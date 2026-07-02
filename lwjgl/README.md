# Bundled graphics/runtime components

These files enable LWJGL2-era OpenGL inside the CheerpJ WebAssembly JVM. They are
open-source components, redistributed with attribution. **No Mojang/Microsoft code
lives in this repository.**

| File | What it is | Origin / License |
|---|---|---|
| `lwjgl-2.9.3.jar`, `lwjgl_util-2.9.3.jar` | LWJGL 2.9.3 Java classes | [LWJGL](https://legacy.lwjgl.org) — BSD-3-Clause |
| `libraries/liblwjgl.so` | LWJGL native layer built for CheerpJ | LWJGL sources (BSD-3-Clause), build from [leaningtech/browsercraft](https://github.com/leaningtech/browsercraft) |
| `libraries/gl4es.wasm` | OpenGL 1.x → GLES/WebGL translation layer | [ptitSeb/gl4es](https://github.com/ptitSeb/gl4es) — MIT, build from Browsercraft |
| `libraries/lwjgl.js` | Tiny JS shim exposing the native lib | Browsercraft |

The CheerpJ runtime itself is loaded at runtime from `cjrtnc.leaningtech.com` under
Leaning Technologies' community licensing (free for non-commercial use). See
[cheerpj.com](https://cheerpj.com) for terms.

`../vendor/fflate.min.js` is [fflate](https://github.com/101arrowz/fflate) 0.8.2 — MIT.
