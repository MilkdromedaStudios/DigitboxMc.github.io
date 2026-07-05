# DIGITBOX DEV VM

A retro CRT **VM in your browser that walks you through a Minecraft modding
dev loop and runs the real game** — hosted entirely on GitHub Pages, 100%
free, no backend, nothing installed, nothing saved, **nothing to type**.

```
dev@digitbox:~/mc-workspace$ ./runClient 1.2.5
```

It boots, asks you to **pick a Minecraft version**, lets you **drop in mods**,
and then **just runs**: logs stream in the terminal until the game window
opens, then the game takes the screen (☰ LOGS brings the log view back at any
time). A Fabric-style dev-environment loop — pick version → stage mods →
runClient → read logs — for the jar-mod era that a browser JVM can genuinely
run.

## Two VMs

At boot you pick a **run mode**:

- **Minecraft (browser JVM)** — the default, described above. [CheerpJ](https://cheerpj.com) is a real *Java* VM (a JVM compiled to WebAssembly); it runs the untouched official client. This is the mode that actually plays: 1.2.5 is proven and every pre-1.6 build attempts for real.
- **Real x86 Linux VM (experimental)** — [v86](https://github.com/copy/v86) is a full-system emulator: a genuine emulated PC (SeaBIOS, x86 CPU, RAM, devices) that boots a small Linux kernel to a real shell. Its serial console *is* the terminal — type commands, run `uname -a`, `cat /proc/cpuinfo`, `ls /`. This answers "make it an actual VM, not just Browsercraft": it is a whole emulated computer, not a JVM.

**Why the x86 VM does not run Minecraft:** v86 emulates no GPU, so it is a text/serial machine — it proves "a real VM in the browser" but modern Minecraft needs a GPU and a hundreds-of-MB JRE, which a software-emulated PC in a tab cannot drive at a playable frame rate. Running Minecraft for real is what the browser-JVM mode is for. (Running *all* versions / Fabric in a browser is blocked by hard walls; see [Honest limits](#honest-limits) — every Fabric version uses LWJGL 3, whose GLFW native windowing has no browser implementation.)

## How it works

| Piece | What actually happens |
|---|---|
| Terminal | A real terminal — vendored [xterm.js](https://xtermjs.org) 5.5 — that the VM streams its boot + build + game logs into. There is no command line to learn: every decision is a big tap-friendly button (number keys 1–9 work too) |
| Guided flow | 1) select a version (curated list or every launchable pre-1.6 build, live from Mojang) → 2) stage mod jars (optional) → 3) accept the EULA gate and run |
| Java | [CheerpJ](https://cheerpj.com) — a full JVM compiled to WebAssembly, loaded at run time |
| Graphics | LWJGL 2.9.3 with a patched native layer + [gl4es](https://github.com/ptitSeb/gl4es) translating OpenGL → WebGL (approach pioneered by [Browsercraft](https://github.com/leaningtech/browsercraft)) |
| Minecraft itself | The **untouched official client jar is streamed from Mojang's CDN at run** (`piston-data.mojang.com`). This repository contains **zero** Mojang code or assets |
| Logs | Download progress, library resolution and JVM boot stream into the terminal; once the game launches the logs hide behind it. The game's real `System.out`/`System.err` are mirrored into the terminal, so ☰ LOGS shows a live game log, dev-env style |
| Mod loading | Staged jars are genuinely merged into the client jar with `META-INF` stripped — the authentic ModLoader / early-Forge install procedure, performed in-browser and in RAM. Each mod's loader is auto-detected; Fabric/Quilt/modern-Forge files are flagged as impossible here |
| Real x86 VM | [v86](https://github.com/copy/v86) (MIT) — an x86 PC emulator in WebAssembly. Core, SeaBIOS and a ~5 MiB buildroot Linux kernel are all vendored in `vendor/v86/`, so the machine is fully self-contained. The guest's serial console is wired straight into the terminal, and quick-command buttons (`uname -a`, `cpuinfo`, `ls /`, `free`) make it usable on mobile without typing |
| Sandbox | All origin storage (IndexedDB, localStorage) is destroyed on every boot and on page hide. ⏻ POWER wipes and reboots. Nothing persists, by design |
| Mobile | No soft keyboard is forced — the whole flow is buttons. Full-width tap targets, safe-area-aware layout, and an on-screen game pad (W/A/S/D/JUMP/SNEAK + MINE/USE) that appears automatically on touch devices. In the x86 VM, `⌨ TYPE HERE` raises the soft keyboard on demand |
| AI assistant | A tiny **🤖 AI** puck under the game bar opens a mini, tabbed panel: **Chat** (an offline mini-wiki that answers survival questions and drops private tips) and **Possess** (a *restricted* auto-play mode). It's local — no backend, no accounts, no network — so it works on any server and, by construction, cannot get you banned. See below |

## AI assistant + restricted possession

A **🤖 AI** button on the game bar opens an absolutely-mini panel (tucked under
the bar on the right, clear of the touch pad — it never overlaps another
button). The overlay is click-through, so empty space still taps the game; only
the panel itself takes input. It has two tabs:

- **Chat** — a private, offline "mini-wiki". Ask it about mining, diamonds,
  tools, mobs, food, the Nether or surviving the first night and it answers from
  a built-in knowledge base. It can also **watch the screen and drop occasional
  tips** (e.g. "it looks dark — mobs spawn in low light") into this chat, and
  this chat only. History is saved **up to 100 messages per chat and up to 100
  saved chats** (a ring buffer; oldest drop off), with a chat switcher, scrolling
  and compact text so it never gets overwhelming. It is reachable whenever the
  mouse is free — the ESC menu, your inventory, a chest, any open UI.
- **Possess (restricted)** — engage it, aim your crosshair, and type an
  instruction ("mine", "tunnel 10s", "walk forward 5s", "strafe left", "jump",
  "sneak", "use", "slot 3"). The AI carries it out for you. Continuous tasks
  auto-stop after 60 s (or your stated duration), and **■ STOP** drops everything
  instantly.

**Why it works on any server — even without BlockPal.** Nothing is installed
server-side. Possession drives the game the exact same way the on-screen touch
pad does: ordinary DOM keystrokes and clicks aimed at the game canvas — the same
events a human hand produces. There is no companion mod to require and no server
plugin to detect.

**Why it can't get you banned.** Because it can only do what a legitimate player
physically can, it stays inside the rules on every server:

- **No PvP and no combat at all** — without BlockPal it is deliberately limited
  to *basic tasks* (mining, gathering, moving) so it can never gain an unfair
  fighting advantage. Any instruction mentioning attacking, hitting, killing or
  PvP is hard-refused.
- **It never touches the game's chat box** and never runs commands — chat/say/
  command intents are refused, and the possession engine has no key bound to
  chat.
- **No cheat surface**: there's no packet layer to forge, so fly, reach, x-ray,
  no-fall, speed and kill-aura are simply unreachable; clicks are paced to human
  speed (mining is a held button, not an auto-clicker).
- **Everything is local and private**: no data leaves your browser, and (like
  the rest of this VM) the chat history is ephemeral — it's wiped on power-off.

The **🛡 RESTRICTED · no PvP · no chat · ban-safe** badge on the Possess tab is a
standing reminder of exactly what it will and won't do.

## Honest limits

This is a real browser JVM, not magic. Verified by launching each era:

- **Minecraft 1.2.5 is the proven build.** Pre-1.6 releases (alphas, betas,
  1.0–1.5.2) use the direct `net.minecraft.client.Minecraft` entry and genuinely
  render — they're offered as *experimental*.
- **1.6.x start but black-screen.** They switched to the newer `client.main.Main`
  launcher pipeline, which the browser JVM has no working asset/LWJGL init for.
- **1.7.2–1.12.2 are locked** by Mojang's proprietary `authlib`: it is only served
  from `libraries.minecraft.net`, which blocks browser fetches (no CORS), and
  re-hosting it is unlawful. Every pure browser launcher hits this exact wall.
  Third-party launcher mirrors (TLauncher/SKLauncher-style) are unauthorized
  re-hosting of Mojang files, and this project will not use them.
- **1.13+ additionally need LWJGL3 natives** (and 1.17+ need Java 17) that a browser
  JVM cannot provide. Consequently **real Fabric cannot load** (it needs MC 1.14+)
  and neither can modern Forge — this VM gives you the free jar-mod-era
  equivalent of that dev loop instead (ModLoader / early Forge for ≤1.5.x).
  The in-VM **WHY ONLY OLD VERSIONS?** button explains the same thing.
- **No Microsoft sign-in**: Xbox/Minecraft auth services reject cross-origin browser
  requests, and a static page has no server to hold secrets. You play as an
  auto-generated offline profile; singleplayer only.
- Performance depends on the device; a desktop browser is recommended. It does start
  on Android Chrome, slowly.
- **The AI is a small offline helper, not a large model.** It answers from a built-in
  knowledge base (so it's best on the classic-era topics this VM runs) and possesses
  the player through plain synthetic input — it has no world map, so it can't pathfind,
  craft through menus, or navigate to a place. It mines whatever your crosshair points
  at and moves on command. That narrowness is deliberate: it's what keeps it ban-safe.
  This build ships singleplayer (see the Microsoft-sign-in note above), so "works on
  any server" describes the design — no BlockPal or server plugin is ever needed —
  rather than a multiplayer feature of this particular static demo.

## Deploying

This repo is a plain static site — enable **GitHub Pages** (Settings → Pages →
Deploy from branch) and open the published URL. Works at the origin root or a
project subpath; the code detects its base path.

## Legal

Not an official Minecraft product. Not approved by or associated with Mojang or
Microsoft. Users must own Minecraft and accept the
[Minecraft EULA](https://www.minecraft.net/eula) before the client is downloaded —
the VM enforces this gate. Game code and assets stream from Mojang's official
servers at runtime and evaporate with the sandbox.

Bundled open-source components: [xterm.js](https://github.com/xtermjs/xterm.js)
5.5.0 + fit addon (MIT) in [`vendor/`](vendor); the rest are credited in
[`lwjgl/README.md`](lwjgl/README.md) (LWJGL — BSD-3-Clause, gl4es — MIT,
fflate — MIT, CheerpJ runtime — Leaning Technologies' free community licensing
for non-commercial use) and [`libs/README.md`](libs/README.md) (the open-source
game libraries used by the pre-1.7 launch pipeline — MIT/Apache-2.0/BSD; no
Mojang-proprietary library is bundled).
