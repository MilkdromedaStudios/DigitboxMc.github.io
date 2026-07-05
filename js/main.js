// DIGITBOX DEV VM — a guided, tap-first Minecraft modding dev loop.
// No shell, no typed commands: boot → pick a version → stage mods → run.
// Logs stream in the terminal until the game takes the screen; the LOGS
// button brings them back. Everything is ephemeral by design.

import { Term, C, sleep } from './term.js';
import * as mojang from './mojang.js';
import * as vm from './vm.js';
import * as x86 from './x86vm.js';
import { mods, pickModFiles, patchClientJar } from './mods.js';
import { sendKey, sendMouse } from './input.js';
import { AI } from './ai.js';

const term = new Term(document.getElementById('term'), document.getElementById('tray'));
const gamepanel = document.getElementById('gamepanel');
const display = document.getElementById('display');
const gametitle = document.getElementById('gametitle');
const touchkeys = document.getElementById('touchkeys');
const btnLogs = document.getElementById('btn-logs');
const TOUCH = matchMedia('(pointer: coarse)').matches;

const state = {
  user: 'Dev' + String(Math.floor(Math.random() * 900) + 100),
  eulaAccepted: false, // per session, never persisted
  version: null,       // manifest entry of the selected version
  json: null,          // its full version JSON
};

const jarCache = new Map(); // version id -> client jar bytes (RAM only)

// versions offered up front: the proven build plus notable pre-1.6 releases
const CURATED = ['1.2.5', '1.5.2', '1.4.7', '1.3.2', '1.1', '1.0', 'b1.7.3', 'a1.2.6'];

// ---------------- boot ----------------

async function boot() {
  const wipe = vm.wipeSandbox(); // sandbox guarantee: wipe BEFORE anything runs
  await term.boot([
    ['DIGITBOX(R) DEV VM BIOS v2.0 — 2026 Milkdromeda Studios', C.bright, 120],
    ['CPU: ' + (navigator.hardwareConcurrency ?? '?') + ' logical cores detected', '', 60],
    ['MEM: ' + (navigator.deviceMemory ? navigator.deviceMemory + ' GiB visible to browser' : 'probing… OK'), '', 60],
    ['', '', 30],
    ['Mounting /app   (read-only HTTP mount) …………… OK', '', 90],
    ['Mounting /files (ephemeral RAM/IndexedDB) …… OK', '', 90],
  ]);

  const w = await wipe;
  term.print(`Sandbox scrub: ${w.wiped} stale database(s) destroyed …… CLEAN`, C.ok);
  term.print('Persistence: DISABLED — this machine forgets everything on reboot', C.warn);
  await sleep(120);

  const net = term.live(C.info);
  net('Contacting Mojang piston-meta ……');
  try {
    const m = await mojang.getManifest();
    net.done(`Contacting Mojang piston-meta …… OK (${m.versions.length} versions indexed, latest ${m.latest.release})`);
  } catch (e) {
    net.done('Contacting Mojang piston-meta …… FAILED (' + e.message + ') — will retry at setup');
  }

  const banner = term.cols >= 66
    ? [
        ['  ██████▄  ██  ▄████▄  ██ ▄████████ ██████▄   ▄████▄  ▀██  ██▀', C.bright, 30],
        ['  ██   ██  ██ ██       ██    ██     ██    ██ ██    ██   ████  ', C.bright, 30],
        ['  ██   ██  ██ ██  ▄▄▄  ██    ██     ██████▀  ██    ██   ▄██▄  ', C.bright, 30],
        ['  ██████▀  ██  ▀████▀  ██    ██     ██████▀   ▀████▀  ▄██  ██▄', C.bright, 30],
        ['                                        D E V   V M   v 2 . 0 ', C.dim, 60],
      ]
    : [
        ['  ▄▄▄ DIGITBOX ▄▄▄', C.bright, 40],
        ['  ▀▀ DEV VM v2.0 ▀▀', C.dim, 60],
      ];
  await term.boot([
    ['JVM: CheerpJ/WASM runtime …… cold (boots at run)', C.dim, 70],
    ['', '', 40],
    ...banner,
    ['', '', 30],
    ['Free Minecraft modding dev VM — a Fabric-style dev loop, entirely in', '', 50],
    ['your browser: pick a version, drop mods in, hit run, watch the logs.', '', 40],
    ['Nothing installs, no account, nothing saved. Every choice is a button.', '', 40],
    ['', '', 20],
    ['Not an official Minecraft product; not approved by or associated with', C.dim, 20],
    ['Mojang or Microsoft. Game code streams from Mojang at runtime.', C.dim, 20],
  ], 40);

  mainMenu();
}

