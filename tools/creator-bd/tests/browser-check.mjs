import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
let url, fixture;
const key = 'fenbd-workspace-v1';
let browser;
const network = [];
const errors = [];

before(async () => {
  const html = await readFile(join(root, '达人商务工作台.html'));
  fixture = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${fixture.address().port}/`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); await new Promise(resolve => fixture?.close(resolve)); });

async function fresh(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai', acceptDownloads: true, ...options });
  const page = await context.newPage();
  page.on('request', request => { if (/^https?:/i.test(request.url()) && !request.url().startsWith(url)) network.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#page')?.children.length > 0);
  t.after(() => context.close());
  return page;
}

async function nav(page, view) { await page.locator(`.nav [data-view="${view}"]`).click(); }
async function state(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), key); }
async function fillRecord(page, values = {}) {
  const defaults = { creator: '测试达人甲', owner: '测试商务甲', stage: '已沟通', dueDate: '2026-10-24', nextAction: '核对寄样安排并约定试吃反馈日期' };
  for (const [name, value] of Object.entries({ ...defaults, ...values })) {
    const el = page.locator(`#record-form [name="${name}"]`);
    if (name === 'approved') await el.setChecked(value);
    else if (['category', 'stage', 'dealType'].includes(name)) await el.selectOption(value);
    else await el.fill(value);
  }
}
async function saveRecord(page) { await page.locator('#record-form button[type="submit"]').click(); }
async function newRecord(page, values = {}) {
  await page.locator('#new-record').click();
  await fillRecord(page, values);
  await saveRecord(page);
  await page.waitForFunction(() => !document.querySelector('#record-dialog').open);
}
async function downloaded(page, click) {
  const promise = page.waitForEvent('download');
  await click();
  const item = await promise;
  return { name: item.suggestedFilename(), bytes: await readFile(await item.path()) };
}
async function fillCalc(page, values) {
  for (const [id, value] of Object.entries(values)) await page.locator(`#calc-${id}`).fill(String(value));
}

test('empty state, mandatory fields, and a successful persisted cooperation', async t => {
  const page = await fresh(t);
  assert.deepEqual(await page.locator('.stat strong').allTextContents(), ['0', '0', '0', '0']);
  assert.match(await page.locator('#page').innerText(), /目前没有合作记录/);
  await page.locator('#new-record').click();
  await saveRecord(page);
  assert.equal(await page.locator('#record-dialog').evaluate(el => el.open), true);
  assert.equal(await page.locator('[name="creator"]').evaluate(el => el.validity.valueMissing), true);
  await fillRecord(page, { owner: '', nextAction: '', dueDate: '' });
  await saveRecord(page);
  assert.equal(await page.locator('[name="owner"]').evaluate(el => el.validity.valueMissing), true);
  await fillRecord(page, { nextAction: '' });
  await saveRecord(page);
  assert.equal(await page.locator('[name="nextAction"]').evaluate(el => el.validity.valueMissing), true);
  await fillRecord(page, { dueDate: '' });
  await saveRecord(page);
  assert.equal(await page.locator('[name="dueDate"]').evaluate(el => el.validity.valueMissing), true);
  await fillRecord(page);
  await saveRecord(page);
  const saved = await state(page);
  assert.equal(saved.records.length, 1);
  assert.equal(saved.records[0].creator, '测试达人甲');
  assert.equal(saved.records[0].owner, '测试商务甲');
  assert.equal(saved.records[0].history.length, 1);
  await page.reload();
  assert.equal((await state(page)).records.length, 1);
});

test('shipping authorization, publish URL, and duplicate-video guards', async t => {
  const page = await fresh(t);
  await page.locator('#new-record').click();
  await fillRecord(page, { stage: '已寄样' });
  await saveRecord(page);
  assert.match(await page.locator('#record-error').innerText(), /授权/);
  assert.equal(await state(page), null);
  await page.locator('[name="approved"]').check();
  await saveRecord(page);
  assert.match(await page.locator('#record-error').innerText(), /快递|寄样记录/);
  await page.locator('[name="tracking"]').fill('测试寄样记录-001（非真实单号）');
  await page.locator('[name="stage"]').selectOption('已发布');
  await saveRecord(page);
  assert.match(await page.locator('#record-error').innerText(), /视频链接/);
  await page.locator('[name="videoUrl"]').fill('https://www.douyin.com/video/1234567890');
  await saveRecord(page);
  assert.equal((await state(page)).records.length, 1);
  await page.locator('#new-record').click();
  await fillRecord(page, { creator: '测试达人乙', videoUrl: 'https://www.douyin.com/video/1234567890' });
  await saveRecord(page);
  assert.match(await page.locator('#record-error').innerText(), /避免重复归因/);
  assert.equal((await state(page)).records.length, 1);
});

