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
| Sandbox | All origin storage (IndexedDB, localStorage) is destroyed on every boot and on page hide. ⏻ POWER wipes and reboots. Nothing persists, by design |
| Mobile | No soft keyboard ever opens — the whole flow is buttons. Full-width tap targets, safe-area-aware layout, and an on-screen game pad (W/A/S/D/JUMP/SNEAK + MINE/USE) that appears automatically on touch devices |

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
