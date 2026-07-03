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

// Support tiers for the browser JVM, drawn on the real dividing lines
// (verified by launching each era). The launch resolver refines this per
// version, but the coarse map is date-based:
// - pre-1.6 uses the launchwrapper→net.minecraft.client.Minecraft entry and
//   genuinely renders under CheerpJ (1.2.5 proven, alphas/betas attempt)
// - 1.6.x switched to net.minecraft.client.main.Main: it starts but
//   black-screens here (no working asset/LWJGL init for that pipeline)
// - 1.7.2–1.12.2 additionally need com.mojang:authlib — proprietary, served
//   only from a CDN that blocks browsers (no CORS): a hard legal+technical wall
// - 1.13+ need LWJGL3 natives (and later Java 17), beyond a browser JVM
const ERA_1_6 = Date.parse('2013-06-20T00:00:00Z');
const ERA_1_7 = Date.parse('2013-10-10T00:00:00Z');
const ERA_LWJGL3 = Date.parse('2017-10-01T00:00:00Z');

export function tierOf(v) {
  if (v.id === '1.2.5') return 'supported';
  const t = Date.parse(v.releaseTime);
  if (t < ERA_1_6) return 'experimental';
  if (t < ERA_1_7) return 'norender';
  if (t < ERA_LWJGL3) return 'locked';
  return 'unsupported';
}

export const TIER_LABEL = {
  supported:    { text: 'RUNS',   cls: 'badge-ok' },
  experimental: { text: 'EXPER',  cls: 'badge-exp' },
  norender:     { text: 'BLANK',  cls: 'badge-no' },
  locked:       { text: 'LOCKED', cls: 'badge-no' },
  unsupported:  { text: 'NO-VM',  cls: 'badge-no' },
};

// Build the real launch arguments from version metadata, handling every
// format Mojang has used: pre-1.6 (positional via launchwrapper),
// minecraftArguments strings (1.6–1.12) and arguments.game arrays (1.13+).
export function buildGameArgs(json, { username, gameDir, assetsDir }) {
  const values = {
    auth_player_name: username,
    auth_session: '-',
    auth_uuid: crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), ''),
    auth_access_token: '0',
    user_properties: '{}',
    user_type: 'legacy',
    version_name: json.id,
    version_type: json.type ?? 'release',
    game_directory: gameDir,
    game_assets: assetsDir,
    assets_root: assetsDir,
    assets_index_name: json.assetIndex?.id ?? json.assets ?? 'legacy',
  };
  const subst = (s) => s.replace(/\$\{(\w+)\}/g, (_, k) => values[k] ?? '');
  if (typeof json.minecraftArguments === 'string') {
    return json.minecraftArguments.split(/\s+/).map(subst);
  }
  if (Array.isArray(json.arguments?.game)) {
    // plain strings only — rule-gated entries are demo/resolution extras
    return json.arguments.game.filter((a) => typeof a === 'string').map(subst);
  }
  return [username, '-']; // ancient fallback: positional username + session
}

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