test('edit history, state filter, owner filter, and search keep records distinct', async t => {
  const page = await fresh(t);
  await newRecord(page);
  await newRecord(page, { creator: '测试达人乙', owner: '测试商务乙', stage: '待建联', nextAction: '准备一条适配达人内容的建联提案' });
  await nav(page, 'pipeline');
  assert.equal(await page.locator('#records-body tr').count(), 2);
  await page.locator('#filter-stage').selectOption('待建联');
  assert.equal(await page.locator('#records-body tr').count(), 1);
  assert.match(await page.locator('#records-body').innerText(), /测试达人乙/);
  await page.locator('#filter-stage').selectOption('');
  await page.locator('#filter-owner').selectOption('测试商务甲');
  assert.equal(await page.locator('#records-body tr').count(), 1);
  assert.match(await page.locator('#records-body').innerText(), /测试达人甲/);
  await page.locator('#records-body [data-action="edit"]').click();
  await page.locator('[name="nextAction"]').fill('已沟通规格，下一步核实费用审批');
  await saveRecord(page);
  const records = (await state(page)).records;
  assert.equal(records.find(r => r.creator === '测试达人甲').history.length, 2);
  assert.equal(records.find(r => r.creator === '测试达人乙').history.length, 1);
  await page.locator('#records-body [data-action="edit"]').click();
  assert.match(await page.locator('#record-history').innerText(), /下一步核实费用审批/);
  await page.locator('[data-close="record-dialog"]').first().click();
  await page.locator('#filter-owner').selectOption('');
  await page.locator('#search').fill('建联提案');
  assert.equal(await page.locator('#records-body tr').count(), 1);
  assert.match(await page.locator('#records-body').innerText(), /测试达人乙/);
});

test('today is due, yesterday is overdue, closed cooperation excluded', async t => {
  const page = await fresh(t);
  const dates = await page.evaluate(() => {
    const d = new Date(), fmt = x => [x.getFullYear(), String(x.getMonth()+1).padStart(2,'0'), String(x.getDate()).padStart(2,'0')].join('-');
    const today = fmt(d); d.setDate(d.getDate()-1); const yesterday = fmt(d); d.setDate(d.getDate()+2); return { today, yesterday, tomorrow: fmt(d) };
  });
  await newRecord(page, { creator: '今天应跟进', dueDate: dates.today });
  await newRecord(page, { creator: '已逾期', dueDate: dates.yesterday });
  await newRecord(page, { creator: '明日跟进', dueDate: dates.tomorrow });
  await newRecord(page, { creator: '暂停合作', dueDate: dates.yesterday, stage: '暂停/终止' });
  assert.deepEqual(await page.locator('.stat strong').allTextContents(), ['4', '2', '1', '0']);
  await nav(page, 'pipeline');
  await page.locator('#filter-overdue').check();
  assert.equal(await page.locator('#records-body tr').count(), 1);
  assert.match(await page.locator('#records-body').innerText(), /已逾期/);
});

