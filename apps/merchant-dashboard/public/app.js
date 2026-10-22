'use strict';

const $ = selector => document.querySelector(selector);
const clone = value => JSON.parse(JSON.stringify(value));
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const PENDING_KEY = 'fenbd-cloud-pending-v1';
const RECOVERY_KEY = 'fenbd-cloud-recovery-v1';
const STAGES = ['待筛选', '待建联', '已沟通', '待寄样', '已寄样', '已签收', '待发布', '已发布', '复盘完成', '暂停/终止'];
const ACTIVE = STAGES.filter(stage => !['复盘完成', '暂停/终止'].includes(stage));
const APPROVAL_STAGES = ['已寄样', '已签收', '待发布', '已发布', '复盘完成'];
const CHECKS = [['入职与权限',['明确达人商务的职责、费用和寄样审批权限','取得 SKU、配料、资质与食品卖点证据包','核实库存、发货、运费、售后与客服承接','统一有效订单、计佣基数、退款和结算口径']],['达人筛选',['记录内容类目与真实目标读者的匹配理由','查看近期同类视频的中位表现，而非只看最高播放','核实可获取的带货、退款与合作记录，标注资料来源','明确一票否决项和试单预算，避免只按粉丝量选人']],['沟通与合作',['写明 SKU、规格、价格条件和活动适用期','确认纯佣 / 固定费、计佣口径、发布要求与素材权限','用已核实成本测算单均贡献及保本有效订单数','寄样或支付前完成授权，保存确认记录']],['寄样与签收',['记录合作 ID、寄样规格、单号和发出日期','核实签收，并约定试吃反馈时间','如过敏原、口味、破损或时效有问题及时记录升级','无回复或延迟按约定节点跟进，不把寄样当作发布承诺']],['内容与发布',['提供有证据支持的产品信息与可使用素材','核对价格、规格、链接、库存、时效与活动期限','食品功效、排名等宣称核对证据，存疑内容先确认','确认约定发布日期，发布后保存视频与商品链接']],['复盘与结算',['每个视频仅记录一次订单归因，写明观察窗口','区分 GMV、售后后有效订单、计佣基数和实际结算','计入固定费、样品物流、佣金及其他合作成本','核对退款与结算状态，明确复投 / 优化 / 暂停理由']]];
const CHECK_TOTAL = CHECKS.reduce((total, [, items]) => total + items.length, 0);
const CALC_FIELDS = [
  ['price', '单均有效商品收入', '元', '尚未扣除下列费用'],
  ['base', '单均计佣基数', '元', '按确认后的合作口径'],
  ['goods', '单均货品成本', '元', '对应相同订单规格'],
  ['pack', '单均包装成本', '元', '无此项填 0'],
  ['shipping', '单均履约运费', '元', '商家实际承担'],
  ['fees', '其他单均费用', '元', '平台、支付、退损等'],
  ['rate', '达人佣金比例', '%', '0–100%'],
  ['fixed', '固定合作费', '元', '本次合作的一次性投入'],
  ['samples', '样品与寄样物流', '元', '本次寄样全部成本'],
  ['other', '其他固定投入', '元', '无此项填 0'],
];
const ICONS = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="17" rx="4"/><path d="M7 2v5m10-5v5M3 10h18m-12 5h6"/></svg>',
  cooperations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h8m-8 4h8m-8 4h5"/></svg>',
  calculator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="2" width="16" height="20" rx="4"/><path d="M8 7h8m-8 5h2m4 0h2m-8 5h2m4 0h2"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m3 7 9-4 9 4v11l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v11M7 5l10 4"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m3 4 18 8-18 8 4-8-4-8Zm4 8h14"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11-3 5.5 5.5 0 0 0 0 11Z"/><path d="m9 13 2 2 4-4"/></svg>',
};

const NAV = [['today', '今日'], ['cooperations', '合作'], ['calculator', '测算'], ['profile', '我的']];
const emptyState = () => ({ version: 1, records: [], checks: {}, demo: false, calculator: { values: {}, demo: false } });
let state = emptyState();
let revision = -1;
let lastSyncedAt = '';
let authenticated = false;
let sessionEpoch = 0;
let loadSerial = 0;
let rawPendingBlocked = false;
let suspendedEditor = false;
let editingOriginal = null;
let view = 'today';
let dirty = false;
let saving = false;
let reconnecting = false;
let conflict = false;
let connectionError = '';
let pendingError = '';
let cloudChangedDuringEdit = false;
let changeVersion = 0;
let saveTimer;
let toastTimer;
let editingId = null;
let confirmResolver;
let calcInvalid = false;
let filter = { q: '', stage: '', owner: '', overdue: false };

function day(date = new Date()) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); }
function shiftDay(amount) { const date = new Date(); date.setDate(date.getDate() + amount); return day(date); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
function validDate(value) { return value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && day(new Date(`${value}T12:00:00`)) === value); }
function validUrl(value) { if (!value) return true; try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }
function overdue(record) { return ACTIVE.includes(record.stage) && record.dueDate < day(); }
function humanTime(value) { if (!value) return '尚未同步'; return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function recordInitial(record) { return [...record.creator.trim()][0] || '达'; }

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || !/^[\w-]{1,80}$/.test(record.id) || !STAGES.includes(record.stage)) throw new Error('合作记录格式不正确。');
  const limits = { creator: 60, owner: 30, category: 30, contact: 300, sku: 80, dealType: 30, nextAction: 150, tracking: 100, videoUrl: 500, notes: 1200, dueDate: 10, publishDate: 10, createdAt: 50, updatedAt: 50 };
  const result = { id: record.id, stage: record.stage, approved: record.approved === true };
  for (const [key, max] of Object.entries(limits)) {
    if (typeof record[key] !== 'string' || record[key].length > max) throw new Error('合作记录字段不完整或过长。');
    result[key] = record[key];
  }
  if (!result.creator.trim() || !result.owner.trim() || !result.nextAction.trim() || !result.dueDate || !validDate(result.dueDate) || !validDate(result.publishDate) || !validUrl(result.videoUrl)) throw new Error('请核对必填项、日期和视频链接。');
  if (APPROVAL_STAGES.includes(result.stage) && !result.approved) throw new Error('推进寄样及后续状态前，请先确认已取得公司授权。');
  if (result.stage === '已寄样' && !result.tracking.trim()) throw new Error('标记已寄样前，请填写快递单号或寄样记录。');
  if (['已发布', '复盘完成'].includes(result.stage) && !result.videoUrl) throw new Error('标记已发布或复盘完成前，请填写视频链接。');
  result.history = Array.isArray(record.history) ? record.history.slice(-100).map(item => {
    if (!item || typeof item.at !== 'string' || typeof item.text !== 'string' || item.text.length > 500) throw new Error('变更记录格式不正确。');
    return { at: item.at.slice(0, 50), text: item.text };
  }) : [];
  return result;
}

