import type { Project } from '../types';

const DRAFT_KEY = 'zhiye-draft-v1';
const PROJECTS_KEY = 'zhiye-projects-v1';

export const initialProject: Project = {
  id: 'welcome-prompt-guide',
  topic: '为什么你问 ChatGPT，它总说一些空话？',
  title: 'ChatGPT 总说空话？试试这 4 个提问技巧',
  caption: '同样是问 ChatGPT，为什么有人拿到的是可直接用的方案，有人只得到一堆空话？\n\n差别往往在于，你有没有把问题讲清楚。\n这 4 个提问技巧，从「给我点建议」到「给我一份能执行的方案」，帮你少走弯路。\n\n先收藏，下次提问前对照着用。\n你遇到过 AI 最离谱的回答是什么？评论区聊聊 👇',
  tags: ['AI科普', 'ChatGPT', '提示词技巧', 'AI工具', '效率提升'],
  cards: [
    { id: 'c1', kind: 'cover', eyebrow: 'AI 入门 · 提问指南', title: '别让 ChatGPT\n再说空话了。', body: '4 个提问技巧\n让 AI 真正帮到你' },
    { id: 'c2', kind: 'content', eyebrow: '技巧 01 / 明确目标', title: '先告诉它，\n你要什么结果。', body: '❌ 帮我写点关于 AI 的内容。\n\n✅ 帮我写一篇面向 AI 新手的科普图文，让读者看懂什么是大模型。\n\n目标越具体，回答越容易派上用场。' },
    { id: 'c3', kind: 'content', eyebrow: '技巧 02 / 补充背景', title: '让 AI 知道，\n它在帮谁。', body: '告诉它你的读者是谁、处于什么场景、已经知道哪些内容。\n\n试试这样说：\n「读者是刚接触 AI 的职场人，没有编程基础，请用日常例子解释。」\n\n背景能帮它选对表达方式。' },
    { id: 'c4', kind: 'content', eyebrow: '技巧 03 / 说明限制', title: '给回答划一个\n有用的范围。', body: '长度、语气、预算和时间，都可以提前说明。\n\n试试这样说：\n「正文控制在 300 字以内，语气轻松，不使用专业术语，给出 2 个例子。」\n\n限制越清楚，修改成本越低。' },
    { id: 'c5', kind: 'outro', eyebrow: '技巧 04 / 指定格式', title: '最后，告诉它\n怎么交付。', body: '把你期待的结构直接写出来。\n\n「按标题、核心观点、操作步骤、结尾提问的顺序输出。」\n\n收藏这张提问清单：\n目标 ＋ 背景 ＋ 限制 ＋ 格式' },
  ],
  mode: 'template',
  createdAt: new Date().toISOString(),
  theme: 'butter',
  brand: 'AI 有点意思',
  format: 'portrait',
};

function readJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function validProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const p = value as Project;
  return typeof p.id === 'string' && typeof p.title === 'string' && typeof p.caption === 'string' && Array.isArray(p.tags) && Array.isArray(p.cards) && p.cards.length > 0 && p.cards.length <= 8 && p.cards.every(c => c && typeof c.title === 'string' && typeof c.body === 'string' && typeof c.id === 'string') && ['butter', 'ink', 'lavender', 'mint'].includes(p.theme) && ['portrait', 'square'].includes(p.format);
}

export function loadDraft(): Project {
  const value = readJson(DRAFT_KEY);
  return validProject(value) ? value : structuredClone(initialProject);
}

export function persistDraft(project: Project) { localStorage.setItem(DRAFT_KEY, JSON.stringify(project)); }
export function loadProjects(): Project[] {
  const value = readJson(PROJECTS_KEY);
  return Array.isArray(value) ? value.filter(validProject) : [];
}
export function persistProjects(projects: Project[]) { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); }
