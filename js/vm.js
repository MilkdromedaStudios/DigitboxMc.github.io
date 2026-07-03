// CheerpJ (WebAssembly JVM) lifecycle: sandbox wipe, JVM boot, virtual-FS
// writes and game launch. CheerpJ is loaded lazily so the terminal stays
// instant when you're only browsing version data.

const CHEERPJ_LOADER = 'https://cjrtnc.leaningtech.com/4.3/loader.js';

// GitHub Pages may serve this site from a subpath (project pages); CheerpJ's
// /app/ mount maps to the *origin* root, so prefix accordingly.
const BASE = location.pathname.replace(/[^/]*$/, '');
export const appPath = (p) => '/app' + BASE + p;

let jvmReady = false;
let gameRunning = false;

export function isJvmReady() { return jvmReady; }
export function isGameRunning() { return gameRunning; }

// ---------- sandbox ----------

// Everything CheerpJ persists lands in IndexedDB (/files/ mount). This origin
// serves only this app, so the sandbox guarantee is simple: at every boot,
// destroy all storage this origin owns. Best-effort repeat on page hide.
export async function wipeSandbox() {
  let wiped = 0;
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked */ }
  try {
    let names = [];
    if (indexedDB.databases) {
      names = (await indexedDB.databases()).map((d) => d.name).filter(Boolean);
    } else {
      names = ['cjFS', 'cjfs', 'cheerpjFS', '/files/']; // legacy fallbacks
    }
    await Promise.all(names.map((n) => new Promise((res) => {
      const req = indexedDB.deleteDatabase(n);
      req.onsuccess = () => { wiped++; res(); };
      req.onerror = req.onblocked = () => res();
    })));
  } catch { /* indexedDB unavailable */ }
  try {
    if (navigator.storage?.estimate) {
      const { usage } = await navigator.storage.estimate();
      return { wiped, residualBytes: usage ?? 0 };
    }
  } catch { /* ignore */ }
  return { wiped, residualBytes: 0 };
}

window.addEventListener('pagehide', () => { wipeSandbox(); });

// ---------- JVM ----------

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}

// Preload hint list (from Leaning Technologies' Browsercraft) — lets CheerpJ
// fetch the hot runtime chunks in parallel instead of on demand, which cuts
// cold JVM boot time substantially.
const PRELOAD = {
  '/lt/8/jre/lib/rt.jar': [0, 131072, 1310720, 1572864, 4456448, 4849664, 5111808, 5505024, 7995392, 8126464, 9699328, 9830400, 9961472, 11534336, 11665408, 12189696, 12320768, 12582912, 13238272, 13369344, 15073280, 15335424, 15466496, 15597568, 15990784, 16121856, 16252928, 16384000, 16777216, 16908288, 17039360, 17563648, 17694720, 17825792, 17956864, 18087936, 18219008, 18612224, 18743296, 18874368, 19005440, 19136512, 19398656, 19791872, 20054016, 20709376, 20840448, 21757952, 21889024, 26869760],
  '/lt/etc/users': [0, 131072],
  '/lt/etc/localtime': [],
  '/lt/8/jre/lib/cheerpj-awt.jar': [0, 131072],
  '/lt/8/lib/ext/meta-index': [0, 131072],
  '/lt/8/lib/ext': [],
  '/lt/8/lib/ext/index.list': [],
  '/lt/8/lib/ext/localedata.jar': [],
  '/lt/8/jre/lib/jsse.jar': [0, 131072, 786432, 917504],
  '/lt/8/jre/lib/jce.jar': [0, 131072],
  '/lt/8/jre/lib/charsets.jar': [0, 131072, 1703936, 1835008],
  '/lt/8/jre/lib/resources.jar': [0, 131072, 917504, 1179648],
  '/lt/8/jre/lib/javaws.jar': [0, 131072, 1441792, 1703936],
  '/lt/8/lib/ext/sunjce_provider.jar': [],
  '/lt/8/lib/security/java.security': [0, 131072],
  '/lt/8/jre/lib/meta-index': [0, 131072],
  '/lt/8/jre/lib': [],
  '/lt/8/lib/accessibility.properties': [],
  '/lt/8/lib/fonts/LucidaSansRegular.ttf': [],
  '/lt/8/lib/currency.data': [0, 131072],
  '/lt/8/lib/currency.properties': [],
  '/lt/libraries/libGLESv2.so.1': [0, 262144],
  '/lt/libraries/libEGL.so.1': [0, 262144],
  '/lt/8/lib/fonts/badfonts.txt': [],
  '/lt/8/lib/fonts': [],
  '/lt/etc/hosts': [],
  '/lt/etc/resolv.conf': [0, 131072],
  '/lt/8/lib/fonts/fallback': [],
  '/lt/fc/fonts/fonts.conf': [0, 131072],
  '/lt/fc/ttf': [],
  '/lt/fc/cache/e21edda6a7db77f35ca341e0c3cb2a22-le32d8.cache-7': [0, 131072],
  '/lt/fc/ttf/LiberationSans-Regular.ttf': [0, 131072, 262144, 393216],
  '/lt/8/lib/jaxp.properties': [],
  '/lt/etc/timezone': [],
  '/lt/8/lib/tzdb.dat': [0, 131072],
};