function normalizeData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.records) || data.records.length > 3000) throw new Error('请导入本工作台或旧版工具导出的 JSON，最多支持 3000 条合作。');
  const records = data.records.map(normalizeRecord);
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('合作 ID 有重复，请先核对。');
  const videos = records.map(record => record.videoUrl.trim()).filter(Boolean);
  if (new Set(videos).size !== videos.length) throw new Error('视频链接有重复，请核对归因，避免重复登记。');
  const checks = {};
  if (data.checks && typeof data.checks === 'object') for (const [key, value] of Object.entries(data.checks)) if (/^\d+-\d+$/.test(key) && typeof value === 'boolean') checks[key] = value;
  const calculator = { values: {}, demo: false };
  if (data.calculator !== undefined) {
    if (!data.calculator || !data.calculator.values || typeof data.calculator.values !== 'object' || Array.isArray(data.calculator.values)) throw new Error('报价测算参数格式不正确。');
    for (const [key] of CALC_FIELDS) {
      const value = data.calculator.values[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > 30 || (value !== '' && (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > (key === 'rate' ? 100 : 1000000000)))) throw new Error('测算参数须为非负数字，佣金比例不超过 100%。');
      calculator.values[key] = value;
    }
    calculator.demo = data.calculator.demo === true;
  }
  return { version: 1, records, checks, demo: data.demo === true, calculator };
}

async function request(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(pathname, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    let data;
    try { data = await response.json(); } catch { throw new Error('服务返回内容无法读取，请稍后重试。'); }
    if (!response.ok) { const error = new Error(data.error || '请求未成功，请稍后重试。'); error.status = response.status; error.code = data.code; error.response = data; throw error; }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接超时，请检查网络后重试。');
    throw error;
  } finally { clearTimeout(timer); }
}

function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.remove('hidden'); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 4200); }
function writePending() {
  if (!dirty) return;
  try {
    const key = rawPendingBlocked ? RECOVERY_KEY : PENDING_KEY;
    localStorage.setItem(key, JSON.stringify({ baseRevision: revision, data: state, savedAt: new Date().toISOString() }));
    if (!rawPendingBlocked) pendingError = '';
  } catch { pendingError = '本机暂存失败。请保持页面打开并立即下载未同步备份。'; }
}
function clearPending() {
  try {
    if (!rawPendingBlocked) localStorage.removeItem(PENDING_KEY);
    localStorage.removeItem(RECOVERY_KEY);
  } catch { /* Cloud data remains available even when browser storage is blocked. */ }
}
function parsePending(raw) {
  const parsed = JSON.parse(raw);
  if (!Number.isInteger(parsed.baseRevision) || parsed.baseRevision < 0) throw new Error('草稿版本无效');
  return { ...parsed, data: normalizeData(parsed.data) };
}
function readPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    try { return parsePending(raw); }
    catch {
      rawPendingBlocked = true;
      pendingError = '这台设备有无法读取的原始草稿，已保护原文件。新修改会另存恢复草稿；请到“我的”下载原始草稿留存。';
      const recovery = localStorage.getItem(RECOVERY_KEY);
      if (recovery) {
        try { return parsePending(recovery); }
        catch { localStorage.setItem(`${RECOVERY_KEY}-damaged-${Date.now()}`, recovery); }
      }
      return null;
    }
  } catch { pendingError = '无法读取这台设备的草稿。新修改请及时下载备份，避免依赖浏览器暂存。'; return null; }
}

function renderSync() {
  let label = '已同步';
  let mode = 'synced';
  if (!navigator.onLine) { label = '离线 · 仅暂存本机'; mode = 'offline'; }
  else if (conflict) { label = '存在冲突'; mode = 'conflict'; }
  else if (saving) { label = '正在同步'; mode = 'saving'; }
  else if (dirty) { label = connectionError ? '连接异常 · 待同步' : '等待同步'; mode = 'pending'; }
  else if (connectionError) { label = '连接异常'; mode = 'offline'; }
  else if (revision < 0) { label = '连接中'; mode = 'saving'; }
  else if (calcInvalid) { label = '测算参数待修正'; mode = 'pending'; }
  $('#sync-label').textContent = label;
  $('#sync-button').dataset.state = mode;
  const banner = $('#sync-banner');
  if (conflict) {
    banner.className = 'sync-banner warning';
    banner.innerHTML = '<strong>另一台设备已更新了工作区</strong><p>为保护双方修改，自动同步已暂停。先下载本机未同步内容，再选择云端版本进行核对。</p><div class="actions"><button class="button small secondary" data-action="export-pending">下载本机备份</button><button class="button small primary" data-action="use-cloud">使用云端版本</button></div>';
  } else if (pendingError) {
    banner.className = 'sync-banner warning';
    banner.innerHTML = `<strong>请保护本机草稿</strong><p>${escape(pendingError)}</p><div class="actions"><button class="button small secondary" data-action="export-pending">下载本机备份</button></div>`;
  } else if (!navigator.onLine || connectionError) {
    banner.className = 'sync-banner warning';
    banner.innerHTML = `<strong>${navigator.onLine ? '暂时未能连接云端' : '当前网络未连接'}</strong><p>${dirty ? '更改尚未同步，已尝试暂存在本机。恢复连接后会检查云端版本再提交。' : '当前页面显示的是上次读取的数据，恢复连接后可刷新。'}</p><div class="actions"><button class="button small secondary" data-action="refresh">重新连接</button>${dirty ? '<button class="button small secondary" data-action="export-pending">下载本机备份</button>' : ''}</div>`;
  } else if (cloudChangedDuringEdit) {
    banner.className = 'sync-banner warning';
    banner.innerHTML = '<strong>云端有更新</strong><p>当前编辑内容已保留。请先完成编辑，再处理同步提示。</p>';
  } else { banner.className = 'sync-banner hidden'; banner.innerHTML = ''; }
  if ($('#last-sync-time')) $('#last-sync-time').textContent = humanTime(lastSyncedAt);
  if ($('#cloud-revision')) $('#cloud-revision').textContent = revision < 0 ? '尚未读取' : `v${revision}`;
}

