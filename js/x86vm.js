// Real full-system x86 virtual machine (v86, an x86 PC emulator compiled to
// WebAssembly). Unlike the CheerpJ path — which is a *Java* VM — this boots a
// genuine emulated computer: SeaBIOS, an x86 CPU, RAM and devices, then a
// small Linux kernel to a real shell on the serial console (ttyS0). The site's
// terminal becomes that VM's console.
//
// Honest scope: v86 emulates no GPU, so this is a serial/text machine. It
// proves "a real VM in the browser", but it will not run modern Minecraft
// playably (that needs a GPU and a hundreds-of-MB JRE). Play 1.2.5 via the
// Minecraft (browser JVM) mode instead.

// GitHub Pages may serve from a subpath; resolve vendored assets against it.
const BASE = location.pathname.replace(/[^/]*$/, '');

// Everything is vendored in-repo so the machine is fully self-contained — no
// runtime dependency on any third-party host, no CORS/hotlink surprises.
const V86_LOADER = BASE + 'vendor/v86/libv86.js';
const WASM_PATH = BASE + 'vendor/v86/v86.wasm';
const SEABIOS = BASE + 'vendor/v86/seabios.bin';
const VGABIOS = BASE + 'vendor/v86/vgabios.bin';
export const IMAGE_URL = BASE + 'vendor/v86/buildroot-bzimage.bin';
export const IMAGE_NAME = 'buildroot Linux (bzImage, ~5 MiB)';

let emulator = null;
let scriptLoaded = null;

export function isRunning() { return !!emulator; }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}

// Boot the machine. onSerial(str) receives console output; onProgress(e)
// receives image-download progress; log(str) receives lifecycle notes.
export async function boot({ onSerial, onProgress, log } = {}) {
  if (emulator) return emulator;
  log?.('loading v86 (x86 emulator, WebAssembly) …');
  if (!scriptLoaded) scriptLoaded = loadScript(V86_LOADER);
  await scriptLoaded;
  if (!window.V86) throw new Error('v86 core failed to initialise');

  emulator = new window.V86({
    wasm_path: WASM_PATH,
    memory_size: 128 * 1024 * 1024,
    vga_memory_size: 4 * 1024 * 1024,
    bios: { url: SEABIOS },
    vga_bios: { url: VGABIOS },
    bzimage: { url: IMAGE_URL },
    cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
    autostart: true,
    disable_keyboard: false,
  });

  emulator.add_listener('serial0-output-byte', (byte) => {
    onSerial?.(String.fromCharCode(byte));
  });
  if (onProgress) emulator.add_listener('download-progress', onProgress);

  return emulator;
}

// Feed keystrokes/commands to the guest's serial console.
export function send(str) {
  if (emulator) emulator.serial0_send(str);
}

export async function stop() {
  if (!emulator) return;
  try { emulator.stop(); } catch { /* already stopped */ }
  try { emulator.destroy?.(); } catch { /* older build: no destroy */ }
  emulator = null;
}
