// Home (paper list), start-configuration page, history and wrong-answer book.

import { h, esc, fmtDate, fmtDuration, fmtScore, uid, modal, toast } from './util.js';
import { attempts, settings, exportAll, importAll } from './store.js';
import { loadIndex, loadPaper, allParts, summarize, migrateSubmitted, OBJECTIVE, SUBTYPE_CN } from './data.js';
import { openSettings, openHelp } from './dialogs.js';

function topbar(active) {
  const link = (href, label, key) => h('a', { href, class: active === key ? 'on' : '' }, label);
  return h(
    'header',
    { class: 'site-top' },
    h('a', { class: 'site-brand', href: '#/' }, h('span', { class: 'logo' }, 'EN'), h('span', {}, '考研英语一 · 机考模拟')),
    h(
      'nav',
      { class: 'site-nav' },
      link('#/', '真题', 'home'),
      link('#/history', '练习记录', 'history'),
      link('#/wrong', '错题本', 'wrong'),
      h('button', { type: 'button', onclick: () => openSettings() }, '设置'),
      h('button', { type: 'button', onclick: () => openHelp() }, '帮助')
    )
  );
}

function page(active, ...children) {
  return h('div', { class: 'site' }, topbar(active), h('main', { class: 'page' }, ...children), h('footer', { class: 'site-foot' }, '真题版权归原作者及国家教育考试主管部门所有，仅供个人学习使用。解析为本项目原创整理。'));
}

function bestOf(list) {
  const done = list.filter((a) => a.status === 'finished' && a.mode === 'mock' && a.result);
  if (!done.length) return null;
  return done.reduce((b, a) => (a.result.objScore > b.result.objScore ? a : b));
}

// ------------------------------------------------------------------ home
export async function renderHome(app) {
  const index = await loadIndex();
  const all = attempts.list();
  const active = all.filter((a) => a.status !== 'finished');
  const totalQ = index.papers.reduce((s, p) => s + p.questions, 0);
  const explained = index.papers.reduce((s, p) => s + (p.explained || 0), 0);

  const hero = h(
    'section',
    { class: 'hero' },
    h('div', {}, h('h1', {}, '考研英语（一）真题机考系统'), h('p', { class: 'lead' }, '仿雅思机考界面 · 计时作答 · 高亮笔记 · 按大题提交 · 自动批改 · 逐题解析'), h('div', { class: 'hero-stats' }, stat(index.papers.length, '套真题'), stat(`${index.papers[index.papers.length - 1].year}–${index.papers[0].year}`, '年份'), stat(totalQ, '道题目'), stat(explained, '条解析')))
  );

  const cont = active.length
    ? h(
        'section',
        { class: 'block' },
        h('h2', {}, '继续作答'),
        h(
          'div',
          { class: 'cont-list' },
          active.slice(0, 6).map((a) =>
            h(
              'a',
              { class: 'cont-item', href: `#/exam/${a.id}` },
              h('b', {}, `${a.paperId} 年`),
              h('span', {}, a.mode === 'mock' ? '全真模考' : `专项 · ${a.partLabel || ''}`),
              h('span', { class: 'muted' }, `已用 ${fmtDuration(a.elapsed || 0)} · ${Object.keys(a.answers || {}).length} 题已答`),
              h('span', { class: 'go' }, '继续 →')
            )
          )
        )
      )
    : null;

  const grid = h('div', { class: 'paper-grid' });
  for (const p of index.papers) {
    const mine = all.filter((a) => a.paperId === p.id);
    const best = bestOf(mine);
    grid.append(
      h(
        'article',
        { class: 'paper-card' },
        h('div', { class: 'pc-year' }, p.year),
        h('div', { class: 'pc-meta' }, h('span', { class: 'pill' }, `新题型 · ${SUBTYPE_CN[p.partB] || p.partB}`), p.explained ? h('span', { class: 'pill pill-ok' }, `解析 ${p.explained}/${p.questions}`) : h('span', { class: 'pill' }, '解析整理中')),
        h('div', { class: 'pc-topics' }, (p.topics || []).map((t) => h('span', {}, t))),
        h('div', { class: 'pc-stat muted' }, mine.length ? `练习 ${mine.length} 次${best ? ` · 模考最佳客观题 ${fmtScore(best.result.objScore)}/${best.result.objMax}` : ''}` : '尚未练习'),
        h('div', { class: 'pc-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startMock(p.id) }, '全真模考'), h('a', { class: 'btn', href: `#/paper/${p.id}` }, '专项练习'))
      )
    );
  }

  app.innerHTML = '';
  app.append(page('home', hero, cont, h('section', { class: 'block' }, h('h2', {}, '历年真题'), grid)));
}

function stat(v, label) {
  return h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, label));
}