function mutate(next, { renderPage = true } = {}) {
  state = normalizeData(next);
  changeVersion += 1;
  dirty = true;
  writePending();
  if (renderPage) render(); else renderSync();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}

async function flushSave() {
  if (!authenticated || saving || reconnecting || !dirty || conflict || !navigator.onLine || revision < 0) { renderSync(); return; }
  saving = true;
  const epoch = sessionEpoch;
  const snapshot = clone(state);
  const savedVersion = changeVersion;
  const baseRevision = revision;
  renderSync();
  try {
    const result = await request('/api/workspace', { method: 'PUT', body: JSON.stringify({ baseRevision, data: snapshot }) });
    if (!authenticated || epoch !== sessionEpoch) return;
    revision = result.revision;
    lastSyncedAt = result.updatedAt;
    connectionError = '';
    if (changeVersion === savedVersion) {
      state = normalizeData(result.data || snapshot);
      dirty = false;
      clearPending();
    } else writePending();
  } catch (error) {
    if (!authenticated || epoch !== sessionEpoch) return;
    if (error.status === 409) { conflict = true; writePending(); }
    else if (error.status === 401) { writePending(); showLogin('会话已过期，请重新登录。未同步草稿仍保留在这台设备。'); }
    else { connectionError = error.message; writePending(); }
  } finally {
    if (epoch !== sessionEpoch) return;
    saving = false;
    renderSync();
    if (dirty && !conflict && !connectionError && authenticated) saveTimer = setTimeout(flushSave, 100);
  }
}

function isEditing() { return $('#record-dialog').open || document.activeElement?.matches('[data-calc]') || calcInvalid; }

async function loadWorkspace({ restorePending = false, manual = false } = {}) {
  if (!authenticated) return;
  if (isEditing()) { if (manual) toast('请先完成或关闭当前编辑，再刷新云端。'); return; }
  if (dirty || saving || conflict) {
    if (manual && conflict) toast('请先处理同步冲突，本机内容不会自动覆盖云端。');
    if (dirty && !conflict) await flushSave();
    return;
  }
  const startedVersion = changeVersion;
  const epoch = sessionEpoch;
  const serial = ++loadSerial;
  try {
    const result = await request('/api/workspace');
    if (!authenticated || epoch !== sessionEpoch || serial !== loadSerial || dirty || saving || conflict || isEditing() || startedVersion !== changeVersion) return;
    const changed = result.revision !== revision;
    const incoming = normalizeData(result.data);
    const pending = (restorePending || revision < 0) ? readPending() : null;
    if (pending && JSON.stringify(pending.data) !== JSON.stringify(incoming)) {
      state = pending.data;
      revision = pending.baseRevision;
      dirty = true;
      changeVersion += 1;
      conflict = pending.baseRevision !== result.revision;
      lastSyncedAt = result.updatedAt;
      if (!conflict) setTimeout(flushSave, 100);
    } else {
      state = incoming;
      revision = result.revision;
      lastSyncedAt = result.updatedAt;
      if (pending) clearPending();
    }
    connectionError = '';
    cloudChangedDuringEdit = false;
    if (changed || pending) render(); else renderSync();
    if (manual) toast('已读取最新云端数据。');
  } catch (error) {
    if (!authenticated || epoch !== sessionEpoch || serial !== loadSerial) return;
    if (error.status === 401) showLogin('请重新登录后读取工作区。');
    else { connectionError = error.message; if (revision < 0) render(); else renderSync(); }
  }
}

async function useCloud() {
  const accepted = await ask('使用最新云端版本？', '这会舍弃本机尚未同步的修改。建议先取消并下载本机备份，核对后再继续。', '确认使用云端');
  if (!accepted) return;
  const epoch = sessionEpoch;
  const startedVersion = changeVersion;
  try {
    const result = await request('/api/workspace');
    if (!authenticated || epoch !== sessionEpoch) return;
    if (startedVersion !== changeVersion) { toast('读取期间本机又有修改，内容已保留。请重新核对后选择云端版本。'); return; }
    state = normalizeData(result.data);
    revision = result.revision;
    lastSyncedAt = result.updatedAt;
    dirty = false; conflict = false; if (!rawPendingBlocked) pendingError = ''; connectionError = ''; cloudChangedDuringEdit = false;
    clearPending(); render(); toast('已使用最新云端版本。');
  } catch (error) { toast(error.message); }
}

