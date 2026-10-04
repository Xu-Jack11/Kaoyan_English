// End-to-end tests for the CBT app. Run with:  npm test
// Needs the `playwright` package and a Chromium build (npx playwright install chromium).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push([false, name]);
    console.log(`  ✗ ${name}\n    ${e.stack || e}`);
  }
}

const server = await serve();
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

async function startMock(year) {
  await page.goto(BASE + '#/');
  await page.locator('.paper-card', { hasText: String(year) }).locator('button', { hasText: '全真模考' }).click();
  await page.locator('.modal .btn-primary').click();
  await page.locator('button', { hasText: '开始考试' }).click();
  await page.waitForSelector('.cbt');
}
const navTo = (label) => page.locator('.nav-part-label', { hasText: label }).click();
const attemptId = () => page.evaluate(() => location.hash.split('/')[2].split('?')[0]);

console.log('CBT end-to-end tests');

await test('home lists all papers', async () => {
  await page.goto(BASE);
  await page.waitForSelector('.paper-card');
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
  assert.equal(await page.locator('.paper-card').count(), index.papers.length);
});

await test('mock exam starts with a 180-minute countdown', async () => {
  await startMock(2025);
  assert.match(await page.locator('.cbt-timer').innerText(), /剩余 180 分钟/);
  assert.equal(await page.locator('.nav-part').count(), 9);
});

await test('cloze answers fill the passage blanks and blanks focus questions', async () => {
  await page.locator('.q[data-q="1"] .opt[data-k="B"]').click();
  await page.locator('.q[data-q="2"] .opt[data-k="A"]').click();
  assert.equal(await page.locator('.blank[data-q="1"] .bw').innerText(), 'prone');
  await page.locator('.blank[data-q="5"]').click();
  await page.waitForSelector('.q[data-q="5"].current');
  assert.ok(await page.locator('.nq[data-q="1"].answered').count());
});

await test('review flag marks the navigator button', async () => {
  await page.locator('.nq[data-q="3"]').click();
  await page.locator('.review-flag input').check();
  assert.ok(await page.locator('.nq[data-q="3"].flagged').count());
});

await test('highlight survives a reload', async () => {
  await page.evaluate(() => {
    const p = document.querySelector('.pane-left .passage p');
    const t = [...p.childNodes].find((n) => n.nodeType === 3 && n.data.length > 30);
    const r = document.createRange();
    r.setStart(t, 0);
    r.setEnd(t, 20);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await page.dispatchEvent('.pane-left .passage p', 'mouseup');
  await page.locator('.hl-menu button', { hasText: '高亮' }).click();
  assert.equal(await page.locator('mark.hl').count(), 1);
  await page.reload();
  await page.waitForSelector('.cbt');
  await navTo('完形');
  await page.waitForSelector('mark.hl');
  assert.equal((await page.locator('mark.hl').innerText()).length, 20);
});

await test('Part B: drag, click-to-place, dropdown, and unique letters', async () => {
  await navTo('新题型');
  await page.locator('.chip[data-letter="D"]').dragTo(page.locator('.slot[data-q="41"]'));
  await page.locator('.chip[data-letter="G"]').click();
  await page.locator('.slot[data-q="42"]').click();
  await page.locator('.q[data-q="43"] select').selectOption('B');
  assert.equal(await page.locator('.slot[data-q="41"] .sl').innerText(), 'D');
  assert.equal(await page.locator('.slot[data-q="42"] .sl').innerText(), 'G');
  assert.equal(await page.locator('.slot[data-q="43"] .sl').innerText(), 'B');
  await page.locator('.q[data-q="44"] select').selectOption('D');
  assert.equal(await page.locator('.slot[data-q="41"] .sl').count(), 0, 'D moved away from 41');
  await page.locator('.q[data-q="41"] select').selectOption('D');
});

await test('writing area counts words', async () => {
  await navTo('大作文');
  await page.locator('textarea.essay').fill('The table above shows a steady rise.');
  assert.match(await page.locator('.word-count').innerText(), /Words: 7/);
});

await test('submitting a section grades it and reveals explanations', async () => {
  await navTo('完形');
  await page.locator('.btn-submit-sec').click();
  await page.locator('.modal .btn-primary').click();
  await page.waitForSelector('.badge-done');
  assert.match(await page.locator('.badge-done').innerText(), /0\.5\/10/);
  assert.ok(await page.locator('.nq[data-q="1"].right').count());
  assert.ok(await page.locator('.nq[data-q="2"].wrong').count());
  const expl = await page.locator('.q[data-q="2"] .expl').innerText();
  assert.ok(expl.length > 40 && !expl.includes('整理中'), 'explanation text present');
  assert.equal(await page.locator('.q[data-q="2"] input:not([disabled])').count(), 0, 'answers locked');
});

await test('finishing produces a score report and fills the wrong-answer book', async () => {
  await page.locator('.btn-finish').click();
  await page.locator('.modal .btn-primary').click();
  await page.waitForSelector('.result-head');
  assert.match(await page.locator('.result-info').innerText(), /客观题 6\.5 \/ 60/); // cloze Q1 (0.5) + Part B 41–43 (3×2)
  await page.goto(BASE + '#/wrong');
  await page.waitForSelector('.wrong-item');
  assert.ok(await page.locator('.wrong-item', { hasText: '你的答案 A · 正确 C' }).count());
});

await test('self-assessment for translation counts toward the total', async () => {
  await page.goto(BASE + '#/history');
  await page.locator('a', { hasText: '报告' }).first().click();
  await page.waitForSelector('.result-head');
  const id = await attemptId();
  await page.goto(BASE + `#/exam/${id}?q=46`);
  await page.waitForSelector('.self-score');
  await page.locator('.q[data-q="46"] .ss', { hasText: '1.5' }).click();
  await page.goto(BASE + `#/result/${id}`);
  await page.waitForSelector('.result-head');
  assert.match(await page.locator('.score-ring').innerText(), /^8\s*\/ 100/); // 6.5 objective + 1.5 self-assessed
});

await test('practice config + countdown expiry auto-submits', async () => {
  await page.goto(BASE + '#/paper/2026');
  await page.waitForSelector('.cfg');
  await page.locator('button', { hasText: '阅读 A 节四篇' }).click();
  await page.locator('input[name=minutes]').fill('1');
  await page.locator('button[type=submit]').click();
  await page.locator('button', { hasText: '开始考试' }).click();
  await page.waitForSelector('.cbt');
  assert.equal(await page.locator('.nav-part').count(), 4);
  const id = await attemptId();
  // Leave the exam (which saves its state), then fast-forward the saved clock to 58 s and come back.
  await page.goto(BASE + '#/');
  await page.waitForSelector('.paper-card');
  await page.evaluate((aid) => {
    const k = 'kyen1:attempt:' + aid;
    const a = JSON.parse(localStorage.getItem(k));
    a.elapsed = 58;
    localStorage.setItem(k, JSON.stringify(a));
  }, id);
  await page.goto(BASE + `#/exam/${id}`);
  await page.waitForSelector('.modal', { timeout: 10000 });
  assert.match(await page.locator('.modal').innerText(), /时间到/);
  await page.locator('.modal .btn-primary').click();
  await page.waitForSelector('.result-head');
});

await test('no uncaught page errors', async () => {
  assert.deepEqual(pageErrors, []);
});

await browser.close();
server.close();
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
