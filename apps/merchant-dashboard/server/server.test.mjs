import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from './server.mjs';
import { normalizeWorkspace, normalizeRecord } from './validation.mjs';

const PASSWORD = 'fixture-only-valid-passphrase';
const emptyData = () => ({ version: 1, records: [], checks: {}, demo: false, calculator: { values: {}, demo: false } });
const record = (id = 'record-one', changes = {}) => ({
  id, creator: '测试达人', owner: '测试商务', category: '美食测评', contact: '', sku: '示例 SKU', dealType: '待协商',
  nextAction: '核对合作条件', tracking: '', videoUrl: '', notes: '', dueDate: '2026-10-24', publishDate: '',
  createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z', stage: '已沟通', approved: false, history: [], ...changes,
});

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fenbd-cloud-'));
  const publicDir = path.join(root, 'public');
  const dataDir = path.join(root, 'data');
  await mkdir(publicDir);
  await writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>粉商小本</title>');
  await writeFile(path.join(publicDir, 'app.js'), 'console.log("fixture");');
  const server = createServer({ password: PASSWORD, dataDir, publicDir, secureCookies: false, env: {}, ...overrides });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
  t.after(async () => { await close(); await rm(root, { recursive: true, force: true }); });
  return { root, publicDir, dataDir, base, server, close };
}

async function login(base, password = PASSWORD, headers = {}) {
  const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ password }) });
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function put(base, cookie, baseRevision, data, headers = {}) {
  return fetch(base + '/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: JSON.stringify({ baseRevision, data }) });
}

test('startup requires a secret and rejects unsafe public origins', () => {
  assert.throws(() => createServer({ env: {} }), /DASHBOARD_PASSWORD/);
  assert.throws(() => createServer({ password: 'short', env: {} }), /at least 12/);
  assert.throws(() => createServer({ password: PASSWORD, appOrigin: 'http://example.com' }), /HTTPS/);
  assert.throws(() => createServer({ password: PASSWORD, appOrigin: 'https://example.com/path' }), /only an HTTP/);
  assert.throws(() => createServer({ password: PASSWORD, dataDir: '/tmp/fixture-public/data', publicDir: '/tmp/fixture-public' }), /DATA_DIR must not/);
});

test('public health/session and protected workspace do not expose credentials or records', async t => {
  const { base } = await fixture(t);
  const health = await fetch(base + '/api/health');
  assert.deepEqual(await health.json(), { ok: true, app: 'fenbd-cloud', version: '0.2.0' });
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await (await fetch(base + '/api/session')).json(), { authenticated: false });
  const unauthenticated = await fetch(base + '/api/workspace');
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).code, 'UNAUTHENTICATED');
  const wrong = await login(base, 'wrong password');
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.cookie, undefined);
});

test('two independent sessions share persisted workspace and stale writes return conflict', async t => {
  const { base, dataDir } = await fixture(t);
  const desktop = await login(base);
  const phone = await login(base);
  assert.equal(desktop.response.status, 200);
  assert.notEqual(desktop.cookie, phone.cookie);
  const text = await desktop.response.text();
  assert.ok(!text.includes(PASSWORD));
  const initial = await (await fetch(base + '/api/workspace', { headers: { Cookie: desktop.cookie } })).json();
  assert.equal(initial.revision, 0);
  const data = { ...emptyData(), records: [record()] };
  const first = await put(base, desktop.cookie, initial.revision, data, { Origin: base });
  assert.equal(first.status, 200);
  const written = await first.json();
  assert.equal(written.revision, 1);
  assert.equal(written.data.records[0].creator, '测试达人');
  const onPhone = await (await fetch(base + '/api/workspace', { headers: { Cookie: phone.cookie } })).json();
  assert.deepEqual(onPhone, written);
  const conflicting = await put(base, phone.cookie, 0, { ...emptyData(), records: [record('different-record')] });
  assert.equal(conflicting.status, 409);
  const conflict = await conflicting.json();
  assert.equal(conflict.code, 'CONFLICT');
  assert.equal(conflict.revision, 1);
  assert.ok(!Object.hasOwn(conflict, 'data'));
  const after = await (await fetch(base + '/api/workspace', { headers: { Cookie: desktop.cookie } })).json();
  assert.deepEqual(after, written);
  const rawDb = await readFile(path.join(dataDir, 'fenbd.sqlite3-wal'));
  assert.ok(!rawDb.includes(Buffer.from(PASSWORD)));
  assert.ok(!rawDb.includes(Buffer.from(desktop.cookie.split('=')[1])));
});