function showLogin(message = '') {
  if (dirty) writePending();
  authenticated = false;
  sessionEpoch += 1;
  loadSerial += 1;
  clearTimeout(saveTimer);
  if ($('#record-dialog').open) { suspendedEditor = true; $('#record-dialog').close(); }
  if ($('#confirm-dialog').open) closeConfirm(false);
  $('#loading-screen').classList.add('hidden');
  $('#app-shell').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  $('#login-password').value = '';
  $('#login-error').textContent = message;
  $('#login-error').classList.toggle('hidden', !message);
}
async function showWorkspace() {
  sessionEpoch += 1;
  authenticated = true;
  $('#loading-screen').classList.add('hidden');
  $('#login-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  revision = -1; dirty = false; saving = false; reconnecting = false; conflict = false; connectionError = ''; calcInvalid = false;
  render();
  await loadWorkspace({ restorePending: true });
  if (authenticated && revision >= 0 && suspendedEditor) { suspendedEditor = false; $('#record-dialog').showModal(); toast('已恢复登录前的编辑内容，请核对后保存。'); }
}

function navigation() {
  $('.desktop-nav').innerHTML = NAV.map(([id, label]) => `<button class="nav-link" data-view="${id}"><span class="nav-icon">${ICONS[id]}</span>${label === '今日' ? '今日工作台' : label === '合作' ? '合作管线' : label === '测算' ? '报价测算' : '我的工作区'}<i>↗</i></button>`).join('');
  $('.bottom-nav').innerHTML = NAV.map(([id, label]) => `<button class="bottom-tab" data-view="${id}"><span class="nav-icon">${ICONS[id]}</span><span class="nav-label">${label}</span></button>`).join('');
}
function setView(next) { if (calcInvalid) { toast('测算参数超出范围，请先修正或清空该项。'); return; } view = next; render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
function render() {
  if (!authenticated) return;
  const headings = {
    today: [new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }), '今天，让好合作再近一步。', '重要的下一步，都帮你记在这里。'],
    cooperations: ['每次跟进，都有着落', '合作，清清楚楚。', '一项合作，一个负责人，一个具体的下一步。'],
    calculator: ['先算清楚，再谈合作', '这次合作，多少单保本？', '按同一 SKU 的有效订单口径测算，未知参数请留空。'],
    profile: ['你的个人商务工作区', '把经验，慢慢积累下来。', '云端同步、备份、SOP 和使用帮助。'],
  };
  const [eyebrow, title, description] = headings[view];
  $('#page-eyebrow').textContent = eyebrow;
  $('#page-title').textContent = title;
  $('#page-description').textContent = description;
  $('#breadcrumb-name').textContent = NAV.find(([id]) => id === view)[1];
  $('#new-record-button').classList.toggle('hidden', !['today', 'cooperations'].includes(view) || revision < 0);
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#demo-banner').classList.toggle('hidden', !state.demo);
  if (revision < 0) {
    $('#page').innerHTML = '<div class="panel empty-state"><span class="empty-mark">☁</span><h2>正在读取云端工作区</h2><p>请稍候。未读取到数据前，不会创建或覆盖台账。</p><button class="button secondary" data-action="refresh">重新读取</button></div>';
  } else ({ today: renderToday, cooperations: renderCooperations, calculator: renderCalculator, profile: renderProfile }[view])();
  renderSync();
}

