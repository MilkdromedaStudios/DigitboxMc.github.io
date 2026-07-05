// DIGITBOX AI — an offline in-game assistant + a *restricted* possession mode.
//
// This whole module runs in the page, with no backend and no network calls:
// the "AI" is a local knowledge base + a rule parser, and possession is a small
// automation engine that only ever emits the same synthetic keystrokes/clicks
// the touch pad does (see input.js). That design is deliberate and is what makes
// the two headline promises real:
//
//   • It works on ANY server, even ones without BlockPal, because it needs
//     nothing installed server-side — it just plays the game like a person.
//   • It cannot get you banned, because it can only do things a legitimate
//     player physically can: mine, gather, walk, jump, sneak, switch hotbar
//     slots. PvP, hitting mobs, chatting, running commands, flying, x-ray,
//     reach, auto-clicking at inhuman speeds — none of it is reachable. The
//     safety guard below hard-blocks those intents, and there is no packet
//     layer to forge them into even if it wanted to.
//
// Without BlockPal the AI is intentionally limited to these "basic tasks" so it
// can never gain an unfair PvP advantage. It also acts as a private mini-wiki:
// it can watch the screen and drop tips into a chat only you can see — it never
// types into the game's chat box.

import { sendKey, sendMouse } from './input.js';

// ---------------- limits & safety ----------------

const MAX_CHATS = 100;          // keep at most 100 saved conversations
const MAX_MSGS = 100;           // …each holding at most 100 messages
const STORE_KEY = 'digitbox.ai.v1';
const MAX_TASK_MS = 60_000;     // a possession task auto-stops after 60s, always
const USE_CADENCE_MS = 420;     // human-paced right-clicks (never an auto-clicker)
const JUMP_CADENCE_MS = 720;
const TIP_MIN_GAP_MS = 90_000;  // at most one screen tip every 90s — never spammy

const SAFE_REFUSAL =
  "🛡 I can't do that. Possession mode is locked to safe, legit tasks — mining, " +
  "gathering and moving. PvP, attacking, chatting, commands, and anything that " +
  "could get you banned are permanently disabled, on every server.";

const UNSUPPORTED_NOTE =
  "I can't pathfind, craft, or navigate in restricted mode — I have no map of " +
  "the world. I can hold-mine whatever your crosshair points at and walk / " +
  "strafe / jump / sneak on command. Aim me first, then say e.g. “mine”, " +
  "“tunnel 10s”, or “walk forward 5s”.";

// Intents that must never run. Kept broad on purpose — when in doubt, refuse.
const FORBIDDEN = [
  /\b(attack|kill|hit|punch|slay|murder|fight|combat|pvp|p\s*v\s*p)\b/,
  /\b(kill\s*aura|killaura|aim\s*bot|aimbot|trigger\s*bot|auto\s*clicker)\b/,
  /\b(shoot|bow|snipe)\b.*\b(player|someone|him|her|them|mob|entity|enemy)\b/,
  /\b(grief|raid|steal|scam|dupe|duplicat|exploit|inject|packet|crash)\b/,
  /\b(chat|say|tell|whisper|msg|message|announce|broadcast|spam)\b/,
  /(^|\s)\/[a-z]/, /\bcommand(s)?\b|\/op\b|\/gamemode\b|\/give\b|console\b/,
  /\b(fly|flight|x\s*-?\s*ray|xray|speed\s*hack|no\s*-?\s*fall|nofall|noclip|reach|esp|hack|cheat)\b/,
];

// ---------------- knowledge base (the "mini wiki") ----------------
// Scored keyword match; best entry wins, with a friendly fallback.

