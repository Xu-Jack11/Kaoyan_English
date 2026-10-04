// IELTS-style highlighting: select text, then choose Highlight / Note / Clear from a small menu
// (also reachable via right-click). Highlights are stored as character offsets relative to a
// container element marked with [data-hl="<key>"]; elements marked [data-hl-skip] (blanks,
// drop slots, buttons) are ignored when counting offsets, so their changing labels never
// shift stored ranges.

import { h, uid, esc } from './util.js';

const SKIP = '[data-hl-skip], input, textarea, select, button, .hl-ignore';

function textNodes(container) {
  const out = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

/** Converts a DOM Range to [start, end) offsets inside the container, or null. */
function rangeToOffsets(container, range) {
  const nodes = textNodes(container);
  let pos = 0;
  let start = null;
  let end = null;
  for (const node of nodes) {
    const len = node.data.length;
    if (range.intersectsNode(node)) {
      const s = node === range.startContainer ? range.startOffset : 0;
      const e = node === range.endContainer ? range.endOffset : len;
      if (e > s) {
        if (start == null) start = pos + s;
        end = pos + e;
      }
    }
    pos += len;
  }
  if (start == null || end <= start) return null;
  return { start, end };
}

function wrap(container, rec) {
  const nodes = textNodes(container);
  let pos = 0;
  for (const node of nodes) {
    const len = node.data.length;
    const s = Math.max(rec.start, pos);
    const e = Math.min(rec.end, pos + len);
    if (e > s) {
      let target = node;
      if (s - pos > 0) target = target.splitText(s - pos);
      if (e - s < target.data.length) target.splitText(e - s);
      if (target.data.trim() || target.data.length) {
        const mark = document.createElement('mark');
        mark.className = 'hl' + (rec.note ? ' hl-note' : '');
        mark.dataset.hlId = rec.id;
        if (rec.note) mark.title = rec.note;
        target.parentNode.insertBefore(mark, target);
        mark.append(target);
      }
    }
    pos += len;
  }
}

function unwrap(container, id) {
  for (const m of container.querySelectorAll(`mark.hl[data-hl-id="${id}"]`)) {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    m.remove();
  }
  container.normalize();
}

export class Highlighter {
  /**
   * @param {HTMLElement} root   element containing highlightable containers
   * @param {{get:(key:string)=>Array, set:(key:string, list:Array)=>void, onChange?:()=>void}} store
   */
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.menu = null;
    this._onUp = (e) => this.onPointerUp(e);
    this._onCtx = (e) => this.onContext(e);
    this._onDown = (e) => {
      if (this.menu && !this.menu.contains(e.target)) this.closeMenu();
    };
    this._onKey = (e) => {
      if (e.key === 'Escape') this.closeMenu();
    };
    root.addEventListener('mouseup', this._onUp);
    root.addEventListener('touchend', this._onUp);
    root.addEventListener('contextmenu', this._onCtx);
    document.addEventListener('mousedown', this._onDown, true);
    document.addEventListener('keydown', this._onKey);
  }

  destroy() {
    this.root.removeEventListener('mouseup', this._onUp);
    this.root.removeEventListener('touchend', this._onUp);
    this.root.removeEventListener('contextmenu', this._onCtx);
    document.removeEventListener('mousedown', this._onDown, true);
    document.removeEventListener('keydown', this._onKey);
    this.closeMenu();
  }

  /** Re-applies stored highlights to every container under `scope`. */
  applyAll(scope = this.root) {
    const containers = scope.matches?.('[data-hl]') ? [scope] : [...scope.querySelectorAll('[data-hl]')];
    for (const c of containers) {
      for (const rec of this.store.get(c.dataset.hl)) wrap(c, rec);
    }
  }

  selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const containers = [...this.root.querySelectorAll('[data-hl]')].filter((c) => range.intersectsNode(c));
    const parts = [];
    for (const c of containers) {
      const off = rangeToOffsets(c, range);
      if (off) parts.push({ container: c, ...off });
    }
    return parts.length ? { range, parts, text: sel.toString() } : null;
  }

  onPointerUp(e) {
    if (e.button === 2) return;
    // Let the selection settle before reading it.
    setTimeout(() => {
      const info = this.selectionInfo();
      if (!info) return;
      const rect = info.range.getBoundingClientRect();
      this.openMenu(rect.left + rect.width / 2, rect.bottom + 6, info, null);
    }, 10);
  }

  onContext(e) {
    const mark = e.target.closest?.('mark.hl');
    const info = this.selectionInfo();
    if (!info && !mark) return;
    e.preventDefault();
    this.openMenu(e.clientX, e.clientY + 4, info, mark);
  }

  openMenu(x, y, info, mark) {
    this.closeMenu();
    const items = [];
    if (info) {
      items.push(h('button', { type: 'button', onclick: () => this.add(info) }, h('span', { class: 'hl-swatch' }), '高亮 Highlight'));
      items.push(h('button', { type: 'button', onclick: () => this.addWithNote(info) }, '✎ 笔记 Notes'));
    }
    const markEl = mark || (info && info.range.commonAncestorContainer.parentElement?.closest?.('mark.hl'));
    if (markEl) {
      const id = markEl.dataset.hlId;
      const rec = this.findRecord(id);
      if (rec?.rec.note != null) items.push(h('button', { type: 'button', onclick: () => this.editNote(id) }, '✎ 编辑笔记'));
      items.push(h('button', { type: 'button', onclick: () => this.clear(id) }, '✕ 清除 Clear'));
    }
    if (!items.length) return;
    const menu = h('div', { class: 'hl-menu', role: 'menu' }, items);
    document.body.append(menu);
    const w = menu.offsetWidth;
    const hgt = menu.offsetHeight;
    menu.style.left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8) + 'px';
    menu.style.top = (y + hgt > window.innerHeight - 8 ? y - hgt - 30 : y) + 'px';
    this.menu = menu;
  }

  closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  findRecord(id) {
    for (const c of this.root.querySelectorAll('[data-hl]')) {
      const list = this.store.get(c.dataset.hl);
      const rec = list.find((r) => r.id === id);
      if (rec) return { container: c, list, rec };
    }
    return null;
  }

  add(info, note = null) {
    const id = uid('hl');
    for (const p of info.parts) {
      const key = p.container.dataset.hl;
      const rec = { id, start: p.start, end: p.end, text: info.text.slice(0, 200) };
      if (note != null) rec.note = note;
      const list = [...this.store.get(key), rec];
      this.store.set(key, list);
      wrap(p.container, rec);
    }
    window.getSelection()?.removeAllRanges();
    this.closeMenu();
    this.store.onChange?.();
    return id;
  }

  async addWithNote(info) {
    this.closeMenu();
    const note = await notePrompt('', info.text);
    if (note == null) return;
    this.add(info, note);
  }

  async editNote(id) {
    this.closeMenu();
    const found = this.findRecord(id);
    if (!found) return;
    const note = await notePrompt(found.rec.note || '', found.rec.text || '');
    if (note == null) return;
    for (const c of this.root.querySelectorAll('[data-hl]')) {
      const list = this.store.get(c.dataset.hl);
      if (!list.some((r) => r.id === id)) continue;
      this.store.set(c.dataset.hl, list.map((r) => (r.id === id ? { ...r, note } : r)));
      for (const m of c.querySelectorAll(`mark.hl[data-hl-id="${id}"]`)) {
        m.title = note;
        m.classList.add('hl-note');
      }
    }
    this.store.onChange?.();
  }

  clear(id) {
    for (const c of this.root.querySelectorAll('[data-hl]')) {
      const list = this.store.get(c.dataset.hl);
      if (!list.some((r) => r.id === id)) continue;
      this.store.set(c.dataset.hl, list.filter((r) => r.id !== id));
      unwrap(c, id);
    }
    this.closeMenu();
    this.store.onChange?.();
  }
}

function notePrompt(initial, quote) {
  return new Promise((resolve) => {
    const root = document.getElementById('overlay-root');
    const ta = h('textarea', { class: 'note-input', rows: 4, placeholder: '写下你的笔记…' });
    ta.value = initial;
    const done = (v) => {
      wrapEl.remove();
      resolve(v);
    };
    const wrapEl = h(
      'div',
      { class: 'modal-wrap' },
      h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-label': '笔记' },
        h('div', { class: 'modal-head' }, h('h2', {}, '笔记 Notes')),
        h('div', { class: 'modal-body' }, quote ? h('blockquote', { class: 'note-quote', html: esc(quote.slice(0, 160)) }) : null, ta),
        h(
          'div',
          { class: 'modal-foot' },
          h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, '取消'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => done(ta.value.trim()) }, '保存')
        )
      )
    );
    root.append(wrapEl);
    ta.focus();
  });
}