test('JSON backup, safe replacement confirmation, invalid backup rejection, and CSV formula safety', async t => {
  const page = await fresh(t);
  await newRecord(page, { creator: '=1+1' });
  await newRecord(page, { creator: ' \t=2+2' });
  const backup = await downloaded(page, () => page.locator('#quick-backup').click());
  const parsed = JSON.parse(backup.bytes);
  assert.equal(parsed.records[0].creator, '=1+1');
  assert.equal(parsed.version, 1);
  await nav(page, 'backup');
  const csv = await downloaded(page, () => page.locator('[data-action="csv"]').click());
  assert.equal(csv.bytes.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(csv.bytes.toString('utf8'), /"'=1\+1"/);
  assert.match(csv.bytes.toString('utf8'), /"' \t=2\+2"/);
  await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await page.waitForFunction(() => document.querySelector('#toast').textContent.startsWith('无法恢复'));
  assert.equal((await state(page)).records[0].creator, '=1+1');
  await page.locator('[data-action="clear"]').click();
  await page.locator('#confirm-action').click();
  assert.equal((await state(page)).records.length, 0);
  await page.locator('#import-file').setInputFiles({ name: backup.name, mimeType: 'application/json', buffer: backup.bytes });
  await page.waitForFunction(() => document.querySelector('#confirm-dialog').open);
  assert.equal((await state(page)).records.length, 0);
  await page.locator('#confirm-action').click();
  assert.equal((await state(page)).records[0].creator, '=1+1');
});

test('calculator handles incomplete, positive, negative, zero and zero fixed costs', async t => {
  const page = await fresh(t);
  await nav(page, 'calculator');
  assert.equal(await page.locator('#break-even').innerText(), '待补充');
  assert.match(await page.locator('#calc-status').innerText(), /参数未填完整/);
  await page.locator('#calc-demo').click();
  assert.equal(await page.locator('#commission').innerText(), '5.00 元');
  assert.equal(await page.locator('#fixed-total').innerText(), '360.00 元');
  assert.match(await page.locator('#unit-profit').innerText(), /^6\.00/);
  assert.equal(await page.locator('#break-even').innerText(), '60 单');
  assert.match(await page.locator('#calc-mode').innerText(), /假设演示值/);
  await nav(page, 'today');
  await nav(page, 'calculator');
  assert.match(await page.locator('#calc-mode').innerText(), /假设演示值/);
  await fillCalc(page, { fixed: 0, samples: 0, other: 0 });
  assert.equal(await page.locator('#break-even').innerText(), '0 单');
  await fillCalc(page, { goods: 14 });
  assert.match(await page.locator('#unit-profit').innerText(), /^0\.00/);
  assert.equal(await page.locator('#break-even').innerText(), '此模型下无法保本');
  await fillCalc(page, { goods: 15 });
  assert.match(await page.locator('#unit-profit').innerText(), /^-1\.00/);
  assert.equal(await page.locator('#break-even').innerText(), '此模型下无法保本');
  await fillCalc(page, { rate: 101 });
  assert.equal(await page.locator('#break-even').innerText(), '参数无效');
  await fillCalc(page, { rate: 20, goods: -1 });
  assert.equal(await page.locator('#break-even').innerText(), '参数无效');
  await fillCalc(page, { goods: '' });
  assert.equal(await page.locator('#break-even').innerText(), '待补充');
  await page.locator('#calc-clear').click();
  assert.equal(await page.locator('#break-even').innerText(), '待补充');
  assert.equal(await page.locator('#calc-price').inputValue(), '');
  assert.doesNotMatch(await page.locator('#calc-mode').innerText(), /假设演示值/);
});

test('demo is visibly labeled, can be cleared, and SOP checks persist', async t => {
  const page = await fresh(t);
  await page.locator('[data-action="demo"]').click();
  assert.match(await page.locator('#demo-banner').innerText(), /不代表公司真实合作/);
  assert.equal((await state(page)).records.length, 3);
  assert.equal((await state(page)).demo, true);
  await page.screenshot({ path: join(root, '工作台预览.png'), fullPage: true });
  await nav(page, 'sop');
  await page.locator('[data-check="0-0"]').check();
  await page.reload();
  await nav(page, 'sop');
  assert.equal(await page.locator('[data-check="0-0"]').isChecked(), true);
  await page.locator('#clear-demo').click();
  await page.locator('#confirm-action').click();
  assert.equal((await state(page)).records.length, 0);
  assert.equal((await state(page)).demo, false);
  assert.deepEqual((await state(page)).checks, {});
});

test('390px mobile navigation, table, calculator and dialogs avoid document overflow', async t => {
  const page = await fresh(t, { viewport: { width: 390, height: 844 } });
  const noOverflow = async name => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), name);
  await noOverflow('today');
  await page.locator('[data-action="demo"]').click();
  await noOverflow('today demo');
  await page.screenshot({ path: '/tmp/merchant-bd-mobile.png', fullPage: true });
  for (const view of ['pipeline', 'calculator', 'sop', 'backup']) { await nav(page, view); await noOverflow(view); }
  await nav(page, 'pipeline');
  await page.locator('#new-record').click();
  await noOverflow('record dialog');
  const rect = await page.locator('#record-dialog').boundingBox();
  assert.ok(rect.x >= 0 && rect.x + rect.width <= 391);
});

test('the app performs no external network requests and has no uncaught page errors', async t => {
  const page = await fresh(t);
  for (const view of ['pipeline', 'calculator', 'sop', 'backup', 'today']) await nav(page, view);
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  await mkdir('/tmp/merchant-bd-qa', { recursive: true });
  await writeFile('/tmp/merchant-bd-qa/network-errors.json', JSON.stringify({ network, errors }, null, 2));
});
