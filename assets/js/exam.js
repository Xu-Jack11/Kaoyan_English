// The computer-based test screen, modelled on the IELTS on-computer interface:
// top bar (candidate / timer / tools), part banner, split passage|questions panes with a
// draggable divider, and a bottom navigator with per-question buttons, Review flag and
// previous/next arrows. Sections (大题) are submitted independently; submitted sections
// switch to review mode with answers and explanations.

import { h, esc, $, $$, richText, promptText, countWords, fmtClock, fmtScore, toast, modal } from './util.js';
import { attempts, settings } from './store.js';
import { loadPaper, loadExplanations, partsFor, sectionsFor, gradeSection, summarize, isAnswered, OBJECTIVE, SUBTYPE_CN } from './data.js';
import { Highlighter } from './highlight.js';
import { openSettings, openHelp } from './dialogs.js';

const LETTERS = 'ABCDEFGH';

const WRITING_BANDS = {
  10: [[9, 10, '第五档：完成全部任务，语法结构与词汇丰富准确，格式恰当，有效使用衔接手段'], [7, 8, '第四档：完成全部任务，语言较丰富，基本无错误，格式恰当'], [5, 6, '第三档：基本完成任务，有一些错误但不影响理解'], [3, 4, '第二档：未能按要求完成任务，错误较多，影响理解'], [1, 2, '第一档：明显遗漏要点，语言错误多，有碍理解'], [0, 0, '零档：内容与题目无关或无法辨认']],
  20: [[17, 20, '第五档：完成全部任务，结构丰富准确，词汇多样，衔接自然，文章完整连贯'], [13, 16, '第四档：完成全部任务，语言较丰富，结构较清晰，基本无错误'], [9, 12, '第三档：基本完成任务，有一些错误，衔接简单'], [5, 8, '第二档：未能按要求完成，语言错误较多，影响理解'], [1, 4, '第一档：明显遗漏要点，语言错误多，有碍理解'], [0, 0, '零档：内容与题目无关或无法辨认']],
};

export async function mountExam(app, attemptId, query = {}) {
  const attempt = attempts.get(attemptId);
  if (!attempt) {
    app.innerHTML = '';
    app.append(h('div', { class: 'page narrow' }, h('h1', {}, '未找到这次练习'), h('p', {}, '记录可能已被删除。'), h('a', { class: 'btn btn-primary', href: '#/' }, '返回首页')));
    return () => {};
  }
  const paper = await loadPaper(attempt.paperId);
  const expl = await loadExplanations(paper.id);
  const view = new ExamView(app, paper, attempt, expl, query);
  view.mount();
  return () => view.destroy();
}

class ExamView {
  constructor(app, paper, attempt, expl, query) {
    this.app = app;
    this.paper = paper;
    this.a = attempt;
    this.expl = expl || { summaries: {}, questions: {} };
    this.query = query;
    this.parts = partsFor(paper, attempt);
    this.sections = sectionsFor(paper, attempt);
    this.qIndex = new Map();
    for (const p of this.parts) for (const q of p.group.questions) this.qIndex.set(q.n, { q, part: p });
    this.order = this.parts.flatMap((p) => p.qNums);
    this.armed = null; // letter picked from an option bank, waiting for a slot click
    this.saveTimer = null;
    this.timerId = null;
    this.warned = new Set();
    this.a.answers ||= {};
    this.a.flags ||= {};
    this.a.submitted ||= {};
    this.a.selfScores ||= {};
    this.a.highlights ||= {};
  }

  get finished() {
    return this.a.status === 'finished';
  }

  reviewVisible(sectionId) {
    return !!this.a.submitted[sectionId] && (this.finished || settings.get().instantFeedback);
  }

  // ---------------------------------------------------------------- lifecycle
  mount() {
    if (this.a.status === 'new') this.renderIntro();
    else this.renderShell();
  }

  destroy() {
    this.stopTimer(true);
    this.flushSave();
    this.hl?.destroy();
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('beforeunload', this._onUnload);
    document.removeEventListener('visibilitychange', this._onVis);
  }

  save(immediate = false) {
    clearTimeout(this.saveTimer);
    if (immediate) attempts.save(this.a);
    else this.saveTimer = setTimeout(() => attempts.save(this.a), 300);
  }

  flushSave() {
    clearTimeout(this.saveTimer);
    attempts.save(this.a);
  }

