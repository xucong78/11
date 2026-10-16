import { spawn } from 'node:child_process';
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import util from 'node:util';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function supportsNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:$|[-+])/.exec(version);
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return major > 24 || (major === 24 && minor >= 5);
}

export function parsePort(value) {
  const text = value === undefined || value === '' ? '3001' : String(value);
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 65535) {
    throw new Error('API_PORT 需要是 1–65535 之间的整数，例如 3001。');
  }
  return Number(text);
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export async function needsInstall(rootDirectory) {
  const required = [
    'node_modules/.package-lock.json',
    'node_modules/vite/package.json',
    'node_modules/typescript/package.json',
    'node_modules/react-dom/package.json',
  ];
  const present = await Promise.all(required.map(file => exists(path.join(rootDirectory, file))));
  if (present.some(value => !value)) return true;
  const [lock, installedLock] = await Promise.all([
    stat(path.join(rootDirectory, 'package-lock.json')),
    stat(path.join(rootDirectory, 'node_modules/.package-lock.json')),
  ]);
  return lock.mtimeMs > installedLock.mtimeMs;
}

async function sourceFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = await Promise.all(entries.map(async entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return entry.isFile() ? [file] : [];
  }));
  return files.flat();
}

export async function shouldBuild(rootDirectory) {
  let built;
  try { built = await stat(path.join(rootDirectory, 'dist/index.html')); }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  const rootFiles = (await readdir(rootDirectory)).filter(name =>
    ['package.json', 'package-lock.json', 'index.html'].includes(name) ||
    /^(vite\.config\.|tsconfig.*\.json$)/.test(name));
  const files = [
    ...rootFiles.map(name => path.join(rootDirectory, name)),
    ...await sourceFiles(path.join(rootDirectory, 'src')),
  ];
  const times = await Promise.all(files.map(file => stat(file)));
  return times.some(file => file.mtimeMs > built.mtimeMs);
}

async function findNpm(rootDirectory, env) {
  const executableDirectory = path.dirname(process.execPath);
  const directories = [...new Set([
    executableDirectory,
    ...String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean),
  ])];
  const candidates = [
    path.join(executableDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
    ...directories.map(directory => path.join(directory, 'node_modules/npm/bin/npm-cli.js')),
  ];
  if (process.platform !== 'win32') {
    for (const directory of directories) {
      try {
        const resolved = await realpath(path.join(directory, 'npm'));
        if (path.basename(resolved) === 'npm-cli.js') candidates.push(resolved);
      } catch { /* Try the remaining PATH entries. */ }
    }
  }
  for (const candidate of candidates) {
    if (await exists(candidate)) return [process.execPath, candidate];
  }
  throw new Error('未找到 npm。源码版需要安装包含 npm 的 Node.js 24.5 或更新版本；便携版请使用随附的启动文件。');
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: options.quiet ? 'ignore' : 'inherit', windowsHide: true });
    child.once('error', () => reject(new Error('无法执行 npm，请确认 Node.js 安装完整。')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`npm ${args.includes('ci') ? '依赖安装' : args.includes('build') ? '网页构建' : '检查'}未成功，请查看上方提示后重新启动。`)));
  });
}

async function portHasListener(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    socket.setTimeout(1200, () => finish(true));
    socket.once('connect', () => finish(true));
    socket.once('error', error => {
      if (error.code === 'ECONNREFUSED') finish(false);
      else finish(undefined, new Error(`无法检查本机端口 ${port}（${error.code ?? '连接失败'}）。`));
    });
  });
}

function requestLocal(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: pathname, method, timeout: 1200, agent: false }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 16_384) { response.destroy(); reject(new Error('响应过长。')); }
        else chunks.push(chunk);
      });
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
      response.once('error', reject);
    });
    request.once('timeout', () => request.destroy(new Error('连接超时。')));
    request.once('error', reject);
    request.end();
  });
}

export async function inspectPort(port) {
  if (!await portHasListener(port)) return { state: 'available' };
  try {
    const health = await requestLocal(port, '/api/health');
    const data = JSON.parse(health.text);
    if (health.status !== 200 || data.ok !== true || data.app !== 'zhiye') return { state: 'foreign' };
    const page = await requestLocal(port, '/', 'HEAD');
    return { state: 'zhiye', pageReady: page.status === 200 && page.headers['content-type']?.includes('text/html') };
  } catch { return { state: 'foreign' }; }
}

export function browserCommand(url, platform = process.platform, env = process.env) {
  // This URL is always generated from loopback + a validated numeric port. Keep
  // cmd's empty START title intact rather than applying argv quote escaping.
  if (platform === 'win32') return [env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `start "" ${url}`]];
  if (platform === 'darwin') return ['open', [url]];
  return ['xdg-open', [url]];
}

export async function openBrowser(url, { env = process.env } = {}) {
  const [command, args] = browserCommand(url, process.platform, env);
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    try {
      const browser = spawn(command, args, { env, stdio: 'ignore', detached: true, windowsHide: true, windowsVerbatimArguments: process.platform === 'win32' });
      browser.once('error', () => finish(false));
      browser.once('exit', code => finish(code === 0));
      browser.unref();
      timer = setTimeout(() => finish(true), 1000);
    } catch { finish(false); }
  });
}

