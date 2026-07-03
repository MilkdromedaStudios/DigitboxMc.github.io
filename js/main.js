import { Terminal, sleep } from './terminal.js';
import * as mojang from './mojang.js';
import * as vm from './vm.js';
import { mods, pickModFiles, patchClientJar } from './mods.js';

const term = new Terminal(document.getElementById('terminal'));
const gamepanel = document.getElementById('gamepanel');
const display = document.getElementById('display');
const gametitle = document.getElementById('gametitle');
const chips = document.getElementById('chips');

const state = {
  user: null,          // offline profile name
  eulaAccepted: false, // per session, never persisted
};

const jarCache = new Map(); // version id -> client jar bytes (RAM only)

// ---------------- commands ----------------

const commands = {

  help: {
    desc: 'list available commands',
    run() {
      term.print('DIGITBOX MCVM — command reference', 'c-bright');
      const rows = Object.entries(commands).map(([name, c]) => `  ${name.padEnd(10)} ${c.desc}`);
      rows.forEach((r) => term.print(r));
      term.print("Tab-completes commands and version ids. Try: launch 1.2.5", 'c-dim');
    },
  },

  about: {
    desc: 'what this machine is (and is not)',
    run() {
      [
        ['DIGITBOX MCVM v1.0 — a sandboxed Minecraft Java VM in your browser.', 'c-bright'],
        [''],
        ['WHAT IS REAL', 'c-info'],
        ['  • A full JVM (CheerpJ, compiled to WebAssembly) boots in this tab.'],
        ['  • The untouched Minecraft client jar streams from Mojang\'s official'],
        ['    CDN at launch. This repo hosts zero Mojang code or assets.'],
        ['  • Version data comes live from piston-meta.mojang.com.'],
        ['  • ANY version can attempt a launch: the resolver builds the real'],
        ['    launcher pipeline (libraries, arguments) and tells you exactly'],
        ['    what runs and what blocks. --force lets doomed attempts try anyway.'],
        ['  • Jar mods are genuinely injected (ModLoader/early-Forge style).'],
        ['  • Downloads are cached in RAM for instant relaunches this session.'],
        ['  • Nothing persists: all storage is wiped at every boot.'],
        [''],
        ['HARD LIMITS (physics + law, not laziness)', 'c-warn'],
        ['  • 1.2.5 is the proven build. Pre-1.6 (alphas, betas, 1.0–1.5.2) use'],
        ['    the direct Minecraft entry and render — attempt them via play.'],
        ['  • 1.6.x start but BLACK-SCREEN: they use the newer Main launcher'],
        ['    pipeline the browser JVM has no working asset/LWJGL init for.'],
        ['  • 1.7.2–1.12.2 are LOCKED: they need Mojang\'s proprietary authlib,'],
        ['    served only from a CDN that blocks browser fetches (no CORS) and'],
        ['    illegal to re-host. Every pure browser launcher hits this wall —'],
        ['    third-party launcher mirrors (TLauncher etc.) are unauthorized'],
        ['    re-hosting, which this machine will not do.'],
        ['  • 1.13+ additionally need LWJGL3 natives and (1.17+) Java 17: beyond'],
        ['    a browser JVM. So no Fabric (needs 1.14+) and no modern Forge —'],
        ['    jar-mod era Forge/ModLoader mods only.'],
        ['  • Microsoft sign-in is impossible from a static page (Xbox auth'],
        ['    endpoints reject cross-origin browsers). Offline profile only,'],
        ['    singleplayer only.'],
        [''],
        ['Not an official Minecraft product. Not approved by or associated with', 'c-dim'],
        ['Mojang or Microsoft. You must own Minecraft: minecraft.net', 'c-dim'],
      ].forEach(([t, c]) => term.print(t, c));
    },
  },

  versions: {
    desc: 'list versions live from Mojang [release|beta|alpha|all] [query]',
    async run(args) {
      const m = await mojang.getManifest();
      let filter = 'release';
      let query = '';
      for (const a of args) {
        if (['release', 'beta', 'alpha', 'all', 'snapshot'].includes(a)) filter = a;
        else query = a.toLowerCase();
      }
      const typeMap = { beta: 'old_beta', alpha: 'old_alpha', release: 'release', snapshot: 'snapshot' };
      let list = m.versions.filter((v) =>
        (filter === 'all' || v.type === typeMap[filter]) &&
        (!query || v.id.toLowerCase().includes(query)));
      const total = list.length;
      const shown = list.slice(0, 30);
      term.print(`piston-meta.mojang.com ▸ ${m.versions.length} versions indexed ▸ filter=${filter}${query ? ` query=${query}` : ''}`, 'c-info');
      for (const v of shown) {
        const tier = mojang.tierOf(v);
        const lbl = mojang.TIER_LABEL[tier];
        term.printHTML(
          `  <span class="c-bright">${esc(v.id.padEnd(24))}</span>` +
          `${v.type.padEnd(10)}${v.releaseTime.slice(0, 10)}  ` +
          `<span class="${lbl.cls}">${lbl.text}</span>`);
      }
      if (total > shown.length) term.print(`  … ${total - shown.length} more — narrow with a query, e.g. 'versions all 1.4'`, 'c-dim');
      term.print(`latest release: ${m.latest.release}   latest snapshot: ${m.latest.snapshot}`, 'c-dim');
    },
  },

  info: {
    desc: 'inspect one version: info <id>',
    async run(args) {
      if (!args[0]) return term.print('usage: info <version-id>', 'c-warn');
      await mojang.getManifest();
      const v = mojang.findVersion(args[0]);
      if (!v) return term.print(`unknown version '${args[0]}'`, 'c-err');
      const j = await mojang.getVersionJson(v.id);
      const tier = mojang.tierOf(v);
      const client = j.downloads?.client;
      term.print(`${v.id} (${v.type})`, 'c-bright');
      term.print(`  released    ${j.releaseTime?.slice(0, 10) ?? '?'}`);
      term.print(`  main class  ${j.mainClass ?? '?'}`);
      term.print(`  java target ${j.javaVersion?.majorVersion ?? '8 (assumed)'}`);
      term.print(`  client jar  ${client ? (client.size / 1048576).toFixed(1) + ' MiB @ ' + new URL(client.url).host : 'n/a'}`);
      term.print(`  assets      ${j.assets ?? '?'}   libraries ${j.libraries?.length ?? 0}`);
      const lbl = mojang.TIER_LABEL[tier];
      term.printHTML(`  browser vm  <span class="${lbl.cls}">${lbl.text}</span> — ${tierNote(tier)}`);
    },
  },

  login: {
    desc: 'set offline profile name: login <username>',
    run(args) {
      const name = (args[0] ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
      if (!name) return term.print('usage: login <username>  (offline profile, 1-16 chars, a-z 0-9 _)', 'c-warn');
      state.user = name;
      term.setPrompt(`${name}@digitbox:~$ `);
      term.print(`offline profile set: ${name}`, 'c-ok');
      term.print('note: Microsoft/Mojang account sign-in cannot work from a static page —', 'c-dim');
      term.print('Xbox auth endpoints reject cross-origin requests. Singleplayer only.', 'c-dim');
    },
  },

  logout: {
    desc: 'clear offline profile',
    run() {
      state.user = null;
      term.setPrompt('guest@digitbox:~$ ');
      term.print('profile cleared', 'c-ok');
    },
  },

  whoami: {
    desc: 'show current profile',
    run() { term.print(state.user ? `${state.user} (offline profile)` : 'guest (no profile — use: login <name>)'); },
  },

  launch: {
    desc: 'try to run any version: launch <id> [--force]',
    async run(args) {
      if (vm.isGameRunning()) return term.print('a game is already running — hit POWER first', 'c-warn');
      const force = args.includes('--force');
      const id = args.filter((a) => !a.startsWith('--'))[0] ?? '1.2.5';
      await mojang.getManifest();
      const v = mojang.findVersion(id);
      if (!v) return term.print(`unknown version '${id}' — see 'versions all ${esc(id)}'`, 'c-err');
      const tier = mojang.tierOf(v);
      const j = await mojang.getVersionJson(v.id);
      if (!j.downloads?.client?.url) return term.print(`Mojang metadata for ${v.id} has no client jar URL.`, 'c-err');

      // resolve: work out exactly how (or why not) this version can run
      const plan = await vm.resolveLaunchPlan(j);
      const bundled = plan.resolvedLibs.filter((l) => l.via !== 'vm').length;
      term.print(`resolve ${v.id} ▸ entry ${plan.entry}`, 'c-dim');
      term.print(`  libraries: ${plan.resolvedLibs.length} resolved` +
        (bundled ? ` (${bundled} bundled open-source, LWJGL via VM build)` : '') +
        (plan.unresolved.length ? `, ${plan.unresolved.length} not bundled` : ''), plan.unresolved.length ? 'c-warn' : 'c-dim');

      // LOCKED (1.7.2–1.12.2): the missing library is Mojang's proprietary
      // authlib, served only from a CDN that blocks browsers. Hard wall — no
      // flag, no mirror this project will touch.
      if (tier === 'locked') {
        const authlibish = plan.unresolved.filter((n) => /authlib|mojang/.test(n));
        (authlibish.length ? authlibish : plan.unresolved.slice(0, 3)).forEach((n) => term.print('    ✖ ' + n, 'c-err'));
        term.print('LOCKED — no flag can fix this:', 'c-err');
        term.print("  Needs Mojang's proprietary authlib. libraries.minecraft.net blocks", 'c-dim');
        term.print('  browser fetches (no CORS) and re-hosting it is unlawful — the wall', 'c-dim');
        term.print('  every pure browser launcher hits (incl. why TLauncher-style mirrors', 'c-dim');
        term.print('  are off-limits here).', 'c-dim');
        term.print("Playable now: run 'play' to see the list.", 'c-info');
        return;
      }

      // The entry point is the real predictor: only the pre-1.6
      // net.minecraft.client.Minecraft path renders under this browser JVM.
      const directEntry = plan.entry === 'net.minecraft.client.Minecraft';

      // BLANK (1.6.x) — starts but black-screens; and any other Main-pipeline
      // build that slipped past the date tiers.
      if (!directEntry || tier === 'norender' || tier === 'unsupported') {
        plan.gates.forEach((g) => term.print(`  ⛔ ${g.detail}`, 'c-err'));
        if (tier === 'unsupported' && !plan.gates.length) {
          term.print('  ⛔ post-1.12 launcher pipeline beyond the browser JVM', 'c-err');
        } else if (tier !== 'unsupported') {
          term.print(`  ⛔ uses ${plan.entry} (post-1.5 launcher pipeline): starts but`, 'c-err');
          term.print('     black-screens under the browser JVM — no working asset/LWJGL init', 'c-err');
        }
        if (!force) {
          term.print('Expected to black-screen. To watch it try anyway:', 'c-warn');
          term.print(`    launch ${v.id} --force`, 'c-bright');
          term.print("Playable now: run 'play' to see the list.", 'c-info');
          return;
        }
        term.print('  --force: attempting anyway. Expect a black screen — that IS the result.', 'c-warn');
      }

      // Missing metadata libs on the direct-entry path are launcher-side
      // (launchwrapper, asm) and not needed to reach the game. Warn, don't block.
      if (plan.unresolved.length) {
        term.print(`  note: ${plan.unresolved.length} metadata lib(s) not bundled (${plan.unresolved.slice(0, 3).join(', ')}${plan.unresolved.length > 3 ? ', …' : ''});`, 'c-dim');
        term.print('  attempting with client jar + resolved libs anyway.', 'c-dim');
      }

      if (directEntry && tier !== 'supported' && !force) {
        term.print(`⚠ ${v.id} is EXPERIMENTAL under the browser JVM — 1.2.5 is the proven build.`, 'c-warn');
        if (!(await term.confirm('Attempt launch anyway?'))) return term.print('aborted', 'c-dim');
      }

      if (!state.eulaAccepted) {
        term.print('Launching downloads the official client from Mojang\'s CDN.', 'c-info');
        term.print('You must own Minecraft and accept the Minecraft EULA:', 'c-info');
        term.print('  https://www.minecraft.net/eula');
        if (!(await term.confirm('I own the game and accept the EULA.'))) {
          return term.print('launch cancelled — EULA not accepted', 'c-warn');
        }
        state.eulaAccepted = true; // session-only, wiped like everything else
      }

      try {
        await vm.bootJvm(display, (t) => term.print('[vm] ' + t, 'c-dim'));

        let jar = jarCache.get(v.id);
        if (jar) {
          term.print(`client ${v.id} cached in RAM (${(jar.length / 1048576).toFixed(1)} MiB) — skipping download`, 'c-ok');
        } else {
          const url = j.downloads.client.url;
          term.print(`GET ${url}`, 'c-dim');
          const live = term.liveLine('c-info');
          jar = await mojang.download(url, (got, total) =>
            live(progressBar('client.jar', got, total)));
          live(progressBar('client.jar', jar.length, jar.length) + '  done');
          jarCache.set(v.id, jar);
        }

        if (mods.length) {
          term.print(`Applying ${mods.length} jar mod(s) to ${v.id} …`, 'c-info');
          jar = await patchClientJar(jar, (t) => term.print('[mods] ' + t, 'c-dim'));
          term.print(`Patched client ready (${(jar.length / 1048576).toFixed(1)} MiB), signature stripped.`, 'c-ok');
        }

        const user = state.user ?? 'Player' + String(Math.floor(Math.random() * 900) + 100);
        const gameArgs = plan.entry === 'net.minecraft.client.Minecraft'
          ? [user, '-']
          : mojang.buildGameArgs(j, { username: user, gameDir: '/files/mc', assetsDir: '/files/mc/assets' });
        term.print(`Starting ${plan.entry} as '${user}' — sandboxed, nothing will be saved.`, 'c-ok');
        term.print('POWER button (top right) exits and wipes the sandbox.', 'c-dim');
        await sleep(400);

        gametitle.textContent = `MCVM ▸ minecraft ${v.id} ▸ ${user} ▸ ephemeral`;
        gamepanel.hidden = false;
        await vm.launchGame({ id: v.id, plan, jarBytes: jar, args: gameArgs });

        // main() returned — game closed from inside
        gamepanel.hidden = true;
        term.print(`minecraft ${v.id} exited. Sandbox contents discarded on reboot.`, 'c-info');
      } catch (e) {
        gamepanel.hidden = true;
        term.print('launch failed: ' + (e?.message ?? String(e)), 'c-err');
        if (tier !== 'supported') term.print('experimental builds fail in many ways — 1.2.5 is the reliable one.', 'c-dim');
      }
    },
  },

  play: {
    desc: 'pick a playable version from a menu (great on mobile)',
    async run(args) {
      await mojang.getManifest();
      // proven + a curated set of notable pre-1.6 builds (direct-entry era)
      const notable = ['1.2.5', '1.5.2', '1.4.7', '1.3.2', '1.1', '1.0', 'b1.7.3', 'a1.2.6'];
      const rows = notable
        .map((id) => mojang.findVersion(id))
        .filter(Boolean)
        .map((v) => ({ v, tier: mojang.tierOf(v) }))
        .filter((r) => r.tier === 'supported' || r.tier === 'experimental');
      term.print('PLAYABLE — 1.2.5 is proven; the rest are pre-1.6 experimental attempts', 'c-bright');
      rows.forEach((r, i) => {
        const lbl = mojang.TIER_LABEL[r.tier];
        term.printHTML(`  <span class="c-bright">${i + 1})</span> ${esc(r.v.id.padEnd(10))} ` +
          `<span class="${lbl.cls}">${lbl.text}</span>  <span class="c-dim">${r.v.type} · ${r.v.releaseTime.slice(0, 10)}</span>`);
      });
      term.print('Any pre-1.6 build can be tried directly too, e.g. launch b1.6', 'c-dim');
      term.print('1.6.x black-screen, 1.7–1.12 LOCKED (authlib), 1.13+ need LWJGL3 — see about', 'c-dim');
      const pick = (await term.ask('Enter a number to play (blank to cancel):', 'play #> ')).trim();
      if (!pick) return term.print('cancelled', 'c-dim');
      const idx = parseInt(pick, 10) - 1;
      if (isNaN(idx) || !rows[idx]) return term.print('not a valid choice', 'c-warn');
      await commands.launch.run([rows[idx].v.id]);
    },
  },

  loaders: {
    desc: 'list mod loaders present in this VM',
    run() {
      term.print('MOD LOADERS', 'c-bright');
      term.printHTML(`  <span class="badge-ok">PRESENT</span>  jar-mod injection (Risugami ModLoader / early-Forge style)`);
      [
        '    How: staged jars are merged into the client jar in-browser and',
        '    META-INF is stripped. This is the real ≤1.5.x install method, so',
        "    era-appropriate ModLoader/Forge mods load. Use 'mods add'.",
      ].forEach((t) => term.print(t, 'c-dim'));
      term.printHTML(`  <span class="badge-no">ABSENT</span>   Fabric / Quilt — loader needs MC 1.14+ (1.13+ won't run here)`);
      term.printHTML(`  <span class="badge-no">ABSENT</span>   Modern Forge (1.6+ installer) — needs a JVM-side install + authlib-era libs`);
      term.print("Add a mod with 'mods add'; its detected loader is shown in 'mods'.", 'c-info');
    },
  },

  mods: {
    desc: 'jar-mod sandbox: mods [add|rm <n>|clear]',
    async run(args) {
      const sub = args[0];
      if (sub === 'add') {
        term.print('opening file picker — select .jar/.zip mods (ModLoader / jar-mod era) …', 'c-info');
        const added = await pickModFiles();
        if (!added || !added.length) return term.print('no files selected', 'c-dim');
        added.forEach((m) => term.print(`  + ${m.name}  [loader: ${m.loader}]`, 'c-ok'));
        term.print(`${mods.length} mod(s) staged in RAM — they are injected at 'launch'.`, 'c-ok');
        return;
      }
      if (sub === 'rm') {
        const i = parseInt(args[1], 10) - 1;
        if (isNaN(i) || !mods[i]) return term.print('usage: mods rm <number from mods list>', 'c-warn');
        term.print('  - ' + mods[i].name, 'c-warn');
        mods.splice(i, 1);
        return;
      }
      if (sub === 'clear') {
        mods.length = 0;
        return term.print('mod list cleared', 'c-ok');
      }
      term.print('MOD BAY — in-memory only, wiped on reboot', 'c-bright');
      if (!mods.length) term.print('  (empty — stage mods with: mods add)');
      mods.forEach((m, i) => term.print(`  ${i + 1}. ${m.name}  ${(m.size / 1024).toFixed(0)} KiB  [${m.loader ?? 'jar-mod'}]`));
      [
        '',
        'How it works: staged jars are merged into the client jar in-browser and',
        'META-INF is stripped — the authentic ModLoader/early-Forge install, so',
        'era-appropriate jar mods (for 1.2.5 etc.) really load.',
        'Fabric needs MC 1.14+, modern Forge needs 1.6+ tooling: those versions',
        "cannot run in a browser JVM yet — see 'about' for why.",
      ].forEach((t) => term.print(t, 'c-dim'));
    },
  },

  sandbox: {
    desc: 'show sandbox status / guarantees',
    async run() {
      term.print('SANDBOX STATUS', 'c-bright');
      term.print('  mode           ephemeral — RAM + this tab only');
      term.print('  persistence    none: origin storage wiped at every boot & pagehide');
      term.print('  jvm            ' + (vm.isJvmReady() ? 'online (CheerpJ/WASM)' : 'cold (boots at launch)'));
      term.print('  staged mods    ' + mods.length);
      try {
        const est = await navigator.storage?.estimate?.();
        if (est) term.print(`  origin usage   ${((est.usage ?? 0) / 1024).toFixed(0)} KiB (browser-reported)`);
      } catch { /* ignore */ }
      term.print("  wipe now       run 'wipe'   |   full reset: 'reboot'", 'c-dim');
    },
  },

  wipe: {
    desc: 'wipe all origin storage right now',
    async run() {
      const r = await vm.wipeSandbox();
      term.print(`wiped ${r.wiped} database(s); localStorage/sessionStorage cleared`, 'c-ok');
      if (vm.isJvmReady()) term.print('note: live JVM state clears fully on reboot', 'c-dim');
    },
  },

  sysinfo: {
    desc: 'host + vm details',
    run() {
      const gl = (() => {
        try {
          const c = document.createElement('canvas');
          const g = c.getContext('webgl2') || c.getContext('webgl');
          return g ? (g.getParameter(g.VERSION) || 'WebGL') : 'unavailable';
        } catch { return 'unavailable'; }
      })();
      const rows = [
        ['', 'DIGITBOX MCVM v1.0', 'c-bright'],
        ['', '───────────────────'],
        ['host', navigator.platform + ' / ' + (navigator.userAgentData?.brands?.map(b => b.brand).join(', ') || navigator.userAgent.slice(0, 60))],
        ['cores', String(navigator.hardwareConcurrency ?? '?')],
        ['memory', navigator.deviceMemory ? '~' + navigator.deviceMemory + ' GiB (browser-capped)' : 'undisclosed'],
        ['display', screen.width + 'x' + screen.height + ' @' + (window.devicePixelRatio || 1) + 'x'],
        ['webgl', gl],
        ['jvm', vm.isJvmReady() ? 'CheerpJ online (Java 8 / WASM)' : 'cold'],
        ['sandbox', 'ephemeral — nothing persists'],
      ];
      const logo = ['   ▄▄▄▄   ', ' ▄██████▄ ', '██▀ ██ ▀██', '██  ██  ██', '██▄ ██ ▄██', ' ▀██████▀ ', '   ▀▀▀▀   ', '          ', '          '];
      const narrow = matchMedia('(max-width: 640px)').matches;
      rows.forEach(([k, v, c], i) => {
        const body = k ? k.padEnd(9) + v : v;
        term.print(narrow ? body : '  ' + logo[i] + '   ' + body, c ?? '');
      });
    },
  },

  eula: {
    desc: 'links: EULA & where to buy Minecraft',
    run() {
      term.printHTML('  EULA: <a href="https://www.minecraft.net/eula" target="_blank" rel="noopener">minecraft.net/eula</a>');
      term.printHTML('  Buy the game: <a href="https://www.minecraft.net" target="_blank" rel="noopener">minecraft.net</a>');
    },
  },

  echo: { desc: 'echo text', run(args) { term.print(args.join(' ')); } },

  clear: { desc: 'clear the screen (also Ctrl+L)', run() { term.clear(); } },

  reboot: {
    desc: 'power-cycle the VM (wipes everything)',
    async run() {
      term.print('wiping sandbox and rebooting …', 'c-warn');
      await vm.wipeSandbox();
      await sleep(400);
      location.reload();
    },
  },
};

// hidden festivity
commands.creeper = { desc: '', hidden: true, run() { term.print('  ssssss… aw man', 'c-ok'); } };

function tierNote(tier) {
  return {
    supported: 'verified rendering under the WASM JVM',
    experimental: 'pre-1.6 direct-entry era — attempts and often reaches a screen; may crash',
    norender: 'starts but black-screens: 1.6.x Main pipeline has no working asset/LWJGL init here',
    locked: "needs Mojang's proprietary authlib; its CDN blocks browsers (no CORS) and re-hosting is illegal — impossible for any pure browser launcher",
    unsupported: 'needs LWJGL3 natives / newer Java than the browser JVM provides',
  }[tier];
}

// ---------------- dispatch ----------------

term.onCommand = async (line) => {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return;
  const [name, ...args] = tokens;
  const cmd = commands[name.toLowerCase()];
  if (!cmd) {
    term.print(`digitbox: ${name}: command not found — try 'help'`, 'c-err');
    return;
  }
  try {
    await cmd.run(args);
  } catch (e) {
    term.print(name + ': ' + (e?.message ?? String(e)), 'c-err');
  }
};

term.completer = (tokens) => {
  if (tokens.length <= 1) {
    return Object.keys(commands).filter((c) => !commands[c].hidden);
  }
  const cmd = tokens[0].toLowerCase();
  if ((cmd === 'launch' || cmd === 'info') && mojang.manifestCache()) {
    return [...mojang.manifestCache().versions.map((v) => v.id), ...(cmd === 'launch' ? ['--force'] : [])];
  }
  if (cmd === 'versions') return ['release', 'beta', 'alpha', 'snapshot', 'all'];
  if (cmd === 'mods') return ['add', 'rm', 'clear'];
  return [];
};

// ---------------- game panel controls ----------------

document.getElementById('btn-power').addEventListener('click', async () => {
  await vm.wipeSandbox();
  location.reload(); // only reliable way to halt JVM threads — and it re-wipes
});

document.getElementById('btn-fs').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else gamepanel.requestFullscreen?.();
});

