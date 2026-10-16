import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, BookOpen, Check,
  CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, ExternalLink,
  FileText, FolderOpen, Grid2X2, HelpCircle, ImagePlus, Layers, Lightbulb, LoaderCircle,
  MessageCircle, MoreHorizontal, Palette, PencilLine, Plus, RefreshCw, Save, Settings2,
  Sparkles, Trash2, WandSparkles, X, Zap,
} from 'lucide-react';
import type { Card, CardFormat, ThemeId } from './card-types';
import type { ModelSettings, Project } from './types';
import KnowledgeCard from './components/KnowledgeCard';
import { exportCards, exportSingleCard } from './lib/export';
import { initialProject, loadDraft, loadProjects, persistDraft, persistProjects } from './lib/projects';

const themes: { id: ThemeId; name: string; color: string; ink: string }[] = [
  { id: 'butter', name: '日光奶油', color: '#f8df76', ink: '#242826' },
  { id: 'ink', name: '极简深墨', color: '#252c32', ink: '#eff2ed' },
  { id: 'lavender', name: '灵感淡紫', color: '#ded5f2', ink: '#464050' },
  { id: 'mint', name: '清新薄荷', color: '#cfe7dc', ink: '#28433a' },
];
const ideas = [
  { category: '实用技巧', title: '为什么你问 ChatGPT，它总说一些空话？', desc: '4 个提问技巧，让 AI 真正帮到你', icon: MessageCircle, color: 'orange' },
  { category: '入门科普', title: 'AI 为什么会一本正经地胡说八道？', desc: '用日常例子，认识大模型的「幻觉」', icon: Lightbulb, color: 'purple' },
  { category: '效率提升', title: '上班族可以怎样用 AI 节省时间？', desc: '从邮件、会议记录到方案提纲', icon: Zap, color: 'green' },
  { category: '入门科普', title: '智能体和普通聊天机器人有什么区别？', desc: '从「给你建议」到「帮你做事」', icon: Layers, color: 'blue' },
  { category: '交流讨论', title: 'AI 回答得很自信，就一定正确吗？', desc: '哪些内容值得查证，哪些交给自己判断', icon: MessageCircle, color: 'purple' },
  { category: '实用技巧', title: '怎样用 AI 学习一个陌生领域？', desc: '让 AI 帮你拆问题、找例子、做练习', icon: BookOpen, color: 'orange' },
];