function createAttempt(paperId, { mode, parts, timeLimit, partLabel }) {
  const a = {
    id: uid('a'),
    paperId,
    mode,
    parts: parts || null,
    partLabel: partLabel || '',
    timeLimit,
    elapsed: 0,
    status: 'new',
    createdAt: Date.now(),
    answers: {},
    flags: {},
    submitted: {},
    selfScores: {},
    highlights: {},
  };
  attempts.save(a);
  return a;
}

async function startMock(paperId) {
  const ok = await modal({
    title: `${paperId} 年 · 全真模考`,
    body: '<p>完整试卷：完形填空、阅读理解 A/B/C 节、小作文、大作文，共 52 题，满分 100 分。</p><p>考试时间 <b>180 分钟</b>，时间到自动交卷；完形、每篇阅读、新题型、翻译、写作均可单独提交。</p>',
    buttons: [{ label: '取消', value: false }, { label: '进入考试', value: true, primary: true }],
  });
  if (!ok) return;
  const a = createAttempt(paperId, { mode: 'mock', parts: null, timeLimit: 180 * 60 });
  location.hash = `#/exam/${a.id}`;
}

// ------------------------------------------------------------------ practice config
export async function renderPaper(app, paperId) {
  const paper = await loadPaper(paperId);
  const parts = allParts(paper);
  const perPartMin = (p) => {
    const sameSec = parts.filter((x) => x.section.id === p.section.id).length;
    return p.section.minutes / sameSec;
  };
  const form = h('form', { class: 'cfg' });
  const groups = paper.sections.map((sec) => {
    const ps = parts.filter((p) => p.section.id === sec.id);
    return h(
      'fieldset',
      { class: 'cfg-sec' },
      h('legend', {}, `${sec.cn}`, h('span', { class: 'muted' }, ` · ${sec.score} 分 · 建议 ${sec.minutes} 分钟${sec.subtype ? ` · ${SUBTYPE_CN[sec.subtype]}` : ''}`)),
      h('div', { class: 'cfg-parts' }, ps.map((p) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'part', value: p.id }), h('span', {}, p.en === p.cn ? p.cn : `${p.en}`), h('small', { class: 'muted' }, `第 ${p.qNums[0]}${p.qNums.length > 1 ? '–' + p.qNums[p.qNums.length - 1] : ''} 题`))))
    );
  });
  const presets = [
    ['全卷', parts.map((p) => p.id)],
    ['客观题（完形+阅读 A/B）', parts.filter((p) => OBJECTIVE.has(p.section.type)).map((p) => p.id)],
    ['完形填空', ['cloze']],
    ['阅读 A 节四篇', ['text1', 'text2', 'text3', 'text4']],
    ['新题型', ['partB']],
    ['翻译', ['partC']],
    ['写作', ['writingA', 'writingB']],
  ];
  const minutesInput = h('input', { type: 'number', name: 'minutes', min: 1, max: 300, value: 20, class: 'num' });
  const timerSel = h(
    'div',
    { class: 'seg' },
    h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name: 'timer', value: 'down', checked: true }), h('span', {}, '倒计时')),
    h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name: 'timer', value: 'up' }), h('span', {}, '不限时（正计时）'))
  );
  const summary = h('p', { class: 'cfg-summary' });
  const update = () => {
    const chosen = new FormData(form).getAll('part');
    const mins = Math.round(parts.filter((p) => chosen.includes(p.id)).reduce((s, p) => s + perPartMin(p), 0));
    if (!form.dataset.touched) minutesInput.value = mins || 20;
    const qn = parts.filter((p) => chosen.includes(p.id)).reduce((s, p) => s + p.qNums.length, 0);
    const pts = parts.filter((p) => chosen.includes(p.id)).reduce((s, p) => s + p.group.questions.reduce((x, q) => x + q.score, 0), 0);
    summary.textContent = chosen.length ? `已选 ${chosen.length} 个部分 · ${qn} 题 · ${fmtScore(pts)} 分 · 建议用时约 ${mins} 分钟` : '请至少选择一个部分';
  };
  minutesInput.addEventListener('input', () => (form.dataset.touched = '1'));
  form.addEventListener('change', (e) => {
    if (e.target.name === 'part') delete form.dataset.touched;
    minutesInput.disabled = new FormData(form).get('timer') === 'up';
    update();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const chosen = fd.getAll('part');
    if (!chosen.length) return toast('请至少选择一个部分', 'warn');
    const ordered = parts.filter((p) => chosen.includes(p.id));
    const timeLimit = fd.get('timer') === 'up' ? 0 : Math.max(1, Number(fd.get('minutes')) || 20) * 60;
    const label = ordered.length === parts.length ? '全卷' : ordered.map((p) => p.cn).join('+');
    const a = createAttempt(paperId, { mode: ordered.length === parts.length ? 'full' : 'practice', parts: ordered.length === parts.length ? null : chosen, timeLimit, partLabel: label });
    location.hash = `#/exam/${a.id}`;
  });
  form.append(
    h('div', { class: 'presets' }, h('span', { class: 'muted' }, '快速选择：'), presets.map(([label, ids]) => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { form.querySelectorAll('input[name=part]').forEach((c) => (c.checked = ids.includes(c.value))); delete form.dataset.touched; update(); } }, label))),
    ...groups,
    h('fieldset', { class: 'cfg-sec' }, h('legend', {}, '计时'), timerSel, h('label', { class: 'mins' }, '时长 ', minutesInput, ' 分钟')),
    summary,
    h('div', { class: 'cfg-actions' }, h('a', { class: 'btn', href: '#/' }, '返回'), h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, '开始练习'))
  );
  form.querySelector('input[value="cloze"]').checked = true;
  update();
  app.innerHTML = '';
  app.append(page('home', h('div', { class: 'narrow' }, h('h1', {}, `${paper.year} 年考研英语（一）· 专项练习`), h('p', { class: 'muted' }, '自由组合要练习的部分。每一部分（如单篇阅读）可单独提交，提交后立即批改并显示解析。'), form)));
}

