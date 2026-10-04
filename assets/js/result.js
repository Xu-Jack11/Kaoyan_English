// Score report for a finished (or partially submitted) attempt.

import { h, fmtDuration, fmtDate, fmtScore, countWords } from './util.js';
import { attempts } from './store.js';
import { loadPaper, partsFor, summarize, isAnswered, OBJECTIVE } from './data.js';
import { page } from './home.js';

export async function renderResult(app, attemptId) {
  const a = attempts.get(attemptId);
  if (!a) {
    app.innerHTML = '';
    app.append(page('history', h('h1', {}, '未找到记录'), h('a', { class: 'btn btn-primary', href: '#/' }, '返回首页')));
    return;
  }
  const paper = await loadPaper(a.paperId);
  const sum = summarize(paper, a);
  const parts = partsFor(paper, a);
  const pct = sum.max ? Math.round((sum.total / sum.max) * 100) : 0;

  const ring = h('div', { class: 'score-ring', style: `--p:${pct}` }, h('div', {}, h('b', {}, fmtScore(sum.total)), h('span', {}, `/ ${fmtScore(sum.max)}`)));
  const head = h(
    'section',
    { class: 'result-head' },
    ring,
    h(
      'div',
      { class: 'result-info' },
      h('h1', {}, `${paper.year} 年考研英语（一）· ${a.mode === 'mock' ? '全真模考' : a.partLabel || '练习'}`),
      h('p', { class: 'muted' }, `${a.finishedAt ? '交卷于 ' + fmtDate(a.finishedAt) : '进行中'} · 用时 ${fmtDuration(a.elapsed || 0)}${a.timeLimit ? ` / 限时 ${Math.round(a.timeLimit / 60)} 分钟` : ''}`),
      h('p', {}, `客观题 ${fmtScore(sum.objScore)} / ${fmtScore(sum.objMax)}`, sum.pending ? h('span', { class: 'pill pill-warn' }, ` ${sum.pending} 题主观题待自评`) : null),
      h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: `#/exam/${a.id}` }, '查看解析 / 回顾'), a.status !== 'finished' ? h('a', { class: 'btn', href: `#/exam/${a.id}` }, '继续作答') : null, h('a', { class: 'btn', href: `#/paper/${a.paperId}` }, '再练一次'), h('a', { class: 'btn btn-ghost', href: '#/' }, '返回首页'))
    )
  );

  const secRows = sum.rows.map((r) =>
    h(
      'tr',
      {},
      h('td', {}, r.section.cn),
      h('td', {}, r.partsDone ? `${r.objective ? `${r.correct} / ${r.doneTotal}` : `${r.answered} / ${r.doneTotal} 已作答`}${r.partsDone < r.partsTotal ? `（已提交 ${r.partsDone}/${r.partsTotal} 篇）` : ''}` : '未提交'),
      h('td', {}, r.partsDone ? (r.objective || !r.pending ? `${fmtScore(r.score)} / ${fmtScore(r.max)}` : `待自评（${fmtScore(r.score)} / ${fmtScore(r.max)}）`) : '—'),
      h('td', {}, h('div', { class: 'bar' }, h('i', { style: `width:${r.max ? (r.score / r.max) * 100 : 0}%` })))
    )
  );

  const grids = parts.map((p) => {
    const objective = OBJECTIVE.has(p.section.type);
    const submitted = !!a.submitted?.[p.id];
    return h(
      'div',
      { class: 'rg-part' },
      h('div', { class: 'rg-title' }, p.cn),
      h(
        'div',
        { class: 'rg-qs' },
        p.group.questions.map((q) => {
          const ans = a.answers[q.n];
          let cls = 'rq';
          let title = `第 ${q.n} 题`;
          if (submitted && objective) {
            cls += ans === q.answer ? ' right' : ans ? ' wrong' : ' empty';
            title += ans === q.answer ? ' 正确' : ` 你的答案 ${ans || '未答'}，正确 ${q.answer}`;
          } else if (!objective) {
            cls += isAnswered(ans) ? ' done' : ' empty';
            const s = a.selfScores?.[q.n];
            if (s != null) title += ` 自评 ${s}`;
            if (p.section.type === 'writing' && ans) title += ` · ${countWords(ans)} 词`;
          }
          return h('a', { class: cls, href: `#/exam/${a.id}?q=${q.n}`, title }, h('span', {}, q.n), submitted && objective && ans !== q.answer ? h('small', {}, q.answer) : null);
        })
      )
    );
  });

  app.innerHTML = '';
  app.append(
    page(
      'history',
      head,
      h('section', { class: 'block' }, h('h2', {}, '各大题得分'), h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['大题', '正确 / 作答', '得分', ''].map((t) => h('th', {}, t)))), h('tbody', {}, secRows)))),
      h('section', { class: 'block' }, h('h2', {}, '答题详情'), h('p', { class: 'muted' }, '绿色为正确，红色为错误（小字为正确答案），灰色为未作答。点击题号查看解析。'), h('div', { class: 'result-grid' }, grids))
    )
  );
}