function stagePill(stage) { return `<span class="stage-pill ${['已寄样', '待发布'].includes(stage) ? 'warm' : stage === '暂停/终止' ? 'muted' : ''}">${escape(stage)}</span>`; }
function dateText(record) { return record.dueDate === day() ? '今天' : record.dueDate.slice(5).replace('-', '/'); }
function taskCard(record) {
  return `<article class="task-card"><span class="task-avatar ${overdue(record) ? 'warm' : ''}">${escape(recordInitial(record))}</span><div class="task-info"><h3 class="task-title">${escape(record.creator)}</h3><p class="task-action">${escape(record.nextAction)}</p><div class="task-meta"><span class="${overdue(record) ? 'overdue' : ''}">${overdue(record) ? '已逾期 · ' : ''}${escape(dateText(record))}</span><i>·</i><span>${escape(record.owner)}</span><i>·</i><span>${escape(record.stage)}</span></div></div><button class="task-open" data-action="edit" data-id="${record.id}" aria-label="跟进 ${escape(record.creator)}">↗</button></article>`;
}
function emptyRecords() {
  return '<div class="empty-state"><span class="empty-mark">✳</span><h2>第一项好合作，从这里开始。</h2><p>记录达人、负责人和下一步动作，电脑与手机会同步到同一个工作区。</p><div><button class="button primary" data-action="new">＋ 新建合作</button><button class="button secondary" data-action="demo">看看演示</button></div></div>';
}
function renderToday() {
  const active = state.records.filter(record => ACTIVE.includes(record.stage));
  const due = active.filter(record => record.dueDate <= day()).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const stats = [
    ['今日及逾期待办', due.length, '按下次跟进时间', 'clock', false],
    ['逾期未处理', active.filter(overdue).length, '优先排查阻塞', 'today', true],
    ['寄样跟进中', state.records.filter(record => ['已寄样', '已签收'].includes(record.stage)).length, '签收与试吃反馈', 'box', false],
    ['等待发布', state.records.filter(record => record.stage === '待发布').length, '核对内容与排期', 'send', false],
  ];
  const recent = [...state.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  const days = Array.from({ length: 7 }, (_, index) => { const date = shiftDay(index - 6); return { date, count: state.records.filter(record => day(new Date(record.createdAt)) === date).length }; });
  const maximum = Math.max(1, ...days.map(item => item.count));
  $('#page').innerHTML = `<section class="dashboard-hero"><div class="hero-copy"><span>每项合作，都值得被认真对待</span><h2>${due.length ? `今天有 <b>${due.length}</b> 项合作，等你向前推进。` : '下一项好合作，正在路上。'}</h2><p>记录当下的行动，也为下一次复盘留下依据。</p></div><div class="hero-art" aria-hidden="true"><span class="hero-card">下一步 <b>↗</b></span><span class="hero-sticker">KEEP GOING</span><i>✳</i></div></section><div class="stats">${stats.map(([label, value, foot, icon, warn]) => `<article class="stat-card ${warn ? 'warn' : ''}"><div><span class="stat-icon">${ICONS[icon]}</span><span class="stat-label">${label}</span></div><strong class="stat-value">${value}</strong><span class="stat-foot">${foot}</span></article>`).join('')}</div><div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><span class="section-eyebrow">TODAY'S FOCUS</span><h2>优先跟进</h2></div><button data-view="cooperations" class="text-button">全部合作 ↗</button></div><div class="task-list">${!state.records.length ? emptyRecords() : due.length ? due.slice(0, 8).map(taskCard).join('') : '<div class="empty-state compact"><span class="empty-mark">✓</span><h2>已录入的到期事项已处理。</h2><p>可以继续安排未来排期，或补充新的合作。</p></div>'}</div></section><div class="dashboard-side"><section class="panel"><div class="panel-heading"><h2>近 7 日新增合作</h2><small>按创建日期</small></div><div class="trend-bars">${days.map(item => `<div class="trend-day"><span class="trend-value">${item.count || ''}</span><div class="bar-track"><i style="height:${item.count ? Math.max(6, item.count / maximum * 100) : 2}%"></i></div><span class="trend-label">${item.date.slice(8)}</span></div>`).join('')}</div><p class="progress-note">仅统计已录入合作，不代表成交或业绩。</p></section><section class="panel"><div class="panel-heading"><h2>合作进行到哪一步？</h2><small>当前状态</small></div><div class="stage-list">${['已沟通', '待寄样', '已寄样', '已签收', '待发布', '已发布'].map(stage => { const count = state.records.filter(record => record.stage === stage).length; return `<div class="stage-row"><span class="stage-name">${stage}</span><span class="stage-track"><i style="width:${state.records.length ? count / state.records.length * 100 : 0}%"></i></span><b class="stage-count">${count}</b></div>`; }).join('')}</div></section></div></div>${recent.length ? `<section class="recent-section"><div class="section-heading"><h2>最近更新</h2><span>把跟进的每一步，留下来</span></div><div class="recent-list">${recent.map(cooperationCard).join('')}</div></section>` : ''}`;
}

function cooperationCard(record) {
  return `<article class="cooperation-card"><div class="card-top"><span class="creator-avatar">${escape(recordInitial(record))}</span><div class="creator-info"><h3>${escape(record.creator)}</h3><span>${escape(record.category)} <i>·</i> ${escape(record.owner)}</span></div>${stagePill(record.stage)}</div><div class="card-body"><span class="next-label">下一步</span><p class="next-action">${escape(record.nextAction)}</p><div class="due-line ${overdue(record) ? 'overdue' : ''}">${ICONS.clock}<span>${overdue(record) ? '已逾期 · ' : '下次跟进 · '}${escape(record.dueDate)}</span>${record.sku ? `<small>${escape(record.sku)}</small>` : ''}</div></div><div class="card-footer"><span>${escape(record.id.slice(0, 8))} · ${escape(record.dealType)}</span><div><button data-action="edit" data-id="${record.id}">编辑跟进 ↗</button><button class="card-delete" data-action="delete" data-id="${record.id}" aria-label="删除 ${escape(record.creator)}">×</button></div></div></article>`;
}
function renderCooperations() {
  const owners = [...new Set(state.records.map(record => record.owner))].sort();
  $('#page').innerHTML = `<div class="filters"><div class="search-field"><span>⌕</span><input id="record-search" aria-label="搜索合作" type="search" placeholder="搜索达人、SKU 或下一步动作" value="${escape(filter.q)}"></div><div class="filter-row"><select id="filter-stage" aria-label="按状态筛选"><option value="">全部状态</option>${STAGES.map(stage => `<option ${filter.stage === stage ? 'selected' : ''}>${stage}</option>`).join('')}</select><select id="filter-owner" aria-label="按负责人筛选"><option value="">全部负责人</option>${owners.map(owner => `<option ${filter.owner === owner ? 'selected' : ''}>${escape(owner)}</option>`).join('')}</select><label class="filter-toggle"><input id="filter-overdue" type="checkbox" ${filter.overdue ? 'checked' : ''}><span>只看逾期</span></label></div></div><div class="section-heading"><h2>全部合作 <span id="record-count"></span></h2><span>每条记录对应一项合作 / 一个视频</span></div><div id="cooperation-list" class="cooperation-grid"></div>`;
  renderCooperationRows();
  $('#record-search').addEventListener('input', event => { filter.q = event.target.value; renderCooperationRows(); });
  $('#filter-stage').addEventListener('change', event => { filter.stage = event.target.value; renderCooperationRows(); });
  $('#filter-owner').addEventListener('change', event => { filter.owner = event.target.value; renderCooperationRows(); });
  $('#filter-overdue').addEventListener('change', event => { filter.overdue = event.target.checked; renderCooperationRows(); });
}
function renderCooperationRows() {
  const query = filter.q.trim().toLowerCase();
  const records = state.records.filter(record => (!query || [record.creator, record.owner, record.sku, record.nextAction, record.id].some(value => value.toLowerCase().includes(query))) && (!filter.stage || record.stage === filter.stage) && (!filter.owner || record.owner === filter.owner) && (!filter.overdue || overdue(record))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  $('#record-count').textContent = records.length;
  $('#cooperation-list').innerHTML = records.length ? records.map(cooperationCard).join('') : state.records.length ? '<div class="panel empty-state"><h2>没有找到这项合作。</h2><p>换个关键词，或调整筛选条件试试。</p></div>' : `<div class="panel">${emptyRecords()}</div>`;
}

function openRecord(id) {
  if (revision < 0 || conflict) { toast('请先读取工作区或处理同步冲突。'); return; }
  editingId = id || null;
  const record = state.records.find(item => item.id === id);
  editingOriginal = record ? JSON.stringify(record) : null;
  const form = $('#record-form');
  form.reset();
  $('#stage-select').innerHTML = STAGES.map(stage => `<option>${stage}</option>`).join('');
  $('#record-title').textContent = record ? `更新合作 · ${record.creator}` : '新建合作';
  $('#record-error').classList.add('hidden');
  if (record) { for (const element of form.elements) if (element.name && Object.hasOwn(record, element.name)) { if (element.type === 'checkbox') element.checked = record[element.name]; else element.value = record[element.name]; } }
  if (!record) { form.elements.dueDate.value = day(); form.elements.nextAction.value = '核实达人内容与产品的匹配情况'; }
  $('#record-history-wrap').classList.toggle('hidden', !record);
  $('#record-history').innerHTML = record ? [...record.history].reverse().map(item => `<p><time>${escape(humanTime(item.at))}</time>${escape(item.text)}</p>`).join('') : '';
  $('#record-dialog').showModal();
}

$('#record-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const old = state.records.find(item => item.id === editingId);
    if (editingId && JSON.stringify(old) !== editingOriginal) throw new Error('云端这项合作已更新。编辑内容已保留，请先复制需要的文字，取消后重新打开最新记录核对。');
    const now = new Date().toISOString();
    const record = normalizeRecord({ ...Object.fromEntries(new FormData(form)), approved: form.elements.approved.checked, id: editingId || uuid(), createdAt: old?.createdAt || now, updatedAt: now, history: old?.history || [] });
    if (record.videoUrl && state.records.some(item => item.id !== record.id && item.videoUrl.trim() === record.videoUrl.trim())) throw new Error('这条视频已登记在其他合作中，请核对归因。');
    record.history.push({ at: now, text: old ? `更新：${old.stage} → ${record.stage}；下一步：${record.nextAction}；负责人：${record.owner}` : `创建合作；负责人：${record.owner}` });
    record.history = record.history.slice(-100);
    const next = clone(state);
    next.records = old ? next.records.map(item => item.id === record.id ? record : item) : [...next.records, record];
    $('#record-dialog').close();
    mutate(next);
    toast(navigator.onLine ? '已记录，正在提交云端。' : '已记录到本机草稿，等待网络恢复。');
  } catch (error) { $('#record-error').textContent = error.message; $('#record-error').classList.remove('hidden'); }
});

