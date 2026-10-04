// Settings and help dialogs (shared by the home page and the test screen).

import { h, modal } from './util.js';
import { settings } from './store.js';

export function openSettings(onChange) {
  const s = settings.get();
  const radio = (name, value, label, cur) =>
    h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name, value, checked: cur === value || null }), h('span', {}, label));
  const body = h(
    'div',
    { class: 'settings' },
    h('fieldset', {}, h('legend', {}, '字号 Text size'), h('div', { class: 'seg' }, radio('fontSize', 's', '小', s.fontSize), radio('fontSize', 'm', '标准', s.fontSize), radio('fontSize', 'l', '大', s.fontSize), radio('fontSize', 'xl', '特大', s.fontSize))),
    h(
      'fieldset',
      {},
      h('legend', {}, '配色 Contrast'),
      h('div', { class: 'seg' }, radio('contrast', 'standard', '白底黑字', s.contrast), radio('contrast', 'dark', '黑底白字', s.contrast), radio('contrast', 'yellow', '黑底黄字', s.contrast))
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, '作答'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'instantFeedback', checked: s.instantFeedback || null }), ' 提交大题后立即显示答案与解析（关闭则交卷后统一显示）'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'showTimer', checked: s.showTimer || null }), ' 显示计时器')
    ),
    h('fieldset', {}, h('legend', {}, '考生姓名（显示在顶栏）'), h('input', { type: 'text', name: 'candidate', value: s.candidate, maxlength: 24, placeholder: '考生' }))
  );
  body.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.name) return;
    settings.set({ [t.name]: t.type === 'checkbox' ? t.checked : t.value });
    onChange?.();
  });
  body.addEventListener('input', (e) => {
    if (e.target.name === 'candidate') settings.set({ candidate: e.target.value.trim() });
  });
  return modal({ title: '设置 Settings', body, buttons: [{ label: '完成', value: true, primary: true }] });
}

export function openHelp() {
  return modal({
    title: '帮助 Help',
    wide: true,
    body: `
      <h3>界面</h3>
      <ul>
        <li>左侧为原文，右侧为题目；拖动中间分隔条可调整两栏宽度，双击恢复默认。</li>
        <li>底部导航栏列出各部分题号：<span class="kbd nq answered">已答</span> <span class="kbd nq">未答</span> <span class="kbd nq flagged">标记</span>，点击题号直接跳转；◀ ▶ 切换上一题/下一题。</li>
        <li>勾选左下角 <b>Review</b> 可标记当前题目，方便交卷前回看。</li>
      </ul>
      <h3>高亮与笔记</h3>
      <ul>
        <li>用鼠标选中原文或题干中的文字，在弹出菜单中选择「高亮」或「笔记」；也可以选中后点击右键。</li>
        <li>点击（或右键）已有高亮，可清除或编辑笔记。顶栏「笔记」按钮可查看全部笔记。</li>
      </ul>
      <h3>作答</h3>
      <ul>
        <li>完形填空：点击左侧空格可定位到对应题目，选中的单词会填入原文。</li>
        <li>新题型：把右侧选项拖到空位；或先点击选项、再点击空位；也可直接点击空位或使用下拉框选择。每个选项最多使用一次。</li>
        <li>翻译与写作：在文本框中作答；写作区实时显示词数。提交后可对照参考译文/范文与评分标准自评。</li>
      </ul>
      <h3>提交与计时</h3>
      <ul>
        <li>完形、每篇阅读（Text 1–4 分别提交）、新题型、翻译、小作文、大作文都可单独提交，只锁定并批改当前这一部分；「交卷」会提交剩余所有部分。</li>
        <li>倒计时剩余 10 分钟、5 分钟时会提醒，时间到自动交卷。点击计时器可隐藏/显示。</li>
      </ul>
      <h3>快捷键</h3>
      <ul>
        <li><span class="kbd">←</span> <span class="kbd">→</span> 上一题 / 下一题；<span class="kbd">A</span>–<span class="kbd">D</span> 为当前完形/阅读题选择选项（输入框外有效）。</li>
      </ul>`,
  });
}
