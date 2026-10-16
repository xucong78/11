import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { browserCommand, inspectPort, launch, needsInstall, parsePort, shouldBuild, supportsNodeVersion } from '../launch.mjs';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zhiye-launcher-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function put(root, file, content = '') {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), content);
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise(resolve => server.close(resolve));
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

const fixtureServer = `
import http from 'node:http';
if (process.env.API_HOST !== '127.0.0.1') throw new Error('Loopback host required');
const server = http.createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, {'content-type': 'application/json'});
    response.end(JSON.stringify({ok:true, app:'zhiye'}));
  } else {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end('<!doctype html><title>知页</title>');
  }
});
server.listen(Number(process.env.API_PORT), process.env.API_HOST);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;

test('requires a Node version that supports the proxy flag', () => {
  assert.equal(supportsNodeVersion('24.4.9'), false);
  assert.equal(supportsNodeVersion('22.99.0'), false);
  assert.equal(supportsNodeVersion('v24.5.0'), true);
  assert.equal(supportsNodeVersion('25.0.0'), true);
  assert.equal(supportsNodeVersion('not a version'), false);
});

test('accepts a valid local port and rejects malformed configuration', () => {
  assert.equal(parsePort(undefined), 3001);
  assert.equal(parsePort('4317'), 4317);
  for (const value of ['0', '65536', '3e3', '3001oops', '-1', '3.5', '3001\n']) {
    assert.throws(() => parsePort(value), /API_PORT/);
  }
});

test('portable launch starts without npm, package.json, node_modules, or a lockfile', async t => {
  const root = await temporaryDirectory(t);
  await put(root, 'backend/server.mjs', fixtureServer);
  await put(root, 'dist/index.html', '<!doctype html><title>知页</title>');
  await put(root, 'portable.json', '{"app":"zhiye"}');
  const port = await freePort();
  const opened = [];
  const session = await launch({
    rootDirectory: root,
    env: { ...process.env, PATH: '', API_PORT: String(port), ZHIYE_NO_OPEN: '0' },
    openBrowserImpl: async url => { opened.push(url); return true; },
    log() {}, warn() {}, handleSignals: false,
  });
  t.after(async () => { session.stop(); await session.completion; });
  assert.equal(session.reused, false);
  assert.equal(session.url, `http://127.0.0.1:${port}`);
  assert.deepEqual(opened, [session.url]);
  assert.deepEqual(await inspectPort(port), { state: 'zhiye', pageReady: true });
  session.stop();
  const result = await session.completion;
  assert.equal(result.code, 0);
  assert.deepEqual(await inspectPort(port), { state: 'available' });
});

test('existing app is opened without taking ownership, and dotenv selects its port', async t => {
  const root = await temporaryDirectory(t);
  await put(root, 'backend/server.mjs', fixtureServer);
  await put(root, 'dist/index.html', 'fixture');
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/api/health' ? 'application/json' : 'text/html');
    response.end(request.url === '/api/health' ? JSON.stringify({ ok: true, app: 'zhiye' }) : 'fixture');
  });
  const port = await listen(server);
  t.after(() => close(server));
  await put(root, '.env', `API_PORT=${port}\nAI_API_KEY=never-print-this-secret\n`);
  const messages = [];
  const env = { ...process.env, ZHIYE_NO_OPEN: '1' };
  delete env.API_PORT;
  const session = await launch({ rootDirectory: root, portable: true, env, log: value => messages.push(value), warn() {}, openBrowserImpl() { throw new Error('Must not open'); } });
  assert.equal(session.reused, true);
  assert.equal(session.child, undefined);
  assert.equal(session.stop, undefined);
  assert.equal(session.url, `http://127.0.0.1:${port}`);
  assert.ok(messages.every(message => !message.includes('never-print-this-secret')));
  assert.equal(server.listening, true);
});

test('another service on the chosen port is left running', async t => {
  const root = await temporaryDirectory(t);
  await put(root, 'backend/server.mjs', fixtureServer);
  await put(root, 'dist/index.html', 'fixture');
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end('{"ok":true}');
  });
  const port = await listen(server);
  t.after(() => close(server));
  assert.deepEqual(await inspectPort(port), { state: 'foreign' });
  await assert.rejects(launch({ rootDirectory: root, portable: true, env: { ...process.env, API_PORT: String(port) }, log() {}, warn() {} }), /已被其他程序占用/);
  assert.equal(server.listening, true);
});

test('a server crash during startup is reported and does not leave a listener', async t => {
  const root = await temporaryDirectory(t);
  await put(root, 'backend/server.mjs', 'process.exit(2);');
  await put(root, 'dist/index.html', 'fixture');
  const port = await freePort();
  await assert.rejects(launch({ rootDirectory: root, portable: true, env: { ...process.env, API_PORT: String(port), ZHIYE_NO_OPEN: '1' }, log() {}, warn() {}, handleSignals: false }), /意外退出/);
  assert.deepEqual(await inspectPort(port), { state: 'available' });
});

test('dependency checks detect missing packages and a newer lockfile', async t => {
  const root = await temporaryDirectory(t);
  await put(root, 'package-lock.json', '{}');
  assert.equal(await needsInstall(root), true);
  for (const file of ['node_modules/.package-lock.json', 'node_modules/vite/package.json', 'node_modules/typescript/package.json', 'node_modules/react-dom/package.json']) await put(root, file, '{}');
  await utimes(path.join(root, 'package-lock.json'), 100, 100);
  await utimes(path.join(root, 'node_modules/.package-lock.json'), 200, 200);
  assert.equal(await needsInstall(root), false);
  await utimes(path.join(root, 'package-lock.json'), 300, 300);
  assert.equal(await needsInstall(root), true);
});

test('source changes rebuild the page while backend-only changes reuse it', async t => {
  const root = await temporaryDirectory(t);
  assert.equal(await shouldBuild(root), true);
  await put(root, 'src/App.tsx', '// app');
  await put(root, 'dist/index.html', '<html>');
  await utimes(path.join(root, 'src/App.tsx'), 100, 100);
  await utimes(path.join(root, 'dist/index.html'), 200, 200);
  await put(root, 'backend/server.mjs', '// changed after build');
  assert.equal(await shouldBuild(root), false);
  await utimes(path.join(root, 'src/App.tsx'), 300, 300);
  assert.equal(await shouldBuild(root), true);
});

test('browser commands support Windows, macOS, and Linux', () => {
  const url = 'http://127.0.0.1:3001';
  assert.deepEqual(browserCommand(url, 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }), ['C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', `start "" ${url}`]]);
  assert.deepEqual(browserCommand(url, 'darwin'), ['open', [url]]);
  assert.deepEqual(browserCommand(url, 'linux'), ['xdg-open', [url]]);
});
