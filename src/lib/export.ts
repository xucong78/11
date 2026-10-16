import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { toPng } from 'html-to-image';
import JSZip from 'jszip';
import KnowledgeCard from '../components/KnowledgeCard';
import type { CardAppearance, CardProject } from '../card-types';

function safeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 70) || 'AI 图文';
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Keep the URL alive long enough for browsers to start their download.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function renderCard(project: CardProject, index: number, options: CardAppearance): Promise<string> {
  const card = project.cards[index];
  if (!card) throw new Error('找不到要导出的卡片。');
  const host = document.createElement('div');
  const height = options.format === 'square' ? 1080 : 1440;
  Object.assign(host.style, { position: 'fixed', top: '0', left: '-12000px', width: '1080px', height: `${height}px`, pointerEvents: 'none', zIndex: '-1' });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(KnowledgeCard, { card, index, total: project.cards.length, ...options })));
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const node = host.firstElementChild;
    if (!(node instanceof HTMLElement)) throw new Error('卡片渲染失败，请重试。');
    return await toPng(node, { width: 1080, height, pixelRatio: 1, cacheBust: false, skipFonts: true, canvasWidth: 1080, canvasHeight: height, style: { transform: 'none', margin: '0' } });
  } finally {
    root.unmount();
    host.remove();
  }
}

function captionFile(project: CardProject): string {
  const tags = project.tags?.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ') || '';
  return `${project.title}\n\n${project.caption || ''}${tags ? `\n\n${tags}` : ''}\n\n—— 图文内容 ——\n\n${project.cards.map((card, index) => `${String(index + 1).padStart(2, '0')} / ${card.title}\n${card.body}`).join('\n\n')}\n`;
}

/** Export every card at its original 1080px resolution, together with an editable text caption. */
export async function exportCards(project: CardProject, options: CardAppearance): Promise<void> {
  if (!project.cards.length) throw new Error('请先生成图文，再导出。');
  const zip = new JSZip();
  const name = safeFilename(project.title);
  // Render sequentially to keep memory use predictable on mobile browsers.
  for (let index = 0; index < project.cards.length; index += 1) {
    const dataUrl = await renderCard(project, index, options);
    zip.file(`${String(index + 1).padStart(2, '0')}-${index === 0 ? '封面' : '知识卡片'}.png`, dataUrl.substring(dataUrl.indexOf(',') + 1), { base64: true });
  }
  zip.file('发布文案.txt', captionFile(project));
  const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
  download(archive, `${name}-图文素材.zip`);
}

/** Export one card as a full-resolution PNG. Index is zero-based. */
export async function exportSingleCard(project: CardProject, index: number, options: CardAppearance): Promise<void> {
  const dataUrl = await renderCard(project, index, options);
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  download(blob, `${safeFilename(project.title)}-${String(index + 1).padStart(2, '0')}.png`);
}