const touchkeys = document.getElementById('touchkeys');
document.getElementById('btn-keys').addEventListener('click', () => {
  touchkeys.hidden = !touchkeys.hidden;
});

// Synthetic key events for touch play; CheerpJ listens for standard DOM
// keyboard events on the page.
const KEYMAP = {
  KeyW: ['w', 87], KeyA: ['a', 65], KeyS: ['s', 83], KeyD: ['d', 68],
  KeyE: ['e', 69], Space: [' ', 32], ShiftLeft: ['Shift', 16], Escape: ['Escape', 27],
};
function sendKey(code, type) {
  const [key, keyCode] = KEYMAP[code];
  const ev = new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true });
  (display.querySelector('canvas') ?? display).dispatchEvent(ev);
  document.dispatchEvent(ev);
}
function sendMouse(button, type) {
  const canvas = display.querySelector('canvas') ?? display;
  const r = canvas.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2; // aim at crosshair
  const ev = new MouseEvent(type, { button, buttons: type === 'mousedown' ? (button === 0 ? 1 : 2) : 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
  canvas.dispatchEvent(ev);
}
for (const btn of touchkeys.querySelectorAll('button')) {
  const code = btn.dataset.key;
  const mouse = btn.dataset.mouse;
  if (mouse != null) {
    const b = +mouse;
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); sendMouse(b, 'mousedown'); });
    btn.addEventListener('pointerup', (e) => { e.preventDefault(); sendMouse(b, 'mouseup'); sendMouse(b, 'click'); });
    btn.addEventListener('pointercancel', () => sendMouse(b, 'mouseup'));
  } else {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); sendKey(code, 'keydown'); });
    btn.addEventListener('pointerup', (e) => { e.preventDefault(); sendKey(code, 'keyup'); });
    btn.addEventListener('pointercancel', () => sendKey(code, 'keyup'));
  }
}

