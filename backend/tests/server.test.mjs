import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer, generateWithModel, validateBaseUrl } from '../server.mjs';
import { generateTemplate } from '../content.mjs';

const input = { topic: 'GPT 提问技巧', audience: '入门小白', tone: '通俗易懂', pageCount: 5 };
const publicLookup = async () => [{ address: '8.8.8.8', family: 4 }];

async function setup(t, options = {}) {
  const server = createAppServer({ env: {}, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('base URLs require HTTPS, reject private addresses and embedded credentials', () => {
  assert.equal(validateBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
  assert.equal(validateBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  for (const url of ['http://api.example.com/v1', 'https://10.1.2.3/v1', 'https://169.254.169.254', 'https://192.168.1.1', 'https://[fd00::1]', 'https://service.internal', 'https://user:pass@api.example.com', 'https://api.example.com/?key=value', 'not a URL']) {
    assert.throws(() => validateBaseUrl(url), { code: 'INVALID_INPUT' });
  }
});

test('HTTP health, template generation and input errors work without an API key', async t => {
  const base = await setup(t);
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true, app: 'zhiye' });
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.mode, 'template');
  assert.equal(settings.configured, false);
  const response = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, 'template');
  assert.equal(result.project.cards.length, input.pageCount);
  const invalid = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, pageCount: 99 }) });
  assert.equal(invalid.status, 400);
  const large = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: 'x'.repeat(40_000) }) });
  assert.equal(large.status, 413);
  const wrongType = await fetch(`${base}/api/generate`, { method: 'POST', body: JSON.stringify(input) });
  assert.equal(wrongType.status, 415);
});

test('settings never return secrets, retain blank key and can switch modes', async t => {
  const base = await setup(t);
  const put = async body => {
    const response = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { response, data: await response.json() };
  };
  assert.equal((await put({ apiKey: '' })).response.status, 400);
  assert.equal((await put({ mode: 'template' })).response.status, 200);
  const first = await put({ baseUrl: 'https://api.example.com/v1', model: 'test-model', apiKey: 'test-secret-value' });
  assert.equal(first.response.status, 200);
  assert.equal(first.data.mode, 'ai');
  assert.equal(first.data.configured, true);
  assert.ok(!JSON.stringify(first.data).includes('test-secret-value'));
  const blank = await put({ apiKey: '' });
  assert.equal(blank.data.configured, true);
  const template = await put({ mode: 'template' });
  assert.equal(template.data.mode, 'template');
  assert.equal(template.data.configured, true);
  const result = await (await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json();
  assert.equal(result.mode, 'template');
  assert.equal((await put({ mode: 'ai' })).data.mode, 'ai');
  assert.equal((await put({ baseUrl: 'https://10.0.0.1/v1' })).response.status, 400);
  const secondBase = await setup(t);
  const secondSettings = await (await fetch(`${secondBase}/api/settings`)).json();
  assert.equal(secondSettings.configured, false, 'settings must remain process-local');
});

test('changing provider origins requires a newly supplied key and preserves settings on failure', async t => {
  const base = await setup(t);
  const put = async body => fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await put({ baseUrl: 'https://api.example.com/v1', apiKey: 'first-provider-key' });
  const rejected = await put({ baseUrl: 'https://another.example.com/v1', apiKey: ' ' });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, 'NEW_PROVIDER_KEY_REQUIRED');
  const unchanged = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(unchanged.baseUrl, 'https://api.example.com/v1');
  assert.equal(unchanged.configured, true);
  assert.equal((await put({ baseUrl: 'https://api.example.com/v2', apiKey: '' })).status, 200);
  const changed = await put({ baseUrl: 'https://another.example.com/v1', apiKey: 'second-provider-key' });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).baseUrl, 'https://another.example.com/v1');
});

test('browser write operations require Origin host to match the preserved request Host', async t => {
  const base = await setup(t);
  const request = (endpoint, origin, body, method) => fetch(`${base}${endpoint}`, { method, headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  const sameOrigin = await request('/api/generate', base, input, 'POST');
  assert.equal(sameOrigin.status, 200);
  for (const endpoint of ['/api/generate', '/api/settings']) {
    const crossOrigin = await request(endpoint, 'https://unrelated.example.com', endpoint === '/api/settings' ? { apiKey: 'must-not-save' } : input, endpoint === '/api/settings' ? 'PUT' : 'POST');
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).code, 'CROSS_ORIGIN_REQUEST');
  }
  const malformed = await request('/api/generate', 'null', input, 'POST');
  assert.equal(malformed.status, 403);
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).configured, false);
});

test('AI-compatible request uses bearer auth and JSON output, with mocked upstream', async () => {
  const template = generateTemplate(input);
  let captured;
  const project = await generateWithModel(input, { baseUrl: 'https://api.example.com/v1', model: 'test-model', apiKey: 'test-key' }, {
    lookupImpl: publicLookup,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return Response.json({ choices: [{ message: { content: JSON.stringify(template) } }] });
    },
  });
  assert.equal(project.mode, 'ai');
  assert.equal(captured.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer test-key');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(JSON.parse(captured.options.body).response_format.type, 'json_object');
});

test('upstream auth errors, malformed JSON and private DNS are actionable failures', async () => {
  const config = { baseUrl: 'https://api.example.com/v1', model: 'test-model', apiKey: 'test-key' };
  await assert.rejects(generateWithModel(input, config, { lookupImpl: publicLookup, fetchImpl: async () => new Response('private server detail', { status: 401 }) }), { code: 'MODEL_AUTH_ERROR' });
  await assert.rejects(generateWithModel(input, config, { lookupImpl: publicLookup, fetchImpl: async () => new Response('not json') }), { code: 'INVALID_MODEL_OUTPUT' });
  await assert.rejects(generateWithModel(input, config, { lookupImpl: async () => [{ address: '10.0.0.1', family: 4 }], fetchImpl: async () => { throw new Error('must not fetch'); } }), { code: 'UNSAFE_MODEL_URL' });
});
