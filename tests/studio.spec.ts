import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

test.beforeEach(async ({ page, request }) => {
  const response = await request.put('/api/settings', { data: { mode: 'template' } });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '把好想法，变成好内容。' })).toBeVisible();
});

test('示例预览、实时编辑、标签与桌面界面', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('button', { name: /^查看第 \d+ 页$/ })).toHaveCount(5);
  await expect(page.locator('.preview-artboard')).toContainText('别让 ChatGPT');
  await expect(page.locator('.draft-status')).toHaveText('草稿已自动保存');
  await page.screenshot({ path: '/tmp/zhiye-desktop.png' });
  await page.screenshot({ path: '/tmp/zhiye-desktop-full.png', fullPage: true });
  await page.getByRole('button', { name: '编辑当前页' }).click();
  await page.getByLabel('卡片标题', { exact: true }).fill('AI 提问，\n先说清楚目标。');
  await page.getByLabel('卡片正文', { exact: true }).fill('说出目标、背景和期待的输出格式。');
  await expect(page.locator('.preview-artboard')).toContainText('先说清楚目标');
  await expect(page.locator('.preview-artboard')).toContainText('说出目标、背景');
  await page.getByRole('button', { name: '极简深墨', exact: true }).click();
  await expect(page.getByRole('button', { name: '极简深墨', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  await expect(page.getByText('1080 × 1080 PX', { exact: true })).toBeVisible();
  const size = await page.locator('.preview-artboard .scaled-card').boundingBox();
  expect(Math.abs(size!.width - size!.height)).toBeLessThan(1);
  await page.getByRole('button', { name: '发布文案', exact: true }).click();
  await page.getByLabel('话题标签', { exact: true }).fill('AI学习');
  await page.getByLabel('话题标签', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: '删除标签 AI学习' })).toBeVisible();
  await page.getByRole('button', { name: '删除标签 ChatGPT', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除标签 ChatGPT', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除标签 AI学习' })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const { ratio, height } of [{ ratio: '3:4', height: 1440 }, { ratio: '1:1', height: 1080 }]) {
  test(`下载 ${ratio} 完整素材：真实 PNG 尺寸及修改后的发布文案`, async ({ page }) => {
    await page.getByRole('button', { name: ratio, exact: true }).click();
    await page.getByLabel('图文标题', { exact: true }).fill('AI 科普导出验收');
    await page.getByLabel('正文', { exact: true }).fill('这是已经核对过的文案。你使用 AI 时最关心什么？');
    await page.getByRole('button', { name: '卡片内容', exact: true }).click();
    await page.getByLabel('卡片标题', { exact: true }).fill('让 AI 理解你的目标');
    await page.getByLabel('卡片正文', { exact: true }).fill('修改后的卡片内容，应一并包含在素材包中。');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载全部图文', exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('AI 科普导出验收-图文素材.zip');
    const archive = await JSZip.loadAsync(await readFile((await download.path())!));
    const images = Object.values(archive.files).filter(file => file.name.endsWith('.png'));
    expect(images).toHaveLength(5);
    for (const image of images) {
      const png = await image.async('nodebuffer');
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16)).toBe(1080);
      expect(png.readUInt32BE(20)).toBe(height);
      expect(png.byteLength).toBeGreaterThan(10_000);
    }
    const caption = await archive.file('发布文案.txt')!.async('string');
    expect(caption).toContain('AI 科普导出验收');
    expect(caption).toContain('这是已经核对过的文案');
    expect(caption).toContain('修改后的卡片内容');
    expect(caption).toContain('#AI科普');
    await expect(page.getByRole('status')).toContainText('图文包已导出');
  });
}