// ---------------- run-mode picker ----------------

async function mainMenu() {
  term.print('');
  term.print('SELECT RUN MODE', C.bright);
  const mode = await term.choose([
    { label: '▶ MINECRAFT — browser JVM (runs 1.2.5 ✓, attempts pre-1.6)', value: 'mc', kind: 'primary', echo: 'run minecraft' },
    { label: '🖥 REAL x86 LINUX VM — full-system emulator (experimental)', value: 'x86', kind: '', echo: 'run x86vm' },
  ]);
  if (mode === 'x86') return x86Intro();
  return wizard();
}

// ---------------- the guided loop ----------------

async function wizard() {
  const v = await stepVersion();
  await stepMods();
  await stepRun(v);
}

async function getManifestUI() {
  for (;;) {
    try { return await mojang.getManifest(); }
    catch (e) {
      term.print('cannot reach piston-meta.mojang.com: ' + e.message, C.err);
      term.print('the version list comes live from Mojang — check the connection', C.dim);
      await term.choose([{ label: '↻ RETRY', value: 1, kind: 'warn', echo: 'retry' }]);
    }
  }
}

// [1/3] version
async function stepVersion() {
  term.print('');
  term.print('STEP 1/3 ▸ SELECT MINECRAFT VERSION', C.bright);
  term.print('1.2.5 is the proven build. Other pre-1.6 builds attempt for real and', C.dim);
  term.print('often reach a screen — they are marked experimental.', C.dim);

  for (;;) {
    const m = await getManifestUI();

    const opts = CURATED
      .map((id) => mojang.findVersion(id))
      .filter(Boolean)
      .map((v) => ({
        label: v.id === '1.2.5' ? 'minecraft 1.2.5 — proven ✓' : `minecraft ${v.id}`,
        value: v,
        kind: v.id === '1.2.5' ? 'primary' : '',
        echo: 'mc use ' + v.id,
      }));
    opts.push({ label: 'ALL PRE-1.6 VERSIONS…', value: 'more', kind: 'dim', echo: 'mc list --all' });
    opts.push({ label: 'WHY ONLY OLD VERSIONS?', value: 'why', kind: 'dim', echo: 'mc doctor' });

    let pick = await term.choose(opts);

    if (pick === 'why') { explainVersions(); continue; }

    if (pick === 'more') {
      const all = m.versions.filter((v) => ['supported', 'experimental'].includes(mojang.tierOf(v)));
      term.print(`${all.length} launchable (pre-1.6) builds — newest first, releases to alphas`, C.dim);
      pick = await term.choose([
        { label: '← BACK', value: 'back', kind: 'dim', echo: false },
        ...all.map((v) => ({ label: v.id, value: v, echo: 'mc use ' + v.id })),
      ], { scroll: true });
      if (pick === 'back') continue;
    }

    const v = pick;
    let j;
    try { j = await mojang.getVersionJson(v.id); }
    catch (e) { term.print('metadata fetch failed: ' + e.message, C.err); continue; }
    if (!j.downloads?.client?.url) {
      term.print(`Mojang metadata for ${v.id} has no client jar URL — pick another.`, C.err);
      continue;
    }

    const client = j.downloads.client;
    term.print(`${v.id} (${v.type})  released ${j.releaseTime?.slice(0, 10) ?? '?'}  client jar ${(client.size / 1048576).toFixed(1)} MiB`, C.bright);

    if (mojang.tierOf(v) !== 'supported') {
      term.print(`⚠ ${v.id} is EXPERIMENTAL under the browser JVM — it may crash or`, C.warn);
      term.print('  misrender. 1.2.5 is the proven one.', C.warn);
      const go = await term.choose([
        { label: `ATTEMPT ${v.id} ANYWAY ▸`, value: true, kind: 'warn', echo: 'mc use ' + v.id + ' --experimental' },
        { label: 'PICK A DIFFERENT VERSION', value: false, kind: 'dim', echo: 'mc use --abort' },
      ]);
      if (!go) continue;
    }

    state.version = v;
    state.json = j;
    return v;
  }
}