test('workspace and authenticated sessions survive restart, password rotation revokes old sessions', async t => {
  const f = await fixture(t);
  const client = await login(f.base);
  const data = { ...emptyData(), records: [record()] };
  assert.equal((await put(f.base, client.cookie, 0, data)).status, 200);
  await f.close();
  const second = createServer({ password: PASSWORD, dataDir: f.dataDir, publicDir: f.publicDir, secureCookies: false, env: {} });
  await new Promise(resolve => second.listen(0, '127.0.0.1', resolve));
  const nextBase = `http://127.0.0.1:${second.address().port}`;
  t.after(() => new Promise(resolve => { second.close(resolve); second.closeAllConnections(); }));
  const restored = await fetch(nextBase + '/api/workspace', { headers: { Cookie: client.cookie } });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).data.records[0].id, 'record-one');
  await new Promise(resolve => { second.close(resolve); second.closeAllConnections(); });
  const rotated = createServer({ password: PASSWORD + '-changed', dataDir: f.dataDir, publicDir: f.publicDir, secureCookies: false, env: {} });
  await new Promise(resolve => rotated.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { rotated.close(resolve); rotated.closeAllConnections(); }));
  const denied = await fetch(`http://127.0.0.1:${rotated.address().port}/api/workspace`, { headers: { Cookie: client.cookie } });
  assert.equal(denied.status, 401);
});

test('logout and absolute session expiration revoke access', async t => {
  let now = 1_800_000_000_000;
  const { base } = await fixture(t, { now: () => now, sessionTtlMs: 1000 });
  const first = await login(base);
  assert.equal((await fetch(base + '/api/session', { headers: { Cookie: first.cookie } })).status, 200);
  now += 1001;
  assert.deepEqual(await (await fetch(base + '/api/session', { headers: { Cookie: first.cookie } })).json(), { authenticated: false });
  assert.equal((await fetch(base + '/api/workspace', { headers: { Cookie: first.cookie } })).status, 401);
  const next = await login(base);
  const logout = await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: next.cookie, Origin: base } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fetch(base + '/api/workspace', { headers: { Cookie: next.cookie } })).status, 401);
});

test('cookies are HttpOnly Strict and secure in production', async t => {
  const { base } = await fixture(t, { secureCookies: true });
  const client = await login(base);
  const header = client.response.headers.get('set-cookie');
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /; Secure/);
  assert.match(header, /Path=\//);
});

