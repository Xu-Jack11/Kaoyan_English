// Hash router.

import { h } from './util.js';
import { applySettings } from './store.js';
import { renderHome, renderPaper, renderHistory, renderWrong } from './home.js';
import { renderResult } from './result.js';
import { mountExam } from './exam.js';

const app = document.getElementById('app');
let cleanup = null;

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { parts: path.split('/').filter(Boolean), query };
}

async function route() {
  if (cleanup) {
    try {
      cleanup();
    } catch (e) {
      console.error(e);
    }
    cleanup = null;
  }
  document.querySelectorAll('.hl-menu, .slot-picker, .modal-wrap').forEach((el) => el.remove());
  document.getElementById('toast')?.classList.remove('show');
  const { parts, query } = parse();
  const [name, id] = parts;
  document.body.dataset.view = name || 'home';
  window.scrollTo(0, 0);
  try {
    if (!name) await renderHome(app);
    else if (name === 'paper' && id) await renderPaper(app, id);
    else if (name === 'exam' && id) cleanup = await mountExam(app, id, query);
    else if (name === 'result' && id) await renderResult(app, id);
    else if (name === 'history') await renderHistory(app);
    else if (name === 'wrong') await renderWrong(app);
    else location.hash = '#/';
  } catch (e) {
    console.error(e);
    app.innerHTML = '';
    app.append(
      h(
        'div',
        { class: 'page narrow' },
        h('h1', {}, '加载失败'),
        h('p', {}, String(e.message || e)),
        h('p', { class: 'muted' }, '请通过本地静态服务器访问（例如在项目目录运行 python3 -m http.server），直接双击打开 HTML 文件时浏览器会阻止读取数据。'),
        h('a', { class: 'btn btn-primary', href: '#/' }, '返回首页')
      )
    );
  }
}

applySettings();
window.addEventListener('hashchange', route);
route();
