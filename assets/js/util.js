// Small DOM and formatting helpers shared by every view.

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal rich text for explanations: escapes HTML, then **bold**, 【tags】 and line breaks. */
export function richText(s) {
  if (!s) return '';
  const blocks = String(s).split(/\n{2,}/);
  return blocks
    .map((b) => {
      let h = esc(b)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/【([^】]{1,12})】/g, '<span class="tag">$1</span>')
        .replace(/\n/g, '<br>');
      return `<p>${h}</p>`;
    })
    .join('');
}

/** Writing prompts: line-based, supports "> " quoted lines (emails) and "|" table rows. */
export function promptText(s) {
  const lines = String(s || '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = rows
        .filter((r) => !/^\|\s*:?-{2,}/.test(r))
        .map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const [head, ...body] = cells;
      out.push(
        `<table class="prompt-table"><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      );
      continue;
    }
    if (line.startsWith('>')) {
      const q = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote class="prompt-mail">${q.map((l) => `<p>${esc(l) || '&nbsp;'}</p>`).join('')}</blockquote>`);
      continue;
    }
    if (line.startsWith('## ')) out.push(`<p class="prompt-caption">${esc(line.slice(3))}</p>`);
    else if (line.trim()) out.push(`<p>${esc(line)}</p>`);
    i++;
  }
  return out.join('');
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}
export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function countWords(text) {
  const m = String(text || '').match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g);
  return m ? m.length : 0;
}

export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (hh) return `${hh} 小时 ${mm} 分`;
  if (mm) return `${mm} 分 ${ss} 秒`;
  return `${ss} 秒`;
}

export function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

let toastTimer;
export function toast(msg, kind = 'info', ms = 3200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.className = `toast show ${kind}`;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Modal dialog. Resolves with the value of the clicked button (or null when dismissed). */
export function modal({ title, body, buttons = [{ label: '确定', value: true, primary: true }], wide = false, dismissible = true }) {
  return new Promise((resolve) => {
    const root = document.getElementById('overlay-root');
    const prevFocus = document.activeElement;
    const close = (v) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        close(null);
      }
    };
    const bodyEl = typeof body === 'string' ? h('div', { class: 'modal-body', html: body }) : h('div', { class: 'modal-body' }, body);
    const btns = buttons.map((b) =>
      h('button', { class: `btn ${b.primary ? 'btn-primary' : ''} ${b.danger ? 'btn-danger' : ''}`, type: 'button', onclick: () => close(typeof b.value === 'function' ? b.value(bodyEl) : b.value) }, b.label)
    );
    const dialog = h(
      'div',
      { class: `modal ${wide ? 'modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
      title ? h('div', { class: 'modal-head' }, h('h2', {}, title), dismissible ? h('button', { class: 'icon-btn', 'aria-label': '关闭', type: 'button', onclick: () => close(null) }, '✕') : null) : null,
      bodyEl,
      btns.length ? h('div', { class: 'modal-foot' }, btns) : null
    );
    const wrap = h('div', { class: 'modal-wrap', onmousedown: (e) => { if (e.target === wrap && dismissible) close(null); } }, dialog);
    root.append(wrap);
    document.addEventListener('keydown', onKey, true);
    (btns.find((b) => b.classList.contains('btn-primary')) || btns[0] || dialog).focus();
  });
}