test('cross-origin writes are rejected, including forged forwarded host and invalid origins', async t => {
  const { base } = await fixture(t);
  assert.equal((await login(base, PASSWORD, { Origin: 'https://evil.example' })).response.status, 403);
  const client = await login(base);
  const denied = await put(base, client.cookie, 0, emptyData(), { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example' });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'CROSS_ORIGIN_REQUEST');
  assert.equal((await put(base, client.cookie, 0, emptyData(), { Origin: 'null' })).status, 403);
  assert.equal((await put(base, client.cookie, 0, emptyData(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await put(base, client.cookie, 0, emptyData(), { Origin: base })).status, 200);
});

test('explicit deployment origin and automatic Render domain work without trusting forwarded headers', async t => {
  const { base } = await fixture(t, { secureCookies: true, env: { RENDER_EXTERNAL_URL: 'https://fenbd.example.com' } });
  const client = await login(base, PASSWORD, { Origin: 'https://fenbd.example.com' });
  assert.equal(client.response.status, 200);
  assert.equal((await put(base, client.cookie, 0, emptyData(), { Origin: 'https://fenbd.example.com' })).status, 200);
  assert.equal((await put(base, client.cookie, 1, emptyData(), { Origin: base })).status, 403);
});

test('five failed logins trigger a bounded rate limit and window expiration permits retry', async t => {
  let now = 1_800_000_000_000;
  const { base } = await fixture(t, { now: () => now });
  for (let index = 0; index < 5; index++) assert.equal((await login(base, 'bad-password')).response.status, 401);
  const limited = await login(base);
  assert.equal(limited.response.status, 429);
  assert.equal(limited.response.headers.get('retry-after'), '900');
  now += 15 * 60 * 1000;
  assert.equal((await login(base)).response.status, 200);
});

test('invalid payloads, duplicate videos and stage authorization cannot alter existing cloud data', async t => {
  const { base } = await fixture(t);
  const { cookie } = await login(base);
  const invalids = [
    { ...emptyData(), records: [record('one', { owner: '' })] },
    { ...emptyData(), records: [record('one', { dueDate: '2026-02-30' })] },
    { ...emptyData(), records: [record('one', { videoUrl: 'javascript:alert(1)' })] },
    { ...emptyData(), records: [record('one', { stage: '已寄样' })] },
    { ...emptyData(), records: [record('one', { stage: '已寄样', approved: true })] },
    { ...emptyData(), records: [record('one', { stage: '已发布', approved: true })] },
    { ...emptyData(), records: [record('one'), record('one')] },
    { ...emptyData(), records: [record('one', { videoUrl: 'https://example.com/video/1' }), record('two', { videoUrl: 'https://example.com/video/1' })] },
    { ...emptyData(), records: new Array(3001).fill(record()) },
  ];
  for (const data of invalids) assert.equal((await put(base, cookie, 0, data)).status, 400);
  const wrongContent = await fetch(base + '/api/workspace', { method: 'PUT', headers: { Cookie: cookie }, body: '{}' });
  assert.equal(wrongContent.status, 415);
  const huge = await fetch(base + '/api/workspace', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(8 * 1024 * 1024) }) });
  assert.equal(huge.status, 413);
  const current = await (await fetch(base + '/api/workspace', { headers: { Cookie: cookie } })).json();
  assert.equal(current.revision, 0);
  assert.deepEqual(current.data, emptyData());
});

test('legacy backup normalization strips unknown fields, rejects duplicates, and retains only bounded history', () => {
  const value = normalizeWorkspace({ ...emptyData(), exportedAt: 'ignored', checks: { '0-1': true, '__proto__': true, unknown: true }, records: [record('one', { unexpected: 'ignored', history: new Array(105).fill({ at: '2026-10-21', text: '记录' }) })] });
  assert.equal(value.records[0].history.length, 100);
  assert.equal(value.records[0].unexpected, undefined);
  assert.deepEqual(value.checks, { '0-1': true });
  assert.equal(value.exportedAt, undefined);
  assert.throws(() => normalizeRecord(record('bad id')));
});

test('calculator inputs synchronize, legacy backups default safely and malformed costs are rejected', () => {
  const legacy = normalizeWorkspace({ version: 1, records: [], checks: {}, demo: false });
  assert.deepEqual(legacy.calculator, { values: {}, demo: false });
  const normalized = normalizeWorkspace({ ...emptyData(), calculator: { values: { price: '25.00', rate: '20', shipping: '', unknown: 'discard' }, demo: true } });
  assert.deepEqual(normalized.calculator, { values: { price: '25.00', rate: '20', shipping: '' }, demo: true });
  for (const calculator of [null, { values: [] }, { values: { rate: '101' } }, { values: { goods: '-1' } }, { values: { price: 25 } }, { values: { price: 'Infinity' } }, { values: { price: '1e10' } }, { values: { base: ' ' } }]) {
    assert.throws(() => normalizeWorkspace({ ...emptyData(), calculator }));
  }
});

test('static assets use safe content types, API data is no-store, and files cannot escape public root', async t => {
  const f = await fixture(t);
  const root = await fetch(f.base + '/');
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type'), /text\/html/);
  assert.equal(root.headers.get('cache-control'), 'no-store');
  assert.match(root.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(root.headers.get('x-frame-options'), 'DENY');
  const js = await fetch(f.base + '/app.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal(js.headers.get('cache-control'), 'no-cache');
  await writeFile(path.join(f.publicDir, 'styles.css'), 'body{color:#234}');
  assert.equal((await fetch(f.base + '/styles.css')).headers.get('cache-control'), 'no-cache');
  await writeFile(path.join(f.root, 'private.txt'), 'private');
  await symlink(path.join(f.root, 'private.txt'), path.join(f.publicDir, 'escape.txt'));
  assert.equal((await fetch(f.base + '/escape.txt')).status, 403);
  assert.equal((await fetch(f.base + '/..%2fprivate.txt')).status, 403);
  assert.equal((await fetch(f.base + '/%00')).status, 400);
  assert.equal((await fetch(f.base + '/api/missing')).status, 404);
});
