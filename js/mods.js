// In-memory mod registry + real jar-mod installation.
//
// Pre-1.6 Minecraft modding worked by merging mod class files into the client
// jar and deleting META-INF (breaking Mojang's signature check) — that is
// exactly what ModLoader and early Forge installs did. We reproduce that
// in-browser with fflate, so uploaded jar mods genuinely load. Everything
// lives in RAM only; a reload discards it all.

const BASE = location.pathname.replace(/[^/]*$/, '');
let fflateReady = null;

function ensureFflate() {
  if (self.fflate) return Promise.resolve();
  if (!fflateReady) {
    fflateReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = BASE + 'vendor/fflate.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load fflate'));
      document.head.appendChild(s);
    });
  }
  return fflateReady;
}

export const mods = []; // { name, size, bytes, loader }

// Best-effort mod-loader sniff from filename + zip contents.
async function detectLoader(name, bytes) {
  const low = name.toLowerCase();
  try {
    await ensureFflate();
    const entries = Object.keys(self.fflate.unzipSync(bytes));
    const has = (re) => entries.some((e) => re.test(e));
    if (has(/^fabric\.mod\.json$/)) return 'Fabric (needs MC 1.14+ — cannot run here)';
    if (has(/^quilt\.mod\.json$/)) return 'Quilt (needs MC 1.14+ — cannot run here)';
    if (has(/^META-INF\/mods\.toml$/)) return 'Modern Forge (1.13+ — cannot run here)';
    if (has(/^mcmod\.info$/)) return 'Forge/FML (1.6–1.12 era)';
    if (has(/mod_.*\.class$/) || has(/^ModLoader/)) return 'Risugami ModLoader / jar-mod (≤1.5.x)';
    return 'jar-mod (raw class overrides)';
  } catch {
    return low.endsWith('.jar') ? 'jar-mod (unreadable — will try raw merge)' : 'zip';
  }
}

export function pickModFiles() {
  const input = document.getElementById('filepick');
  return new Promise((resolve) => {
    input.value = '';
    const onChange = async () => {
      input.removeEventListener('change', onChange);
      const added = [];
      for (const f of input.files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const loader = await detectLoader(f.name, bytes);
        mods.push({ name: f.name, size: f.size, bytes, loader });
        added.push({ name: f.name, loader });
      }
      resolve(added);
    };
    input.addEventListener('change', onChange);
    // If the user cancels the picker no event fires; resolve on refocus.
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      setTimeout(() => {
        input.removeEventListener('change', onChange);
        resolve(null);
      }, 400);
    };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

// Merge all registered mods into the client jar (ModLoader-style).
export async function patchClientJar(clientBytes, log) {
  if (!mods.length) return clientBytes;
  await ensureFflate();
  const { unzipSync, zipSync } = self.fflate;

  log?.(`Unpacking client jar (${(clientBytes.length / 1048576).toFixed(1)} MiB) …`);
  const entries = unzipSync(clientBytes);

  // ModLoader-era step one: strip the signature so patched classes load.
  for (const name of Object.keys(entries)) {
    if (name.startsWith('META-INF/')) delete entries[name];
  }

  for (const mod of mods) {
    log?.(`Injecting ${mod.name} …`);
    let modEntries;
    try {
      modEntries = unzipSync(mod.bytes);
    } catch {
      throw new Error(`${mod.name} is not a readable jar/zip`);
    }
    let count = 0;
    for (const [name, data] of Object.entries(modEntries)) {
      if (name.startsWith('META-INF/') || name.endsWith('/')) continue;
      entries[name] = data;
      count++;
    }
    log?.(`  ${count} entries merged`);
  }

  log?.('Repacking patched jar …');
  return zipSync(entries, { level: 1 });
}
