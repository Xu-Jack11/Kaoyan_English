// Persistence: attempts, settings. Everything lives in localStorage (falls back to memory).

const PREFIX = 'kyen1:';
const mem = new Map();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return mem.has(key) ? mem.get(key) : fallback;
  }
}

function write(key, value) {
  mem.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode or quota: keep the in-memory copy */
  }
}

function remove(key) {
  mem.delete(key);
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export const DEFAULT_SETTINGS = {
  fontSize: 'm', // s | m | l | xl
  contrast: 'standard', // standard | dark | yellow
  showTimer: true,
  instantFeedback: true, // reveal answers + explanations right after a section is submitted
  candidate: '',
};

export const settings = {
  get() {
    return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
  },
  set(patch) {
    const next = { ...settings.get(), ...patch };
    write('settings', next);
    applySettings(next);
    return next;
  },
};

export function applySettings(s = settings.get()) {
  const root = document.documentElement;
  root.dataset.font = s.fontSize;
  root.dataset.contrast = s.contrast;
}

export const attempts = {
  list() {
    const ids = read('attempt-ids', []);
    return ids.map((id) => read('attempt:' + id, null)).filter(Boolean);
  },
  get(id) {
    return read('attempt:' + id, null);
  },
  save(a) {
    a.updatedAt = Date.now();
    write('attempt:' + a.id, a);
    const ids = read('attempt-ids', []);
    if (!ids.includes(a.id)) {
      ids.unshift(a.id);
      write('attempt-ids', ids);
    }
  },
  remove(id) {
    remove('attempt:' + id);
    write('attempt-ids', read('attempt-ids', []).filter((x) => x !== id));
  },
};

export function exportAll() {
  return { version: 1, exportedAt: Date.now(), settings: settings.get(), attempts: attempts.list() };
}

export function importAll(data) {
  if (!data || !Array.isArray(data.attempts)) throw new Error('文件格式不正确');
  let n = 0;
  for (const a of data.attempts) {
    if (a && a.id && a.paperId) {
      attempts.save(a);
      n++;
    }
  }
  if (data.settings) settings.set(data.settings);
  return n;
}
