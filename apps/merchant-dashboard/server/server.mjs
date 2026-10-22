import http from 'node:http';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, validateWrite } from './validation.mjs';
import { createStore } from './store.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cookieName = 'fenbd_session';
const maxBytes = 8 * 1024 * 1024;
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
}

function sendJson(response, status, payload, extra = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      request.resume(); reject(new ApiError('请求必须是 JSON 格式。', 415, 'JSON_REQUIRED')); return;
    }
    if (Number(request.headers['content-length']) > maxBytes) {
      request.resume(); reject(new ApiError('数据超过 8 MB，请分批整理后重试。', 413, 'BODY_TOO_LARGE')); return;
    }
    const chunks = [];
    let bytes = 0, failed = false;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        if (!failed) reject(new ApiError('数据超过 8 MB，请分批整理后重试。', 413, 'BODY_TOO_LARGE'));
        failed = true; chunks.length = 0;
      } else if (!failed) chunks.push(chunk);
    });
    request.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError('JSON 数据格式不正确。')); }
    });
    request.on('error', () => reject(new ApiError('读取请求失败。')));
    request.on('aborted', () => reject(new ApiError('请求已中断。')));
  });
}

function configuredOrigin(raw) {
  if (!raw) return undefined;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('APP_ORIGIN must be a valid absolute origin.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('APP_ORIGIN must contain only an HTTP(S) origin.');
  if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error('Public APP_ORIGIN must use HTTPS.');
  return parsed.origin;
}

function checkOrigin(request, origin, secureCookies) {
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new ApiError('不允许跨站修改工作台。', 403, 'CROSS_ORIGIN_REQUEST');
  const supplied = request.headers.origin;
  if (!supplied) return;
  let suppliedOrigin;
  try { suppliedOrigin = new URL(supplied).origin; }
  catch { throw new ApiError('请求来源无效。', 403, 'CROSS_ORIGIN_REQUEST'); }
  let expected = origin;
  if (!expected) {
    try { expected = new URL(`${secureCookies ? 'https' : 'http'}://${request.headers.host}`).origin; }
    catch { throw new ApiError('请求来源无效。', 403, 'CROSS_ORIGIN_REQUEST'); }
  }
  if (suppliedOrigin !== expected || suppliedOrigin === 'null') throw new ApiError('不允许跨站修改工作台。', 403, 'CROSS_ORIGIN_REQUEST');
}

function sessionToken(request) {
  const pairs = String(request.headers.cookie || '').split(';');
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index >= 0 && pair.slice(0, index).trim() === cookieName) return pair.slice(index + 1).trim();
  }
  return undefined;
}

