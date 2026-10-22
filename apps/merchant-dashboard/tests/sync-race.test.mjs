import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the shipped synchronization functions with controlled request timing.
// Rendering is separate from these state transitions and covered in browser tests.
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const boundary = app.indexOf('function navigation()');
assert.ok(boundary > 0, 'the synchronization functions must be available');
const synchronization = app.slice(0, boundary);

function workspace(revision, checks = {}) {
  return {
    revision,
    updatedAt: `2026-10-22T10:${String(revision).padStart(2, '0')}:00.000Z`,
    data: { version: 1, records: [], checks, demo: false, calculator: { values: {}, demo: false } },
  };
}

function createHarness() {
  const nodes = new Map();
  const storage = new Map();
  const requests = [];
  function element(selector) {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        open: false,
        value: '',
        textContent: '',
        elements: {},
        classList: { add() {}, remove() {}, toggle() {} },
        close() { this.open = false; },
        showModal() { this.open = true; },
      });
    }
    return nodes.get(selector);
  }
  const context = vm.createContext({
    URL,
    crypto: {},
    navigator: { onLine: true },
    document: { querySelector: element, activeElement: null },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    setTimeout: () => 1,
    clearTimeout() {},
    deferredRequest(pathname, options) {
      return new Promise((resolve, reject) => requests.push({ pathname, options, resolve, reject }));
    },
  });
  vm.runInContext(`${synchronization}
    render = () => {};
    renderSync = () => {};
    toast = () => {};
    request = (...args) => deferredRequest(...args);
    function closeConfirm() { $('#confirm-dialog').close(); }
  `, context, { filename: 'app-sync-under-test.js' });
  const run = code => vm.runInContext(code, context);
  const snapshot = () => JSON.parse(run('JSON.stringify({state, revision, dirty, saving, conflict, authenticated})'));
  return { run, snapshot, requests, storage, element };
}

test('a GET from an earlier login cannot replace the new session workspace', async () => {
  const h = createHarness();
  h.run('authenticated = true; revision = 1;');
  const oldRead = h.run('loadWorkspace()');
  h.run('showLogin("expired");');
  const relogin = h.run('showWorkspace()');
  h.requests[1].resolve(workspace(10, { '1-0': true }));
  await relogin;
  const current = h.snapshot();
  h.requests[0].resolve(workspace(1));
  await oldRead;
  assert.deepEqual(h.snapshot(), current);
  assert.equal(h.snapshot().revision, 10);
});

test('a stale GET 401 cannot expire a newer authenticated session', async () => {
  const h = createHarness();
  h.run('authenticated = true; revision = 1;');
  const oldRead = h.run('loadWorkspace()');
  h.run('showLogin("expired");');
  const relogin = h.run('showWorkspace()');
  h.requests[1].resolve(workspace(10));
  await relogin;
  h.requests[0].reject(Object.assign(new Error('old unauthorized request'), { status: 401 }));
  await oldRead;
  assert.equal(h.snapshot().authenticated, true);
  assert.equal(h.snapshot().revision, 10);
});

test('an old PUT cannot replace a recovered draft or clear a newer save flag', async () => {
  const h = createHarness();
  h.run("authenticated = true; revision = 1; dirty = true; state.checks['0-0'] = true;");
  const oldSave = h.run('flushSave()');
  h.run('showLogin("expired");');
  const relogin = h.run('showWorkspace()');
  h.requests[1].resolve(workspace(10, { '1-0': true }));
  await relogin;
  // A current session can already be doing new work when an old response arrives.
  h.run('saving = true;');
  const current = h.snapshot();
  const stored = new Map(h.storage);
  h.requests[0].resolve(workspace(2, { '0-0': true }));
  await oldSave;
  assert.deepEqual(h.snapshot(), current);
  assert.deepEqual(h.storage, stored);
  assert.equal(h.snapshot().saving, true);
});

test('an old PUT failure cannot mutate or log out a newer session', async () => {
  for (const status of [401, 409]) {
    const h = createHarness();
    h.run("authenticated = true; revision = 1; dirty = true; state.checks['0-0'] = true;");
    const oldSave = h.run('flushSave()');
    h.run('showLogin("expired");');
    const relogin = h.run('showWorkspace()');
    h.requests[1].resolve(workspace(1, { '0-0': true }));
    await relogin;
    const current = h.snapshot();
    h.requests[0].reject(Object.assign(new Error('old request failed'), { status }));
    await oldSave;
    assert.deepEqual(h.snapshot(), current);
  }
});

test('a session expiry releases modal dialogs and restores the unsaved editor after login', async () => {
  const h = createHarness();
  const editor = h.element('#record-dialog');
  const confirmation = h.element('#confirm-dialog');
  const creator = { value: '尚未提交的达人名称' };
  h.element('#record-form').elements.creator = creator;
  editor.open = confirmation.open = true;
  h.run('authenticated = true; revision = 1; showLogin("expired");');
  assert.equal(editor.open, false, 'the native modal must stop blocking the login controls');
  assert.equal(confirmation.open, false);
  assert.equal(creator.value, '尚未提交的达人名称');
  const relogin = h.run('showWorkspace()');
  h.requests[0].resolve(workspace(1));
  await relogin;
  assert.equal(editor.open, true, 'the unsubmitted form should be available after login');
  assert.equal(creator.value, '尚未提交的达人名称');
});

test('a malformed pending draft survives new edits, cloud-save cleanup and another login', () => {
  const h = createHarness();
  const pendingKey = 'fenbd-cloud-pending-v1';
  const recoveryKey = 'fenbd-cloud-recovery-v1';
  const original = '{damaged original draft: keep every byte';
  h.storage.set(pendingKey, original);
  assert.equal(h.run('readPending()'), null);
  h.run("authenticated = true; revision = 4; mutate({...emptyState(), checks: {'0-0': true}});");
  assert.equal(h.storage.get(pendingKey), original);
  const recovery = JSON.parse(h.storage.get(recoveryKey));
  assert.equal(recovery.baseRevision, 4);
  assert.deepEqual(recovery.data.checks, { '0-0': true });
  const reopened = JSON.parse(h.run('JSON.stringify(readPending())'));
  assert.deepEqual(reopened.data.checks, { '0-0': true });
  h.run('clearPending();');
  assert.equal(h.storage.get(pendingKey), original, 'save cleanup must retain the only original raw draft');
  assert.ok(h.run('pendingError.length > 0'), 'the preserved raw draft must remain discoverable');
});
