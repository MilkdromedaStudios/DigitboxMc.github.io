// Shared synthetic input. Both the on-screen touch pad and the AI possession
// engine drive the game through ordinary DOM keyboard/mouse events aimed at
// the game canvas — the exact same events a real key press or tap produces.
//
// This is the whole basis of the "cannot get you banned" guarantee: there is
// no network layer here to forge packets into, no memory to poke — the only
// thing that can happen is a keystroke or click a human could physically make.
// Anything a server's anti-cheat would flag (forged movement, reach, fly,
// no-fall, packet spam) is simply not reachable from a page overlay.

export const KEYMAP = {
  KeyW: ['w', 87], KeyA: ['a', 65], KeyS: ['s', 83], KeyD: ['d', 68],
  KeyE: ['e', 69], Space: [' ', 32], ShiftLeft: ['Shift', 16], Escape: ['Escape', 27],
  // hotbar selection — legit item switching, useful to the possession engine
  Digit1: ['1', 49], Digit2: ['2', 50], Digit3: ['3', 51], Digit4: ['4', 52],
  Digit5: ['5', 53], Digit6: ['6', 54], Digit7: ['7', 55], Digit8: ['8', 56],
  Digit9: ['9', 57],
};

// The CheerpJ display is a canvas; keyboard events also go to document because
// LWJGL's browser input layer listens there too.
function gameCanvas() {
  const display = document.getElementById('display');
  return (display && display.querySelector('canvas')) || display;
}

export function sendKey(code, type) {
  const map = KEYMAP[code];
  if (!map) return;
  const [key, keyCode] = map;
  const ev = new KeyboardEvent(type, {
    key, code, keyCode, which: keyCode, bubbles: true, cancelable: true,
  });
  const el = gameCanvas();
  if (el) el.dispatchEvent(ev);
  document.dispatchEvent(ev);
}

export function sendMouse(button, type) {
  const canvas = gameCanvas();
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2; // aim at the crosshair
  const ev = new MouseEvent(type, {
    button,
    buttons: type === 'mousedown' ? (button === 0 ? 1 : 2) : 0,
    clientX: x, clientY: y, bubbles: true, cancelable: true,
  });
  canvas.dispatchEvent(ev);
}
