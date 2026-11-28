import type { InterviewRecord } from '../types';

const KEY = 'mock-interview-history';
const LIMIT = 30;
export const HISTORY_LIMIT = LIMIT;

export function loadHistory(): InterviewRecord[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** 整体替换（导入备份时用），调用方负责排序和去重 */
export function replaceHistory(records: InterviewRecord[]) {
  localStorage.setItem(KEY, JSON.stringify(records.slice(0, LIMIT)));
}

export function saveRecord(record: InterviewRecord) {
  localStorage.setItem(KEY, JSON.stringify([record, ...loadHistory()].slice(0, LIMIT)));
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