const WIKI = [
  { keys: ['hi', 'hello', 'hey', 'yo', 'sup', 'howdy'],
    a: "Hey! I'm your DIGITBOX assistant. Ask me anything about surviving and " +
       "mining, or switch to the Possess tab and I'll handle safe tasks like " +
       "mining and moving for you. I never touch chat or PvP." },
  { keys: ['help', 'what can you do', 'commands', 'how do you work', 'abilities'],
    a: "Two things: (1) Chat — I answer Minecraft questions and give private " +
       "tips. (2) Possess (restricted) — aim your crosshair, then tell me " +
       "“mine”, “tunnel 10s”, “walk forward 5s”, " +
       "“strafe left”, “jump”, “sneak”, “use”, " +
       "or “slot 3”. I only do safe tasks — no PvP, no chat, nothing bannable." },
  { keys: ['possess', 'possession', 'blockpal', 'ban', 'banned', 'safe', 'anticheat', 'anti-cheat'],
    a: "Possession here is BlockPal-free: it works on any server because it just " +
       "plays like a human — synthetic key/mouse input only. That also means it " +
       "can't be banned: no forged packets, no fly/reach/x-ray, no auto-clicking, " +
       "no chat. Without BlockPal it's capped to basic tasks (mining, gathering, " +
       "moving) so it can never get a PvP edge." },
  { keys: ['pickaxe', 'pick', 'tool', 'tools', 'axe', 'shovel'],
    a: "Tools go wood → stone → iron → diamond. Recipe shape is the same: " +
       "the tool head on top, two sticks down the middle. A pickaxe mines stone/ore, " +
       "an axe chops wood faster, a shovel digs dirt/sand/gravel. You need a stone " +
       "pickaxe to mine iron, and an iron pickaxe to mine diamond/gold/redstone." },
  { keys: ['diamond', 'diamonds'],
    a: "Diamonds sit in the deep layers (roughly the bottom ~16 levels, just above " +
       "bedrock). Bring an iron pickaxe (wood/stone won't collect them), torches, " +
       "and watch for lava — diamonds love to spawn right next to it. Branch-mine at " +
       "that depth rather than digging straight down." },
  { keys: ['mine', 'mining', 'branch', 'strip', 'dig', 'ore'],
    a: "Efficient mining: get to the deep layers, then dig 1-wide branch tunnels " +
       "every 3 blocks so you expose the most stone. Torch as you go to stop mobs " +
       "spawning behind you, and never dig straight down — you can drop into lava or " +
       "a cave. In Possess mode, aim at a block and say “mine” or “tunnel”." },
  { keys: ['wood', 'tree', 'log', 'plank', 'planks', 'stick', 'sticks'],
    a: "Punch a tree to get logs, turn each log into 4 planks, and 2 planks stacked " +
       "into a crafting table (also 2 planks → 4 sticks). Wood is the start of " +
       "basically everything — tools, torches, chests, doors." },
  { keys: ['craft', 'crafting', 'table', 'recipe', 'make'],
    a: "Your 2×2 inventory grid makes basics (planks, sticks, torches, a crafting " +
       "table). Place a crafting table for the full 3×3 grid — tools, armor, a " +
       "furnace, chests, beds. Note: I can't craft for you in restricted possession " +
       "(it needs menu clicks I won't fake), but I'll happily tell you any recipe." },
  { keys: ['furnace', 'smelt', 'smelting', 'cook'],
    a: "A furnace is 8 cobblestone in a ring (center empty) on the crafting table. " +
       "Use it to smelt ore into ingots and cook raw food. Fuel can be coal, charcoal, " +
       "wood or planks — coal lasts longest." },
  { keys: ['coal', 'torch', 'torches', 'light', 'lighting'],
    a: "Coal + a stick = 4 torches. Torches are your best friend: light level stops " +
       "hostile mobs spawning, so torch your base, your mines, and the area around " +
       "your first shelter. No coal yet? Smelt a log into charcoal and use that." },
  { keys: ['creeper', 'creepers'],
    a: "Creepers are silent until the hiss — then you have about 1.5 seconds. Back " +
       "off to break line of sight, or hit-and-retreat. Never let one detonate " +
       "against your walls. Well-lit bases keep them from spawning near you at night." },
  { keys: ['zombie', 'skeleton', 'spider', 'mob', 'monster', 'enemy'],
    a: "Hostile mobs spawn in the dark and (most) burn up at sunrise. Skeletons " +
       "shoot arrows — use cover; spiders climb walls, so overhang your defenses. " +
       "Keep your base lit and walled. (Heads up: I won't fight them for you — no " +
       "combat in restricted possession.)" },
  { keys: ['night', 'first night', 'dark', 'evening', 'shelter', 'survive'],
    a: "First-night plan: punch wood, make a crafting table + wooden sword and " +
       "pickaxe, dig a small 2-block hole or wall off a nook, seal it, place a torch. " +
       "Wait out the night or sleep. Come morning, gather stone and level up your gear." },
  { keys: ['bed', 'sleep', 'spawn', 'respawn'],
    a: "A bed is 3 wool over 3 planks. Sleeping skips the night (safer than waiting) " +
       "and sets your respawn point. Get wool from sheep — shears are ideal, or you " +
       "get 1 wool per sheep by hand." },
  { keys: ['food', 'hunger', 'eat', 'heal', 'health', 'apple', 'bread', 'meat'],
    a: "Keep fed to regenerate. Easy food: cook meat from animals in a furnace, or " +
       "grow wheat and craft bread (3 wheat in a row). Never eat raw chicken. Health " +
       "comes back on its own while you're well-fed and safe." },
  { keys: ['farm', 'wheat', 'seed', 'seeds', 'crop', 'hoe', 'grow'],
    a: "Till grass with a hoe next to water, plant seeds (from breaking tall grass), " +
       "and keep it lit so it grows at night too. Wheat → bread. Water hydrates " +
       "farmland up to 4 blocks away." },
  { keys: ['iron', 'ingot', 'armor', 'armour'],
    a: "Mine iron ore with a stone pickaxe, smelt it into ingots, then craft tools " +
       "and armor. A full iron set is the survival sweet spot before you go diamond " +
       "hunting." },
  { keys: ['nether', 'portal', 'obsidian', 'lava'],
    a: "A nether portal is an obsidian frame (a 4×5 rectangle, corners optional) " +
       "lit with flint & steel. Obsidian forms when water hits a lava source; mine it " +
       "with a diamond pickaxe. The Nether is dangerous — bring gear. And near lava, " +
       "always mind your footing." },
  { keys: ['water', 'swim', 'bucket', 'infinite'],
    a: "Two water source blocks diagonally (a 2×2 or a 1×3 with sources at " +
       "the ends) create an infinite water source you can scoop forever with a bucket. " +
       "Handy for farms and for turning lava into obsidian." },
  { keys: ['lost', 'coordinate', 'coordinates', 'compass', 'home', 'find base'],
    a: "Hit F3 (on desktop) to see your XYZ coordinates and jot down your base. A " +
       "compass points to your world spawn. Torched tunnels also make a breadcrumb " +
       "trail back home." },
];