function explainVersions() {
  [
    ['WHY ONLY PRE-1.6 VERSIONS? (physics + law, not laziness)', C.info],
    ['  • Pre-1.6 uses the direct net.minecraft.client.Minecraft entry, which', ''],
    ['    genuinely renders under the WebAssembly JVM — 1.2.5 is proven.', ''],
    ['  • 1.6.x switched launcher pipelines: it starts here but black-screens.', ''],
    ["  • 1.7.2–1.12.2 need Mojang's proprietary authlib. Its CDN blocks browser", ''],
    ['    fetches (no CORS) and re-hosting it is unlawful — the wall every pure', ''],
    ['    browser launcher hits. No mirror tricks here.', ''],
    ['  • 1.13+ need LWJGL3 natives and (1.17+) Java 17 — beyond a browser JVM.', ''],
    ['    That is also why real Fabric (MC 1.14+) cannot load: this VM gives you', ''],
    ['    the free jar-mod-era equivalent of that dev loop instead.', ''],
  ].forEach(([t, c]) => term.print(t, c));
}

// [2/3] mods
async function stepMods() {
  term.print('');
  term.print('STEP 2/3 ▸ ADD MODS (optional)', C.bright);
  term.print('Staged jars are merged into the client jar with META-INF stripped —', C.dim);
  term.print('the authentic ModLoader / early-Forge install for this era, done in', C.dim);
  term.print('RAM. Era-appropriate jar mods (≤1.5.x) really load.', C.dim);

  for (;;) {
    if (mods.length) {
      term.print('mod bay:', C.info);
      mods.forEach((m, i) => term.print(`  ${i + 1}. ${m.name}  ${(m.size / 1024).toFixed(0)} KiB  [${m.loader ?? 'jar-mod'}]`));
    }

    const opts = [];
    if (!mods.length) {
      opts.push({ label: '＋ ADD MOD JARS', value: 'add', kind: 'primary', echo: 'mods add' });
      opts.push({ label: 'CONTINUE WITHOUT MODS ▸', value: 'done', kind: 'ok', echo: 'mods skip' });
    } else {
      opts.push({ label: `CONTINUE WITH ${mods.length} MOD${mods.length > 1 ? 'S' : ''} ▸`, value: 'done', kind: 'primary', echo: 'mods done' });
      opts.push({ label: '＋ ADD MORE', value: 'add', echo: 'mods add' });
      opts.push({ label: 'REMOVE ALL', value: 'clear', kind: 'danger', echo: 'mods clear' });
    }
    const a = await term.choose(opts);

    if (a === 'add') {
      term.print('file picker open — select .jar/.zip mods (ModLoader / jar-mod era)', C.info);
      const added = await pickModFiles();
      if (!added || !added.length) { term.print('no files selected', C.dim); continue; }
      for (const mod of added) {
        const doomed = /cannot run here/.test(mod.loader);
        term.print(`  + ${mod.name}  [loader: ${mod.loader}]`, doomed ? C.warn : C.ok);
        if (doomed) term.print('    ⚠ that loader needs a newer Minecraft than any browser JVM can run', C.warn);
      }
      continue;
    }
    if (a === 'clear') { mods.length = 0; term.print('mod bay cleared', C.ok); continue; }
    return; // done
  }
}

