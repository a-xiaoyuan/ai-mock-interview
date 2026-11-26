import type { InterviewRecord } from '../types';

const KEY = 'mock-interview-history';
const LIMIT = 30;

/** 逐条校验存量记录的形状：旧版或损坏数据里的坏元素直接丢弃，避免消费方解引用时崩溃 */
function isRecord(data: unknown): data is InterviewRecord {
  if (!data || typeof data !== 'object') return false;
  const r = data as InterviewRecord;
  if (typeof r.at !== 'number' || typeof r.role !== 'string' || typeof r.level !== 'string') return false;
  if (!Array.isArray(r.items) || r.items.some((it) => !it || typeof it !== 'object')) return false;
  if (typeof r.total !== 'number' || !r.report || typeof r.report !== 'object') return false;
  const w = r.report.weaknesses;
  if (w !== undefined && (!Array.isArray(w) || w.some((x) => !x || typeof x !== 'object' || typeof (x as { topic?: unknown }).topic !== 'string'))) return false;
  return true;
}

export function loadHistory(): InterviewRecord[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(data) ? data.filter(isRecord) : [];
  } catch {
    return [];
  }
}

/** 保存一场记录；配额满时丢掉最旧的一半重试一次，再失败返回 false（调用方可据此提示） */
export function saveRecord(record: InterviewRecord): boolean {
  const records = [record, ...loadHistory()].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
    return true;
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify(records.slice(0, Math.max(1, Math.ceil(records.length / 2)))));
      return true;
    } catch {
      return false;
    }
  }
}

/** 以往复盘里出现过的弱项名称（新的在前、去重），让新的复盘沿用同一名称，便于跟踪 */
export function knownWeaknessTopics(limit = 20): string[] {
  const seen = new Map<string, string>();
  for (const r of loadHistory()) {
    if (r.focus && !seen.has(r.focus.toLowerCase())) seen.set(r.focus.toLowerCase(), r.focus);
    for (const w of r.report?.weaknesses || []) {
      const t = w.topic.trim();
      if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    }
  }
  return [...seen.values()].slice(0, limit);
}
