# Bundled open-source game libraries

These are the third-party libraries Minecraft's pre-1.7 era links against,
bundled so `launch 1.6.x` (and other experimental attempts) can resolve a full
classpath in the browser — Mojang's library CDN (`libraries.minecraft.net`)
does not allow browser fetches (no CORS). **Every jar here is open-source and
redistributable; no Mojang-proprietary library (e.g. authlib) is or ever will
be bundled**, which is why 1.7.2+ cannot launch here.

| Library | License |
|---|---|
| `jopt-simple-4.5.jar` | MIT |
| `guava-14.0.jar` | Apache-2.0 |
| `gson-2.2.2.jar` | Apache-2.0 |
| `commons-lang3-3.1.jar` | Apache-2.0 |
| `commons-io-2.4.jar` | Apache-2.0 |
| `argo-2.25_fixed.jar` | New BSD |
| `bcprov-jdk15on-1.47.jar` | Bouncy Castle (MIT-like) |
| `jinput-2.0.5.jar`, `jutils-1.0.0.jar` | BSD |
| `soundsystem-20120107.jar`, `codecjorbis-*.jar`, `codecwav-*.jar`, `libraryjavasound-*.jar`, `librarylwjglopenal-*.jar` | Paul Lamb SoundSystem license (free use/redistribution with credit); CodecJOrbis includes JOrbis (LGPL) |

`catalog.json` maps Maven coordinates (`group:artifact:version`) to these
files; the launch resolver consults it and reports anything unresolvable
instead of guessing.
