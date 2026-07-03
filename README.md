# DIGITBOX MCVM

A retro CRT **terminal that boots a sandboxed "VM" in your browser and runs real
Minecraft Java** — hosted entirely on GitHub Pages, no backend, nothing installed,
nothing saved.

```
guest@digitbox:~$ launch 1.2.5
```

## How it works

| Piece | What actually happens |
|---|---|
| Terminal / VM shell | Custom JS terminal with a BIOS-style boot, history, tab completion, touch support |
| Java | [CheerpJ](https://cheerpj.com) — a full JVM compiled to WebAssembly, loaded at launch time |
| Graphics | LWJGL 2.9.3 with a patched native layer + [gl4es](https://github.com/ptitSeb/gl4es) translating OpenGL → WebGL (approach pioneered by [Browsercraft](https://github.com/leaningtech/browsercraft)) |
| Minecraft itself | The **untouched official client jar is streamed from Mojang's CDN at launch** (`piston-data.mojang.com`). This repository contains **zero** Mojang code or assets |
| Live game data | Version list / metadata fetched live from `piston-meta.mojang.com` (`versions`, `info` commands) |
| Version picker | `play` lists the versions that actually render as a numbered menu — pick one without knowing ids |
| Mod testing | `mods add` stages jar mods in RAM; at launch they are genuinely merged into the client jar with `META-INF` stripped — the authentic ModLoader / early-Forge install procedure, performed in-browser. `loaders` lists what's present; each staged mod's loader is detected |
| Sandbox | All origin storage (IndexedDB, localStorage) is destroyed on every boot and on page hide. The POWER button wipes and reboots. Nothing persists, by design |
| Mobile | Visible command bar with a **RUN** button (soft keyboard opens on the first tap — no more poking the screen), quick-command chips, and a split on-screen game pad: movement (W/A/S/D/JUMP/SNEAK) plus MINE/USE mouse buttons |

## Any version can *attempt* to launch

`launch <id>` runs a resolver that builds the real launcher pipeline for that
version — entry point, library classpath (LWJGL2 via the bundled CheerpJ build,
everything else from `libs/` open-source jars), and the authentic
`--username/--version/--assetsDir` argument set parsed from Mojang's metadata.
It then reports exactly what resolves and what blocks, instead of a flat "no".
`--force` lets a doomed attempt run anyway so you can watch the real failure.
Client jars are cached in RAM for instant relaunches within a session, and the
JVM boot is accelerated with CheerpJ preload hints.

## Honest limits

This is a real browser JVM, not magic. Verified by launching each era:

- **Minecraft 1.2.5 is the proven build.** Pre-1.6 releases (alphas, betas,
  1.0–1.5.2) use the direct `net.minecraft.client.Minecraft` entry and genuinely
  render — run `play` to pick one, or `launch <id>` directly.
- **1.6.x start but black-screen.** They switched to the newer `client.main.Main`
  launcher pipeline, which the browser JVM has no working asset/LWJGL init for.
  `launch 1.6.4 --force` lets you watch it try.
- **1.7.2–1.12.2 are locked** by Mojang's proprietary `authlib`: it is only served
  from `libraries.minecraft.net`, which blocks browser fetches (no CORS), and
  re-hosting it is unlawful. Every pure browser launcher hits this exact wall.
  Third-party launcher mirrors (TLauncher/SKLauncher-style) are unauthorized
  re-hosting of Mojang files, and this project will not use them.
- **1.13+ additionally need LWJGL3 natives** (and 1.17+ need Java 17) that a browser
  JVM cannot provide. Consequently **no Fabric** (needs 1.14+) and **no modern
  Forge** — mod testing means jar-mod-era mods (ModLoader, early Forge for ≤1.5.x).
- **No Microsoft sign-in**: Xbox/Minecraft auth services reject cross-origin browser
  requests, and a static page has no server to hold secrets. `login <name>` sets an
  offline profile; singleplayer only.
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
the terminal enforces this gate. Game code and assets stream from Mojang's official
servers at runtime and evaporate with the sandbox.

Bundled open-source components are credited in [`lwjgl/README.md`](lwjgl/README.md)
(LWJGL — BSD-3-Clause, gl4es — MIT, fflate — MIT, CheerpJ runtime — Leaning
Technologies' free community licensing for non-commercial use) and
[`libs/README.md`](libs/README.md) (the open-source game libraries used by the
pre-1.7 launch pipeline — MIT/Apache-2.0/BSD; no Mojang-proprietary library is
bundled).