export async function bootJvm(displayEl, log) {
  if (jvmReady) return;
  log?.('Fetching CheerpJ runtime (WebAssembly JVM) from cjrtnc.leaningtech.com …');
  await loadScript(CHEERPJ_LOADER);
  log?.('Initialising JVM: Java 8, X11 framebuffer, gl4es → WebGL bridge …');
  await cheerpjInit({
    version: 8,
    javaProperties: ['java.library.path=' + appPath('lwjgl/libraries/')],
    libraries: { 'libGL.so.1': appPath('lwjgl/libraries/gl4es.wasm') },
    enableX11: true,
    preloadResources: PRELOAD,
  });
  cheerpjCreateDisplay(-1, -1, displayEl);
  jvmReady = true;
  log?.('JVM online.');
}

// ---------- launch planning ----------

let libCatalog = null; // "group:artifact:version" -> { file, size, sha1 }

async function getCatalog() {
  if (libCatalog) return libCatalog;
  const res = await fetch(BASE + 'libs/catalog.json');
  libCatalog = res.ok ? await res.json() : {};
  return libCatalog;
}

// Work out exactly how (or why not) a version can run in the browser JVM.
// Returns { entry, classpath, gates:[{code,detail}], unresolved:[names],
//           resolvedLibs:[{name,via}] }.
export async function resolveLaunchPlan(json) {
  const catalog = await getCatalog();
  const gates = [];
  const unresolved = [];
  const resolvedLibs = [];
  const classpath = [appPath('lwjgl/lwjgl-2.9.3.jar'), appPath('lwjgl/lwjgl_util-2.9.3.jar')];

  const javaMajor = json.javaVersion?.majorVersion ?? 8;
  if (javaMajor > 8) {
    gates.push({
      code: 'java',
      detail: `needs Java ${javaMajor}; the browser JVM (CheerpJ) provides Java 8`,
    });
  }

  const byArtifact = {}; // fallback: same group:artifact, any bundled version
  for (const [name, entry] of Object.entries(catalog)) {
    byArtifact[name.split(':').slice(0, 2).join(':')] = entry;
  }

  let lwjgl3 = false;
  for (const lib of json.libraries ?? []) {
    const name = lib.name ?? '';
    if (!lib.downloads?.artifact && !name) continue;
    if (name.startsWith('org.lwjgl.lwjgl:')) { resolvedLibs.push({ name, via: 'vm' }); continue; } // LWJGL2 → our CheerpJ build
    if (name.startsWith('org.lwjgl:')) { lwjgl3 = true; continue; }
    if (!lib.downloads?.artifact) continue; // natives-only entry
    if (lib.rules && !rulesAllow(lib.rules)) continue;
    const exact = catalog[name];
    const near = byArtifact[name.split(':').slice(0, 2).join(':')];
    if (exact) {
      classpath.push(appPath('libs/' + exact.file));
      resolvedLibs.push({ name, via: 'bundled' });
    } else if (near) {
      classpath.push(appPath('libs/' + near.file));
      resolvedLibs.push({ name, via: 'bundled≈' + near.file });
    } else {
      unresolved.push(name);
    }
  }
  if (lwjgl3) {
    gates.push({
      code: 'lwjgl3',
      detail: 'needs LWJGL3 native bindings, which do not exist for the browser JVM',
    });
  }

  let entry = json.mainClass ?? 'net.minecraft.client.Minecraft';
  if (entry === 'net.minecraft.launchwrapper.Launch') entry = 'net.minecraft.client.Minecraft';

  return { entry, classpath, gates, unresolved, resolvedLibs };
}

function rulesAllow(rules) {
  // library rules gate on OS; we impersonate linux (CheerpJ's personality)
  let allow = false;
  for (const r of rules) {
    const osMatch = !r.os || r.os.name === 'linux';
    if (osMatch) allow = r.action === 'allow';
  }
  return allow;
}

// write bytes into the JVM's ephemeral /files/ mount
export function writeVmFile(path, bytes) {
  return new Promise((resolve, reject) => {
    const fds = [];
    cheerpOSOpen(fds, path, 'w', (fd) => {
      if (fd < 0) return reject(new Error('vm fs open failed: ' + path));
      cheerpOSWrite(fds, fd, bytes, 0, bytes.length, () => {
        cheerpOSClose(fds, fd, resolve);
      });
    });
  });
}

export async function launchGame({ id, plan, jarBytes, args }) {
  const jarPath = `/files/client_${id.replace(/[^A-Za-z0-9._-]/g, '_')}.jar`;
  await writeVmFile(jarPath, jarBytes);
  const classpath = [...plan.classpath, jarPath].join(':');
  gameRunning = true;
  try {
    return await cheerpjRunMain(plan.entry, classpath, ...args);
  } finally {
    gameRunning = false;
  }
}