  // ---------------------------------------------------------------- intro screen
  renderIntro() {
    const a = this.a;
    const limit = a.timeLimit ? `${Math.round(a.timeLimit / 60)} 分钟` : '不限时（正计时）';
    const rows = this.sections.map((s) => {
      const parts = this.parts.filter((p) => p.section.id === s.id);
      const nums = parts.flatMap((p) => p.qNums);
      const max = parts.flatMap((p) => p.group.questions).reduce((x, q) => x + q.score, 0);
      return h('tr', {}, h('td', {}, s.cn), h('td', {}, parts.map((p) => p.en).join(' · ')), h('td', {}, `${nums[0]}–${nums[nums.length - 1]}`), h('td', {}, fmtScore(max)));
    });
    const candidate = settings.get().candidate || '考生';
    this.app.innerHTML = '';
    this.app.append(
      h(
        'div',
        { class: 'intro' },
        h('div', { class: 'intro-bar' }, h('span', { class: 'brand' }, 'KAOYAN · CBT'), h('span', {}, `Candidate: ${candidate}`)),
        h(
          'div',
          { class: 'intro-card' },
          h('h1', {}, `${this.paper.year} 年考研英语（一）`),
          h('p', { class: 'intro-sub' }, a.mode === 'mock' ? '全真模考 · Full Test' : '专项练习 · Practice'),
          h('p', { class: 'intro-time' }, `时间 Time：${limit}`),
          h('h3', {}, 'INSTRUCTIONS TO CANDIDATES 考生须知'),
          h(
            'ul',
            {},
            h('li', {}, '答题区分左右两栏：左侧为原文，右侧为题目；拖动中间分隔条可调整宽度。'),
            h('li', {}, '可随时修改答案。每个大题可单独点击「提交本大题」，提交后该大题答案锁定并自动批改。'),
            h('li', {}, '选中文字后在弹出菜单中选择「高亮」或「笔记」；也可右键操作，点击已有高亮可清除。'),
            h('li', {}, '勾选底部「Review」可标记题目以便回看；底部题号按钮显示作答状态。'),
            h('li', {}, a.timeLimit ? '计时结束时系统将自动提交所有未提交的大题。' : '本次为正计时练习，不会自动交卷。'),
            h('li', {}, '作答进度自动保存在本机浏览器中，刷新或关闭页面后可继续。')
          ),
          h('h3', {}, 'INFORMATION FOR CANDIDATES 试卷信息'),
          h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, '大题'), h('th', {}, '内容'), h('th', {}, '题号'), h('th', {}, '分值'))), h('tbody', {}, rows)),
          h(
            'div',
            { class: 'intro-actions' },
            h('a', { class: 'btn', href: '#/' }, '返回'),
            h(
              'button',
              {
                class: 'btn btn-primary btn-lg',
                type: 'button',
                onclick: () => {
                  this.a.status = 'active';
                  this.a.startedAt = Date.now();
                  this.save(true);
                  this.renderShell();
                },
              },
              '开始考试 Start test'
            )
          )
        )
      )
    );
  }

  // ---------------------------------------------------------------- shell
  renderShell() {
    const s = settings.get();
    const candidate = s.candidate || '考生';
    this.app.innerHTML = '';
    this.timerEl = h('button', { class: 'cbt-timer', type: 'button', title: '点击隐藏/显示计时', onclick: () => this.toggleTimer() });
    this.root = h(
      'div',
      { class: 'cbt' },
      h(
        'header',
        { class: 'cbt-top' },
        h('div', { class: 'cbt-id' }, h('span', { class: 'brand' }, `${this.paper.year} 英语（一）`), h('span', { class: 'cand' }, `Candidate · ${candidate}`)),
        this.timerEl,
        h(
          'div',
          { class: 'cbt-tools' },
          this.a.mode !== 'mock' && !this.finished && this.a.timeLimit ? h('button', { class: 'tool', type: 'button', onclick: () => this.pause() }, '⏸ 暂停') : null,
          h('button', { class: 'tool', type: 'button', onclick: () => this.showNotes() }, '✎ 笔记'),
          h('button', { class: 'tool', type: 'button', onclick: () => openSettings(() => this.refreshPart()) }, '⚙ 设置'),
          h('button', { class: 'tool', type: 'button', onclick: () => openHelp() }, '? 帮助'),
          this.finished ? h('a', { class: 'tool', href: `#/result/${this.a.id}` }, '成绩报告') : null,
          h('button', { class: 'tool', type: 'button', onclick: () => this.exit() }, '⎋ 退出')
        )
      ),
      (this.partBar = h('div', { class: 'cbt-partbar' })),
      h(
        'div',
        { class: 'cbt-tabs' },
        h('button', { type: 'button', class: 'tab on', dataset: { pane: 'left' }, onclick: (e) => this.mobilePane('left', e) }, '原文 Passage'),
        h('button', { type: 'button', class: 'tab', dataset: { pane: 'right' }, onclick: (e) => this.mobilePane('right', e) }, '题目 Questions')
      ),
      (this.main = h(
        'main',
        { class: 'cbt-main', dataset: { mobile: 'left' } },
        (this.left = h('section', { class: 'pane pane-left', 'aria-label': '原文' })),
        (this.divider = h('div', { class: 'divider', role: 'separator', 'aria-orientation': 'vertical', title: '拖动调整宽度' }, h('span', { class: 'grip' }))),
        (this.right = h('section', { class: 'pane pane-right', 'aria-label': '题目' }))
      )),
      (this.nav = h('footer', { class: 'cbt-nav' }))
    );
    this.app.append(this.root);
    this.initDivider();
    this.hl = new Highlighter(this.root, {
      get: (k) => this.a.highlights[k] || [],
      set: (k, list) => {
        if (list.length) this.a.highlights[k] = list;
        else delete this.a.highlights[k];
      },
      onChange: () => this.save(),
    });
    this._onKey = (e) => this.onKey(e);
    this._onUnload = () => {
      this.stopTimer(true);
      this.flushSave();
    };
    this._onVis = () => {
      if (document.visibilityState === 'hidden') {
        this.a.elapsed = this.elapsedNow();
        this.flushSave();
      }
    };
    document.addEventListener('keydown', this._onKey);
    window.addEventListener('beforeunload', this._onUnload);
    document.addEventListener('visibilitychange', this._onVis);

    let startQ = Number(this.query.q) || this.a.current?.q;
    if (!this.qIndex.has(startQ)) startQ = this.order[0];
    this.goto(startQ, { scroll: true });
    if (!this.finished) this.startTimer();
    else this.renderTimer();
  }

  mobilePane(which, e) {
    this.main.dataset.mobile = which;
    $$('.cbt-tabs .tab', this.root).forEach((t) => t.classList.toggle('on', t.dataset.pane === which));
    e?.currentTarget?.blur();
  }

  initDivider() {
    const KEY = 'kyen1:split';
    let pct = 50;
    try {
      pct = Number(localStorage.getItem(KEY)) || 50;
    } catch {}
    const apply = (v) => {
      pct = Math.min(75, Math.max(25, v));
      this.main.style.setProperty('--split', pct + '%');
    };
    apply(pct);
    this.divider.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.divider.setPointerCapture(e.pointerId);
      this.main.classList.add('dragging');
      const rect = this.main.getBoundingClientRect();
      const move = (ev) => apply(((ev.clientX - rect.left) / rect.width) * 100);
      const up = () => {
        this.main.classList.remove('dragging');
        this.divider.removeEventListener('pointermove', move);
        this.divider.removeEventListener('pointerup', up);
        try {
          localStorage.setItem(KEY, String(pct));
        } catch {}
      };
      this.divider.addEventListener('pointermove', move);
      this.divider.addEventListener('pointerup', up);
    });
    this.divider.addEventListener('dblclick', () => apply(50));
  }

  // ---------------------------------------------------------------- timer
  elapsedNow() {
    if (this.timerId == null) return this.a.elapsed || 0;
    return this.baseElapsed + (performance.now() - this.tickStart) / 1000;
  }

  startTimer() {
    if (this.timerId != null) return;
    this.baseElapsed = this.a.elapsed || 0;
    this.tickStart = performance.now();
    this.lastPersist = 0;
    this.timerId = setInterval(() => this.tick(), 500);
    this.tick();
  }

  stopTimer(persist) {
    if (this.timerId == null) return;
    const e = this.elapsedNow();
    clearInterval(this.timerId);
    this.timerId = null;
    if (persist) this.a.elapsed = e;
  }

  tick() {
    const e = this.elapsedNow();
    if (e - this.lastPersist > 5) {
      this.a.elapsed = e;
      this.lastPersist = e;
      this.save();
    }
    this.renderTimer(e);
    if (this.a.timeLimit) {
      const left = this.a.timeLimit - e;
      for (const m of [10, 5]) {
        if (left <= m * 60 && left > 0 && !this.warned.has(m) && this.a.timeLimit > m * 60) {
          this.warned.add(m);
          toast(`还剩 ${m} 分钟`, 'warn', 5000);
        }
      }
      if (left <= 0) this.timeUp();
    }
  }

  renderTimer(e = this.elapsedNow()) {
    if (!this.timerEl) return;
    const show = settings.get().showTimer;
    let label;
    let cls = 'cbt-timer';
    if (this.finished) {
      label = `用时 ${fmtClock(this.a.elapsed || 0)}`;
    } else if (this.a.timeLimit) {
      const left = Math.max(0, this.a.timeLimit - e);
      label = left >= 600 ? `剩余 ${Math.ceil(left / 60)} 分钟` : `剩余 ${fmtClock(left)}`;
      if (left < 600) cls += ' warn';
      if (left < 300) cls += ' danger';
    } else {
      label = `已用 ${fmtClock(e)}`;
    }
    this.timerEl.className = cls + (show ? '' : ' hidden-time');
    this.timerEl.textContent = show ? `⏱ ${label}` : '⏱ 显示计时';
  }

  toggleTimer() {
    settings.set({ showTimer: !settings.get().showTimer });
    this.renderTimer();
  }

  async pause() {
    this.stopTimer(true);
    this.save(true);
    this.root.classList.add('paused');
    await modal({ title: '已暂停', body: '<p>计时已暂停，题目内容已隐藏。</p>', buttons: [{ label: '继续作答', value: true, primary: true }], dismissible: false });
    this.root.classList.remove('paused');
    this.startTimer();
  }

  async timeUp() {
    this.stopTimer(false);
    this.a.elapsed = this.a.timeLimit;
    for (const s of this.sections) if (!this.a.submitted[s.id]) this.doSubmit(s.id, true);
    this.finish();
    await modal({ title: '考试时间到', body: '<p>时间已用完，系统已自动提交全部大题。</p>', buttons: [{ label: '查看成绩报告', value: true, primary: true }], dismissible: false });
    location.hash = `#/result/${this.a.id}`;
  }

  // ---------------------------------------------------------------- navigation
  currentPart() {
    return this.parts.find((p) => p.id === this.curPartId);
  }

  goto(n, { scroll = true } = {}) {
    const info = this.qIndex.get(n);
    if (!info) return;
    const partChanged = info.part.id !== this.curPartId;
    this.curQ = n;
    this.a.current = { part: info.part.id, q: n };
    this.save();
    if (partChanged) {
      this.curPartId = info.part.id;
      this.renderPart();
    }
    this.renderNav();
    this.markCurrent(scroll);
  }

  step(delta) {
    const i = this.order.indexOf(this.curQ);
    const n = this.order[i + delta];
    if (n != null) this.goto(n);
  }

  markCurrent(scroll) {
    $$('.q.current, .blank.current, .slot.current', this.root).forEach((el) => el.classList.remove('current'));
    const qEl = $(`.q[data-q="${this.curQ}"]`, this.right);
    qEl?.classList.add('current');
    const inLeft = $$(`.blank[data-q="${this.curQ}"], .slot[data-q="${this.curQ}"]`, this.left);
    inLeft.forEach((el) => el.classList.add('current'));
    if (scroll) {
      qEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      inLeft[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  onKey(e) {
    if (document.querySelector('.modal-wrap')) return;
    const t = e.target;
    if (t.closest?.('textarea, input, select, [contenteditable]')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.step(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.step(-1);
    } else if (/^[a-dA-D]$/.test(e.key)) {
      const info = this.qIndex.get(this.curQ);
      if (!info) return;
      const t2 = info.part.section.type;
      if ((t2 === 'cloze' || t2 === 'reading') && !this.a.submitted[info.part.section.id]) {
        this.setAnswer(this.curQ, e.key.toUpperCase());
        const r = $(`.q[data-q="${this.curQ}"] input[value="${e.key.toUpperCase()}"]`, this.right);
        if (r) r.checked = true;
      }
    }
  }

  // ---------------------------------------------------------------- answers
  setAnswer(n, val) {
    const info = this.qIndex.get(n);
    if (!info || this.a.submitted[info.part.section.id]) return;
    if (val == null || val === '') delete this.a.answers[n];
    else this.a.answers[n] = val;
    this.save();
    this.updateNavButton(n);
    this.updateNavCount();
  }

  /** Part B letters are used at most once per group: placing a letter clears it elsewhere. */
  placeLetter(n, letter) {
    const info = this.qIndex.get(n);
    if (!info || this.a.submitted[info.part.section.id]) return;
    if (letter) {
      for (const q of info.part.group.questions) {
        if (q.n !== n && this.a.answers[q.n] === letter) this.setAnswer(q.n, null);
      }
    }
    this.setAnswer(n, letter);
    this.armed = null;
    this.refreshPartB();
    this.goto(n, { scroll: false });
  }

  // ---------------------------------------------------------------- part banner + nav
  renderPartBar() {
    const p = this.currentPart();
    const sec = p.section;
    const nums = p.qNums;
    const range = nums.length > 1 ? `${nums[0]}–${nums[nums.length - 1]}` : `${nums[0]}`;
    const verb = { cloze: '阅读短文，为每个空选择最佳答案', reading: '阅读短文，回答', partB: `完成${SUBTYPE_CN[sec.subtype] || '新题型'}`, translation: '将划线部分译成中文', writing: '按要求完成写作' }[sec.type];
    const submitted = this.a.submitted[sec.id];
    const g = gradeSection(this.paper, this.a, sec.id);
    let action;
    if (submitted) {
      action = h('span', { class: 'badge-done' }, this.reviewVisible(sec.id) ? `${sec.cn} 已提交 · ${g.objective ? `得分 ${fmtScore(g.score)}/${fmtScore(g.max)}` : g.pending ? '待自评' : `自评 ${fmtScore(g.score)}/${fmtScore(g.max)}`}` : `${sec.cn} 已提交`);
    } else if (!this.finished) {
      action = h('button', { class: 'btn btn-submit-sec', type: 'button', onclick: () => this.submitSection(sec.id) }, `提交本大题 · ${sec.cn}`);
    }
    this.partBar.innerHTML = '';
    this.partBar.append(
      h(
        'div',
        { class: 'pb-text' },
        h('strong', {}, sec.title.replace(/\s+/g, ' ')),
        h('span', { class: 'pb-cn' }, `${p.group.id.startsWith('text') ? p.en : sec.cn}${sec.type === 'partB' && SUBTYPE_CN[sec.subtype] ? ` · ${SUBTYPE_CN[sec.subtype]}` : ''}`),
        h('span', { class: 'pb-desc' }, `${verb}${sec.type === 'reading' ? `第 ${range} 题` : `（第 ${range} 题）`}。`),
        sec.directions ? h('button', { class: 'linkish', type: 'button', onclick: () => modal({ title: 'Directions', body: `<p class="directions">${esc(sec.directions)}</p>` }) }, 'Directions') : null
      ),
      action || ''
    );
  }

  renderNav() {
    this.nav.innerHTML = '';
    const flagged = !!this.a.flags[this.curQ];
    const flag = h(
      'label',
      { class: `review-flag ${flagged ? 'on' : ''}`, title: '标记本题，稍后回看' },
      h('input', {
        type: 'checkbox',
        checked: flagged,
        onchange: (e) => {
          if (e.target.checked) this.a.flags[this.curQ] = true;
          else delete this.a.flags[this.curQ];
          e.target.parentElement.classList.toggle('on', e.target.checked);
          this.save();
          this.updateNavButton(this.curQ);
        },
      }),
      ` Review ${this.curQ}`
    );
    const partsEl = h('div', { class: 'nav-parts' });
    this.parts.forEach((p) => {
      const active = p.id === this.curPartId;
      const answered = p.qNums.filter((n) => isAnswered(this.a.answers[n])).length;
      const wrap = h('div', { class: `nav-part ${active ? 'active' : ''} ${this.a.submitted[p.section.id] ? 'submitted' : ''}`, dataset: { part: p.id } });
      wrap.append(
        h('button', { class: 'nav-part-label', type: 'button', onclick: () => this.goto(p.qNums.includes(this.curQ) ? this.curQ : p.qNums[0]) }, h('span', { class: 'np-name' }, p.nav), h('span', { class: 'np-count', dataset: { count: p.id } }, `${answered}/${p.qNums.length}`))
      );
      if (active) {
        const qs = h('div', { class: 'nav-qs' });
        for (const n of p.qNums) qs.append(this.navButton(n));
        wrap.append(qs);
      }
      partsEl.append(wrap);
    });
    const arrows = h(
      'div',
      { class: 'nav-arrows' },
      h('button', { class: 'arrow', type: 'button', 'aria-label': '上一题', onclick: () => this.step(-1) }, '◀'),
      h('button', { class: 'arrow', type: 'button', 'aria-label': '下一题', onclick: () => this.step(1) }, '▶')
    );
    const finishBtn = this.finished
      ? h('a', { class: 'btn btn-finish', href: `#/result/${this.a.id}` }, '📊 成绩报告')
      : h('button', { class: 'btn btn-finish', type: 'button', onclick: () => this.finishAll() }, '✓ 交卷');
    this.nav.append(flag, partsEl, arrows, finishBtn);
    partsEl.querySelector('.nav-part.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  navButton(n) {
    const b = h('button', { class: 'nq', type: 'button', dataset: { q: n }, onclick: () => this.goto(n) }, String(n));
    this.styleNavButton(b, n);
    return b;
  }

  styleNavButton(b, n) {
    const info = this.qIndex.get(n);
    const sec = info.part.section;
    b.classList.toggle('answered', isAnswered(this.a.answers[n]));
    b.classList.toggle('flagged', !!this.a.flags[n]);
    b.classList.toggle('current', n === this.curQ);
    b.classList.remove('right', 'wrong');
    if (this.reviewVisible(sec.id) && OBJECTIVE.has(sec.type)) b.classList.add(this.a.answers[n] === info.q.answer ? 'right' : 'wrong');
    b.setAttribute('aria-label', `第 ${n} 题${isAnswered(this.a.answers[n]) ? '，已作答' : '，未作答'}${this.a.flags[n] ? '，已标记' : ''}`);
  }

  updateNavButton(n) {
    const b = $(`.nq[data-q="${n}"]`, this.nav);
    if (b) this.styleNavButton(b, n);
  }

  updateNavCount() {
    for (const p of this.parts) {
      const el = $(`[data-count="${p.id}"]`, this.nav);
      if (el) el.textContent = `${p.qNums.filter((n) => isAnswered(this.a.answers[n])).length}/${p.qNums.length}`;
    }
  }

  // ---------------------------------------------------------------- part rendering
  refreshPart() {
    const l = this.left.scrollTop;
    const r = this.right.scrollTop;
    this.renderPart();
    this.left.scrollTop = l;
    this.right.scrollTop = r;
    this.renderNav();
    this.markCurrent(false);
  }

  renderPart() {
    const p = this.currentPart();
    this.renderPartBar();
    this.left.innerHTML = '';
    this.right.innerHTML = '';
    this.left.scrollTop = 0;
    this.right.scrollTop = 0;
    const type = p.section.type;
    const review = this.reviewVisible(p.section.id);
    this.root.dataset.type = type;
    this.root.classList.toggle('review', review);
    if (type === 'cloze') this.renderCloze(p, review);
    else if (type === 'reading') this.renderReading(p, review);
    else if (type === 'partB') this.renderPartB(p, review);
    else if (type === 'translation') this.renderTranslation(p, review);
    else if (type === 'writing') this.renderWriting(p, review);
    this.hl.applyAll(this.root);
  }

  summaryBox(p) {
    const s = this.expl.summaries?.[p.id];
    if (!s) return null;
    return h('details', { class: 'summary-box hl-ignore' }, h('summary', {}, '文章大意 / 结构'), h('div', { html: richText(s) }));
  }

  explBox(n, open) {
    const e = this.expl.questions?.[n];
    const text = typeof e === 'string' ? e : e?.analysis;
    return h('details', { class: 'expl hl-ignore', open: open || null }, h('summary', {}, '解析'), h('div', { html: text ? richText(text) : '<p class="muted">本题解析整理中。</p>' }));
  }

  passageHtml(paras, ctx) {
    return paras
      .map((para) => {
        let html = '';
        const re = /\{\{(\d+)\}\}|<u>([\s\S]*?)<\/u>/g;
        let last = 0;
        let m;
        while ((m = re.exec(para))) {
          html += esc(para.slice(last, m.index));
          html += m[1] ? ctx.blank(Number(m[1])) : ctx.underline(m[2]);
          last = re.lastIndex;
        }
        html += esc(para.slice(last));
        if (ctx.blockSlot && /^\s*<span class="slot[^>]*>.*<\/span>\s*$/.test(html)) return `<div class="slot-line">${html}</div>`;
        return `<p>${html}</p>`;
      })
      .join('');
  }

  optionList(q, review, { inline = false } = {}) {
    const chosen = this.a.answers[q.n];
    const locked = !!this.a.submitted[this.qIndex.get(q.n).part.section.id];
    const wrap = h('div', { class: `opts ${inline ? 'opts-inline' : ''}`, role: 'radiogroup' });
    for (const [k, text] of Object.entries(q.options)) {
      let cls = 'opt';
      if (chosen === k) cls += ' chosen';
      if (review) {
        if (k === q.answer) cls += ' is-answer';
        else if (chosen === k) cls += ' is-wrong';
      }
      const input = h('input', { type: 'radio', name: `q${q.n}`, value: k, checked: chosen === k, disabled: locked || null });
      input.addEventListener('change', () => {
        this.setAnswer(q.n, k);
        $$('.opt', wrap).forEach((o) => o.classList.toggle('chosen', o.dataset.k === k));
        this.onObjectiveAnswered(q);
        this.goto(q.n, { scroll: false });
      });
      const label = h('label', { class: cls, dataset: { k } }, input, h('span', { class: 'opt-letter' }, k), h('span', { class: 'opt-text' }, text));
      label.addEventListener('click', (e) => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && label.contains(sel.anchorNode)) e.preventDefault();
      });
      wrap.append(label);
    }
    return wrap;
  }

  verdict(q) {
    const a = this.a.answers[q.n];
    if (!a) return h('div', { class: 'verdict none' }, `未作答 · 正确答案 ${q.answer}`);
    if (a === q.answer) return h('div', { class: 'verdict ok' }, `✓ 回答正确 · ${q.answer}`);
    return h('div', { class: 'verdict bad' }, `✗ 你的答案 ${a} · 正确答案 ${q.answer}`);
  }

  onObjectiveAnswered(q) {
    const blank = $(`.blank[data-q="${q.n}"] .bw`, this.left);
    if (blank) blank.textContent = q.options[this.a.answers[q.n]] || '';
    $(`.blank[data-q="${q.n}"]`, this.left)?.classList.toggle('filled', !!this.a.answers[q.n]);
  }

  // cloze -------------------------------------------------------------------
  renderCloze(p, review) {
    const g = p.group;
    const qmap = new Map(g.questions.map((q) => [q.n, q]));
    const passage = h('div', { class: 'passage', dataset: { hl: `p:${g.id}` } });
    passage.innerHTML = this.passageHtml(g.passage, {
      blank: (n) => {
        const q = qmap.get(n);
        const a = this.a.answers[n];
        let cls = 'blank' + (a ? ' filled' : '');
        let extra = '';
        if (review && q) {
          cls += a === q.answer ? ' right' : ' wrong';
          if (a !== q.answer) extra = `<span class="bfix">${esc(q.options[q.answer])}</span>`;
        }
        return `<button type="button" class="${cls}" data-hl-skip data-q="${n}" aria-label="第 ${n} 空"><span class="bn">${n}</span><span class="bw">${esc(q && a ? q.options[a] || '' : '')}</span>${extra}</button>`;
      },
      underline: (t) => `<u class="u-mark">${esc(t)}</u>`,
    });
    passage.addEventListener('click', (e) => {
      const b = e.target.closest('.blank');
      if (b) this.goto(Number(b.dataset.q));
    });
    this.left.append(review ? this.summaryBox(p) || '' : '', h('h2', { class: 'passage-title' }, 'Section I  Use of English'), passage);

    const list = h('div', { class: 'qlist qlist-cloze' });
    for (const q of g.questions) {
      const box = h('div', { class: 'q', dataset: { q: q.n }, id: `q-${q.n}` }, h('div', { class: 'q-head' }, h('span', { class: 'qnum' }, q.n)), this.optionList(q, review, { inline: true }));
      if (review) box.append(h('div', { class: 'q-review' }, this.verdict(q), this.explBox(q.n, this.a.answers[q.n] !== q.answer)));
      box.addEventListener('focusin', () => this.curQ !== q.n && this.goto(q.n, { scroll: false }));
      list.append(box);
    }
    this.right.append(list);
  }

  // reading -----------------------------------------------------------------
  renderReading(p, review) {
    const g = p.group;
    const passage = h('div', { class: 'passage', dataset: { hl: `p:${g.id}` } });
    passage.innerHTML = this.passageHtml(g.passage, { blank: () => '', underline: (t) => `<u class="u-mark">${esc(t)}</u>` });
    this.left.append(review ? this.summaryBox(p) || '' : '', h('h2', { class: 'passage-title' }, g.title), passage);
    const list = h('div', { class: 'qlist' });
    for (const q of g.questions) {
      const box = h(
        'div',
        { class: 'q', dataset: { q: q.n }, id: `q-${q.n}` },
        h('div', { class: 'q-head' }, h('span', { class: 'qnum' }, q.n), h('div', { class: 'q-stem', dataset: { hl: `q:${q.n}` } }, q.stem)),
        this.optionList(q, review)
      );
      if (review) box.append(this.verdict(q), this.explBox(q.n, this.a.answers[q.n] !== q.answer));
      box.addEventListener('focusin', () => this.curQ !== q.n && this.goto(q.n, { scroll: false }));
      list.append(box);
    }
    this.right.append(list);
  }

  // Part B ------------------------------------------------------------------
  renderPartB(p, review) {
    const sec = p.section;
    const g = p.group;
    const sub = sec.subtype;
    const qmap = new Map(g.questions.map((q) => [q.n, q]));
    const locked = !!this.a.submitted[sec.id];
    const slotHtml = (n, block = false) => {
      const q = qmap.get(n);
      const a = this.a.answers[n];
      let cls = `slot ${block ? 'slot-block' : ''} ${a ? 'filled' : ''}`;
      let fix = '';
      if (review && q) {
        cls += a === q.answer ? ' right' : ' wrong';
        if (a !== q.answer) fix = `<span class="sfix">正确：${q.answer}</span>`;
      }
      const text = a ? (sub === 'ordering' ? '' : g.options[a] || '') : '';
      return `<span class="${cls}" data-hl-skip data-q="${n}" role="button" tabindex="0" aria-label="第 ${n} 题，${a ? '已选 ' + a : '未作答'}"><span class="bn">${n}</span>${a ? `<b class="sl">${a}</b><span class="st">${esc(text)}</span>` : (locked ? '<span class="sph">未作答</span>' : '<span class="sph">拖放/点击选择</span>')}${fix}${a && !locked ? '<span class="sx" title="清除" data-clear="1">×</span>' : ''}</span>`;
    };

    const left = h('div', { class: `passage partb partb-${sub}`, dataset: { hl: `p:${g.id}` } });
    if (sub === 'ordering') {
      left.innerHTML = `<p class="muted hl-ignore">以下段落顺序已被打乱，请在右侧排列 41–45 对应段落。</p>` + Object.entries(g.options).map(([k, t]) => `<div class="para-card" data-letter="${k}"><span class="para-letter" data-hl-skip>[${k}]</span> ${esc(t)}</div>`).join('');
    } else if (sub === 'matching') {
      let html = g.passage?.length ? this.passageHtml(g.passage, { blank: (n) => slotHtml(n), underline: (t) => `<u class="u-mark">${esc(t)}</u>` }) : '';
      for (const q of g.questions) {
        const [name, ...rest] = (q.stem || '').split('\n');
        html += `<div class="match-item" data-q="${q.n}"><div class="match-head">${slotHtml(q.n)}<b>${esc(name)}</b></div>${rest.length ? rest.map((r) => `<p>${esc(r)}</p>`).join('') : ''}</div>`;
      }
      left.innerHTML = html;
    } else {
      left.innerHTML = this.passageHtml(g.passage || [], { blank: (n) => slotHtml(n, sub === 'heading'), underline: (t) => `<u class="u-mark">${esc(t)}</u>`, blockSlot: true });
    }
    this.left.append(review ? this.summaryBox(p) || '' : '', h('h2', { class: 'passage-title' }, `Part B · ${SUBTYPE_CN[sub] || ''}`), left);

    // right: bank + answers
    const used = new Set(g.questions.map((q) => this.a.answers[q.n]).filter(Boolean));
    const bank = h('div', { class: `bank bank-${sub}` });
    for (const [k, t] of Object.entries(g.options)) {
      const given = sub === 'ordering' && g.order?.some((o) => o.given === k);
      const chip = h(
        'div',
        { class: `chip ${used.has(k) ? 'used' : ''} ${given ? 'given' : ''} ${this.armed === k ? 'armed' : ''}`, draggable: !locked && !given ? 'true' : null, dataset: { letter: k }, tabindex: !locked && !given ? '0' : null, role: 'button' },
        h('b', { class: 'chip-letter' }, k),
        h('span', { class: 'chip-text' }, sub === 'ordering' ? t.split(/\s+/).slice(0, 14).join(' ') + ' …' : t),
        given ? h('span', { class: 'chip-tag' }, '已给出') : null
      );
      if (!locked && !given) {
        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', k);
          e.dataTransfer.effectAllowed = 'move';
          chip.classList.add('dragging');
        });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
        const arm = () => {
          this.armed = this.armed === k ? null : k;
          $$('.chip', bank).forEach((c) => c.classList.toggle('armed', c.dataset.letter === this.armed));
          if (this.armed) toast(`已选中 ${k}，点击左侧或下方的空位放入`, 'info', 2000);
        };
        chip.addEventListener('click', arm);
        chip.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            arm();
          }
        });
      }
      bank.append(chip);
    }
    const answers = h('div', { class: 'qlist partb-answers' });
    if (sub === 'ordering') {
      const seq = h('div', { class: 'order-seq' });
      g.order.forEach((o, i) => {
        if (i) seq.append(h('span', { class: 'seq-arrow' }, '→'));
        if (o.given) seq.append(h('span', { class: 'seq-given' }, o.given));
        else {
          const tmp = h('span');
          tmp.innerHTML = slotHtml(o.n);
          seq.append(tmp.firstChild);
        }
      });
      answers.append(h('div', { class: 'order-wrap' }, h('div', { class: 'order-title' }, '段落顺序 Order'), seq));
    }
    for (const q of g.questions) {
      const sel = h('select', { disabled: locked || null, 'aria-label': `第 ${q.n} 题答案` }, h('option', { value: '' }, '— 选择 —'), Object.keys(g.options).filter((k) => !(sub === 'ordering' && g.order?.some((o) => o.given === k))).map((k) => h('option', { value: k, selected: this.a.answers[q.n] === k || null }, k)));
      sel.addEventListener('change', () => this.placeLetter(q.n, sel.value || null));
      const label = sub === 'matching' && q.stem ? q.stem.split('\n')[0] : sub === 'ordering' ? '段落' : sub === 'heading' ? '小标题' : '空格';
      const box = h('div', { class: 'q q-compact', dataset: { q: q.n }, id: `q-${q.n}` }, h('div', { class: 'q-head' }, h('span', { class: 'qnum' }, q.n), h('span', { class: 'q-label' }, label), sel, review ? this.verdict(q) : null));
      if (review) box.append(this.explBox(q.n, this.a.answers[q.n] !== q.answer));
      box.addEventListener('focusin', () => this.curQ !== q.n && this.goto(q.n, { scroll: false }));
      answers.append(box);
    }
    this.right.append(h('div', { class: 'bank-title' }, locked ? '选项 Options' : '选项 Options · 拖动到空位，或点击选项后再点击空位'), bank, answers);
    this.bindSlots();
  }

  bindSlots() {
    for (const slot of $$('.slot', this.root)) {
      const n = Number(slot.dataset.q);
      const info = this.qIndex.get(n);
      if (!info) continue;
      const locked = !!this.a.submitted[info.part.section.id];
      slot.addEventListener('click', (e) => {
        if (e.target.dataset.clear && !locked) {
          e.stopPropagation();
          this.placeLetter(n, null);
          return;
        }
        if (this.armed && !locked) this.placeLetter(n, this.armed);
        else if (!locked) this.slotPicker(slot, n);
        else this.goto(n);
      });
      slot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          slot.click();
        }
      });
      if (locked) continue;
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.classList.add('over');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('over'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('over');
        const k = e.dataTransfer.getData('text/plain');
        if (k) this.placeLetter(n, k);
      });
    }
  }

  slotPicker(slot, n) {
    const info = this.qIndex.get(n);
    const g = info.part.group;
    const sub = info.part.section.subtype;
    $('.slot-picker')?.remove();
    const letters = Object.keys(g.options).filter((k) => !(sub === 'ordering' && g.order?.some((o) => o.given === k)));
    const menu = h(
      'div',
      { class: 'slot-picker', role: 'menu' },
      h('div', { class: 'sp-title' }, `第 ${n} 题`),
      letters.map((k) => h('button', { type: 'button', class: this.a.answers[n] === k ? 'on' : '', onclick: () => { menu.remove(); this.placeLetter(n, k); } }, h('b', {}, k), ' ', (g.options[k] || '').slice(0, 48) + ((g.options[k] || '').length > 48 ? '…' : ''))),
      this.a.answers[n] ? h('button', { type: 'button', class: 'sp-clear', onclick: () => { menu.remove(); this.placeLetter(n, null); } }, '清除答案') : null
    );
    document.body.append(menu);
    const r = slot.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px';
    const top = r.bottom + 4;
    menu.style.top = (top + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - menu.offsetHeight - 4) : top) + 'px';
    const off = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('mousedown', off, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', off, true));
    this.goto(n, { scroll: false });
  }

  refreshPartB() {
    const ls = this.left.scrollTop;
    const rs = this.right.scrollTop;
    const p = this.currentPart();
    this.left.innerHTML = '';
    this.right.innerHTML = '';
    this.renderPartB(p, this.reviewVisible(p.section.id));
    this.hl.applyAll(this.root);
    this.left.scrollTop = ls;
    this.right.scrollTop = rs;
  }

  // translation -------------------------------------------------------------
  renderTranslation(p, review) {
    const g = p.group;
    const nums = g.questions.map((q) => q.n);
    let i = 0;
    const passage = h('div', { class: 'passage', dataset: { hl: `p:${g.id}` } });
    passage.innerHTML = this.passageHtml(g.passage, {
      blank: () => '',
      underline: (t) => {
        const n = nums[i++];
        return `<u class="tr-seg" data-q="${n}"><span class="tr-num" data-hl-skip>(${n})</span>${esc(t)}</u>`;
      },
    });
    passage.addEventListener('click', (e) => {
      const u = e.target.closest('.tr-seg');
      if (u && window.getSelection()?.isCollapsed) this.goto(Number(u.dataset.q));
    });
    this.left.append(review ? this.summaryBox(p) || '' : '', h('h2', { class: 'passage-title' }, 'Part C · Translation'), passage);
    const locked = !!this.a.submitted[p.section.id];
    const list = h('div', { class: 'qlist' });
    for (const q of g.questions) {
      const ta = h('textarea', { class: 'answer-text', rows: 4, placeholder: '在此输入中文译文…', readonly: locked || null, 'aria-label': `第 ${q.n} 题译文` });
      ta.value = this.a.answers[q.n] || '';
      const cnt = h('span', { class: 'q-meta' }, `${ta.value.replace(/\s/g, '').length} 字`);
      ta.addEventListener('input', () => {
        this.setAnswer(q.n, ta.value);
        cnt.textContent = `${ta.value.replace(/\s/g, '').length} 字`;
      });
      ta.addEventListener('focus', () => this.curQ !== q.n && this.goto(q.n, { scroll: false }));
      const box = h('div', { class: 'q', dataset: { q: q.n }, id: `q-${q.n}` }, h('div', { class: 'q-head' }, h('span', { class: 'qnum' }, q.n), h('div', { class: 'q-stem en', dataset: { hl: `q:${q.n}` } }, q.text)), ta, cnt);
      if (review) {
        const e = this.expl.questions?.[q.n] || {};
        box.append(
          h('div', { class: 'ref hl-ignore' }, h('div', { class: 'ref-title' }, '参考译文'), h('div', { html: e.ref ? richText(e.ref) : '<p class="muted">参考译文整理中。</p>' })),
          e.analysis ? h('details', { class: 'expl hl-ignore', open: true }, h('summary', {}, '解析 · 难点与采分点'), h('div', { html: richText(e.analysis) })) : '',
          this.selfScore(q, [0, 0.5, 1, 1.5, 2])
        );
      }
      list.append(box);
    }
    this.right.append(list);
  }

  selfScore(q, steps) {
    const cur = this.a.selfScores[q.n];
    const wrap = h('div', { class: 'self-score hl-ignore' }, h('span', {}, '对照参考答案自评：'));
    for (const s of steps) {
      wrap.append(
        h(
          'button',
          {
            type: 'button',
            class: `ss ${cur === s ? 'on' : ''}`,
            onclick: () => {
              this.a.selfScores[q.n] = s;
              this.save();
              $$('.ss', wrap).forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === s));
              this.renderPartBar();
            },
            dataset: { v: s },
          },
          fmtScore(s)
        )
      );
    }
    return wrap;
  }

  // writing -----------------------------------------------------------------
  renderWriting(p, review) {
    const q = p.group.questions[0];
    const prompt = h('div', { class: 'passage prompt', dataset: { hl: `p:${p.group.id}` } });
    prompt.innerHTML = `<p class="prompt-dir hl-ignore">Directions:</p>` + promptText(q.prompt);
    const imgs = (q.images || []).map((src) =>
      h('figure', { class: 'prompt-fig' }, h('img', { src, alt: `第 ${q.n} 题图片`, loading: 'lazy', onclick: () => modal({ title: '图片', body: h('img', { src, class: 'lightbox', alt: '' }), wide: true, buttons: [] }) }))
    );
    this.left.append(h('h2', { class: 'passage-title' }, p.section.title.replace('Section III  ', '')), prompt, ...imgs);
    const locked = !!this.a.submitted[p.section.id];
    const ta = h('textarea', { class: 'answer-text essay', placeholder: 'Type your answer here… 在此输入作文', readonly: locked || null, spellcheck: 'false', 'aria-label': `第 ${q.n} 题作文` });
    ta.value = this.a.answers[q.n] || '';
    const target = q.score === 10 ? '约 100 词' : '160–200 词';
    const wc = h('div', { class: 'word-count' }, `Words: ${countWords(ta.value)}`, h('span', { class: 'muted' }, ` · 要求 ${target}`));
    ta.addEventListener('input', () => {
      this.setAnswer(q.n, ta.value);
      wc.firstChild.textContent = `Words: ${countWords(ta.value)}`;
    });
    ta.addEventListener('focus', () => this.curQ !== q.n && this.goto(q.n, { scroll: false }));
    const box = h('div', { class: 'q q-writing', dataset: { q: q.n }, id: `q-${q.n}` }, h('div', { class: 'q-head' }, h('span', { class: 'qnum' }, q.n), h('span', { class: 'q-label' }, p.cn)), ta, wc);
    if (review) {
      const e = this.expl.questions?.[q.n] || {};
      box.append(
        e.analysis ? h('details', { class: 'expl hl-ignore', open: true }, h('summary', {}, '审题与写作思路'), h('div', { html: richText(e.analysis) })) : '',
        h('div', { class: 'ref hl-ignore' }, h('div', { class: 'ref-title' }, `参考范文${e.sample ? `（${countWords(e.sample)} 词）` : ''}`), h('div', { class: 'sample', html: e.sample ? richText(e.sample) : '<p class="muted">范文整理中。</p>' })),
        this.writingScore(q)
      );
    }
    this.right.append(box);
  }

  writingScore(q) {
    const bands = WRITING_BANDS[q.score] || WRITING_BANDS[20];
    const cur = this.a.selfScores[q.n];
    const sel = h('select', { 'aria-label': '自评分数' }, h('option', { value: '' }, '— 自评分数 —'));
    for (let s = q.score; s >= 0; s--) {
      const band = bands.find(([lo, hi]) => s >= lo && s <= hi);
      sel.append(h('option', { value: s, selected: cur === s || null }, `${s} 分 · ${band ? band[2].split('：')[0] : ''}`));
    }
    sel.addEventListener('change', () => {
      if (sel.value === '') delete this.a.selfScores[q.n];
      else this.a.selfScores[q.n] = Number(sel.value);
      this.save();
      this.renderPartBar();
    });
    return h(
      'div',
      { class: 'self-score writing hl-ignore' },
      h('div', {}, h('span', {}, '对照评分标准自评：'), sel),
      h('ul', { class: 'bands' }, bands.map(([lo, hi, d]) => h('li', {}, h('b', {}, lo === hi ? `${lo} 分` : `${lo}–${hi} 分`), ' ', d)))
    );
  }

  // ---------------------------------------------------------------- submit
  async submitSection(sectionId) {
    const sec = this.paper.sections.find((s) => s.id === sectionId);
    const parts = this.parts.filter((p) => p.section.id === sectionId);
    const nums = parts.flatMap((p) => p.qNums);
    const unanswered = nums.filter((n) => !isAnswered(this.a.answers[n]));
    const flagged = nums.filter((n) => this.a.flags[n]);
    const body = h(
      'div',
      {},
      h('p', {}, `确定提交「${sec.cn}」吗？提交后本大题答案将被锁定${settings.get().instantFeedback ? '，并立即显示批改结果与解析' : ''}。`),
      unanswered.length ? h('p', { class: 'warn-text' }, `还有 ${unanswered.length} 题未作答：${unanswered.join('、')}`) : h('p', { class: 'ok-text' }, '本大题已全部作答。'),
      flagged.length ? h('p', { class: 'muted' }, `已标记 Review 的题目：${flagged.join('、')}`) : null
    );
    const ok = await modal({ title: '提交本大题', body, buttons: [{ label: '继续作答', value: false }, { label: '确认提交', value: true, primary: true }] });
    if (!ok) return;
    this.doSubmit(sectionId);
    const g = gradeSection(this.paper, this.a, sectionId);
    if (settings.get().instantFeedback) {
      toast(g.objective ? `${sec.cn}：${g.correct}/${g.total} 正确，得分 ${fmtScore(g.score)} / ${fmtScore(g.max)}` : `${sec.cn} 已提交，请对照参考答案自评`, 'ok', 4500);
    } else toast(`${sec.cn} 已提交`, 'ok');
    const allDone = this.sections.every((s) => this.a.submitted[s.id]);
    if (allDone) {
      this.finish();
      const go = await modal({ title: '全部大题已提交', body: '<p>本次练习的所有大题均已提交。</p>', buttons: [{ label: '留在此页回顾', value: false }, { label: '查看成绩报告', value: true, primary: true }] });
      if (go) {
        location.hash = `#/result/${this.a.id}`;
        return;
      }
    }
    this.refreshPart();
  }

  doSubmit(sectionId, auto = false) {
    const g = gradeSection(this.paper, this.a, sectionId);
    this.a.submitted[sectionId] = { at: Date.now(), elapsed: Math.round(this.elapsedNow()), auto, score: g.score, max: g.max };
    this.save(true);
  }

  finish() {
    if (this.a.status === 'finished') return;
    this.stopTimer(true);
    this.a.status = 'finished';
    this.a.finishedAt = Date.now();
    this.a.elapsed = Math.min(this.a.elapsed || 0, this.a.timeLimit || Infinity);
    const sum = summarize(this.paper, this.a);
    this.a.result = { objScore: sum.objScore, objMax: sum.objMax, max: sum.max };
    this.save(true);
  }

  async finishAll() {
    const pending = this.sections.filter((s) => !this.a.submitted[s.id]);
    const unanswered = this.order.filter((n) => !isAnswered(this.a.answers[n]) && pending.some((s) => s.id === this.qIndex.get(n).part.section.id));
    const body = h(
      'div',
      {},
      h('p', {}, pending.length ? `将一并提交以下未提交的大题：${pending.map((s) => s.cn).join('、')}。` : '所有大题均已提交。'),
      unanswered.length ? h('p', { class: 'warn-text' }, `仍有 ${unanswered.length} 题未作答：${unanswered.slice(0, 30).join('、')}${unanswered.length > 30 ? '…' : ''}`) : null,
      h('p', { class: 'muted' }, '交卷后将结束计时并生成成绩报告。')
    );
    const ok = await modal({ title: '交卷', body, buttons: [{ label: '继续作答', value: false }, { label: '确认交卷', value: true, primary: true }] });
    if (!ok) return;
    for (const s of pending) this.doSubmit(s.id);
    this.finish();
    location.hash = `#/result/${this.a.id}`;
  }

  async exit() {
    if (!this.finished) {
      const ok = await modal({ title: '退出考试', body: '<p>作答进度与计时已保存，可在首页「继续作答」。确定退出吗？</p>', buttons: [{ label: '取消', value: false }, { label: '保存并退出', value: true, primary: true }] });
      if (!ok) return;
    }
    location.hash = '#/';
  }

  showNotes() {
    const items = [];
    for (const [key, list] of Object.entries(this.a.highlights)) {
      for (const r of list) if (r.note != null) items.push({ key, ...r });
    }
    const where = (key) => {
      const [kind, id] = key.split(':');
      if (kind === 'q') return `第 ${id} 题`;
      const p = this.parts.find((x) => x.id === id);
      return p ? p.cn : id;
    };
    const body = items.length
      ? h('ul', { class: 'notes-list' }, items.map((r) => h('li', {}, h('div', { class: 'muted' }, where(r.key)), h('blockquote', {}, r.text || ''), h('div', {}, r.note || '（空）'))))
      : h('p', { class: 'muted' }, '还没有笔记。选中文字后点击「笔记」即可添加。');
    modal({ title: '我的笔记', body, wide: true });
  }
}
