import type { InterviewRecord } from '../types';

const KEY = 'mock-interview-history';
const LIMIT = 30;

export function loadHistory(): InterviewRecord[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveRecord(record: InterviewRecord) {
  localStorage.setItem(KEY, JSON.stringify([record, ...loadHistory()].slice(0, LIMIT)));
}