function wikiAnswer(text) {
  const low = ' ' + text.toLowerCase() + ' ';
  let best = null, bestScore = 0;
  for (const entry of WIKI) {
    let score = 0;
    for (const k of entry.keys) if (low.includes(' ' + k) || low.includes(k + ' ')) score += k.length;
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  if (best && bestScore > 0) return best.a;
  return "I'm not sure about that one — I'm a small offline helper for the classic " +
    "Minecraft this VM runs. Try asking about mining, diamonds, tools, mobs, food, " +
    "the nether, or surviving the first night. For actions, use the Possess tab.";
}

// ---------------- intent parsing ----------------

function parseDuration(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/);
  if (!m) return null;
  let ms = parseFloat(m[1]) * (/^m/.test(m[2]) ? 60_000 : 1000);
  return Math.min(ms, MAX_TASK_MS);
}

// Returns { kind:'forbidden' } | { kind:'chat' } | { kind:'unsupported' }
//       | { kind:'task', action, seconds, note? }
function parseIntent(raw) {
  const text = raw.toLowerCase().trim();
  if (!text) return { kind: 'chat' };
  if (FORBIDDEN.some((re) => re.test(text))) return { kind: 'forbidden' };

  // A question is always answered as information, never run as a task — so
  // "how do I find diamonds?" gets a wiki answer, while a bare "find diamonds"
  // is treated as an instruction.
  if (/\?/.test(text) ||
      /^(how|what|whats|what's|where|why|when|which|who|whom|whose)\b/.test(text) ||
      /\b(recipe|tell me|explain|what is|how do|how to)\b/.test(text)) {
    return { kind: 'chat' };
  }

  const has = (re) => re.test(text);
  const stop = has(/\b(stop|halt|cancel|abort|freeze|stand\s*down|stop possess|end task|whoa)\b/);
  if (stop) return { kind: 'task', action: 'stop' };

  // navigation / crafting we honestly cannot do without world knowledge
  if (has(/\b(follow|come here|go to|navigate|pathfind|find |fetch|bring|deliver|explore)\b/))
    return { kind: 'unsupported' };

  const seconds = parseDuration(text);
  const wantsMine = has(/\b(mine|dig|break|harvest|chop|gather|collect|excavate|ore)\b/);
  const wantsTunnel = has(/\b(tunnel|strip\s*mine|dig\s+(forward|through|ahead))\b/);
  const wantsFwd = has(/\b(forward|ahead|straight|walk|move|advance|go)\b/) && !has(/\bdown\b/);
  const downNote = wantsMine && has(/\b(down|straight down)\b/)
    ? " Aim your view down first — I mine whatever the crosshair points at." : '';

  if (wantsTunnel || (wantsMine && wantsFwd)) return { kind: 'task', action: 'tunnel', seconds };
  if (wantsMine) return { kind: 'task', action: 'mine', seconds, note: downNote };
  if (has(/\b(use|place|put|plant|right.?click|interact|activate|build)\b/)) return { kind: 'task', action: 'use', seconds };
  if (has(/\b(jump|hop|leap)\b/)) return { kind: 'task', action: 'jump', seconds };
  if (has(/\b(sneak|crouch|shift)\b/)) return { kind: 'task', action: 'sneak', seconds };
  if (has(/\b(inventory|inv|backpack)\b/)) return { kind: 'task', action: 'inventory' };
  const slot = text.match(/\b(?:slot|hotbar|select|switch to|hold)\b.*?\b([1-9])\b/) || text.match(/^\s*([1-9])\s*$/);
  if (slot) return { kind: 'task', action: 'hotbar', slot: +slot[1] };
  if (has(/\bback|backward|retreat\b/)) return { kind: 'task', action: 'back', seconds };
  if (has(/\bleft\b/)) return { kind: 'task', action: 'left', seconds };
  if (has(/\bright\b/)) return { kind: 'task', action: 'right', seconds };
  if (wantsFwd) return { kind: 'task', action: 'forward', seconds };

  return { kind: 'chat' };
}

// ---------------- possession engine (safe automation) ----------------

const engine = {
  heldKeys: new Set(),
  heldMouse: new Set(),
  timers: [],
  active: null, // human-readable label of the running task, or null

  holdKey(code) { if (!this.heldKeys.has(code)) { this.heldKeys.add(code); sendKey(code, 'keydown'); } },
  releaseKey(code) { if (this.heldKeys.has(code)) { this.heldKeys.delete(code); sendKey(code, 'keyup'); } },
  tapKey(code, ms = 120) { sendKey(code, 'keydown'); this.after(() => sendKey(code, 'keyup'), ms); },
  holdMouse(btn) { if (!this.heldMouse.has(btn)) { this.heldMouse.add(btn); sendMouse(btn, 'mousedown'); } },
  releaseMouse(btn) { if (this.heldMouse.has(btn)) { this.heldMouse.delete(btn); sendMouse(btn, 'mouseup'); } },
  after(fn, ms) { const id = setTimeout(fn, ms); this.timers.push(id); return id; },
  every(fn, ms) { const id = setInterval(fn, ms); this.timers.push(id); return id; },

  // Stop everything and let go of every held input. Called on STOP, on task
  // switch, when possession is disabled, and whenever the game leaves screen.
  stop() {
    for (const id of this.timers) { clearTimeout(id); clearInterval(id); }
    this.timers = [];
    for (const c of [...this.heldKeys]) this.releaseKey(c);
    for (const b of [...this.heldMouse]) this.releaseMouse(b);
    this.active = null;
  },

  // Run a parsed task. Continuous tasks auto-stop after `seconds` (or the hard
  // 60s cap) so nothing ever runs away from you.
  run(intent, onDone) {
    this.stop();
    const dur = intent.seconds || MAX_TASK_MS;
    const finish = (label) => this.after(() => { this.stop(); onDone?.(label); }, dur);

    switch (intent.action) {
      case 'stop': onDone?.('stopped'); return;
      case 'mine': this.holdMouse(0); this.active = 'mining'; finish('mining'); break;
      case 'tunnel': this.holdKey('KeyW'); this.holdMouse(0); this.active = 'tunnelling'; finish('tunnelling'); break;
      case 'forward': this.holdKey('KeyW'); this.active = 'walking forward'; finish('walking'); break;
      case 'back': this.holdKey('KeyS'); this.active = 'walking back'; finish('walking back'); break;
      case 'left': this.holdKey('KeyA'); this.active = 'strafing left'; finish('strafing'); break;
      case 'right': this.holdKey('KeyD'); this.active = 'strafing right'; finish('strafing'); break;
      case 'sneak': this.holdKey('ShiftLeft'); this.active = 'sneaking'; finish('sneaking'); break;
      case 'jump': this.active = 'jumping'; this.tapKey('Space'); this.every(() => this.tapKey('Space'), JUMP_CADENCE_MS); finish('jumping'); break;
      case 'use': this.active = 'using item'; sendMouse(2, 'mousedown'); sendMouse(2, 'mouseup'); this.every(() => { sendMouse(2, 'mousedown'); sendMouse(2, 'mouseup'); }, USE_CADENCE_MS); finish('using'); break;
      case 'inventory': this.tapKey('KeyE'); this.active = null; onDone?.('opened inventory'); break;
      case 'hotbar': this.tapKey('Digit' + intent.slot); this.active = null; onDone?.('selected slot ' + intent.slot); break;
      default: this.active = null; onDone?.(null);
    }
  },
};

// ---------------- chat store (100 chats × 100 messages) ----------------

const store = {
  chats: [],       // [{ id, title, msgs:[{role,text,ts}] }]
  currentId: null,

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        this.chats = Array.isArray(data.chats) ? data.chats.slice(-MAX_CHATS) : [];
        this.currentId = data.currentId ?? null;
      }
    } catch { /* corrupt or blocked storage — start fresh */ }
    if (!this.chats.length) this.newChat();
    else if (!this.chats.some((c) => c.id === this.currentId)) this.currentId = this.chats[this.chats.length - 1].id;
  },
  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ chats: this.chats, currentId: this.currentId }));
    } catch { /* storage full/blocked — history stays in memory only */ }
  },
  current() { return this.chats.find((c) => c.id === this.currentId) || this.chats[0]; },
  newChat() {
    const c = { id: 'c' + Date.now() + Math.floor(Math.random() * 1e4), title: 'New chat', msgs: [] };
    this.chats.push(c);
    while (this.chats.length > MAX_CHATS) this.chats.shift(); // drop the oldest
    this.currentId = c.id;
    this.save();
    return c;
  },
  add(role, text) {
    const c = this.current();
    c.msgs.push({ role, text, ts: Date.now() });
    while (c.msgs.length > MAX_MSGS) c.msgs.shift(); // ring buffer, newest 100 kept
    if (role === 'you' && (c.title === 'New chat' || !c.title)) c.title = text.slice(0, 28);
    this.save();
    return c.msgs[c.msgs.length - 1];
  },
  clearCurrent() { this.current().msgs = []; this.save(); },
};