// [3/3] run
async function stepRun(v) {
  term.print('');
  term.print('STEP 3/3 ▸ RUN', C.bright);

  if (!state.eulaAccepted) {
    term.print("Running streams the official client jar from Mojang's CDN.", C.info);
    term.print('You must own Minecraft and accept the Minecraft EULA:', C.info);
    term.print('  https://www.minecraft.net/eula');
    const ok = await term.choose([
      { label: '✔ I OWN MINECRAFT — ACCEPT EULA & RUN ▸', value: true, kind: 'primary', echo: 'eula accept && ./runClient ' + v.id },
      { label: '⟲ START OVER', value: false, kind: 'dim', echo: 'exit' },
    ]);
    if (!ok) { term.print('run cancelled — EULA not accepted', C.warn); return wizard(); }
    state.eulaAccepted = true; // session-only, wiped like everything else
  } else {
    term.cmd('./runClient ' + v.id);
  }

  await runClient(v);
}

async function runClient(v) {
  const j = state.json;
  try {
    const plan = await vm.resolveLaunchPlan(j);
    const bundled = plan.resolvedLibs.filter((l) => l.via !== 'vm').length;
    term.print(`resolve ${v.id} ▸ entry ${plan.entry}`, C.dim);
    term.print(`  libraries: ${plan.resolvedLibs.length} resolved` +
      (bundled ? ` (${bundled} bundled open-source, LWJGL via VM build)` : '') +
      (plan.unresolved.length ? `, ${plan.unresolved.length} launcher-side libs skipped` : ''), C.dim);

    await vm.bootJvm(display, (t) => term.print('[vm] ' + t, C.dim));

    let jar = jarCache.get(v.id);
    if (jar) {
      term.print(`client ${v.id} cached in RAM (${(jar.length / 1048576).toFixed(1)} MiB) — skipping download`, C.ok);
    } else {
      const url = j.downloads.client.url;
      term.print(`GET ${url}`, C.dim);
      const live = term.live(C.info);
      jar = await mojang.download(url, (got, total) => live(progressBar('client.jar', got, total)));
      live.done(progressBar('client.jar', jar.length, jar.length) + '  done');
      jarCache.set(v.id, jar);
    }

    if (mods.length) {
      term.print(`Applying ${mods.length} jar mod(s) to ${v.id} …`, C.info);
      jar = await patchClientJar(jar, (t) => term.print('[mods] ' + t, C.dim));
      term.print(`Patched client ready (${(jar.length / 1048576).toFixed(1)} MiB), signature stripped.`, C.ok);
    }

    const gameArgs = plan.entry === 'net.minecraft.client.Minecraft'
      ? [state.user, '-']
      : mojang.buildGameArgs(j, { username: state.user, gameDir: '/files/mc', assetsDir: '/files/mc/assets' });
    term.print(`Starting ${plan.entry} as '${state.user}' — sandboxed, nothing is saved.`, C.ok);
    term.print('The game takes the screen when it opens; ☰ LOGS brings these back.', C.dim);
    await sleep(400);

    gametitle.textContent = `DEV VM ▸ minecraft ${v.id} ▸ ${state.user} ▸ ephemeral`;
    showGame(true);
    mirrorConsole(true); // pipe the game's real stdout/stderr into the terminal
    try {
      await vm.launchGame({ id: v.id, plan, jarBytes: jar, args: gameArgs });
    } finally {
      mirrorConsole(false);
    }

    // main() returned — game closed from inside
    showGame(false);
    term.print(`minecraft ${v.id} exited. Sandbox contents evaporate on reboot.`, C.info);
  } catch (e) {
    mirrorConsole(false);
    showGame(false);
    term.print('run failed: ' + (e?.message ?? String(e)), C.err);
    if (mojang.tierOf(v) !== 'supported') term.print('experimental builds fail in many ways — 1.2.5 is the reliable one.', C.dim);
  }
  await afterRun(v);
}

