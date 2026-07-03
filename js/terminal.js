// Terminal emulator: scrollback, prompt, history, tab completion, async ask().
// All input funnels through a hidden <input> so desktop keys and mobile soft
// keyboards behave the same.

export class Terminal {
  constructor(root) {
    this.el = root;
    this.scrollback = root.querySelector('#scrollback');
    this.inputline = root.querySelector('#inputline');
    this.echo = root.querySelector('#inputecho');
    this.ps1 = root.querySelector('#ps1');
    this.cmdps1 = document.getElementById('cmdps1');
    this.kbd = document.getElementById('kbd');
    this.runbtn = document.getElementById('runbtn');
    this.history = [];
    this.histIdx = -1;
    this.histStash = '';
    this.onCommand = null;   // async (line) => void
    this.completer = null;   // (tokens) => string[] candidates for last token
    this.busy = true;        // true while a command (or boot) runs
    this._askResolve = null;

    this.kbd.addEventListener('input', () => this._sync());
    this.kbd.addEventListener('keydown', (e) => this._onKey(e));
    // RUN button (touch) submits the current line, same path as Enter
    this.runbtn?.addEventListener('click', (e) => {
      e.preventDefault();
      this._enter();
      this.focus();
    });
    // focus keyboard whenever the terminal is tapped/clicked (desktop aid)
    this.el.addEventListener('pointerup', (e) => {
      if (e.target === this.kbd || e.target === this.runbtn) return;
      if (!window.getSelection()?.toString()) this.focus();
    });
  }

  focus() { this.kbd.focus({ preventScroll: true }); }

  setPrompt(text) {
    this.ps1.textContent = text;
    if (this.cmdps1) this.cmdps1.textContent = text.trim();
  }

  print(text = '', cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    this.scrollback.appendChild(div);
    this._scroll();
    return div;
  }

  // print with inline html (trusted, internal strings only)
  printHTML(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    this.scrollback.appendChild(div);
    this._scroll();
    return div;
  }

  // Re-writable line, for progress bars: returns update(text) fn
  liveLine(cls = '') {
    const div = this.print('', cls);
    return (text) => { div.textContent = text; this._scroll(); };
  }

  clear() { this.scrollback.innerHTML = ''; }

  // typewriter-ish boot output
  async boot(lines, delay = 55) {
    for (const [text, cls, pause] of lines) {
      this.print(text, cls);
      await sleep(pause ?? delay);
    }
  }

  // hand the prompt to the user
  ready() {
    this.busy = false;
    this.inputline.hidden = false;
    this._sync();
    this._scroll();
  }

  _lock() {
    this.busy = true;
    this.inputline.hidden = true;
  }

  // ask a free-form question mid-command; resolves with the entered line
  ask(question, promptText = '?> ') {
    if (question) this.print(question, 'c-info');
    const oldPs1 = this.ps1.textContent;
    this.setPrompt(promptText);
    this.busy = false;
    this.inputline.hidden = false;
    this._scroll();
    this.focus();
    return new Promise((resolve) => {
      this._askResolve = (line) => {
        this.setPrompt(oldPs1);
        resolve(line);
      };
    });
  }

  async confirm(question) {
    const a = (await this.ask(question, '[y/N]> ')).trim().toLowerCase();
    return a === 'y' || a === 'yes';
  }

  // Submit the current input line. Shared by Enter and the RUN button.
  _enter() {
    if (this.busy && !this._askResolve) return;
    const line = this.kbd.value;
    this.kbd.value = '';
    this._sync();
    this.print(this.ps1.textContent + line, 'c-bright');
    if (this._askResolve) {
      const r = this._askResolve;
      this._askResolve = null;
      this._lock();
      r(line);
      return;
    }
    if (line.trim()) {
      this.history.push(line);
      if (this.history.length > 200) this.history.shift();
    }
    this.histIdx = -1;
    this._lock();
    Promise.resolve(this.onCommand?.(line)).finally(() => this.ready());
  }

  _onKey(e) {
    if (this.busy && !this._askResolve) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this._enter();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.history.length) return;
      if (this.histIdx === -1) { this.histStash = this.kbd.value; this.histIdx = this.history.length; }
      this.histIdx = Math.max(0, this.histIdx - 1);
      this.kbd.value = this.history[this.histIdx];
      this._sync();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.histIdx === -1) return;
      this.histIdx++;
      if (this.histIdx >= this.history.length) { this.histIdx = -1; this.kbd.value = this.histStash; }
      else this.kbd.value = this.history[this.histIdx];
      this._sync();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this._complete();
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      this.clear();
    } else if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
      e.preventDefault();
      this.print(this.ps1.textContent + this.kbd.value + '^C', 'c-dim');
      this.kbd.value = '';
      this.histIdx = -1;
      this._sync();
    }
  }

  _complete() {
    if (!this.completer) return;
    const val = this.kbd.value;
    const tokens = val.split(/\s+/);
    const last = tokens[tokens.length - 1] ?? '';
    const cands = this.completer(tokens).filter((c) => c.startsWith(last) && c !== last);
    if (cands.length === 1) {
      tokens[tokens.length - 1] = cands[0];
      this.kbd.value = tokens.join(' ') + ' ';
      this._sync();
    } else if (cands.length > 1) {
      // extend to longest common prefix, show options
      let p = cands[0];
      for (const c of cands) { while (!c.startsWith(p)) p = p.slice(0, -1); }
      if (p.length > last.length) {
        tokens[tokens.length - 1] = p;
        this.kbd.value = tokens.join(' ');
        this._sync();
      }
      this.print(cands.slice(0, 24).join('  ') + (cands.length > 24 ? '  …' : ''), 'c-dim');
    }
  }

  _sync() {
    this.echo.textContent = this.kbd.value;
    this._scroll();
  }

  _scroll() { this.el.scrollTop = this.el.scrollHeight; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