// ---------------- UI ----------------

const ui = {
  root: null, panel: null, launch: null, messages: null,
  chatInput: null, possessInput: null, possessBody: null,
  chatSelect: null, statusLine: null, dot: null,
  open: false, tab: 'chat', possessOn: false, monitorOn: true,
  lastTip: 0, lastTipText: '',
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function buildUI() {
  const root = el('div'); root.id = 'ai-root';

  // collapsed launcher — absolutely mini, tucked under the game bar, right side
  const launch = el('button', 'ai-launch'); launch.type = 'button';
  launch.title = 'AI assistant + restricted possession';
  launch.innerHTML = '<span class="ai-face">🤖</span>';
  const dot = el('span', 'ai-dot'); dot.hidden = true; launch.appendChild(dot);
  launch.addEventListener('click', () => setOpen(true));

  // the panel
  const panel = el('div', 'ai-panel'); panel.hidden = true;

  const header = el('div', 'ai-head');
  const tabs = el('div', 'ai-tabs');
  const tabChat = el('button', 'ai-tab is-on', 'Chat'); tabChat.type = 'button';
  const tabPoss = el('button', 'ai-tab', '⛏ Possess'); tabPoss.type = 'button';
  tabChat.addEventListener('click', () => setTab('chat'));
  tabPoss.addEventListener('click', () => setTab('possess'));
  tabs.append(tabChat, tabPoss);
  const close = el('button', 'ai-x', '×'); close.type = 'button'; close.title = 'Minimise';
  close.addEventListener('click', () => setOpen(false));
  header.append(tabs, close);

  // chat view
  const chatView = el('div', 'ai-view ai-chat');
  const bar = el('div', 'ai-chatbar');
  const chatSelect = el('select', 'ai-select'); chatSelect.title = 'Saved chats';
  chatSelect.addEventListener('change', () => { store.currentId = chatSelect.value; renderMessages(); });
  const btnNew = el('button', 'ai-mini', '＋'); btnNew.type = 'button'; btnNew.title = 'New chat';
  btnNew.addEventListener('click', () => { store.newChat(); renderChatList(); renderMessages(); });
  const btnClear = el('button', 'ai-mini', '🗑'); btnClear.type = 'button'; btnClear.title = 'Clear this chat';
  btnClear.addEventListener('click', () => { store.clearCurrent(); renderMessages(); });
  bar.append(chatSelect, btnNew, btnClear);

  const messages = el('div', 'ai-messages');

  const chatRow = el('div', 'ai-inputrow');
  const chatInput = el('textarea', 'ai-input'); chatInput.rows = 1;
  chatInput.placeholder = 'Ask for tips or an instruction…';
  const chatSend = el('button', 'ai-send', '➤'); chatSend.type = 'button';
  bindInput(chatInput, chatSend, () => submit(chatInput));
  chatRow.append(chatInput, chatSend);
  chatView.append(bar, messages, chatRow);

  // possess view
  const possView = el('div', 'ai-view ai-possess'); possView.hidden = true;
  const badge = el('div', 'ai-badge', '🛡 RESTRICTED · no PvP · no chat · ban-safe');
  const toggleRow = el('label', 'ai-toggle');
  const toggle = el('input'); toggle.type = 'checkbox';
  toggle.addEventListener('change', () => setPossession(toggle.checked));
  toggleRow.append(toggle, el('span', null, 'Engage possession'));
  const status = el('div', 'ai-status', 'Idle. Toggle on, aim your crosshair, then give an instruction.');
  const possBody = el('div', 'ai-possbody'); possBody.hidden = true;
  const possRow = el('div', 'ai-inputrow');
  const possInput = el('textarea', 'ai-input'); possInput.rows = 1;
  possInput.placeholder = 'e.g. "mine", "tunnel 10s", "walk forward 5s"…';
  const possSend = el('button', 'ai-send', '▶'); possSend.type = 'button';
  bindInput(possInput, possSend, () => submit(possInput));
  possRow.append(possInput, possSend);
  const stopBtn = el('button', 'ai-stop', '■ STOP'); stopBtn.type = 'button';
  stopBtn.addEventListener('click', () => { engine.stop(); setStatus('Stopped.'); });
  const chips = el('div', 'ai-chips');
  for (const c of ['mine', 'tunnel 10s', 'walk forward 5s', 'strafe left', 'jump', 'sneak', 'stop']) {
    const chip = el('button', 'ai-chip', c); chip.type = 'button';
    chip.addEventListener('click', () => { possInput.value = c; submit(possInput); });
    chips.appendChild(chip);
  }
  possBody.append(possRow, stopBtn, chips);

  const monRow = el('label', 'ai-toggle ai-mon');
  const mon = el('input'); mon.type = 'checkbox'; mon.checked = true;
  mon.addEventListener('change', () => { ui.monitorOn = mon.checked; });
  monRow.append(mon, el('span', null, 'Watch screen & drop private tips'));

  possView.append(badge, toggleRow, status, possBody, monRow);

  panel.append(header, chatView, possView);
  root.append(launch, panel);
  document.getElementById('gamepanel').appendChild(root);

  Object.assign(ui, {
    root, panel, launch, dot, messages, chatInput, possessInput: possInput,
    possessBody: possBody, chatSelect, statusLine: status,
    tabChat, tabPoss, chatView, possView, possToggle: toggle,
  });
}

function bindInput(input, sendBtn, onSend) {
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 84) + 'px'; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  });
  sendBtn.addEventListener('click', onSend);
}