async function afterRun(v) {
  const a = await term.choose([
    { label: '▶ RUN AGAIN', value: 'again', kind: 'primary', echo: './runClient ' + v.id },
    { label: '⟲ CHANGE VERSION / MODS', value: 'change', kind: '', echo: 'setup' },
    { label: '⏻ REBOOT VM (full wipe)', value: 'reboot', kind: 'danger', echo: 'reboot' },
  ]);
  if (a === 'again') {
    if (vm.isGameRunning()) { term.print('a game is still running — hit ⏻ POWER first', C.warn); return afterRun(v); }
    return runClient(v);
  }
  if (a === 'change') return wizard();
  await vm.wipeSandbox();
  location.reload();
}

// ---------------- real x86 VM flow ----------------

let x86Input = null; // xterm input disposable while the VM is live

async function x86Intro() {
  term.print('');
  term.print('REAL x86 VIRTUAL MACHINE (experimental)', C.bright);
  [
    'This boots a genuine full-system emulator (v86, a WebAssembly x86 PC):',
    'SeaBIOS, an x86 CPU, RAM and devices — then a small Linux kernel to a real',
    'shell on the serial console. Unlike the Minecraft mode (which is a Java VM),',
    'this is a whole emulated computer. The terminal below becomes its console.',
  ].forEach((t) => term.print(t, C.dim));
  term.print('Honest limits:', C.warn);
  [
    '  • No GPU is emulated — this is a text/serial machine. It proves "a real VM',
    '    in the browser", but it will NOT run modern Minecraft playably (that needs',
    '    a GPU and a hundreds-of-MB JRE). Use the Minecraft (browser JVM) mode to',
    '    actually play 1.2.5.',
    '  • Everything is ephemeral: the machine is discarded when you power it off.',
  ].forEach((t) => term.print(t, C.dim));

  const go = await term.choose([
    { label: '⚡ BOOT THE x86 VM ▸', value: true, kind: 'primary', echo: './boot-vm.sh ' + x86.IMAGE_NAME },
    { label: '← BACK TO RUN MODE', value: false, kind: 'dim', echo: false },
  ]);
  if (!go) return mainMenu();
  await bootX86();
}

async function bootX86() {
  term.cmd('./boot-vm.sh --serial');
  const prog = term.live(C.info);
  prog(`fetching ${x86.IMAGE_NAME} …`);
  try {
    await x86.boot({
      onSerial: (s) => term.raw(s),
      onProgress: (e) => {
        if (e && e.total) prog(progressBar('kernel image', e.loaded || 0, e.total));
      },
      log: (t) => term.print('[x86] ' + t, C.dim),
    });
    prog.done('kernel image loaded — powering on the emulated PC …');
    term.print('');
    term.print('── serial console (ttyS0) — a real emulated x86 machine ──', C.dim);
    term.print('Type below (Enter runs). Try: uname -a · cat /proc/cpuinfo · ls /', C.dim);
    term.raw('\r\n');
    x86Input = term.onInput((d) => x86.send(d)); // terminal → guest keystrokes
    term.focusTerm();
    x86Controls();
  } catch (e) {
    prog.done('x86 VM failed to boot: ' + (e?.message ?? String(e)));
    await afterX86();
  }
}

// Persistent controls: quick commands (great on mobile, no typing needed) + stop.
function x86Controls() {
  term.toolbar([
    { label: 'uname -a', onClick: () => x86.send('uname -a\n') },
    { label: 'cpuinfo', onClick: () => x86.send('head -20 /proc/cpuinfo\n') },
    { label: 'ls /', onClick: () => x86.send('ls -la /\n') },
    { label: 'free', onClick: () => x86.send('free -m\n') },
    { label: '⌨ TYPE HERE', onClick: () => term.focusTerm() },
    { label: '⏻ POWER OFF VM', kind: 'danger', onClick: () => stopX86() },
  ]);
}