// ------------------------------------------------------------------ history
export async function renderHistory(app) {
  const list = attempts.list().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const rows = [];
  for (const a of list) {
    let score = '—';
    if (a.status === 'finished') {
      try {
        const sum = summarize(await loadPaper(a.paperId), a);
        score = `${fmtScore(sum.total)} / ${fmtScore(sum.max)}${sum.pending ? '（含待自评）' : ''}`;
      } catch {}
    }
    rows.push(
      h(
        'tr',
        {},
        h('td', {}, fmtDate(a.updatedAt || a.createdAt)),
        h('td', {}, `${a.paperId}`),
        h('td', {}, a.mode === 'mock' ? '全真模考' : a.partLabel || '专项'),
        h('td', {}, fmtDuration(a.elapsed || 0)),
        h('td', {}, a.status === 'finished' ? score : h('span', { class: 'pill' }, a.status === 'new' ? '未开始' : '进行中')),
        h(
          'td',
          { class: 'actions' },
          a.status === 'finished' ? h('a', { class: 'btn btn-sm', href: `#/result/${a.id}` }, '报告') : h('a', { class: 'btn btn-sm btn-primary', href: `#/exam/${a.id}` }, '继续'),
          h(
            'button',
            {
              class: 'btn btn-sm btn-ghost',
              type: 'button',
              onclick: async () => {
                if (await modal({ title: '删除记录', body: '<p>删除后无法恢复，确定吗？</p>', buttons: [{ label: '取消', value: false }, { label: '删除', value: true, danger: true, primary: true }] })) {
                  attempts.remove(a.id);
                  renderHistory(app);
                }
              },
            },
            '删除'
          )
        )
      )
    );
  }
  const fileInput = h('input', { type: 'file', accept: 'application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const n = importAll(JSON.parse(await f.text()));
      toast(`已导入 ${n} 条记录`, 'ok');
      renderHistory(app);
    } catch (e) {
      toast('导入失败：' + e.message, 'warn');
    }
  });
  const exportBtn = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      onclick: () => {
        const blob = new Blob([JSON.stringify(exportAll(), null, 1)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        h('a', { href: url, download: `kaoyan-english-backup-${new Date().toISOString().slice(0, 10)}.json` }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    },
    '导出备份'
  );
  app.innerHTML = '';
  app.append(
    page(
      'history',
      h('div', { class: 'row-between' }, h('h1', {}, '练习记录'), h('div', { class: 'row' }, exportBtn, h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, '导入备份'), fileInput)),
      list.length
        ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['时间', '试卷', '模式', '用时', '得分', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows)))
        : h('p', { class: 'muted' }, '还没有练习记录。')
    )
  );
}