function cookie(token, ttlMs, secure) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(ttlMs / 1000))}${secure ? '; Secure' : ''}`;
}

async function staticFile(request, response, publicDirectory, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new ApiError('路径无效。'); }
  if (decoded.includes('\0') || decoded.includes('\\')) throw new ApiError('路径无效。', 400);
  const filename = path.resolve(publicDirectory, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!filename.startsWith(publicDirectory + path.sep)) throw new ApiError('无法访问此路径。', 403);
  let actual;
  try { actual = await realpath(filename); } catch { return sendJson(response, 404, { error: '页面不存在。', code: 'NOT_FOUND' }); }
  if (!actual.startsWith(publicDirectory + path.sep)) throw new ApiError('无法访问此路径。', 403);
  const info = await stat(actual);
  const extension = path.extname(actual).toLowerCase();
  if (!info.isFile() || !contentTypes[extension] || path.basename(actual).startsWith('.')) return sendJson(response, 404, { error: '页面不存在。', code: 'NOT_FOUND' });
  const data = await readFile(actual);
  const cacheControl = ['.html', '.webmanifest'].includes(extension) ? 'no-store' : ['.js', '.mjs', '.css'].includes(extension) ? 'no-cache' : 'public, max-age=3600';
  response.writeHead(200, { 'Content-Type': contentTypes[extension], 'Cache-Control': cacheControl, 'Content-Length': data.length });
  response.end(request.method === 'HEAD' ? undefined : data);
}

export function createServer(options = {}) {
  const env = options.env ?? process.env;
  const password = options.password ?? env.DASHBOARD_PASSWORD;
  if (typeof password !== 'string' || password.length < 12 || password.length > 512) throw new Error('Set DASHBOARD_PASSWORD to a secret containing at least 12 characters before starting the dashboard.');
  const secureCookies = options.secureCookies ?? (env.NODE_ENV === 'production' || env.COOKIE_SECURE === 'true');
  const origin = configuredOrigin(options.appOrigin ?? (env.APP_ORIGIN || env.RENDER_EXTERNAL_URL));
  const now = options.now ?? Date.now;
  const sessionTtlMs = options.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0) throw new Error('Session lifetime must be positive.');
  const dataDir = path.resolve(options.dataDir ?? env.DATA_DIR ?? path.join(appDirectory, 'var'));
  const publicDirectory = path.resolve(options.publicDir ?? path.join(appDirectory, 'public'));
  if (dataDir === publicDirectory || dataDir.startsWith(publicDirectory + path.sep)) throw new Error('DATA_DIR must not be inside the public assets directory.');
  const store = createStore({ dataDir, password, now });
  const attempts = new Map();
  const attemptWindowMs = 15 * 60 * 1000;
  function throttle(request) {
    const key = request.socket.remoteAddress || 'unknown';
    let value = attempts.get(key);
    if (!value || value.until <= now()) { value = { count: 0, until: now() + attemptWindowMs }; attempts.set(key, value); }
    if (value.count >= 5) throw new ApiError('登录尝试过多，请 15 分钟后重试。', 429, 'LOGIN_RATE_LIMIT', { retryAfter: Math.ceil((value.until - now()) / 1000) });
    return { key, value };
  }
  const server = http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) checkOrigin(request, origin, secureCookies);
      if (pathname === '/api/health' && request.method === 'GET') return sendJson(response, 200, { ok: true, app: 'fenbd-cloud', version: '0.2.0' });
      const token = sessionToken(request);
      if (pathname === '/api/session' && request.method === 'GET') return sendJson(response, 200, { authenticated: store.validSession(token) });
      if (pathname === '/api/login' && request.method === 'POST') {
        const { key, value } = throttle(request);
        const input = await readJson(request);
        const candidate = input && typeof input.password === 'string' && input.password.length <= 512 ? input.password : '';
        const hash = scryptSync(candidate, store.salt, 64);
        if (!candidate || !timingSafeEqual(hash, store.passwordHash)) {
          value.count += 1;
          if (attempts.size > 1000) for (const [oldKey, oldValue] of attempts) { if (oldValue.until <= now() || oldKey !== key) { attempts.delete(oldKey); break; } }
          return sendJson(response, 401, { error: '访问密码不正确。', code: 'INVALID_PASSWORD' });
        }
        attempts.delete(key);
        if (token) store.removeSession(token);
        const nextToken = store.createSession(sessionTtlMs);
        return sendJson(response, 200, { authenticated: true }, { 'Set-Cookie': cookie(nextToken, sessionTtlMs, secureCookies) });
      }
      if (pathname === '/api/logout' && request.method === 'POST') {
        if (token) store.removeSession(token);
        request.resume();
        return sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': cookie('', 0, secureCookies) });
      }
      if (pathname === '/api/workspace') {
        if (!store.validSession(token)) throw new ApiError('请先登录工作台。', 401, 'UNAUTHENTICATED');
        if (request.method === 'GET') return sendJson(response, 200, store.getWorkspace());
        if (request.method === 'PUT') {
          const input = validateWrite(await readJson(request));
          const result = store.saveWorkspace(input.baseRevision, input.data);
          if (result.conflict) return sendJson(response, 409, { error: '其他设备已更新数据。你的改动尚未覆盖云端，请先备份当前修改并刷新云端版本。', code: 'CONFLICT', revision: result.revision, updatedAt: result.updatedAt });
          return sendJson(response, 200, result);
        }
        throw new ApiError('不支持此请求方式。', 405, 'METHOD_NOT_ALLOWED');
      }
      if (pathname.startsWith('/api/')) throw new ApiError('接口不存在。', 404, 'NOT_FOUND');
      if (['GET', 'HEAD'].includes(request.method)) return await staticFile(request, response, publicDirectory, pathname);
      throw new ApiError('不支持此请求方式。', 405, 'METHOD_NOT_ALLOWED');
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      if (error instanceof ApiError) return sendJson(response, error.status, { error: error.message, code: error.code, ...error.details }, error.status === 429 ? { 'Retry-After': error.details.retryAfter } : {});
      console.error('Dashboard request failed:', error?.name || 'Error');
      return sendJson(response, 500, { error: '服务暂时无法处理请求，请稍后重试。', code: 'INTERNAL_ERROR' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.once('close', () => store.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT || 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
    const server = createServer();
    server.on('error', error => { console.error(`Dashboard startup failed: ${error.code || error.name}`); process.exitCode = 1; });
    server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`FenBD dashboard listening on port ${port}.`));
    const shutdown = () => {
      server.close(() => process.exit());
      const timer = setTimeout(() => process.exit(1), 10_000); timer.unref();
    };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