test('保存作品、重新打开、刷新后草稿仍存在', async ({ page }) => {
  await page.getByLabel('图文标题', { exact: true }).fill('我的 GPT 科普第一期');
  await page.getByLabel('正文', { exact: true }).fill('这是我准备发布的第一期内容。');
  await page.getByLabel('账号署名', { exact: true }).fill('AI 学习笔记');
  await page.getByRole('button', { name: '灵感淡紫', exact: true }).click();
  await page.getByRole('button', { name: '保存作品', exact: true }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的作品' }).click();
  await expect(page.getByRole('button', { name: '打开作品 我的 GPT 科普第一期' })).toBeVisible();
  await page.getByRole('button', { name: '新建图文', exact: true }).click();
  await expect(page.getByLabel('图文标题', { exact: true })).toHaveValue('未命名图文');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的作品' }).click();
  await page.getByRole('button', { name: '打开作品 我的 GPT 科普第一期' }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('这是我准备发布的第一期内容。');
  await expect(page.getByLabel('账号署名', { exact: true })).toHaveValue('AI 学习笔记');
  await expect(page.getByRole('button', { name: '灵感淡紫', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.draft-status')).toHaveText('草稿已自动保存');
  await page.reload();
  await expect(page.getByLabel('图文标题', { exact: true })).toHaveValue('我的 GPT 科普第一期');
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('这是我准备发布的第一期内容。');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的作品' }).click();
  await expect(page.getByRole('button', { name: '打开作品 我的 GPT 科普第一期' })).toBeVisible();
});

test('本地模板支持不同科普选题与 3、6、8 页', async ({ page }) => {
  for (const item of [
    { topic: 'AI 为什么会出现幻觉？', pages: 3, expected: 'AI 回答得很自信' },
    { topic: '智能体和普通聊天机器人有什么区别？', pages: 6, expected: 'AI 智能体' },
    { topic: '职场里怎样使用 AI 提升效率？', pages: 8, expected: '职场用 AI' },
  ]) {
    await page.getByLabel('今天，想分享什么？').fill(item.topic);
    await page.getByRole('button', { name: `${item.pages}页`, exact: true }).click();
    const generated = page.waitForResponse(response => response.url().endsWith('/api/generate') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /^生成图文/ }).click();
    expect((await generated).ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: /^查看第 \d+ 页$/ })).toHaveCount(item.pages);
    await expect(page.locator('.preview-artboard')).toContainText(item.expected);
    await expect(page.locator('.generation-note')).toContainText('本地模板');
    await expect(page.getByLabel('图文标题', { exact: true })).not.toHaveValue('');
  }
});

test('模型配置不回显密钥，使用本机模拟模型完成 AI 生成', async ({ page, request }) => {
  const key = 'test-only-zhiye-key-do-not-use';
  const upstream: { auth?: string; payload?: any } = {};
  const mock = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    upstream.auth = req.headers.authorization;
    upstream.payload = JSON.parse(Buffer.concat(chunks).toString());
    const output = { title: '从目标开始写提示词', caption: '模型返回的中文发布正文，可继续编辑。', tags: ['AI科普', '提示词'], cards: Array.from({ length: 3 }, (_, i) => ({ title: ['先说目标', '补充背景', '一起交流'][i], body: '用具体问题，让 AI 理解你的需求。', eyebrow: `知识 ${i + 1}` })) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
  });
  await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
  const port = (mock.address() as AddressInfo).port;
  try {
    await page.getByRole('button', { name: '连接 AI 模型', exact: true }).click();
    await page.getByLabel('接口地址', { exact: true }).fill(`http://127.0.0.1:${port}/v1`);
    await page.getByLabel('模型名称', { exact: true }).fill('local-test-model');
    await page.getByLabel('API Key').fill(key);
    await expect(page.getByLabel('API Key')).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: '保存并启用 AI', exact: true }).click();
    await expect(page.getByRole('button', { name: 'AI 已配置', exact: true })).toBeVisible();
    const settings = await (await request.get('/api/settings')).text();
    expect(settings).not.toContain(key);
    expect(JSON.parse(settings)).toMatchObject({ configured: true, mode: 'ai', model: 'local-test-model' });
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(key);
    await page.getByRole('button', { name: 'AI 已配置', exact: true }).click();
    await expect(page.getByLabel('API Key')).toHaveValue('');
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    await page.getByLabel('今天，想分享什么？').fill('如何写好一个 AI 提示词？');
    await page.getByRole('button', { name: '3页', exact: true }).click();
    await page.getByRole('button', { name: /^生成图文/ }).click();
    await expect(page.getByLabel('图文标题', { exact: true })).toHaveValue('从目标开始写提示词');
    await expect(page.getByRole('button', { name: /^查看第 \d+ 页$/ })).toHaveCount(3);
    await expect(page.locator('.generation-note')).toContainText('AI 模式');
    expect(upstream.auth === `Bearer ${key}`).toBeTruthy();
    expect(upstream.payload.model).toBe('local-test-model');
    expect(JSON.parse(upstream.payload.messages[1].content)).toMatchObject({ topic: '如何写好一个 AI 提示词？', pageCount: 3 });
    expect(await page.content()).not.toContain(key);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(key);
  } finally {
    await request.put('/api/settings', { data: { mode: 'template' } });
    await new Promise<void>(resolve => mock.close(() => resolve()));
  }
});

test('手机 375px 与 390px 无横向溢出，导航及编辑可用', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.reload();
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await noOverflow();
  await page.getByRole('button', { name: '编辑当前页' }).click();
  await page.getByLabel('卡片标题', { exact: true }).fill('手机也能编辑 AI 图文');
  await expect(page.locator('.preview-artboard')).toContainText('手机也能编辑');
  await noOverflow();
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('button', { name: '我的作品' }).click();
  await expect(page.getByText('你的第一篇好内容，正在路上。')).toBeVisible();
  await noOverflow();
  await nav.getByRole('button', { name: '灵感选题' }).click();
  await expect(page.getByRole('heading', { name: '今天，分享一点新知。' })).toBeVisible();
  await noOverflow();
  await page.getByRole('button', { name: '用这个选题创作', exact: true }).click();
  await expect(page.getByLabel('今天，想分享什么？')).toHaveValue('为什么你问 ChatGPT，它总说一些空话？');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await expect(page.locator('.draft-status')).toHaveText('草稿已自动保存');
  await noOverflow();
  await page.screenshot({ path: '/tmp/zhiye-mobile.png' });
  await page.screenshot({ path: '/tmp/zhiye-mobile-full.png', fullPage: true });
});