function renderCalculator() {
  $('#page').innerHTML = `<div class="helper-note">估算参数随台账同步到其他设备。所有单均金额需对应同一 SKU 和同一订单规格；收入尚未扣除下列费用。价格、成本、佣金和费用口径须先核实。</div><div class="calculator-grid"><section class="panel"><div class="panel-heading"><h2>成本与合作参数</h2><div><button class="text-button" data-action="calc-demo">假设演示</button><button class="text-button" data-action="calc-clear">清空</button></div></div><div class="form-grid calc-fields">${CALC_FIELDS.map(([key, label, unit, hint]) => `<label class="field"><span>${label} <i>${unit}</i></span><input id="calc-${key}" data-calc="${key}" type="number" min="0" ${key === 'rate' ? 'max="100"' : 'max="1000000000"'} step="0.01" inputmode="decimal" placeholder="待核实" value="${escape(state.calculator.values[key] ?? '')}"><small>${hint}</small></label>`).join('')}</div><p class="progress-note" id="calc-mode">${state.calculator.demo ? '当前包含假设演示值，不代表公司售价、佣金或利润。' : '参数未知请留空；确实没有费用的项目填写 0。'}</p></section><section class="panel calc-result"><span class="result-eyebrow">每个有效订单的贡献</span><div id="calc-profit" class="result-number">— <small>元 / 单</small></div><p id="calc-status" class="result-note">补齐参数后计算。</p><div class="result-row"><span>单均达人佣金</span><strong id="calc-commission">—</strong></div><div class="result-row"><span>本次固定投入</span><strong id="calc-fixed-total">—</strong></div><div class="result-row emphasis"><span>保本有效订单数</span><strong id="calc-break-even">待补充</strong></div><div class="formula-note">单均贡献 = 有效商品收入 − 货品 − 包装 − 履约运费 − 其他单均费用 − 计佣基数 × 佣金比例。<br><br>保本订单 = 固定投入 ÷ 正的单均贡献，向上取整。实际退损、税费及其他未录入成本仍需核对。</div></section></div>`;
  calcInvalid = false;
  document.querySelectorAll('[data-calc]').forEach(input => {
    input.addEventListener('input', () => {
      calcInvalid = [...document.querySelectorAll('[data-calc]')].some(field => field.validity.badInput || field.validity.rangeUnderflow || field.validity.rangeOverflow);
      updateCalculation();
      if (calcInvalid) { renderSync(); return; }
      const next = clone(state);
      for (const field of document.querySelectorAll('[data-calc]')) next.calculator.values[field.dataset.calc] = field.value;
      mutate(next, { renderPage: false });
    });
    input.addEventListener('blur', () => { if (cloudChangedDuringEdit && !dirty) setTimeout(() => void loadWorkspace(), 0); });
  });
  updateCalculation();
}
function updateCalculation() {
  const entries = CALC_FIELDS.map(([key]) => $(`#calc-${key}`).value.trim());
  const reset = message => { $('#calc-profit').innerHTML = '— <small>元 / 单</small>'; $('#calc-profit').classList.remove('negative'); $('#calc-status').textContent = message; $('#calc-commission').textContent = $('#calc-fixed-total').textContent = '—'; $('#calc-break-even').textContent = '待补充'; };
  if (entries.some(value => value === '')) { reset('参数尚未填完整。无费用的项目请明确填写 0。'); return; }
  const values = entries.map(Number);
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1000000000) || values[0] <= 0 || values[6] > 100) { reset('收入应大于 0，成本不能为负，佣金需在 0–100% 内。'); return; }
  const [price, base, goods, packaging, shipping, fees, rate, fixed, samples, other] = values;
  const cents = value => Math.round(value * 100);
  const commission = Math.round(cents(base) * rate / 100);
  const contribution = cents(price) - cents(goods) - cents(packaging) - cents(shipping) - cents(fees) - commission;
  const upfront = cents(fixed) + cents(samples) + cents(other);
  $('#calc-profit').innerHTML = `${(contribution / 100).toFixed(2)} <small>元 / 单</small>`;
  $('#calc-profit').classList.toggle('negative', contribution <= 0);
  $('#calc-commission').textContent = `${(commission / 100).toFixed(2)} 元`;
  $('#calc-fixed-total').textContent = `${(upfront / 100).toFixed(2)} 元`;
  $('#calc-break-even').textContent = contribution > 0 ? `${Math.ceil(upfront / contribution)} 单` : '此模型下无法保本';
  $('#calc-status').textContent = contribution > 0 ? '结果为报价估算，不代表实际订单或收益承诺。' : '单均贡献不为正，请先调整价格、成本或合作条件。';
}

