// Terminal front-end: a real terminal (vendored xterm.js) the VM streams its
// logs into, plus a tap-first option tray. The VM never asks for free-typed
// input — every decision is a tray button, mirrored on number keys 1-9 for
// hardware keyboards.

const SGR = {
  reset: '\x1b[0m',
  dim: '\x1b[90m',
  bright: '\x1b[97m',
  ok: '\x1b[92m',
  warn: '\x1b[93m',
  err: '\x1b[91m',
  info: '\x1b[96m',
  blue: '\x1b[94m',
};
export const C = SGR;

// phosphor palette, mirrored in css/style.css
const THEME = {
  background: 'rgba(5, 8, 5, 0)', // let the CRT gradient show through
  foreground: '#3bf273',
  cursor: '#b7ffcf',
  cursorAccent: '#050805',
  selectionBackground: 'rgba(59, 242, 115, 0.30)',
  black: '#050805',
  red: '#ff5c5c',
  green: '#3bf273',
  yellow: '#ffb347',
  blue: '#5c9dff',
  magenta: '#d78cff',
  cyan: '#5cd7ff',
  white: '#9fdfb4',
  brightBlack: '#1d8f45',
  brightRed: '#ff7a7a',
  brightGreen: '#7dffa8',
  brightYellow: '#ffc877',
  brightBlue: '#8db8ff',
  brightMagenta: '#e6b3ff',
  brightCyan: '#8ce4ff',
  brightWhite: '#d9ffe6',
};

export class Term {
  constructor(mount, tray) {
    this.xt = new window.Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: true,
      fontFamily: '"Cascadia Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: window.innerWidth < 460 ? 12 : window.innerWidth < 900 ? 13 : 15,
      lineHeight: 1.25,
      theme: THEME,
    });
    this.fit = new window.FitAddon.FitAddon();
    this.xt.loadAddon(this.fit);
    this.xt.open(mount);
    this._refit();

    this.tray = tray;
    this._pick = null; // active chooser resolver: (index) => void
    this._opts = null;

    // refit whenever the mount resizes (tray appearing, rotation, resize)
    new ResizeObserver(() => this._refit()).observe(mount);

    // number keys select tray options without needing terminal focus
    document.addEventListener('keydown', (e) => {
      if (!this._pick || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && this._opts && n <= Math.min(9, this._opts.length)) {
        e.preventDefault();
        this._pick(n - 1);
      }
    });
  }

  _refit() { try { this.fit.fit(); } catch { /* mount not laid out yet */ } }

  get cols() { return this.xt.cols; }

  print(text = '', color = '') {
    this.xt.writeln(color ? color + text + SGR.reset : text);
  }

  // shell-style echo of a command the VM runs on the user's behalf
  cmd(line) {
    this.xt.writeln(`${SGR.ok}dev@digitbox${SGR.reset}:${SGR.blue}~/mc-workspace${SGR.reset}$ ${SGR.bright}${line}${SGR.reset}`);
  }

  // typewriter-ish boot output: [[text, color, pauseMs], …]
  async boot(lines, delay = 55) {
    for (const [text, color, pause] of lines) {
      this.print(text, color);
      await sleep(pause ?? delay);
    }
  }

  // Re-writable status line for progress bars. update(text) rewrites it in
  // place (real \r + erase-line, like a real terminal); update.done(text?)
  // finalises it and moves on. Text is clipped to the column count so the
  // rewrite never wraps.
  live(color = '') {
    let open = true;
    const update = (text) => {
      if (!open) return;
      const max = Math.max(8, this.cols - 1);
      this.xt.write('\r\x1b[2K' + color + String(text).slice(0, max) + SGR.reset);
    };
    update.done = (text) => {
      if (text != null) update(text);
      open = false;
      this.xt.write('\r\n');
    };
    return update;
  }

  // Tap-first selector. options: [{ label, value, kind?, echo? }]
  //   kind: 'primary' | 'ok' | 'warn' | 'danger' | 'dim'
  //   echo: shell-style string printed as the command this choice runs
  //         (undefined = print the label; false = silent)
  // Resolves with the chosen option's value.
  choose(options, { scroll = false } = {}) {
    return new Promise((resolve) => {
      this.tray.innerHTML = '';
      this.tray.classList.toggle('scroll', scroll);
      this.tray.hidden = false;
      this._opts = options;
      this._pick = (i) => {
        const opt = options[i];
        this._pick = null;
        this._opts = null;
        this.tray.hidden = true;
        this.tray.innerHTML = '';
        if (opt.echo) this.cmd(opt.echo);
        else if (opt.echo !== false) this.print('▸ ' + opt.label, SGR.bright);
        this.xt.scrollToBottom();
        resolve(opt.value);
      };
      options.forEach((opt, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'opt' + (opt.kind ? ' k-' + opt.kind : '');
        if (i < 9 && !scroll) {
          const k = document.createElement('kbd');
          k.textContent = String(i + 1);
          b.appendChild(k);
        }
        b.appendChild(document.createTextNode(opt.label));
        b.addEventListener('click', () => this._pick && this._pick(i));
        this.tray.appendChild(b);
      });
      this.xt.scrollToBottom();
    });
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