// quick-command chips (touch aid)
chips.addEventListener('click', (e) => {
  const cmd = e.target?.dataset?.cmd;
  if (!cmd || term.busy) return;
  term.print(document.getElementById('ps1').textContent + cmd, 'c-bright');
  term._lock();
  Promise.resolve(term.onCommand(cmd)).finally(() => term.ready());
});

// ---------------- boot ----------------

function progressBar(label, got, total) {
  const width = 26;
  const frac = total ? got / total : 0;
  const fill = Math.round(frac * width);
  const bar = '█'.repeat(fill) + '░'.repeat(width - fill);
  const mib = (n) => (n / 1048576).toFixed(1);
  return `${label.padEnd(12)}[${bar}] ${mib(got)}/${total ? mib(total) : '?'} MiB`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function boot() {
  const wipe = vm.wipeSandbox(); // sandbox guarantee: wipe BEFORE anything runs
  await term.boot([
    ['DIGITBOX(R) MCVM BIOS v1.0 — 2026 Milkdromeda Studios', 'c-bright', 120],
    ['CPU: ' + (navigator.hardwareConcurrency ?? '?') + ' logical cores detected', '', 60],
    ['MEM: ' + (navigator.deviceMemory ? navigator.deviceMemory + ' GiB visible to browser' : 'probing… OK'), '', 60],
    ['', '', 30],
    ['Mounting /app  (read-only HTTP mount) …………… OK', '', 90],
    ['Mounting /files (ephemeral RAM/IndexedDB) …… OK', '', 90],
  ]);

  const w = await wipe;
  term.print(`Sandbox scrub: ${w.wiped} stale database(s) destroyed …… CLEAN`, 'c-ok');
  term.print('Persistence: DISABLED — this machine forgets everything on reboot', 'c-warn');
  await sleep(120);

  const netLine = term.liveLine('c-info');
  netLine('Contacting Mojang piston-meta ……');
  try {
    const m = await mojang.getManifest();
    netLine(`Contacting Mojang piston-meta …… OK (${m.versions.length} versions indexed, latest ${m.latest.release})`);
  } catch (e) {
    netLine('Contacting Mojang piston-meta …… FAILED (' + e.message + ') — offline mode');
  }

  const banner = matchMedia('(max-width: 640px)').matches
    ? [
        ['  ▄▄▄ DIGITBOX ▄▄▄', 'c-bright', 40],
        ['  ▀▀ MCVM  v1.0 ▀▀', 'c-dim', 60],
      ]
    : [
        ['  ██████▄  ██  ▄████▄  ██ ▄████████ ██████▄   ▄████▄  ▀██  ██▀', 'c-bright', 30],
        ['  ██   ██  ██ ██       ██    ██     ██    ██ ██    ██   ████  ', 'c-bright', 30],
        ['  ██   ██  ██ ██  ▄▄▄  ██    ██     ██████▀  ██    ██   ▄██▄  ', 'c-bright', 30],
        ['  ██████▀  ██  ▀████▀  ██    ██     ██████▀   ▀████▀  ▄██  ██▄', 'c-bright', 30],
        ['                                          M C V M   v 1 . 0   ', 'c-dim', 60],
      ];
  await term.boot([
    ['JVM: CheerpJ/WASM runtime …… cold (boots on first launch)', 'c-dim', 70],
    ['', '', 40],
    ...banner,
    ['', '', 30],
    ['Sandboxed Minecraft Java VM — in your browser, forgetting by design.', '', 50],
    ["Type 'play' to pick a version, 'help' for commands, 'about' for what's real:", '', 40],
    ['', '', 20],
    ['    play', 'c-bright', 20],
    ['    launch 1.2.5', 'c-bright', 40],
    ['', '', 20],
    ['Not an official Minecraft product; not approved by or associated with', 'c-dim', 20],
    ['Mojang or Microsoft. Game code streams from Mojang at runtime.', 'c-dim', 20],
  ], 40);

  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch) chips.hidden = false;
  term.ready();
  if (!touch) term.focus(); // on touch, let the user tap the visible bar (avoids a forced keyboard pop)
}

boot();

// console/debug handle (everything here is ephemeral anyway)
window.MCVM = { term, mods, state, vm, mojang };