function setOpen(open) {
  ui.open = open;
  ui.panel.hidden = !open;
  ui.launch.hidden = open;
  if (open) { ui.dot.hidden = true; renderChatList(); renderMessages(); }
}

function setTab(tab) {
  ui.tab = tab;
  ui.tabChat.classList.toggle('is-on', tab === 'chat');
  ui.tabPoss.classList.toggle('is-on', tab === 'possess');
  ui.chatView.hidden = tab !== 'chat';
  ui.possView.hidden = tab !== 'possess';
  if (tab === 'chat') { ui.dot.hidden = true; renderMessages(); } // catch up on anything logged while away
}

function setPossession(on) {
  ui.possessOn = on;
  ui.possessBody.hidden = !on;
  ui.possToggle.checked = on;
  if (!on) { engine.stop(); setStatus('Possession off.'); }
  else setStatus(inGameReady() ? 'Armed. Aim your crosshair and give an instruction.'
                               : 'Armed — start a world and I’ll act on your instructions.');
}

function setStatus(text) { if (ui.statusLine) ui.statusLine.textContent = text; }

function renderChatList() {
  const sel = ui.chatSelect;
  sel.innerHTML = '';
  for (const c of store.chats) {
    const o = el('option', null, c.title || 'New chat');
    o.value = c.id;
    sel.appendChild(o);
  }
  sel.value = store.currentId;
}

