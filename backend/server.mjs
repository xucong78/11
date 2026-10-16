import http from 'node:http';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputError, normalizeInput, generateTemplate, buildMessages, validateModelOutput } from './content.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultBaseUrl = 'https://api.openai.com/v1';
const maxRequestBytes = 32 * 1024;
const maxResponseBytes = 2 * 1024 * 1024;

function isPrivateAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return true;
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff');
  }
  return true;
}

export function validateBaseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 500) throw new InputError('请填写有效的模型服务地址。');
  let url;
  try { url = new URL(rawUrl.trim()); } catch { throw new InputError('模型服务地址格式不正确。'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new InputError('模型服务请使用 HTTPS；本机 localhost 服务支持 HTTP。');
  }
  if (url.username || url.password || url.search || url.hash) throw new InputError('服务地址不能包含账号、密码、查询参数或片段。');
  if (!local && (hostname.endsWith('.local') || hostname.endsWith('.localhost') || hostname.endsWith('.internal') || !hostname.includes('.') || (isIP(hostname) && isPrivateAddress(hostname)))) {
    throw new InputError('模型服务地址不能指向内网或保留地址。');
  }
  return url.toString().replace(/\/+$/, '');
}

async function checkDestination(baseUrl, lookupImpl) {
  const url = new URL(baseUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return;
  let addresses;
  try { addresses = await lookupImpl(hostname, { all: true, verbatim: true }); }
  catch { throw new InputError('无法解析模型服务地址，请检查地址和网络设置。', 502, 'MODEL_DNS_ERROR'); }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new InputError('模型服务解析到了内网或保留地址，请使用公开的 HTTPS 服务。', 400, 'UNSAFE_MODEL_URL');
  }
}

function settingsView(config) {
  return { configured: Boolean(config.apiKey), baseUrl: config.baseUrl, model: config.model, mode: config.mode };
}

async function readResponseText(response) {
  if (Number(response.headers.get('content-length')) > maxResponseBytes) throw new InputError('模型返回内容过长，请缩短选题后重试。', 502, 'MODEL_RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw new InputError('模型返回内容过长，请缩短选题后重试。', 502, 'MODEL_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function generateWithModel(input, config, { fetchImpl = fetch, lookupImpl = lookup } = {}) {
  const baseUrl = validateBaseUrl(config.baseUrl);
  await checkDestination(baseUrl, lookupImpl);
  let response;
  let payload;
  try {
    response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: buildMessages(input), temperature: 0.7, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(60_000),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new InputError('模型服务拒绝访问，请检查 API Key 和模型权限。', 502, 'MODEL_AUTH_ERROR');
      if (response.status === 429) throw new InputError('模型服务额度不足或请求过于频繁，请稍后重试。', 429, 'MODEL_RATE_LIMIT');
      throw new InputError(`模型服务暂时不可用（HTTP ${response.status}），请检查服务地址和所选模型。`, 502, 'MODEL_SERVICE_ERROR');
    }
    const text = await readResponseText(response);
    try { payload = JSON.parse(text); }
    catch { throw new InputError('模型服务返回了无法解析的数据，请检查服务是否兼容 OpenAI API。', 502, 'INVALID_MODEL_OUTPUT'); }
  } catch (error) {
    if (error instanceof InputError) throw error;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new InputError('模型生成超时，请稍后重试或更换响应更快的模型。', 504, 'MODEL_TIMEOUT');
    throw new InputError('无法连接模型服务，请检查服务地址、网络和代理设置。', 502, 'MODEL_CONNECTION_ERROR');
  }
  return validateModelOutput(payload?.choices?.[0]?.message?.content, input);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      request.resume();
      reject(new InputError('请求需要使用 application/json。', 415));
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxRequestBytes) {
        if (!failed) reject(new InputError('请求内容过大。', 413, 'REQUEST_TOO_LARGE'));
        failed = true;
        chunks.length = 0;
      } else if (!failed) chunks.push(chunk);
    });
    request.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new InputError('请求不是有效的 JSON。')); }
    });
    request.on('error', () => reject(new InputError('读取请求失败。')));
    request.on('aborted', () => reject(new InputError('请求已中断。')));
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