function occupiedError(port) {
  return new Error(`端口 ${port} 已被其他程序占用。请关闭占用端口的程序，或在 .env 中设置 API_PORT=3002 后重试；启动器不会终止其他程序。`);
}

/** Start the bundled app or the source checkout. No dependencies are needed by this file. */
export async function launch({
  rootDirectory = projectRoot,
  portable = process.argv.includes('--portable'),
  env = process.env,
  log = console.log,
  warn = console.error,
  openBrowserImpl = openBrowser,
  handleSignals = true,
  readinessTimeoutMs = 20_000,
} = {}) {
  if (!supportsNodeVersion(process.versions.node)) {
    throw new Error('需要 Node.js 24.5 或更新版本，请更新 Node.js 后重试。');
  }
  rootDirectory = path.resolve(rootDirectory);
  portable ||= await exists(path.join(rootDirectory, 'portable.json'));
  for (const file of ['backend/server.mjs', ...(portable ? ['dist/index.html'] : ['package.json', 'package-lock.json'])]) {
    if (!await exists(path.join(rootDirectory, file))) {
      throw new Error(`项目文件不完整：缺少 ${file}。请完整解压下载包后再启动。`);
    }
  }
  let fileEnv = {};
  try { fileEnv = util.parseEnv(await readFile(path.join(rootDirectory, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 .env，请检查文件格式和读取权限。'); }
  const port = parsePort(env.API_PORT ?? fileEnv.API_PORT);
  const url = `http://127.0.0.1:${port}`;
  const showPage = async () => {
    log(`知页已就绪：${url}`);
    if (env.ZHIYE_NO_OPEN !== '1' && !await openBrowserImpl(url, { env })) {
      warn(`未能自动打开浏览器，请复制此地址打开：${url}`);
    }
  };
  const current = await inspectPort(port);
  if (current.state === 'foreign') throw occupiedError(port);
  if (current.state === 'zhiye') {
    if (!current.pageReady) throw new Error(`端口 ${port} 上的知页服务尚未提供网页，请关闭它的启动窗口后重试。`);
    log('检测到已经运行的知页，正在打开现有页面。修改 .env 后需要先关闭原启动窗口。');
    await showPage();
    return { url, reused: true };
  }

  if (!portable) {
    const [node, npmCli] = await findNpm(rootDirectory, env);
    await runCommand(node, [npmCli, '--version'], { cwd: rootDirectory, env, quiet: true });
    const installed = await needsInstall(rootDirectory);
    if (installed) {
      log('首次启动或依赖有更新，正在安装依赖；需要联网，请稍候。');
      await runCommand(node, [npmCli, 'ci', '--cache', path.join(rootDirectory, '.cache/npm'), '--no-audit', '--no-fund'], { cwd: rootDirectory, env });
    }
    if (installed || await shouldBuild(rootDirectory)) {
      log('正在构建图文工作台，请稍候。');
      await runCommand(node, [npmCli, 'run', 'build'], { cwd: rootDirectory, env });
    }
  }

  log('正在启动知页；关闭此窗口即可停止本次服务。');
  const child = spawn(process.execPath, ['--use-env-proxy', '--env-file-if-exists=.env', path.join(rootDirectory, 'backend/server.mjs')], {
    cwd: rootDirectory,
    env: { ...env, API_PORT: String(port), API_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let spawnError;
  let finished;
  let stopping = false;
  let stderrText = '';
  let forceTimer;
  child.stdout.on('data', data => log(data.toString().trimEnd()));
  child.stderr.on('data', data => {
    stderrText = (stderrText + data.toString()).slice(-16_384);
    warn(data.toString().trimEnd());
  });
  const stop = () => {
    if (stopping || finished) return;
    stopping = true;
    child.kill('SIGTERM');
    forceTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    forceTimer.unref();
  };
  const cleanup = () => {
    clearTimeout(forceTimer);
    if (handleSignals) {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  };
  const completion = new Promise(resolve => {
    child.once('error', error => {
      spawnError = error;
      finished = { code: 1, error };
      cleanup();
      resolve(finished);
    });
    child.once('exit', (code, signal) => {
      finished = { code: stopping ? 0 : code ?? 1, signal };
      cleanup();
      resolve(finished);
    });
  });
  if (handleSignals) {
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < readinessTimeoutMs) {
      if (spawnError) throw new Error('无法启动知页服务，请确认目录读取权限与 Node.js 安装完整。');
      if (finished) {
        if (stderrText.includes('EADDRINUSE')) throw occupiedError(port);
        throw new Error('知页服务启动后意外退出，请查看上方提示。');
      }
      const status = await inspectPort(port);
      if (status.state === 'zhiye' && status.pageReady) {
        await showPage();
        return { url, child, stop, completion, reused: false };
      }
      await delay(100);
    }
    throw new Error('等待知页启动超时，请查看上方提示并重新启动。');
  } catch (error) {
    stop();
    await completion;
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const session = await launch();
    if (session.completion) {
      const result = await session.completion;
      if (result.code !== 0) console.error('知页服务已停止。请查看上方提示，再次双击启动文件。');
      process.exitCode = result.code;
    }
  } catch (error) {
    console.error(`启动失败：${error.message}`);
    process.exitCode = 1;
  }
}