async function stopX86() {
  if (x86Input) { try { x86Input.dispose(); } catch { /* ignore */ } x86Input = null; }
  await x86.stop();
  term.hideTray();
  term.print('');
  term.print('x86 VM powered off. Nothing was saved.', C.info);
  await afterX86();
}

async function afterX86() {
  const a = await term.choose([
    { label: '⚡ BOOT THE x86 VM AGAIN', value: 'again', kind: 'primary', echo: './boot-vm.sh' },
    { label: '▶ SWITCH TO MINECRAFT MODE', value: 'mc', echo: 'run minecraft' },
    { label: '⏻ REBOOT PAGE (full wipe)', value: 'reboot', kind: 'danger', echo: 'reboot' },
  ]);
  if (a === 'again') return bootX86();
  if (a === 'mc') return wizard();
  await vm.wipeSandbox();
  location.reload();
}

// ---------------- game panel ----------------

function showGame(on) {
  gamepanel.hidden = !on;
  document.body.classList.toggle('ingame', on);
  document.body.classList.remove('logsview');
  btnLogs.textContent = '☰ LOGS';
  if (on && TOUCH) touchkeys.hidden = false; // pad appears automatically on touch
  AI.setInGame(on); // reveal the AI launcher only while a game is on screen
}

btnLogs.addEventListener('click', () => {
  const showing = document.body.classList.toggle('logsview');
  btnLogs.textContent = showing ? '▶ GAME' : '☰ LOGS';
  if (showing) term.xt.scrollToBottom();
});

document.getElementById('btn-power').addEventListener('click', async () => {
  await vm.wipeSandbox();
  location.reload(); // only reliable way to halt JVM threads — and it re-wipes
});

document.getElementById('btn-fs').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else gamepanel.requestFullscreen?.();
});

document.getElementById('btn-keys').addEventListener('click', () => {
  touchkeys.hidden = !touchkeys.hidden;
});

// AI assistant + restricted possession mode. Local/offline: it only ever
// dispatches the same synthetic input the touch pad does, so it can mine and
// move but can never PvP, chat, or do anything ban-worthy. See ai.js.
AI.init({ isGameRunning: vm.isGameRunning });
document.getElementById('btn-ai').addEventListener('click', () => AI.toggle());

// Synthetic key/mouse events for touch play (shared with the AI possession
// engine, see input.js); CheerpJ listens for standard DOM events on the page.
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

// ---------------- log mirroring ----------------

// While the game runs, its System.out/err arrive via the JS console
// (CheerpJ routes them there). Mirror them into the terminal so ☰ LOGS
// shows the real game log, dev-environment style.
const consoleOrig = {};
function mirrorConsole(on) {
  const levels = ['log', 'info', 'warn', 'error'];
  if (on) {
    for (const k of levels) {
      if (consoleOrig[k]) continue;
      consoleOrig[k] = console[k].bind(console);
      console[k] = (...args) => {
        consoleOrig[k](...args);
        try {
          const s = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ').replace(/\s+$/, '');
          if (s) term.print(s.slice(0, 400), k === 'error' ? C.err : k === 'warn' ? C.warn : C.dim);
        } catch { /* never let logging break the game */ }
      };
    }
  } else {
    for (const k of levels) {
      if (consoleOrig[k]) { console[k] = consoleOrig[k]; delete consoleOrig[k]; }
    }
  }
}

// ---------------- misc ----------------

function progressBar(label, got, total) {
  const width = Math.max(8, Math.min(26, term.cols - 34));
  const frac = total ? got / total : 0;
  const fill = Math.round(frac * width);
  const bar = '█'.repeat(fill) + '░'.repeat(width - fill);
  const mib = (n) => (n / 1048576).toFixed(1);
  return `${label.padEnd(12)}[${bar}] ${mib(got)}/${total ? mib(total) : '?'} MiB`;
}

boot();

// console/debug handle (everything here is ephemeral anyway)
window.MCVM = { term, mods, state, vm, mojang, AI };