function checkRequestOrigin(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) || !request.headers.origin) return;
  let origin;
  try { origin = new URL(request.headers.origin); }
  catch { throw new InputError('请求来源无效，请从工作台页面重试。', 403, 'INVALID_ORIGIN'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.host.toLowerCase() !== request.headers.host?.toLowerCase()) {
    throw new InputError('不允许跨站修改设置或生成内容，请从工作台页面重试。', 403, 'CROSS_ORIGIN_REQUEST');
  }
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

async function serveStatic(request, response, pathname, distDirectory) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new InputError('路径格式不正确。'); }
  const fullPath = path.resolve(distDirectory, `.${decoded}`);
  if (fullPath !== distDirectory && !fullPath.startsWith(`${distDirectory}${path.sep}`)) throw new InputError('无法访问此路径。', 403);
  let filePath = fullPath;
  let fileInfo;
  try { fileInfo = await stat(filePath); } catch { /* A client route can use the SPA entry. */ }
  if (!fileInfo?.isFile()) filePath = path.join(distDirectory, 'index.html');
  try {
    const buffer = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    response.end(request.method === 'HEAD' ? undefined : buffer);
  } catch { sendJson(response, 404, { error: '网页尚未构建。开发模式请启动前端服务；生产模式请先执行 npm run build。', code: 'STATIC_NOT_BUILT' }); }
}

export function createAppServer(options = {}) {
  const env = options.env ?? process.env;
  let config = { baseUrl: env.AI_BASE_URL?.trim() || defaultBaseUrl, model: env.AI_MODEL?.trim() || 'gpt-4o-mini', apiKey: env.AI_API_KEY?.trim() || '', mode: env.AI_API_KEY?.trim() ? 'ai' : 'template' };
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupImpl = options.lookupImpl ?? lookup;
  const distDirectory = path.resolve(options.distDirectory ?? path.join(rootDirectory, 'dist'));
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/')) checkRequestOrigin(request);
      if (pathname === '/api/health' && request.method === 'GET') return sendJson(response, 200, { ok: true, app: 'zhiye' });
      if (pathname === '/api/settings' && request.method === 'GET') return sendJson(response, 200, settingsView(config));
      if (pathname === '/api/settings' && request.method === 'PUT') {
        const data = await readJson(request);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new InputError('设置格式不正确。');
        if (data.mode !== undefined && !['template', 'ai'].includes(data.mode)) throw new InputError('生成模式格式不正确。');
        const baseUrl = validateBaseUrl(data.baseUrl ?? config.baseUrl);
        const model = data.model === undefined ? config.model : typeof data.model === 'string' ? data.model.trim() : '';
        if (!model || model.length > 120 || /[\r\n]/.test(model)) throw new InputError('模型名称需要 1–120 个字符。');
        if (data.apiKey !== undefined && typeof data.apiKey !== 'string') throw new InputError('API Key 格式不正确。');
        const newApiKey = data.apiKey?.trim() || '';
        let currentOrigin;
        try { currentOrigin = new URL(config.baseUrl).origin; } catch { currentOrigin = null; }
        if (config.apiKey && new URL(baseUrl).origin !== currentOrigin && !newApiKey) {
          throw new InputError('更换模型服务商后，请重新填写该服务商的 API Key，防止旧密钥发送到新地址。', 400, 'NEW_PROVIDER_KEY_REQUIRED');
        }
        const apiKey = newApiKey || config.apiKey;
        if (apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new InputError('API Key 格式不正确。');
        if (data.mode !== 'template' && !apiKey) throw new InputError('请先填写 API Key，再启用 AI 生成。');
        const mode = data.mode === 'template' ? 'template' : apiKey ? 'ai' : 'template';
        config = { baseUrl, model, apiKey, mode };
        return sendJson(response, 200, settingsView(config));
      }
      if (pathname === '/api/generate' && request.method === 'POST') {
        const data = normalizeInput(await readJson(request));
        const snapshot = { ...config };
        const project = snapshot.mode === 'ai' && snapshot.apiKey ? await generateWithModel(data, snapshot, { fetchImpl, lookupImpl }) : generateTemplate(data);
        return sendJson(response, 200, { project, mode: project.mode });
      }
      if (pathname.startsWith('/api/')) return sendJson(response, 404, { error: '接口不存在。', code: 'NOT_FOUND' });
      if (request.method === 'GET' || request.method === 'HEAD') return await serveStatic(request, response, pathname, distDirectory);
      return sendJson(response, 405, { error: '不支持此请求方式。', code: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      if (response.headersSent) return response.end();
      if (error instanceof InputError) return sendJson(response, error.status, { error: error.message, code: error.code });
      console.error('API request failed:', error.name);
      return sendJson(response, 500, { error: '服务暂时出错，请稍后重试。', code: 'INTERNAL_ERROR' });
    }
  });
  server.requestTimeout = 75_000;
  server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.API_PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be between 1 and 65535.');
  const server = createAppServer();
  const host = process.env.API_HOST || '0.0.0.0';
  server.listen(port, host, () => console.log(`AI 图文工作台 API 已启动：http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
}
