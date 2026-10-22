export class ApiError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT', details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const STAGES = ['待筛选', '待建联', '已沟通', '待寄样', '已寄样', '已签收', '待发布', '已发布', '复盘完成', '暂停/终止'];
const shippingStages = ['已寄样', '已签收', '待发布', '已发布', '复盘完成'];
const lengths = { creator: 60, owner: 30, category: 30, contact: 300, sku: 80, dealType: 30, nextAction: 150, tracking: 100, videoUrl: 500, notes: 1200, dueDate: 10, publishDate: 10, createdAt: 50, updatedAt: 50 };

export function validDate(value) {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validUrl(value) {
  if (!value) return true;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

export function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.id !== 'string' || !/^[\w-]{1,80}$/.test(value.id) || !STAGES.includes(value.stage)) {
    throw new ApiError('合作记录格式不正确。');
  }
  const record = { id: value.id, stage: value.stage, approved: value.approved === true };
  for (const [name, limit] of Object.entries(lengths)) {
    if (typeof value[name] !== 'string' || value[name].length > limit || value[name].includes('\0')) throw new ApiError('合作记录字段不完整或过长。');
    record[name] = value[name];
  }
  if (!record.creator.trim() || !record.owner.trim() || !record.nextAction.trim() || !record.dueDate || !validDate(record.dueDate) || !validDate(record.publishDate) || !validUrl(record.videoUrl)) {
    throw new ApiError('合作记录的必填项、日期或链接无效。');
  }
  if (shippingStages.includes(record.stage) && !record.approved) throw new ApiError('寄样或后续阶段缺少授权确认。');
  if (record.stage === '已寄样' && !record.tracking.trim()) throw new ApiError('已寄样记录缺少快递单号或寄样依据。');
  if (['已发布', '复盘完成'].includes(record.stage) && !record.videoUrl.trim()) throw new ApiError('已发布记录缺少视频链接。');
  record.history = Array.isArray(value.history) ? value.history.slice(-100).map(item => {
    if (!item || typeof item !== 'object' || typeof item.at !== 'string' || typeof item.text !== 'string' || item.text.length > 500) throw new ApiError('变更记录格式不正确。');
    return { at: item.at.slice(0, 50), text: item.text };
  }) : [];
  return record;
}

export function normalizeWorkspace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.records) || value.records.length > 3000) {
    throw new ApiError('请提交有效工作台数据，最多支持 3000 条合作。');
  }
  const records = value.records.map(normalizeRecord);
  if (new Set(records.map(record => record.id)).size !== records.length) throw new ApiError('合作 ID 重复，请核对后再同步。');
  const videos = records.map(record => record.videoUrl.trim()).filter(Boolean);
  if (new Set(videos).size !== videos.length) throw new ApiError('视频链接重复，请核对归因后再同步。');
  const checks = {};
  if (value.checks && typeof value.checks === 'object' && !Array.isArray(value.checks)) {
    const entries = Object.entries(value.checks);
    if (entries.length > 500) throw new ApiError('检查项数量过多。');
    for (const [key, checked] of entries) if (/^\d{1,3}-\d{1,3}$/.test(key) && typeof checked === 'boolean') checks[key] = checked;
  }
  const calculator = { values: {}, demo: false };
  if (value.calculator !== undefined) {
    if (!value.calculator || typeof value.calculator !== 'object' || Array.isArray(value.calculator) || !value.calculator.values || typeof value.calculator.values !== 'object' || Array.isArray(value.calculator.values)) throw new ApiError('报价测算参数格式不正确。');
    for (const name of ['price', 'base', 'goods', 'pack', 'shipping', 'fees', 'rate', 'fixed', 'samples', 'other']) {
      const amount = value.calculator.values[name];
      if (amount === undefined) continue;
      if (typeof amount !== 'string' || amount.length > 30 || (amount !== '' && (!amount.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0 || Number(amount) > (name === 'rate' ? 100 : 1e9)))) throw new ApiError('报价测算参数需为有效非负数字，佣金比例不超过 100%。');
      calculator.values[name] = amount;
    }
    calculator.demo = value.calculator.demo === true;
  }
  return { version: 1, records, checks, demo: value.demo === true, calculator };
}

export function validateWrite(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0) throw new ApiError('请提供有效的数据版本。');
  return { baseRevision: value.baseRevision, data: normalizeWorkspace(value.data) };
}