function CardPreview({ card, index, project, className = '' }: { card: Card; index: number; project: Project; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`scaled-card ${className}`} style={{ aspectRatio: project.format === 'square' ? '1' : '3 / 4' }}>
    <div style={{ width: 1080, height: project.format === 'square' ? 1080 : 1440, transform: `scale(${width / 1080})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0 }}>
      <KnowledgeCard card={card} index={index} total={project.cards.length} theme={project.theme} brand={project.brand} format={project.format} />
    </div>
  </div>;
}

function Modal({ title, subtitle, onClose, children, className = '' }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]')].filter(el => !el.hasAttribute('disabled'));
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={dialog} tabIndex={-1}>
      <button className="icon-button modal-close" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button>
      <div className="modal-symbol"><Sparkles size={23} /></div>
      <h2>{title}</h2>{subtitle && <p className="modal-subtitle">{subtitle}</p>}{children}
    </div>
  </div>;
}

export default function App() {
  const [project, setProject] = useState<Project>(loadDraft);
  const [saved, setSaved] = useState<Project[]>(loadProjects);
  const [view, setView] = useState<'studio' | 'projects' | 'ideas'>('studio');
  const [topic, setTopic] = useState(project.topic);
  const [audience, setAudience] = useState('入门小白');
  const [tone, setTone] = useState('通俗易懂');
  const [pageCount, setPageCount] = useState(5);
  const [activeCard, setActiveCard] = useState(0);
  const [editingTab, setEditingTab] = useState<'caption' | 'card'>('caption');
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [settings, setSettings] = useState<ModelSettings>({ configured: false, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', mode: 'template' });
  const [modal, setModal] = useState<'settings' | 'help' | 'preview' | 'delete' | null>(null);
  const [settingsForm, setSettingsForm] = useState({ baseUrl: '', model: '', apiKey: '' });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [draftStatus, setDraftStatus] = useState<'saving' | 'saved' | 'error'>('saved');
  const [toast, setToast] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [ideaOffset, setIdeaOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState('');

  useEffect(() => {
    fetch('/api/settings').then(async r => { if (r.ok) setSettings(await r.json()); }).catch(() => {});
  }, []);
  useEffect(() => {
    setDraftStatus('saving');
    const timer = setTimeout(() => {
      try { persistDraft(project); setDraftStatus('saved'); } catch { setDraftStatus('error'); }
    }, 450);
    return () => clearTimeout(timer);
  }, [project]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  const card = project.cards[Math.min(activeCard, project.cards.length - 1)];
  const cardIndex = Math.min(activeCard, project.cards.length - 1);
  const patch = (data: Partial<Project>) => setProject(p => ({ ...p, ...data, updatedAt: new Date().toISOString() }));
  function patchCard(data: Partial<Card>) {
    patch({ cards: project.cards.map((c, i) => i === cardIndex ? { ...c, ...data } : c) });
  }
  function openSettings() {
    setSettingsForm({ baseUrl: settings.baseUrl || 'https://api.deepseek.com/v1', model: settings.model || 'deepseek-chat', apiKey: '' });
    setSettingsError(''); setModal('settings');
  }
  async function saveSettings(mode: 'ai' | 'template' = 'ai') {
    setSettingsSaving(true); setSettingsError('');
    try {
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mode === 'template' ? { mode: 'template' } : settingsForm) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '设置保存失败，请稍后重试');
      setSettings(result); setSettingsForm(f => ({ ...f, apiKey: '' })); setModal(null);
      setToast(mode === 'template' ? '已切换到本地模板' : '模型配置已保存，可以开始生成了');
    } catch (error) { setSettingsError(error instanceof Error ? error.message : '无法连接服务，请检查服务是否运行'); }
    finally { setSettingsSaving(false); }
  }
  async function generate() {
    if (!topic.trim()) { setGenerateError('先写下一个你想分享的选题吧'); return; }
    setGenerating(true); setGenerateError('');
    try {
      const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: topic.trim(), audience, tone, pageCount }), signal: AbortSignal.timeout(150000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '生成失败，请稍后重试');
      const next: Project = { ...result.project, theme: project.theme, format: project.format, brand: project.brand };
      if (!next.cards?.length) throw new Error('没有收到可用的知识卡片，请重新生成');
      setProject(next); setActiveCard(0); setEditingTab('caption');
      setToast(`${next.cards.length} 页图文已生成${next.mode === 'template' ? ' · 本地模板' : ''}`);
    } catch (error) { setGenerateError(error instanceof Error ? error.message : '生成失败，请检查连接后重试'); }
    finally { setGenerating(false); }
  }
  function saveProject() {
    const updated = { ...project, updatedAt: new Date().toISOString() };
    const next = [updated, ...saved.filter(p => p.id !== project.id)];
    try { persistProjects(next); setSaved(next); setToast('已保存到「我的作品」'); }
    catch { setToast('浏览器存储空间不足，请先下载图文保存'); }
  }
  async function download(single = false) {
    if (exporting) return;
    setExporting(true);
    try {
      const options = { theme: project.theme, brand: project.brand, format: project.format };
      if (single) await exportSingleCard(project, cardIndex, options);
      else await exportCards(project, options);
      setToast(single ? '当前卡片已导出' : '图文包已导出，包含全部图片和发布文案');
    } catch { setToast('图片导出失败，请关闭预览后重试'); }
    finally { setExporting(false); }
  }
  async function copyCaption() {
    const text = `${project.title}\n\n${project.caption}\n\n${project.tags.map(t => '#' + t).join(' ')}`;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const el = document.createElement('textarea'); el.value = text; document.body.append(el); el.select();
        const ok = document.execCommand('copy'); el.remove(); if (!ok) throw new Error('copy');
      }
      setToast('标题、正文和话题已复制');
    } catch { setToast('当前浏览器不支持复制，请选中文案手动复制'); }
  }
  function addTag() {
    const tag = tagInput.replace(/^#+/, '').trim();
    if (tag && !project.tags.includes(tag) && project.tags.length < 10) { patch({ tags: [...project.tags, tag.slice(0, 20)] }); setTagInput(''); }
  }
  function addCard() {
    if (project.cards.length >= 8) return;
    patch({ cards: [...project.cards, { id: crypto.randomUUID(), kind: 'content', eyebrow: '写下一个小知识', title: '一个值得\n分享的观点。', body: '在右侧「卡片内容」中，写下你的解释和例子。' }] });
    setActiveCard(project.cards.length); setEditingTab('card');
  }
  function moveCard(direction: number) {
    const next = cardIndex + direction;
    if (next < 0 || next >= project.cards.length) return;
    const cards = [...project.cards]; [cards[cardIndex], cards[next]] = [cards[next], cards[cardIndex]];
    patch({ cards }); setActiveCard(next);
  }
  function newProject() {
    const fresh = structuredClone(initialProject);
    fresh.id = crypto.randomUUID(); fresh.createdAt = new Date().toISOString();
    fresh.topic = ''; fresh.title = '未命名图文'; fresh.caption = ''; fresh.tags = [];
    fresh.brand = project.brand;
    fresh.cards = [
      { id: crypto.randomUUID(), kind: 'cover', eyebrow: '让知识变得有意思', title: '你的好想法，\n值得被看见。', body: '从一个选题开始\n做出你的第一篇知识图文' },
      { id: crypto.randomUUID(), kind: 'content', eyebrow: '核心观点', title: '把复杂的事，\n讲得简单一点。', body: '在左侧输入选题，生成后可以自由修改每一页内容。' },
      { id: crypto.randomUUID(), kind: 'outro', eyebrow: '一起聊聊', title: '关于 AI，\n你还想知道什么？', body: '留下一个好问题，\n下一篇图文就从这里开始。' },
    ];
    setProject(fresh); setTopic(''); setActiveCard(0); setGenerateError(''); setView('studio');
  }
  function useIdea(title: string) { setTopic(title); setView('studio'); setGenerateError(''); setToast('选题已填入，点击「生成图文」开始创作'); }
  function deleteProject() {
    try { const next = saved.filter(p => p.id !== deleteId); persistProjects(next); setSaved(next); setModal(null); setToast('作品已删除'); }
    catch { setToast('删除失败，请检查浏览器存储权限'); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setView('studio')} aria-label="知页首页"><span className="brand-mark"><BookOpen size={23} strokeWidth={2.2} /></span><span>知页<span className="brand-en">KNOWPAGE</span></span></button>
      <div className="workspace-label">你的创作空间 <span>个人版</span></div>
      <nav className="main-nav" aria-label="主导航">
        <button className={view === 'studio' ? 'active' : ''} onClick={() => setView('studio')}><Grid2X2 size={18} />图文创作<span className="nav-current" /></button>
        <button className={view === 'projects' ? 'active' : ''} onClick={() => setView('projects')}><FolderOpen size={18} />我的作品{saved.length > 0 && <span className="nav-count">{saved.length}</span>}</button>
        <button className={view === 'ideas' ? 'active' : ''} onClick={() => setView('ideas')}><Lightbulb size={18} />灵感选题<span className="new-dot" /></button>
      </nav>
      <div className="sidebar-note"><span className="note-sparkle">✳</span><p>让知识，<br />多一点被看见的可能。</p><span>ONE IDEA, MANY POSSIBILITIES.</span><svg viewBox="0 0 130 50" aria-hidden="true"><path d="M3 39c18-23 33 4 52-15S89 5 109 19m-7-16 9 18-21-1" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></div>
      <div className="sidebar-bottom"><button onClick={() => setModal('help')}><HelpCircle size={17} />使用指南<ExternalLink size={13} /></button><button className="creator-profile" onClick={openSettings}><span className="avatar">知</span><span>AI 科普创作者<small>让好内容持续发生</small></span><MoreHorizontal size={17} /></button></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs">工作空间 <ChevronRight size={13} /><span>{view === 'studio' ? '图文创作' : view === 'projects' ? '我的作品' : '灵感选题'}</span></div><div className="topbar-right"><span className="draft-status"><span className={`status-dot ${draftStatus === 'error' ? 'error' : ''}`} />{draftStatus === 'saving' ? '正在保存…' : draftStatus === 'error' ? '草稿保存失败' : '草稿已自动保存'}</span><span className="topbar-divider" /><button className="model-button" onClick={openSettings}><Settings2 size={15} />{settings.mode === 'ai' ? 'AI 已配置' : '连接 AI 模型'}</button><span className="top-avatar">知</span></div></header>

      <div className="page-content">
        {view === 'studio' && <>
          <section className="page-heading"><div><div className="eyebrow"><span />从灵感，到分享</div><h1>把好想法，变成好内容<span>。</span></h1><p>专注你的想法，剩下的交给知页。轻松创作 AI 科普图文。</p></div><button className="button button-white new-project" onClick={newProject}><Plus size={16} />新建图文</button></section>

          <div className="studio-grid">
            <section className="panel creation-panel">
              <div className="panel-heading"><h2><span className="step-number">01</span>创作设置</h2><WandSparkles size={17} className="muted" /></div>
              <div className="creation-body">
                <label className="field-label" htmlFor="topic">今天，想分享什么？<span className="required-dot">*</span></label>
                <div className={`topic-input ${generateError && !topic.trim() ? 'invalid' : ''}`}><textarea id="topic" value={topic} onChange={e => { setTopic(e.target.value); setGenerateError(''); }} maxLength={200} placeholder="例如：为什么你问 ChatGPT，它总说一些空话？" /><span>{topic.length}/200</span></div>
                <div className="suggestion-header"><span><Sparkles size={12} />试试这些灵感</span><button onClick={() => setIdeaOffset(n => (n + 2) % ideas.length)} aria-label="换一批灵感"><RefreshCw size={12} />换一批</button></div>
                <div className="suggestion-chips">{[ideas[ideaOffset], ideas[(ideaOffset + 1) % ideas.length]].map(idea => <button key={idea.title} onClick={() => { setTopic(idea.title); setGenerateError(''); }}>{idea.title}<ArrowRight size={12} /></button>)}</div>
                <div className="form-divider" />
                <div className="form-group"><label className="field-label">你的读者是谁？</label><div className="audience-options">{['入门小白', '职场人', '内容创作者'].map(item => <button key={item} className={audience === item ? 'selected' : ''} onClick={() => setAudience(item)}>{item}</button>)}</div></div>
                <div className="form-group"><label className="field-label" htmlFor="tone">表达风格</label><div className="select-wrap"><MessageCircle size={15} /><select id="tone" value={tone} onChange={e => setTone(e.target.value)}><option>通俗易懂</option><option>专业严谨</option><option>轻松有趣</option></select><ChevronDown size={14} /></div></div>
                <div className="form-group"><label className="field-label">图文页数<span className="label-note">含封面</span></label><div className="page-options">{[3, 5, 6, 8].map(n => <button key={n} className={pageCount === n ? 'selected' : ''} onClick={() => setPageCount(n)}>{n}<span>页</span></button>)}</div></div>
                {generateError && <div className="inline-error" role="alert">{generateError}</div>}
                <button className="button button-primary generate-button" onClick={generate} disabled={generating}>{generating ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}{generating ? '正在组织知识点…' : '生成图文'}{!generating && <span>↗</span>}</button>
                <p className="generation-note">{settings.mode === 'ai' ? <><span className="status-dot" />AI 模式 · 生成后可自由编辑</> : <>当前为本地模板 · <button onClick={openSettings}>连接 AI 解锁更多选题</button></>}</p>
              </div>
              <div className="creation-tip"><Lightbulb size={17} /><p>好选题的小秘诀<span>一个具体问题，比一个宽泛话题更好。</span></p></div>
            </section>

            <section className="panel preview-panel">
              <div className="panel-heading"><h2><span className="step-number">02</span>图文预览<span className="small-badge">{project.cards.length} 页</span></h2><button className="icon-button" aria-label="放大预览" title="放大预览" onClick={() => setModal('preview')}><Layers size={17} /></button></div>
              <div className="preview-stage">
                <div className="preview-topline"><span><span className="live-dot" />实时预览</span><button onClick={() => { setEditingTab('card'); }}><PencilLine size={12} />编辑当前页</button></div>
                <div className="preview-artboard"><CardPreview card={card} index={cardIndex} project={project} /></div>
                <div className="preview-bottomline"><span>{project.format === 'portrait' ? '1080 × 1440' : '1080 × 1080'} PX</span><div><button className="icon-button" onClick={() => setActiveCard(i => Math.max(0, i - 1))} disabled={cardIndex === 0} aria-label="上一页"><ChevronLeft size={16} /></button><b>{String(cardIndex + 1).padStart(2, '0')}</b><span> / {String(project.cards.length).padStart(2, '0')}</span><button className="icon-button" onClick={() => setActiveCard(i => Math.min(project.cards.length - 1, i + 1))} disabled={cardIndex === project.cards.length - 1} aria-label="下一页"><ChevronRight size={16} /></button></div></div>
              </div>
              <div className="thumbnail-section"><div className="thumbnails">{project.cards.map((c, i) => <button key={c.id} aria-label={`查看第 ${i + 1} 页`} aria-pressed={i === cardIndex} className={`thumbnail ${i === cardIndex ? 'active' : ''}`} onClick={() => setActiveCard(i)}><CardPreview card={c} index={i} project={project} /><span className="thumbnail-number">{i + 1 === 1 ? '封面' : String(i + 1).padStart(2, '0')}</span></button>)}{project.cards.length < 8 && <button className="add-page" onClick={addCard} aria-label="新增页面"><Plus size={17} /><span>加一页</span></button>}</div></div>
              <div className="appearance-section"><div className="appearance-row"><span className="mini-label"><Palette size={14} />卡片配色</span><div className="theme-options">{themes.map(t => <button key={t.id} title={t.name} aria-label={t.name} aria-pressed={project.theme === t.id} className={project.theme === t.id ? 'active' : ''} style={{ '--swatch': t.color, '--swatch-ink': t.ink } as CSSProperties} onClick={() => patch({ theme: t.id })}>{project.theme === t.id && <Check size={12} />}</button>)}</div><span className="theme-name">{themes.find(t => t.id === project.theme)?.name}</span></div><div className="appearance-row"><label className="mini-label" htmlFor="brand">账号署名</label><input id="brand" aria-label="账号署名" maxLength={16} value={project.brand} onChange={e => patch({ brand: e.target.value })} /><div className="format-switch" aria-label="图片比例">{(['portrait', 'square'] as CardFormat[]).map(format => <button key={format} className={project.format === format ? 'active' : ''} onClick={() => patch({ format })}>{format === 'portrait' ? '3:4' : '1:1'}</button>)}</div></div></div>
            </section>

            <section className="panel caption-panel">
              <div className="panel-heading"><h2><span className="step-number">03</span>编辑与导出</h2><FileText size={17} className="muted" /></div>
              <div className="editor-tabs"><button className={editingTab === 'caption' ? 'active' : ''} onClick={() => setEditingTab('caption')}>发布文案</button><button className={editingTab === 'card' ? 'active' : ''} onClick={() => setEditingTab('card')}>卡片内容</button></div>
              <div className="editor-body">{editingTab === 'caption' ? <>
                <div className="editor-label"><label htmlFor="post-title">图文标题</label><span>{project.title.length}/100</span></div><textarea id="post-title" className="post-title" maxLength={100} value={project.title} onChange={e => patch({ title: e.target.value })} rows={2} />
                <div className="editor-label"><label htmlFor="caption">正文</label><button onClick={copyCaption}><Copy size={12} />复制全部</button></div><textarea id="caption" className="caption-textarea" maxLength={2000} value={project.caption} onChange={e => patch({ caption: e.target.value })} placeholder="在这里写下你的发布文案…" /><div className="textarea-count">{project.caption.length}/2000</div>
                <div className="editor-label"><label htmlFor="tag-input">话题标签</label><span>{project.tags.length}/10</span></div><div className="tags">{project.tags.map(tag => <span className="tag" key={tag}>#{tag}<button aria-label={`删除标签 ${tag}`} onClick={() => patch({ tags: project.tags.filter(t => t !== tag) })}><X size={10} /></button></span>)}</div>{project.tags.length < 10 && <div className="tag-input-row"><input id="tag-input" placeholder="添加话题，按回车确认" maxLength={20} value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} /><button className="icon-button" onClick={addTag} disabled={!tagInput.trim()} aria-label="添加标签"><Plus size={14} /></button></div>}
              </> : <>
                <div className="card-edit-header"><span>第 {cardIndex + 1} 页 · {card.kind === 'cover' ? '封面' : card.kind === 'outro' ? '结尾页' : '知识页'}</span><div><button className="icon-button" onClick={() => moveCard(-1)} disabled={cardIndex === 0} title="前移" aria-label="前移卡片"><ArrowUp size={14} /></button><button className="icon-button" onClick={() => moveCard(1)} disabled={cardIndex === project.cards.length - 1} title="后移" aria-label="后移卡片"><ArrowDown size={14} /></button><button className="icon-button danger" onClick={() => { patch({ cards: project.cards.filter((_, i) => i !== cardIndex) }); setActiveCard(i => Math.max(0, i - 1)); }} disabled={project.cards.length <= 2} title="删除当前页" aria-label="删除当前页"><Trash2 size={14} /></button></div></div>
                <label className="field-label" htmlFor="card-kind">页面类型</label><select id="card-kind" className="plain-select" value={card.kind} onChange={e => patchCard({ kind: e.target.value as Card['kind'] })}><option value="cover">封面</option><option value="content">知识页</option><option value="outro">结尾页</option></select>
                <label className="field-label" htmlFor="card-eyebrow">顶部小标题</label><input id="card-eyebrow" className="text-input" value={card.eyebrow} maxLength={30} onChange={e => patchCard({ eyebrow: e.target.value })} />
                <div className="editor-label"><label htmlFor="card-title">卡片标题</label><span>{card.title.length}/48</span></div><textarea id="card-title" className="card-title-input" value={card.title} maxLength={48} onChange={e => patchCard({ title: e.target.value })} rows={3} /><p className="input-hint">换行可以调整标题的排版节奏</p>
                <div className="editor-label"><label htmlFor="card-body">卡片正文</label><span>{card.body.length}/260</span></div><textarea id="card-body" className="card-body-input" value={card.body} maxLength={260} onChange={e => patchCard({ body: e.target.value })} /><p className="input-hint">内容越精炼，手机上越容易阅读</p>
              </>}</div>
              <div className="export-section"><div className="export-info"><span className="export-icon"><ImagePlus size={17} /></span><div>为分享准备就绪<small>高清 PNG 图片 ＋ 完整发布文案</small></div><CheckCheck size={17} /></div><div className="export-buttons"><button className="button button-primary" onClick={() => download()} disabled={exporting}>{exporting ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}{exporting ? '正在导出…' : '下载全部图文'}</button><button className="button button-white save-button" onClick={saveProject} aria-label="保存作品" title="保存到我的作品"><Save size={17} /></button></div><button className="single-download" onClick={() => download(true)} disabled={exporting}>只下载当前页<ArrowDownToLine size={12} /></button></div>
            </section>
          </div>
          <footer className="studio-footer"><span><span className="footer-sparkle">✳</span>不止生成内容，更让知识有温度。</span><span>为 AI 科普创作者而造 <span className="footer-dot">·</span> KNOWPAGE STUDIO</span></footer>
        </>}

        {view === 'projects' && <><section className="page-heading"><div><div className="eyebrow"><span />每一次创作，都值得留下</div><h1>你的好内容，都在这里<span>。</span></h1><p>作品保存在当前浏览器，随时回来继续打磨。</p></div><button className="button button-primary" onClick={newProject}><Plus size={16} />新建图文</button></section><div className="collection-toolbar"><h2>全部作品 <span>{saved.length}</span></h2><input aria-label="搜索作品" placeholder="搜索作品标题…" value={search} onChange={e => setSearch(e.target.value)} /></div>{saved.length === 0 ? <div className="empty-state"><FolderOpen size={38} /><h2>你的第一篇好内容，正在路上。</h2><p>在创作工作台点击保存，作品就会出现在这里。</p><button className="button button-primary" onClick={() => setView('studio')}>去创作<ArrowRight size={16} /></button></div> : <div className="projects-grid">{saved.filter(p => p.title.toLowerCase().includes(search.toLowerCase())).map(p => <article className="project-tile" key={p.id}><button className="project-thumbnail" aria-label={`打开作品 ${p.title}`} onClick={() => { setProject(structuredClone(p)); setTopic(p.topic); setActiveCard(0); setView('studio'); }}><CardPreview card={p.cards[0]} index={0} project={p} /></button><div className="project-tile-info"><h3>{p.title}</h3><p>{p.cards.length} 页图文<span>·</span>{new Date(p.updatedAt || p.createdAt).toLocaleDateString('zh-CN')}</p><button className="icon-button" aria-label={`删除作品 ${p.title}`} onClick={() => { setDeleteId(p.id); setModal('delete'); }}><Trash2 size={15} /></button></div></article>)}{saved.filter(p => p.title.toLowerCase().includes(search.toLowerCase())).length === 0 && <p className="no-results">没有找到这个标题，换个关键词试试。</p>}</div>}</>}

        {view === 'ideas' && <><section className="page-heading"><div><div className="eyebrow"><span />从一个好问题开始</div><h1>今天，分享一点新知<span>。</span></h1><p>为 AI 科普与交流准备的选题，把复杂的事情讲明白。</p></div><span className="curated-badge"><Sparkles size={14} />编辑精选 · 非实时热点</span></section><div className="idea-feature"><div><span>本期推荐 / PROMPTING</span><h2>好答案，<br />从好问题开始。</h2><p>AI 不是读心术。试着把你的目标，讲得更具体一点。</p><button className="button button-dark" onClick={() => useIdea(ideas[0].title)}>用这个选题创作<ArrowRight size={16} /></button></div><div className="idea-illustration" aria-hidden="true"><span className="idea-orbit" /><span className="idea-bubble">一个好问题<span>↗</span></span><span className="idea-small-bubble">Aha! ✦</span><span className="idea-star">✳</span></div></div><h2 className="section-title">下一篇，可以聊聊这些 <span>6 个创作起点</span></h2><div className="ideas-grid">{ideas.map(idea => <button className="idea-tile" key={idea.title} onClick={() => useIdea(idea.title)}><span className={`idea-icon ${idea.color}`}><idea.icon size={20} /></span><span className="idea-category">{idea.category}</span><h3>{idea.title}</h3><p>{idea.desc}</p><span className="idea-cta">开始创作<ArrowRight size={15} /></span></button>)}</div></>}
      </div>
    </main>

    {modal === 'settings' && <Modal title="让 AI 成为你的创作搭档" subtitle="连接模型，自由探索每一个新选题。" onClose={() => { setModal(null); setSettingsForm(f => ({ ...f, apiKey: '' })); }}>
      <div className="settings-mode"><span className={`status-dot ${settings.mode !== 'ai' ? 'neutral' : ''}`} />当前模式：{settings.mode === 'ai' ? 'AI 生成' : '本地模板体验'}</div><div className="provider-options"><button onClick={() => setSettingsForm(f => ({ ...f, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }))}>DeepSeek</button><button onClick={() => setSettingsForm(f => ({ ...f, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }))}>OpenAI</button><span>支持兼容接口</span></div>
      <form onSubmit={e => { e.preventDefault(); saveSettings(); }}><label className="field-label" htmlFor="api-base">接口地址</label><input id="api-base" className="text-input" value={settingsForm.baseUrl} onChange={e => setSettingsForm(f => ({ ...f, baseUrl: e.target.value }))} placeholder="https://api.deepseek.com/v1" required /><label className="field-label" htmlFor="api-model">模型名称</label><input id="api-model" className="text-input" value={settingsForm.model} onChange={e => setSettingsForm(f => ({ ...f, model: e.target.value }))} placeholder="deepseek-chat" required /><label className="field-label" htmlFor="api-key">API Key {settings.configured && <span className="label-note">留空保留现有密钥</span>}</label><input id="api-key" className="text-input" type="password" autoComplete="off" value={settingsForm.apiKey} onChange={e => setSettingsForm(f => ({ ...f, apiKey: e.target.value }))} placeholder={settings.configured ? '已配置 · 不显示密钥' : '填写模型服务商提供的密钥'} required={!settings.configured} /><p className="input-hint settings-hint">密钥只保存在服务端内存，重启后需重新填写。模型调用可能产生服务商费用。</p>{settingsError && <div className="inline-error" role="alert">{settingsError}</div>}<button type="submit" className="button button-primary settings-submit" disabled={settingsSaving}>{settingsSaving ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}保存并启用 AI</button></form><button className="template-mode-button" onClick={() => saveSettings('template')} disabled={settingsSaving}>继续使用本地模板<ArrowRight size={14} /></button>
    </Modal>}
    {modal === 'help' && <Modal title="从一个问题，到一篇好图文" subtitle="你的第一篇 AI 科普，只需要这几步。" onClose={() => setModal(null)}><div className="help-steps">{[['写下选题', '输入一个具体问题，选择读者、表达风格和页数。'], ['生成，再打磨', '本地模板可以直接体验；连接 AI 后生成新选题。标题、正文和每页内容都能修改。'], ['换上你的风格', '选择配色、图片比例，填入你的账号署名。'], ['下载，去分享', '下载 ZIP 获取全部高清图片和文案，也可以只下载当前页。保存的作品留在当前浏览器。']].map(([title, text], i) => <div key={title}><span>{i + 1}</span><section><h3>{title}</h3><p>{text}</p></section></div>)}</div><div className="help-note">当前版本专注图文制作，尚未接入抖音账号和自动发布。发布前请核对科普内容中的事实、来源与时效。</div><button className="button button-primary settings-submit" onClick={() => setModal(null)}>开始我的创作<ArrowRight size={16} /></button></Modal>}
    {modal === 'preview' && <Modal title="看看这页的完整样子" onClose={() => setModal(null)} className="preview-modal"><CardPreview card={card} index={cardIndex} project={project} /><div className="preview-modal-nav"><button className="icon-button" aria-label="预览上一页" disabled={cardIndex === 0} onClick={() => setActiveCard(i => i - 1)}><ChevronLeft size={20} /></button><span>第 {cardIndex + 1} / {project.cards.length} 页</span><button className="icon-button" aria-label="预览下一页" disabled={cardIndex === project.cards.length - 1} onClick={() => setActiveCard(i => i + 1)}><ChevronRight size={20} /></button></div></Modal>}
    {modal === 'delete' && <Modal title="删除这篇作品？" subtitle="删除后无法恢复，已下载的文件不受影响。" onClose={() => setModal(null)}><div className="confirm-buttons"><button className="button button-white" onClick={() => setModal(null)}>再想想</button><button className="button button-danger" onClick={deleteProject}><Trash2 size={15} />确认删除</button></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}
