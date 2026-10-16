import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { Card, CardFormat, ThemeId } from '../card-types';

export interface KnowledgeCardProps {
  card: Card;
  index: number;
  total: number;
  theme: ThemeId;
  brand: string;
  format?: CardFormat;
}

const palettes = {
  butter: { background: '#f5df79', foreground: '#24251f', accent: '#e66c43', paper: '#fffbed', line: '#b8a753', muted: '#665f36' },
  ink: { background: '#252820', foreground: '#f6efd9', accent: '#e6de7f', paper: '#414635', line: '#60644d', muted: '#c3c5ad' },
  lavender: { background: '#e5ddf8', foreground: '#302a3d', accent: '#8a6bc9', paper: '#fbf8ff', line: '#b5a7cf', muted: '#70647e' },
  mint: { background: '#d5e9d8', foreground: '#283a30', accent: '#3d7c60', paper: '#f7fcf4', line: '#9fbba6', muted: '#5e7665' },
};

function textWidthUnits(text: string) {
  return Array.from(text).reduce((width, character) => width + (/[\x00-\x7f]/.test(character) ? .55 : 1), 0);
}

function estimatedLines(text: string, width: number, fontSize: number) {
  return text.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(textWidthUnits(line) * fontSize / width)), 0);
}

function Spark({ color, size = 62, style }: { color: string; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 80 80" style={style}><path d="M40 4L47 31L74 40L47 48L40 76L32 48L5 40L32 31Z" fill={color} /></svg>;
}

function ConversationArt({ theme, square }: { theme: ThemeId; square: boolean }) {
  const p = palettes[theme];
  return (
    <div data-feature-decoration aria-hidden="true" style={{ width: '100%', marginTop: 'auto', height: square ? 265 : 410, flexShrink: 0 }}>
      <svg width="100%" height="100%" viewBox="0 0 928 410" style={{ overflow: 'visible' }}>
        <path d="M106 111C182 72 279 80 322 132" fill="none" stroke={p.foreground} strokeWidth="4" strokeLinecap="round" strokeDasharray="10 13" />
        <path d="M310 108L329 138L295 143" fill="none" stroke={p.foreground} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <g transform="translate(346 34) rotate(-7 180 124)">
          <rect x="9" y="12" width="350" height="231" rx="43" fill={p.foreground} />
          <path d="M40 0H307Q350 0 350 43V171Q350 213 307 213H119L67 258L75 213H43Q0 213 0 171V43Q0 0 40 0Z" fill={p.paper} stroke={p.foreground} strokeWidth="4" />
          <text x="175" y="133" textAnchor="middle" fill={p.foreground} fontFamily="Arial, sans-serif" fontWeight="800" fontSize="98" letterSpacing="-8">GPT</text>
        </g>
        <g transform="translate(54 196) rotate(5 155 80)">
          <rect x="0" y="0" width="310" height="144" rx="38" fill={p.accent} stroke={p.foreground} strokeWidth="4" />
          <path d="M238 141L257 174L199 144" fill={p.accent} stroke={p.foreground} strokeWidth="4" strokeLinejoin="round" />
          <circle cx="91" cy="72" r="12" fill={theme === 'ink' ? p.background : p.paper} />
          <circle cx="155" cy="72" r="12" fill={theme === 'ink' ? p.background : p.paper} />
          <circle cx="219" cy="72" r="12" fill={theme === 'ink' ? p.background : p.paper} />
        </g>
        <g transform="translate(741 116) rotate(12)">
          <rect width="123" height="123" rx="28" fill="none" stroke={p.foreground} strokeWidth="4" />
          <path d="M29 83L83 29M36 28H84V76" fill="none" stroke={p.foreground} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <path d="M563 310C630 343 715 341 763 299" fill="none" stroke={p.foreground} strokeWidth="4" strokeLinecap="round" />
        <path d="M748 287L770 295L762 318" fill="none" stroke={p.foreground} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M171 23V59M153 41H189M811 336V374M792 355H831" stroke={p.foreground} strokeWidth="4" strokeLinecap="round" />
        <circle cx="696" cy="369" r="7" fill={p.foreground} />
        <circle cx="27" cy="125" r="6" fill={p.foreground} />
      </svg>
    </div>
  );
}

/** Fixed-resolution artwork. Scale the outer wrapper when displaying in the editor. */
export function KnowledgeCard({ card, index, total, theme, brand, format = 'portrait' }: KnowledgeCardProps) {
  const p = palettes[theme] || palettes.butter;
  const square = format === 'square';
  const isCover = card.kind === 'cover';
  const isOutro = card.kind === 'outro';
  const featureRef = useRef<HTMLDivElement>(null);
  const paragraphs = card.body.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const titleLength = card.title.replace(/\s/g, '').length;
  const titleSize = isCover ? (square ? (titleLength > 38 ? 65 : titleLength > 22 ? 77 : 89) : titleLength > 42 ? 76 : titleLength > 24 ? 92 : 108) : (square ? (titleLength > 25 ? 56 : 64) : titleLength > 27 ? 66 : 76);
  const featureTitleSize = isCover ? titleSize : square ? 76 : 94;
  const featureBodySize = isCover ? (square ? 29 : 33) : (square ? 30 : 36);
  const featureHeight = square ? (isCover ? 789 : 784) : (isCover ? 1126 : 1098);

  useLayoutEffect(() => {
    if (!isCover && !isOutro) return;
    const section = featureRef.current;
    if (!section) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      const title = section.querySelector<HTMLElement>('[data-feature-title]');
      const body = section.querySelector<HTMLElement>('[data-feature-body]');
      const decoration = section.querySelector<HTMLElement>('[data-feature-decoration]');
      if (!title || !body) return;
      title.style.fontSize = `${featureTitleSize}px`;
      body.style.fontSize = `${featureBodySize}px`;
      if (decoration) decoration.style.display = 'none';

      // Read actual browser line wrapping. offset/scroll measurements remain
      // correct when the editor scales the whole 1080px artwork for preview.
      const fitFont = (element: HTMLElement, initialSize: number, maxHeight: number) => {
        if (element.scrollHeight <= maxHeight) return;
        let low = 1;
        let high = initialSize;
        for (let iteration = 0; iteration < 13; iteration += 1) {
          const middle = (low + high) / 2;
          element.style.fontSize = `${middle}px`;
          if (element.scrollHeight <= maxHeight) low = middle;
          else high = middle;
        }
        element.style.fontSize = `${Math.floor(low * 10) / 10}px`;
      };
      const occupiedHeight = (except?: HTMLElement) => Array.from(section.children).reduce((height, child) => {
        if (!(child instanceof HTMLElement) || child === decoration || child === except) return height;
        const style = getComputedStyle(child);
        return height + child.offsetHeight + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
      }, 0);

      fitFont(title, featureTitleSize, featureHeight * (isCover ? .44 : .40));
      const bodyStyle = getComputedStyle(body);
      const bodyMargins = (parseFloat(bodyStyle.marginTop) || 0) + (parseFloat(bodyStyle.marginBottom) || 0);
      fitFont(body, featureBodySize, Math.max(1, featureHeight - occupiedHeight(body) - bodyMargins - 18));

      if (decoration) {
        const freeSpace = featureHeight - occupiedHeight() - 24;
        const minimumDecoration = isCover ? 130 : 108;
        if (freeSpace >= minimumDecoration) {
          decoration.style.display = isCover ? 'block' : 'flex';
          decoration.style.height = `${Math.min(freeSpace, isCover ? (square ? 265 : 410) : (square ? 90 : 112))}px`;
        }
      }
    };
    fit();
    // Font loading can change Chinese glyph metrics after the first layout.
    void document.fonts?.ready.then(fit);
    return () => { cancelled = true; };
  }, [card.title, card.body, card.eyebrow, featureTitleSize, featureBodySize, featureHeight, isCover, isOutro, square]);

  let bodySize = square ? 30 : 36;
  if (!isCover && !isOutro) {
    const availableHeight = (square ? 1080 : 1440) - (square ? 200 : 220) - (64 + 43 + (square ? 40 : 66) + 34 + (square ? 22 : 30) + estimatedLines(card.title, 928, titleSize) * titleSize * 1.24 + (square ? 35 : 48));
    const textWidth = 928 - (square ? 52 : 64) - (paragraphs.length <= 3 ? (square ? 46 : 58) : 0);
    const estimateHeight = (size: number) => paragraphs.reduce((height, paragraph) => height + Math.max(estimatedLines(paragraph, textWidth, size) * size * 1.78, square ? 35 : 40) + (paragraphs.length <= 3 ? (square ? 42 : 54) : 0), 0) + Math.max(0, paragraphs.length - 1) * (square ? 20 : 29);
    while (bodySize > (square ? 22 : 26) && estimateHeight(bodySize) > availableHeight) bodySize -= 1;
  }
  const footerStyle: CSSProperties = { position: 'absolute', bottom: 53, left: 76, right: 76, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `2px solid ${p.line}`, paddingTop: 28, color: p.foreground, fontSize: 24, fontWeight: 600, letterSpacing: '.02em' };

  return (
    <article data-card-id={card.id} style={{ width: 1080, height: square ? 1080 : 1440, position: 'relative', overflow: 'hidden', boxSizing: 'border-box', backgroundColor: p.background, color: p.foreground, padding: '64px 76px', fontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Arial", sans-serif', textRendering: 'optimizeLegibility', WebkitFontSmoothing: 'antialiased' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 43, fontFamily: 'Arial, sans-serif', fontSize: 22, lineHeight: 1, fontWeight: 700, letterSpacing: '1.8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><span style={{ width: 15, height: 15, borderRadius: '50%', backgroundColor: p.foreground, display: 'block' }} />AI KNOWLEDGE</div>
        <span style={{ color: p.muted, fontSize: 19, letterSpacing: '2.5px' }}>ISSUE {String(index + 1).padStart(3, '0')}</span>
      </div>

      {isCover ? <div ref={featureRef} style={{ display: 'flex', flexDirection: 'column', marginTop: square ? 41 : 64, height: featureHeight }}>
        <div style={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', flexShrink: 0, padding: '11px 20px', border: `2px solid ${p.foreground}`, borderRadius: 999, fontSize: 23, lineHeight: 1.4, fontWeight: 600, letterSpacing: 2 }}>{card.eyebrow || 'AI 入门 · 一起学会'}</div>
        <h1 data-feature-title style={{ margin: `${square ? 25 : 32}px 0 0`, fontSize: featureTitleSize, fontWeight: 900, lineHeight: 1.2, letterSpacing: '-4px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: 922, flexShrink: 0 }}>{card.title || '把 AI 知识，\n讲得简单一点。'}</h1>
        <p data-feature-body style={{ margin: `${square ? 22 : 30}px 0 0`, maxWidth: 850, fontSize: featureBodySize, lineHeight: 1.65, color: p.muted, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flexShrink: 0 }}>{card.body}</p>
        <ConversationArt theme={theme} square={square} />
      </div> : isOutro ? <div ref={featureRef} style={{ display: 'flex', flexDirection: 'column', marginTop: square ? 46 : 92, height: featureHeight }}>
        <div style={{ display: 'inline-flex', flexShrink: 0, fontSize: 25, lineHeight: 1.4, color: p.muted, letterSpacing: 3 }}>{card.eyebrow || 'YOUR TURN / 轮到你了'}</div>
        <h1 data-feature-title style={{ margin: '38px 0 0', fontWeight: 900, fontSize: featureTitleSize, lineHeight: 1.25, letterSpacing: '-3px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: 900, flexShrink: 0 }}>{card.title}</h1>
        <div data-feature-body style={{ marginTop: square ? 34 : 50, padding: square ? '28px 32px' : '38px 42px', boxSizing: 'border-box', borderRadius: 26, backgroundColor: p.paper, border: `2px solid ${p.line}`, fontSize: featureBodySize, lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: p.foreground, flexShrink: 0 }}>{card.body}</div>
        <div data-feature-decoration style={{ display: 'flex', marginTop: 'auto', height: square ? 90 : 112, flexShrink: 0, gap: 24, alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: square ? 80 : 105, height: square ? 80 : 105, borderRadius: '50%', background: p.foreground }}><svg width="51" height="51" viewBox="0 0 48 48"><path d="M10 11H38V30H25L17 38V30H10V11Z" fill="none" stroke={p.background} strokeWidth="3" strokeLinejoin="round" /><path d="M17 20H31M17 25H26" stroke={p.background} strokeWidth="2.5" strokeLinecap="round" /></svg></span>
          <div style={{ fontSize: square ? 23 : 27, lineHeight: 1.65, fontWeight: 600 }}>欢迎在评论区聊聊<span style={{ display: 'block', fontSize: square ? 19 : 22, fontWeight: 400, color: p.muted }}>保持好奇，一起探索 AI 的可能。</span></div>
          <Spark color={p.accent} size={square ? 80 : 112} style={{ marginLeft: 'auto', marginRight: 14, transform: 'rotate(12deg)', flexShrink: 0 }} />
        </div>
      </div> : <>
        <div style={{ marginTop: square ? 40 : 66, display: 'flex', alignItems: 'center', gap: 18, color: p.muted, fontSize: square ? 23 : 25, fontWeight: 500, letterSpacing: 2 }}><span style={{ fontFamily: 'Arial, sans-serif', color: p.accent, fontSize: 28, fontWeight: 800 }}>{String(index).padStart(2, '0')}</span><span style={{ width: 34, height: 2, backgroundColor: p.line }} />{card.eyebrow || '把知识拆开讲'}</div>
        <h1 style={{ margin: `${square ? 22 : 30}px 0 ${square ? 35 : 48}px`, fontSize: titleSize, lineHeight: 1.24, letterSpacing: '-2px', fontWeight: 900, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{card.title}</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: square ? 20 : 29 }}>
          {paragraphs.map((paragraph, paragraphIndex) => {
            const cleanParagraph = paragraph.replace(/^(?:[-•·]\s*|\d+[.、)]\s*)/, '');
            return <div key={paragraphIndex} style={{ display: 'flex', gap: square ? 17 : 24, alignItems: 'flex-start', padding: paragraphs.length <= 3 ? (square ? '21px 23px' : '27px 29px') : 0, borderRadius: 20, backgroundColor: paragraphs.length <= 3 ? p.paper : 'transparent' }}>
              <span style={{ width: square ? 35 : 40, height: square ? 35 : 40, flexShrink: 0, marginTop: square ? 7 : 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', color: p.foreground, background: p.background, border: `1.5px solid ${p.line}`, fontFamily: 'Arial, sans-serif', fontSize: square ? 18 : 21, fontWeight: 700 }}>{String(paragraphIndex + 1).padStart(2, '0')}</span>
              <p style={{ margin: 0, fontSize: bodySize, lineHeight: 1.78, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontWeight: 500 }}>{cleanParagraph}</p>
            </div>;
          })}
        </div>
        <div style={{ position: 'absolute', bottom: square ? 149 : 167, left: 77, right: 77, display: 'flex', alignItems: 'center', gap: 15, color: p.muted, fontSize: 20 }}><Spark color={p.accent} size={27} /><span>让复杂的 AI，变成你能用的知识。</span></div>
      </>}

      <footer style={footerStyle}><span style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ fontSize: 25 }}>↗</span>{brand || 'AI 灵感研究所'}</span><span style={{ fontFamily: 'Arial, sans-serif', fontSize: 21, letterSpacing: 2 }}>{String(index + 1).padStart(2, '0')}<span style={{ color: p.muted }}> / {String(total).padStart(2, '0')}</span></span></footer>
    </article>
  );
}

export default KnowledgeCard;
