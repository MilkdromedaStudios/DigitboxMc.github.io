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
| Mod testing | `mods add` stages jar mods in RAM; at launch they are genuinely merged into the client jar with `META-INF` stripped — the authentic ModLoader / early-Forge install procedure, performed in-browser |
| Sandbox | All origin storage (IndexedDB, localStorage) is destroyed on every boot and on page hide. The POWER button wipes and reboots. Nothing persists, by design |
| Mobile | Responsive terminal with quick-command chips and soft-keyboard support; in-game on-screen keys (W/A/S/D/JUMP/…) on touch devices |

## Honest limits

This is a real browser JVM, not magic:

- **Minecraft 1.2.5 is the proven build.** Other pre-1.6 versions (alphas, betas,
  early releases) are launchable as *experimental* — some run, some crash.
- **1.6+ cannot run**: Mojang switched to a new launcher pipeline (`client.main.Main`,
  asset indexes) and, from 1.13, to LWJGL3 with native bindings a browser JVM cannot
  provide. Consequently **no Fabric** (needs 1.14+) and **no modern Forge** — mod
  testing means jar-mod-era mods (ModLoader, early Forge builds for ≤1.5.x).
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
Technologies' free community licensing for non-commercial use).
