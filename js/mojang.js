// Live data from Mojang's official launcher metadata (CORS-enabled endpoints).
// No game code or assets are stored in this repository — everything is
// retrieved from Mojang at runtime, exactly like the official launcher does.

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

let manifest = null;            // cached manifest
const versionJson = new Map();  // id -> full version JSON

export async function getManifest() {
  if (manifest) return manifest;
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`piston-meta.mojang.com answered HTTP ${res.status}`);
  manifest = await res.json();
  return manifest;
}

export function manifestCache() { return manifest; }

export function findVersion(id) {
  if (!manifest) return null;
  return manifest.versions.find((v) => v.id.toLowerCase() === id.toLowerCase()) ?? null;
}

export async function getVersionJson(id) {
  const v = findVersion(id);
  if (!v) throw new Error(`unknown version '${id}' — try 'versions'`);
  if (versionJson.has(v.id)) return versionJson.get(v.id);
  const res = await fetch(v.url);
  if (!res.ok) throw new Error(`version metadata fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  versionJson.set(v.id, json);
  return json;
}

// Support tiers for the browser JVM.
// LWJGL2 + applet-era entry points run under CheerpJ; 1.6+ switched to
// net.minecraft.client.main.Main + the asset-index pipeline and (from 1.13)
// LWJGL3, none of which a browser JVM can service today.
const RELEASE_1_6 = Date.parse('2013-06-01T00:00:00Z');

export function tierOf(v) {
  if (v.id === '1.2.5') return 'supported';
  if (Date.parse(v.releaseTime) < RELEASE_1_6) return 'experimental';
  return 'unsupported';
}

export const TIER_LABEL = {
  supported:    { text: 'RUNS',  cls: 'badge-ok' },
  experimental: { text: 'EXPER', cls: 'badge-exp' },
  unsupported:  { text: 'NO-VM', cls: 'badge-no' },
};

// Streamed download with progress callback. Used for the client jar.
export async function download(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const total = +res.headers.get('Content-Length') || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
  }
  const bytes = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) { bytes.set(c, pos); pos += c.length; }
  return bytes;
}