function renderMessages() {
  const box = ui.messages;
  box.innerHTML = '';
  const msgs = store.current().msgs;
  if (!msgs.length) {
    box.appendChild(el('div', 'ai-empty',
      'No messages yet. Say hi, ask a survival question, or head to Possess.'));
  }
  for (const m of msgs) {
    const row = el('div', 'ai-msg ai-' + m.role);
    row.appendChild(el('div', 'ai-bubble', m.text));
    box.appendChild(row);
  }
  box.scrollTop = box.scrollHeight;
  if (ui.chatSelect.value !== store.currentId) renderChatList();
}

// A message from the assistant (or a private tip). Renders + persists + badges.
function aiSay(text, role = 'ai') {
  store.add(role, text);
  if (ui.open && ui.tab === 'chat') renderMessages();
  else { ui.dot.hidden = false; }
}

// ---------------- the brain: turn user text into an answer or an action ----------------

function inGameReady() { return ui.inGame && ui.isGameRunning?.(); }

function submit(input) {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  store.add('you', text);
  renderChatList();
  renderMessages();
  respond(text);
}

function respond(text) {
  const intent = parseIntent(text);
  const onPossess = ui.tab === 'possess'; // keep the possess status line informative

  if (intent.kind === 'forbidden') { if (onPossess) setStatus('🛡 Refused — that could get you banned.'); return aiSay(SAFE_REFUSAL); }
  if (intent.kind === 'unsupported') { if (onPossess) setStatus('Can’t do that in restricted mode.'); return aiSay(UNSUPPORTED_NOTE); }
  if (intent.kind === 'chat') return aiSay(wikiAnswer(text));

  // it's a task
  if (intent.action === 'stop') { engine.stop(); setStatus('Stopped.'); return aiSay('Stopped — all inputs released.'); }

  if (!ui.possessOn) {
    if (onPossess) setStatus('Toggle “Engage possession” on first.');
    return aiSay('That’s a possession task. Open the ⛏ Possess tab and toggle ' +
      '“Engage possession” first — then I’ll do it (safe tasks only).');
  }
  if (!inGameReady()) {
    setStatus('Waiting for a live game…');
    return aiSay('Start a world first — I can only possess a game that’s on screen.');
  }

  engine.run(intent, (label) => { if (label && label !== 'stopped') setStatus('Done: ' + label + '.'); });
  const secs = intent.seconds ? ' for ' + Math.round(intent.seconds / 1000) + 's' : '';
  const doing = engine.active ? engine.active : intent.action;
  setStatus('▶ ' + doing + (secs ? secs : ' (auto-stops in ' + MAX_TASK_MS / 1000 + 's)') + '. Hit STOP anytime.');
  aiSay('On it — ' + doing + secs + '.' + (intent.note || '') +
        ' (Safe input only; I won’t attack, chat, or run commands.)');
}