function renderProfile() {
  const checked = CHECKS.reduce((total, [, items], group) => total + items.filter((_, index) => state.checks[`${group}-${index}`]).length, 0);
  $('#page').innerHTML = `<section class="profile-card"><span class="profile-avatar">粉</span><div><p>我的商务工作区</p><h2>把跟进变成可复用的经验。</h2><span>同一密码登录的设备，共享同一份台账</span></div><span class="profile-cloud">${ICONS.cloud}</span></section><div class="profile-grid"><section class="panel"><div class="panel-heading"><h2>数据与同步</h2><small id="cloud-revision">v${revision}</small></div><div class="setting-list"><button class="setting-row" data-action="refresh"><span class="setting-icon">↻</span><span class="setting-copy"><b>刷新云端数据</b><small>上次读取 / 保存：<span id="last-sync-time">${escape(humanTime(lastSyncedAt))}</span></small></span><span class="setting-arrow">↗</span></button><button class="setting-row" data-action="export"><span class="setting-icon">↓</span><span class="setting-copy"><b>导出完整 JSON 备份</b><small>保留合作、变更历史、SOP 和测算参数</small></span><span class="setting-arrow">↗</span></button><button class="setting-row" data-action="import"><span class="setting-icon">↑</span><span class="setting-copy"><b>导入旧版 / JSON 备份</b><small>先确认再替换，不会自动合并或上传旧数据</small></span><span class="setting-arrow">↗</span></button><button class="setting-row" data-action="csv"><span class="setting-icon">▤</span><span class="setting-copy"><b>导出 CSV 合作清单</b><small>供 Excel 查看，不用作恢复备份</small></span><span class="setting-arrow">↗</span></button></div></section><section class="panel"><div class="panel-heading"><h2>在手机上使用</h2><span class="tiny-tag">iPhone</span></div><div class="install-help"><span class="install-icon">↗</span><h3>把小本放到主屏幕。</h3><p>用 Safari 打开这个工作台，点击底部的“分享”，选择“添加到主屏幕”。以后可以像打开 App 一样进入。</p><small>需要可访问的 HTTPS 网址。添加后仍需联网才能读取或同步云端。</small></div></section></div><div class="section-heading"><h2>SOP 小检查 <span>${checked} / ${CHECK_TOTAL}</span></h2><span>辅助检查，不代替公司审批</span></div><div class="sop-grid">${CHECKS.map(([title, items], group) => `<section class="panel sop-section"><h3>${String(group + 1).padStart(2, '0')} / ${title}</h3>${items.map((item, index) => `<label class="sop-check"><input type="checkbox" data-check="${group}-${index}" ${state.checks[`${group}-${index}`] ? 'checked' : ''}><span>${item}</span></label>`).join('')}</section>`).join('')}</div><section class="panel account-tools"><div><h3>演示与退出</h3><p>演示数据会明确标记；正式使用前请清空。</p></div><div><button class="button secondary" data-action="demo">载入演示</button><button class="button secondary" data-action="clear">清空台账</button><button class="button secondary" data-action="logout">退出登录</button></div></section><p class="helper-note">云端保存的是你手工录入的合作、SOP 进度和测算参数，未自动接入抖音订单。复盘完成不等于结算完成，财务对账请继续使用公司认可的系统。${hasOldLocalData() ? '<br><strong>检测到这台设备保存过旧版离线数据。请在旧版导出 JSON，再通过上面的“导入”核对后迁移；不会自动上传。</strong>' : ''}${pendingError ? '<br><button class="text-button" data-action="export-raw">下载这台设备的原始草稿</button>' : ''}</p>`;
  document.querySelectorAll('[data-check]').forEach(input => input.addEventListener('change', () => { const next = clone(state); next.checks[input.dataset.check] = input.checked; mutate(next); }));
}

function hasOldLocalData() { try { return Boolean(localStorage.getItem('fenbd-workspace-v1')); } catch { return false; } }
function download(content, name, type) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function exportData(pending = false) { download(JSON.stringify({ ...state, exportedAt: new Date().toISOString(), ...(pending ? { unsynced: true, baseRevision: revision } : {}) }, null, 2), `${pending ? '未同步草稿' : '达人商务备份'}-${day()}.json`, 'application/json;charset=utf-8'); toast(pending ? '已导出本机内容；这份备份可能包含未同步修改。' : '已导出当前工作区备份。'); }
function exportCsv() {
  const columns = [['合作ID', 'id'], ['达人', 'creator'], ['负责人', 'owner'], ['内容方向', 'category'], ['状态', 'stage'], ['SKU', 'sku'], ['合作方式', 'dealType'], ['下次跟进', 'dueDate'], ['下一步动作', 'nextAction'], ['约定发布日', 'publishDate'], ['快递记录', 'tracking'], ['视频链接', 'videoUrl'], ['备注', 'notes']];
  const cell = value => `"${String(value ?? '').replace(/^[\s\uFEFF]*[=+@-]/, "'$&").replace(/"/g, '""')}"`;
  const rows = [columns.map(([label]) => cell(label)).join(','), ...state.records.map(record => columns.map(([, key]) => cell(record[key])).join(','))];
  download(`\ufeff${rows.join('\r\n')}`, `达人合作清单-${day()}.csv`, 'text/csv;charset=utf-8');
  toast('CSV 已导出，完整恢复请使用 JSON 备份。');
}
function ask(title, description, action = '确认') {
  $('#confirm-title').textContent = title;
  $('#confirm-description').textContent = description;
  $('#confirm-submit').textContent = action;
  $('#confirm-dialog').showModal();
  return new Promise(resolve => { confirmResolver = resolve; });
}
function closeConfirm(value) { $('#confirm-dialog').close(); if (confirmResolver) confirmResolver(value); confirmResolver = null; }

async function loadDemo() {
  if (state.records.length) { toast('请先导出并清空现有合作，再载入演示。'); return; }
  if (!await ask('载入演示数据？', '会添加三条明确标记的假设合作并同步到你的工作区，其他设备也会看到演示标记。', '载入演示')) return;
  const now = new Date().toISOString();
  const make = (creator, stage, offset, nextAction, extra = {}) => ({ id: uuid(), creator, stage, owner: '演示商务', category: '美食测评', contact: '演示资料，非真实达人', sku: '示例 SKU · 待核实', dealType: '待协商', dueDate: shiftDay(offset), nextAction, tracking: '', publishDate: '', videoUrl: '', notes: '演示数据，不代表公司实际合作、费用或业绩。', approved: APPROVAL_STAGES.includes(stage), createdAt: now, updatedAt: now, history: [{ at: now, text: '载入演示记录' }], ...extra });
  mutate({ ...state, demo: true, records: [make('演示达人 A', '已寄样', -1, '确认包裹签收，约定试吃反馈日期', { tracking: '演示寄样-DEMO001' }), make('演示达人 B', '待发布', 0, '核对商品链接和约定发布档期', { publishDate: shiftDay(2) }), make('演示达人 C', '已沟通', 2, '补齐成本参数后确认合作条件')] });
  toast('演示记录已载入，正在同步。');
}

