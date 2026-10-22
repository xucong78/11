import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/server.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let browser;

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); });

async function eventually(check, message, timeout = 12000) {
  const end = Date.now() + timeout;
  do {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < end);
  assert.fail(message);
}

async function setup(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'fenbd-browser-test-'));
  const password = randomBytes(24).toString('base64url');
  let server;
  const contexts = [];
  let url;
  async function start(port = 0) {
    server = createServer({ password, dataDir, secureCookies: false, env: {}, ...options });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  }
  await start();
  t.after(async () => {
    await Promise.all(contexts.map(context => context.close()));
    await stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  async function device(mobile = false, width = 390) {
    const context = await browser.newContext({ viewport: mobile ? { width, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1, acceptDownloads: true });
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(url);
    await page.locator('#login-screen').waitFor({ state: 'visible' });
    await page.locator('#login-password').fill(password);
    await page.locator('#login-submit').click();
    await synced(page);
    return { context, page };
  }
  return { device, stop, start, get url() { return url; }, async workspace(context) { const response = await context.request.get(`${url}/api/workspace`); assert.equal(response.status(), 200); return response.json(); } };
}

async function synced(page) { await page.locator('#sync-button[data-state="synced"]').waitFor(); }
async function nav(page, view) {
  const selector = page.viewportSize().width < 950 ? '.bottom-nav' : '.desktop-nav';
  await page.locator(`${selector} [data-view="${view}"]`).click();
}
async function refresh(page) {
  await nav(page, 'profile');
  const reading = page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.request().method() === 'GET' && response.status() === 200);
  await page.locator('[data-action="refresh"]').click();
  const latest = await (await reading).json();
  await page.waitForFunction(expected => document.querySelector('#cloud-revision')?.textContent === `v${expected}`, latest.revision);
  await synced(page);
}
async function createRecord(page, creator = '测试演示达人 A') {
  await nav(page, 'cooperations');
  await page.locator('#new-record-button').click();
  await page.locator('#record-form [name="creator"]').fill(creator);
  await page.locator('#record-form [name="owner"]').fill('测试演示商务');
  await page.locator('#record-form [name="nextAction"]').fill('测试演示：确认试吃反馈');
  await page.locator('#record-form [name="notes"]').fill('自动化测试演示资料，无真实公司数据。');
  await page.locator('#record-form button[type="submit"]').click();
  await page.locator('#record-dialog').waitFor({ state: 'hidden' });
}
async function editRecord(page, changes) {
  await nav(page, 'cooperations');
  await page.locator('#cooperation-list [data-action="edit"]').first().click();
  for (const [key, value] of Object.entries(changes)) await page.locator(`#record-form [name="${key}"]`).fill(value);
  await page.locator('#record-form button[type="submit"]').click();
  await page.locator('#record-dialog').waitFor({ state: 'hidden' });
}
async function downloadJson(page, selector) {
  const waiting = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await waiting;
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}
function legacyRecord(creator = '=测试演示导入') {
  const now = new Date().toISOString();
  return { id: 'test-legacy-1', creator, owner: '测试演示商务', category: '美食测评', contact: '测试资料', sku: '测试示例 SKU', dealType: '待协商', stage: '已沟通', dueDate: now.slice(0, 10), publishDate: '', nextAction: '测试演示：核实合作条件', tracking: '', videoUrl: '', notes: '旧版离线备份兼容测试；无真实资料。', approved: false, createdAt: now, updatedAt: now, history: [{ at: now, text: '测试演示历史' }] };
}

test('authentication: isolated sessions, unauthenticated/expired access denied, password kept out of browser storage', async t => {
  let now = Date.now();
  const app = await setup(t, { now: () => now });
  const anonymous = await browser.newContext();
  t.after(() => anonymous.close());
  assert.equal((await anonymous.request.get(`${app.url}/api/workspace`)).status(), 401);
  const desktop = await app.device();
  const phone = await app.device(true);
  const cookieA = (await desktop.context.cookies()).find(cookie => cookie.name === 'fenbd_session');
  const cookieB = (await phone.context.cookies()).find(cookie => cookie.name === 'fenbd_session');
  assert.ok(cookieA?.httpOnly && cookieB?.httpOnly);
  assert.notEqual(cookieA.value, cookieB.value);
  assert.equal(await desktop.page.evaluate(() => document.cookie.includes('fenbd_session')), false);
  assert.deepEqual(await desktop.page.evaluate(() => Object.keys(localStorage)), []);
  assert.deepEqual(await desktop.page.evaluate(() => Object.keys(sessionStorage)), []);
  assert.equal(await desktop.page.locator('#login-password').inputValue(), '');
  now += 8 * 24 * 60 * 60 * 1000;
  assert.equal((await desktop.context.request.get(`${app.url}/api/workspace`)).status(), 401);
  await desktop.page.locator('#new-record-button').click();
  await desktop.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await desktop.page.locator('#login-screen').waitFor({ state: 'visible' });
  assert.equal(await desktop.page.locator('#record-dialog').evaluate(dialog => dialog.open), false, 'An expired session must close its modal so login remains usable.');
  assert.match(await desktop.page.locator('#login-error').textContent(), /登录/);
});

test('cooperation: phone save is acknowledged, desktop poll receives it, desktop follow-up reaches phone', async t => {
  const app = await setup(t);
  const desktop = await app.device();
  const phone = await app.device(true);
  const saved = phone.page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.request().method() === 'PUT' && response.status() === 200);
  await createRecord(phone.page);
  await saved;
  await synced(phone.page);
  const stored = await app.workspace(phone.context);
  assert.equal(stored.data.records.length, 1);
  assert.equal(stored.data.records[0].creator, '测试演示达人 A');
  await nav(desktop.page, 'cooperations');
  await desktop.page.locator('#cooperation-list').getByText('测试演示达人 A', { exact: true }).waitFor({ timeout: 12000 });
  await editRecord(desktop.page, { notes: '测试演示：电脑补充了已确认的反馈。', nextAction: '测试演示：手机应看到下一步约档期' });
  await synced(desktop.page);
  await refresh(phone.page);
  await nav(phone.page, 'cooperations');
  await phone.page.locator('#cooperation-list').getByText('测试演示：手机应看到下一步约档期', { exact: true }).waitFor();
  await phone.page.locator('#cooperation-list [data-action="edit"]').click();
  assert.equal(await phone.page.locator('[name="notes"]').inputValue(), '测试演示：电脑补充了已确认的反馈。');
  assert.ok((await app.workspace(phone.context)).data.records[0].history.length >= 2);
  await phone.page.locator('#record-dialog [data-close]').first().click();

  // Hold an already-read cloud snapshot until after the user makes another local edit.
  // This exercises the GET/local-mutation race through the real UI and backend.
  let release;
  let captured;
  let holdNextGet = true;
  const gate = new Promise(resolve => { release = resolve; });
  const intercepted = new Promise(resolve => { captured = resolve; });
  await desktop.page.route('**/api/workspace', async route => {
    if (holdNextGet && route.request().method() === 'GET') {
      holdNextGet = false;
      const response = await route.fetch();
      captured();
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  t.after(() => release());
  await nav(desktop.page, 'profile');
  await desktop.page.locator('[data-action="refresh"]').click();
  await intercepted;
  await editRecord(desktop.page, { nextAction: '测试演示：GET迟到也必须保留的本机修改' });
  release();
  await synced(desktop.page);
  assert.equal((await app.workspace(desktop.context)).data.records[0].nextAction, '测试演示：GET迟到也必须保留的本机修改');
  await desktop.page.unroute('**/api/workspace');
});

test('calculator and SOP checks: shared values persist and are visible on the other device', async t => {
  const app = await setup(t);
  const desktop = await app.device();
  const phone = await app.device(true);
  await nav(desktop.page, 'calculator');
  const values = { price: '25', base: '25', goods: '8', pack: '1', shipping: '4', fees: '1', rate: '20', fixed: '300', samples: '60', other: '0' };
  for (const [key, value] of Object.entries(values)) await desktop.page.locator(`#calc-${key}`).fill(value);
  await synced(desktop.page);
  await eventually(async () => (await app.workspace(desktop.context)).data.calculator?.values?.price === '25', 'Calculator values must be saved to the server.');
  await refresh(phone.page);
  await nav(phone.page, 'calculator');
  for (const [key, value] of Object.entries(values)) assert.equal(await phone.page.locator(`#calc-${key}`).inputValue(), value);
  assert.match(await phone.page.locator('#calc-profit').textContent(), /6\.00/);
  assert.equal(await phone.page.locator('#calc-break-even').textContent(), '60 单');
  await nav(phone.page, 'profile');
  await phone.page.locator('[data-check="0-0"]').check();
  await synced(phone.page);
  await refresh(desktop.page);
  assert.equal(await desktop.page.locator('[data-check="0-0"]').isChecked(), true);
});

test('persistence: SQLite data and existing login survive an HTTP server restart', async t => {
  const app = await setup(t);
  const desktop = await app.device();
  await createRecord(desktop.page, '测试演示持久化达人');
  await synced(desktop.page);
  const initial = await app.workspace(desktop.context);
  const port = Number(new URL(app.url).port);
  await app.stop();
  await app.start(port);
  await desktop.page.reload();
  await synced(desktop.page);
  assert.equal(await desktop.page.locator('#login-screen').isVisible(), false);
  assert.deepEqual(await app.workspace(desktop.context), initial);
  await nav(desktop.page, 'cooperations');
  await desktop.page.getByText('测试演示持久化达人', { exact: true }).waitFor();
});

test('offline conflict: reconnect protects cloud, stale API writes return 409, and drafts export before confirmed adoption', async t => {
  const app = await setup(t);
  const local = await app.device(true);
  const remote = await app.device();
  await createRecord(local.page, '测试演示冲突达人');
  await synced(local.page);
  await refresh(remote.page);
  await local.context.setOffline(true);
  await editRecord(local.page, { nextAction: '测试演示：仅手机未同步动作', notes: '测试演示本机草稿，必须可导出。' });
  await local.page.locator('#sync-button[data-state="offline"]').waitFor();
  const pending = await local.page.evaluate(() => JSON.parse(localStorage.getItem('fenbd-cloud-pending-v1')));
  assert.ok(pending);
  await editRecord(remote.page, { nextAction: '测试演示：云端电脑最新动作', notes: '测试演示云端资料，应保留。' });
  await synced(remote.page);
  const cloudBefore = await app.workspace(remote.context);
  await local.context.setOffline(false);
  await local.page.locator('#sync-button[data-state="conflict"]').waitFor();
  // The UI detects the newer revision before writing; the API must independently
  // reject the same stale draft if another client submits it without that check.
  const rejected = await local.context.request.put(`${app.url}/api/workspace`, { data: { baseRevision: pending.baseRevision, data: pending.data } });
  assert.equal(rejected.status(), 409);
  assert.equal((await rejected.json()).code, 'CONFLICT');
  assert.deepEqual(await app.workspace(remote.context), cloudBefore);
  const backup = await downloadJson(local.page, '[data-action="export-pending"]');
  assert.equal(backup.unsynced, true);
  assert.equal(backup.records[0].nextAction, '测试演示：仅手机未同步动作');
  await local.page.locator('[data-action="use-cloud"]').click();
  await local.page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  assert.match(await local.page.locator('#confirm-description').textContent(), /舍弃本机/);
  await local.page.locator('#confirm-dialog [data-close]').first().click();
  await local.page.locator('#sync-button[data-state="conflict"]').waitFor();
  assert.deepEqual(await app.workspace(remote.context), cloudBefore);
  await local.page.locator('[data-action="use-cloud"]').click();
  await local.page.locator('#confirm-submit').click();
  await synced(local.page);
  assert.equal(await local.page.evaluate(() => localStorage.getItem('fenbd-cloud-pending-v1')), null);
  assert.deepEqual(await app.workspace(local.context), cloudBefore);
  await nav(local.page, 'cooperations');
  await local.page.getByText('测试演示：云端电脑最新动作', { exact: true }).waitFor();
});

test('backup: old offline JSON imports only after confirmation; full JSON round-trips and CSV escapes formulas', async t => {
  const app = await setup(t);
  const desktop = await app.device();
  const oldData = { version: 1, records: [legacyRecord()], checks: { '1-2': true }, demo: true, exportedAt: new Date().toISOString() };
  await nav(desktop.page, 'profile');
  await desktop.page.locator('#import-file').setInputFiles({ name: '测试演示旧版备份.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(oldData)) });
  await desktop.page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  assert.equal((await app.workspace(desktop.context)).data.records.length, 0);
  await desktop.page.locator('#confirm-submit').click();
  await synced(desktop.page);
  const imported = await app.workspace(desktop.context);
  assert.deepEqual(imported.data.records, oldData.records);
  assert.equal(imported.data.checks['1-2'], true);
  const backup = await downloadJson(desktop.page, '[data-action="export"]');
  assert.deepEqual(backup.records, oldData.records);
  assert.deepEqual(backup.checks, oldData.checks);
  assert.ok(backup.exportedAt);
  const downloadEvent = desktop.page.waitForEvent('download');
  await desktop.page.locator('[data-action="csv"]').click();
  const csv = await readFile(await (await downloadEvent).path(), 'utf8');
  assert.ok(csv.includes('"\'=测试演示导入"'));
  assert.equal((await app.workspace(desktop.context)).revision, imported.revision);
});

test('iPhone layouts: 375/390/430 px have no horizontal overflow, usable touch controls, 16 px inputs and safe-area CSS', async t => {
  const app = await setup(t);
  const phone = await app.device(true);
  await createRecord(phone.page, '测试演示手机布局达人');
  await synced(phone.page);
  const problems = [];
  for (const width of [375, 390, 430]) {
    await phone.page.setViewportSize({ width, height: 844 });
    for (const view of ['today', 'cooperations', 'calculator', 'profile']) {
      await nav(phone.page, view);
      const result = await phone.page.evaluate(() => {
        const visible = element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== 'hidden'; };
        const touch = [...document.querySelectorAll('button,a,label:has(input[type="checkbox"])')].filter(visible).filter(element => !element.closest('.sidebar'));
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          small: touch.filter(element => { const r = element.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).map(element => `${element.textContent.trim().slice(0, 24)} ${Math.round(element.getBoundingClientRect().width)}×${Math.round(element.getBoundingClientRect().height)}`),
          fonts: [...document.querySelectorAll('input:not([type="checkbox"]),textarea,select')].filter(visible).filter(element => parseFloat(getComputedStyle(element).fontSize) < 16).map(element => element.id || element.name),
          oversizedIcons: [...document.querySelectorAll('.due-line svg')].filter(visible).some(element => { const r = element.getBoundingClientRect(); return r.width > 24 || r.height > 24; }),
        };
      });
      if (result.overflow || result.small.length || result.fonts.length || result.oversizedIcons) problems.push({ width, view, ...result });
    }
    await nav(phone.page, 'cooperations');
    await phone.page.locator('#new-record-button').click();
    const modal = await phone.page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, fonts: [...document.querySelectorAll('#record-form input:not([type="checkbox"]),#record-form textarea,#record-form select')].map(element => parseFloat(getComputedStyle(element).fontSize)), buttons: [...document.querySelectorAll('#record-dialog button')].filter(element => element.getBoundingClientRect().width > 0).map(element => ({ text: element.textContent.trim(), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })) }));
    if (modal.overflow || modal.fonts.some(size => size < 16) || modal.buttons.some(item => item.width < 43.5 || item.height < 43.5)) problems.push({ width, modal });
    await phone.page.locator('#record-dialog [data-close]').first().click();
  }
  assert.deepEqual(problems, []);
  const css = await readFile(path.join(appDirectory, 'public/styles.css'), 'utf8');
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(await phone.page.locator('meta[name="viewport"]').getAttribute('content'), /viewport-fit=cover/);
});

test('assets and demo previews: local requests only, no console/CSP errors, correct manifest and installed-app icons', async t => {
  const app = await setup(t);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const external = [], errors = [], failed = [];
  page.on('request', request => { if (!request.url().startsWith(app.url) && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) external.push(request.url()); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failed.push(request.failure()?.errorText));
  // Login through a separately created device, then copy only its session cookie into this monitored context.
  const logged = await app.device(true);
  await context.addCookies(await logged.context.cookies());
  await page.goto(app.url);
  await synced(page);
  await nav(page, 'profile');
  await page.locator('[data-action="demo"]').click();
  await page.locator('#confirm-submit').click();
  await synced(page);
  await page.locator('#demo-banner').waitFor({ state: 'visible' });
  await nav(page, 'today');
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(appDirectory, 'preview-iphone.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().top), 0);
  await page.screenshot({ path: path.join(appDirectory, 'preview-desktop.png') });
  const manifestResponse = await context.request.get(`${app.url}/manifest.webmanifest`);
  assert.equal(manifestResponse.status(), 200);
  assert.match(manifestResponse.headers()['content-type'], /manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const response = await context.request.get(new URL(icon.src, app.url).href);
    assert.equal(response.status(), 200);
    assert.match(response.headers()['content-type'], /image\/(png|svg\+xml)/);
    if (icon.type === 'image/png') {
      const png = await response.body();
      assert.equal(png.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
      assert.equal(png.readUInt32BE(20), Number(icon.sizes.split('x')[1]));
    }
  }
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const appleResponse = await context.request.get(new URL(appleIcon, app.url).href);
  assert.equal(appleResponse.status(), 200);
  const applePng = await appleResponse.body();
  assert.equal(applePng.readUInt32BE(16), 180);
  assert.equal(applePng.readUInt32BE(20), 180);
  assert.deepEqual(external, []);
  assert.deepEqual(failed, []);
  assert.deepEqual(errors, []);
});