// ---------------- private screen monitor (mini-wiki tips) ----------------

const ROTATING_TIPS = [
  'Tip: torch as you mine — a lit tunnel never spawns mobs behind you.',
  'Tip: never dig straight down; you can drop into lava or a ravine.',
  'Tip: keep a food item handy so you regenerate between fights.',
  'Tip: mark your base coordinates so a deep mining trip can find its way home.',
  'Tip: a wall of torches around your base stops night-time creepers spawning.',
  'Tip: diamonds hide in the deepest layers — bring an iron pickaxe and spare torches.',
];

// Sample the game canvas' brightness (best-effort — WebGL buffers can read
// back black, so failures fall through to rotating tips). Everything here is
// private: tips only ever go to your chat panel, never the game's chat.
function sampleBrightness() {
  try {
    const canvas = document.querySelector('#display canvas');
    if (!canvas || !canvas.width) return null;
    const s = document.createElement('canvas');
    s.width = 16; s.height = 16;
    const ctx = s.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
    const avg = n ? sum / n : 0;
    return avg === 0 ? null : avg; // all-black usually means the read was blocked
  } catch { return null; }
}

function monitorTick() {
  if (!ui.monitorOn || !inGameReady()) return;
  const now = Date.now();
  if (now - ui.lastTip < TIP_MIN_GAP_MS) return;

  let tip;
  const b = sampleBrightness();
  if (b != null && b < 42) {
    tip = 'It looks dark on screen — hostile mobs spawn in low light. Place torches or wall up for the night.';
  } else {
    // pick a rotating tip that isn't the one we just showed
    for (let i = 0; i < ROTATING_TIPS.length; i++) {
      const cand = ROTATING_TIPS[Math.floor(Math.random() * ROTATING_TIPS.length)];
      if (cand !== ui.lastTipText) { tip = cand; break; }
    }
    tip = tip || ROTATING_TIPS[0];
  }
  ui.lastTip = now;
  ui.lastTipText = tip;
  aiSay(tip, 'tip');
}

// ---------------- public API ----------------

export const AI = {
  init({ isGameRunning } = {}) {
    ui.isGameRunning = isGameRunning || (() => false);
    store.load();
    buildUI();
    setTab('chat');
    ui.root.hidden = true; // hidden until a game is on screen
    setInterval(monitorTick, 30_000);
  },

  toggle() { if (ui.root.hidden) return; setOpen(!ui.open); },

  // called by main.js when the game panel shows/hides
  setInGame(on) {
    ui.inGame = on;
    if (!ui.root) return;
    ui.root.hidden = !on;
    if (!on) { engine.stop(); setOpen(false); }
  },

  // Pure/inspectable internals, exposed on the ephemeral debug handle only —
  // handy for testing that the safety guard and executor behave. The engine
  // has no unsafe action to reach even from here.
  _parse: parseIntent,
  _engine: engine,
};
