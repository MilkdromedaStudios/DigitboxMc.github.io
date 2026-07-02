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
  });
  cheerpjCreateDisplay(-1, -1, displayEl);
  jvmReady = true;
  log?.('JVM online.');
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

// Resolve the entry point actually runnable under the browser JVM.
// Pre-1.6 clients expose net.minecraft.client.Minecraft.main() (the
// launchwrapper in their metadata is just Mojang's shim); 1.6+ moved to
// net.minecraft.client.main.Main which needs the asset pipeline + args and
// (1.13+) LWJGL3 — not runnable here.
export function entryPointFor(versionJson) {
  const mc = versionJson.mainClass ?? '';
  if (mc.startsWith('net.minecraft.client.main.Main')) return null;
  if (mc === 'net.minecraft.launchwrapper.Launch') return 'net.minecraft.client.Minecraft';
  return mc || 'net.minecraft.client.Minecraft';
}

export async function launchGame({ id, entry, jarBytes, username }) {
  const jarPath = `/files/client_${id.replace(/[^A-Za-z0-9._-]/g, '_')}.jar`;
  await writeVmFile(jarPath, jarBytes);
  const classpath = [
    appPath('lwjgl/lwjgl-2.9.3.jar'),
    appPath('lwjgl/lwjgl_util-2.9.3.jar'),
    jarPath,
  ].join(':');
  const args = username ? [username, '-'] : [];
  gameRunning = true;
  try {
    return await cheerpjRunMain(entry, classpath, ...args);
  } finally {
    gameRunning = false;
  }
}