async function clearData() {
  if (!await ask('清空当前工作区？', '将清空合作、变更历史、SOP 进度和测算参数，并同步到其他设备。此操作不可撤销，建议先导出 JSON。', '确认清空')) return;
  calcInvalid = false;
  mutate(emptyState());
  toast('已清空，正在提交云端。');
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('#login-password').value;
  $('#login-submit').disabled = true;
  $('#login-submit').textContent = '正在验证…';
  $('#login-error').classList.add('hidden');
  try { await request('/api/login', { method: 'POST', body: JSON.stringify({ password }) }); $('#login-password').value = ''; await showWorkspace(); }
  catch (error) { $('#login-error').textContent = error.message; $('#login-error').classList.remove('hidden'); }
  finally { $('#login-password').value = ''; $('#login-submit').disabled = false; $('#login-submit').innerHTML = '进入工作台 <span>↗</span>'; }
});
$('#new-record-button').addEventListener('click', () => openRecord());
$('#sync-button').addEventListener('click', () => { if (conflict || dirty || connectionError) renderSync(); else toast(`上次云端同步：${humanTime(lastSyncedAt)}`); });
$('#clear-demo').addEventListener('click', clearData);
$('#confirm-submit').addEventListener('click', () => closeConfirm(true));
$('#confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); closeConfirm(false); });
$('#record-dialog').addEventListener('close', () => { if (cloudChangedDuringEdit && !dirty) void loadWorkspace(); });
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('请使用 8 MB 以内的 JSON 备份。');
    const next = normalizeData(JSON.parse(await file.text()));
    if (await ask('用备份替换云端台账？', `将导入 ${next.records.length} 条合作，替换当前 ${state.records.length} 条合作及 SOP 进度。建议先取消并导出当前备份。`, '确认导入')) { mutate(next); toast('备份已导入，正在提交云端。'); }
  } catch (error) { toast(`无法导入：${error.message}`); }
});

document.addEventListener('click', async event => {
  const close = event.target.closest('[data-close]');
  if (close) { if (close.dataset.close === 'confirm-dialog') closeConfirm(false); else $(`#${close.dataset.close}`).close(); return; }
  const nav = event.target.closest('[data-view]');
  if (nav) { setView(nav.dataset.view); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'new') openRecord();
  if (action === 'edit') openRecord(button.dataset.id);
  if (action === 'refresh') await loadWorkspace({ manual: true });
  if (action === 'export') exportData(dirty);
  if (action === 'export-pending') exportData(true);
  if (action === 'export-raw') { try { const raw = localStorage.getItem(PENDING_KEY); if (raw) download(raw, `原始草稿-${day()}.txt`, 'text/plain;charset=utf-8'); else toast('没有找到原始草稿。'); } catch { toast('当前浏览器不允许读取本机草稿。'); } }
  if (action === 'use-cloud') await useCloud();
  if (action === 'csv') exportCsv();
  if (action === 'import') { if (conflict) toast('请先处理同步冲突，再导入新数据。'); else $('#import-file').click(); }
  if (action === 'demo') await loadDemo();
  if (action === 'clear') await clearData();
  if (action === 'delete') {
    const record = state.records.find(item => item.id === button.dataset.id);
    if (record && await ask('删除这项合作？', `将删除「${record.creator}」及这项合作的变更历史，并同步到其他设备。`, '确认删除')) mutate({ ...state, records: state.records.filter(item => item.id !== record.id) });
  }
  if (action === 'calc-demo') { const next = clone(state); next.calculator = { values: {}, demo: true }; const values = [25, 25, 8, 1, 4, 1, 20, 300, 60, 0]; CALC_FIELDS.forEach(([key], index) => next.calculator.values[key] = String(values[index])); calcInvalid = false; mutate(next); }
  if (action === 'calc-clear') { const next = clone(state); next.calculator = { values: {}, demo: false }; calcInvalid = false; mutate(next); }
  if (action === 'logout') {
    if (dirty && !await ask('退出前还有未同步修改', '本机草稿会尝试保留在此设备，其他设备暂时看不到。建议先取消并导出备份。', '仍然退出')) return;
    try { await request('/api/logout', { method: 'POST', body: '{}' }); state = emptyState(); showLogin('你已退出工作区。'); }
    catch (error) { toast(`退出未完成：${error.message}`); }
  }
});

async function reconnect() {
  if (!authenticated || reconnecting) return;
  if (!dirty) { await loadWorkspace(); return; }
  if (conflict || saving) { renderSync(); return; }
  const epoch = sessionEpoch;
  const startedVersion = changeVersion;
  reconnecting = true;
  try {
    const result = await request('/api/workspace');
    if (!authenticated || epoch !== sessionEpoch) return;
    connectionError = '';
    if (result.revision !== revision) {
      const incoming = normalizeData(result.data);
      if (startedVersion === changeVersion && JSON.stringify(incoming) === JSON.stringify(state)) {
        state = incoming; revision = result.revision; lastSyncedAt = result.updatedAt; dirty = false; clearPending();
      } else { conflict = true; writePending(); }
    }
  } catch (error) {
    if (!authenticated || epoch !== sessionEpoch) return;
    if (error.status === 401) showLogin('会话已过期，请重新登录。未同步草稿已保留。');
    else { connectionError = error.message; writePending(); }
  } finally {
    if (epoch === sessionEpoch) {
      reconnecting = false; renderSync();
      if (dirty && !conflict && !connectionError) void flushSave();
    }
  }
}
window.addEventListener('online', () => { connectionError = ''; renderSync(); void reconnect(); });
window.addEventListener('offline', renderSync);
window.addEventListener('beforeunload', event => { if (dirty) { writePending(); event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && authenticated) void loadWorkspace(); });
setInterval(async () => {
  if (!authenticated || document.visibilityState === 'hidden') return;
  if (isEditing()) {
    const epoch = sessionEpoch;
    try { const result = await request('/api/workspace'); if (!authenticated || epoch !== sessionEpoch) return; if (result.revision !== revision) { cloudChangedDuringEdit = true; renderSync(); } } catch (error) { if (epoch === sessionEpoch && error.status === 401) showLogin('会话已过期，重新登录后可继续。'); }
    return;
  }
  if (dirty) void flushSave(); else void loadWorkspace();
}, 8000);

navigation();
request('/api/session').then(result => result.authenticated ? showWorkspace() : showLogin()).catch(() => showLogin('暂时无法连接工作台，请检查网络后重新登录。'));