// ------------------------------------------------------------------ wrong book
export async function renderWrong(app) {
  // For every objective question, keep the most recent submitted attempt that included it.
  const latest = new Map();
  const list = attempts.list().sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  const papers = new Map();
  for (const a of list) {
    const subs = Object.keys(migrateSubmitted(a).submitted);
    if (!subs.length) continue;
    if (!papers.has(a.paperId)) papers.set(a.paperId, await loadPaper(a.paperId).catch(() => null));
    const paper = papers.get(a.paperId);
    if (!paper) continue;
    for (const p of allParts(paper)) {
      if (a.parts && !a.parts.includes(p.id)) continue;
      if (!subs.includes(p.id) || !OBJECTIVE.has(p.section.type)) continue;
      for (const q of p.group.questions) latest.set(`${a.paperId}:${q.n}`, { a, paper, part: p, q });
    }
  }
  const wrong = [...latest.values()].filter((x) => x.a.answers[x.q.n] !== x.q.answer);
  const byPaper = new Map();
  for (const w of wrong) {
    if (!byPaper.has(w.paper.id)) byPaper.set(w.paper.id, []);
    byPaper.get(w.paper.id).push(w);
  }
  const blocks = [...byPaper.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([pid, items]) =>
      h(
        'section',
        { class: 'block' },
        h('h2', {}, `${pid} 年 · ${items.length} 题`),
        h(
          'div',
          { class: 'wrong-list' },
          items
            .sort((a, b) => a.q.n - b.q.n)
            .map((w) =>
              h(
                'a',
                { class: 'wrong-item', href: `#/exam/${w.a.id}?q=${w.q.n}` },
                h('span', { class: 'qnum' }, w.q.n),
                h('span', { class: 'wi-part' }, w.part.cn),
                h('span', { class: 'wi-stem' }, w.q.stem || (w.q.options ? Object.values(w.q.options).join(' / ') : '')),
                h('span', { class: 'wi-ans' }, `你的答案 ${w.a.answers[w.q.n] || '—'} · 正确 ${w.q.answer}`)
              )
            )
        )
      )
    );
  app.innerHTML = '';
  app.append(page('wrong', h('h1', {}, '错题本'), h('p', { class: 'muted' }, '汇总已提交大题中做错或未作答的客观题（同一题以最近一次作答为准）。点击题目进入解析。'), blocks.length ? blocks : h('p', { class: 'muted' }, '暂无错题，继续保持！')));
}

export { page, esc };
