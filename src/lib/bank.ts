// 面经题库：存在浏览器本地（localStorage），和面试记录一样不经过服务器保存。
import type { BankItem, Question } from '../types';

const KEY = 'mock-interview-bank';
const LIMIT = 500;
/** 一次出题最多带多少道题库题给模型，太多会拖慢出题 */
const PLAN_POOL = 30;
/** 两道题的字符二元组重合度超过这个值，就当作同一道题 */
const SIMILAR = 0.75;

export function loadBank(): BankItem[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveBank(items: BankItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, LIMIT)));
}

const normalize = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

function bigrams(s: string): Set<string> {
  const n = normalize(s);
  const out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  if (n.length === 1) out.add(n);
  return out;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return common / (a.size + b.size - common);
}

/** 找出题库里与这道题重复的条目 */
export function findDuplicate(question: string, items: BankItem[]): BankItem | undefined {
  const q = bigrams(question);
  return items.find((it) => similarity(q, bigrams(it.question)) >= SIMILAR);
}

/** 加入题库（新的在前），跳过与已有题目重复的；返回实际加入的数量 */
export function addToBank(questions: Question[], meta: { source: string; role: string }): number {
  const items = loadBank();
  const added: BankItem[] = [];
  for (const q of questions) {
    if (findDuplicate(q.question, [...added, ...items])) continue;
    added.push({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      stage: q.stage,
      topic: q.topic,
      question: q.question,
      points: q.points,
      source: meta.source,
      role: meta.role,
      addedAt: Date.now(),
      used: 0,
    });
  }
  saveBank([...added, ...items]);
  return added.length;
}

export function removeFromBank(ids: string[]) {
  const set = new Set(ids);
  saveBank(loadBank().filter((it) => !set.has(it.id)));
}

/** 出题时带给模型的候选题：同岗位（或没注明岗位）的题，考得少的优先 */
export function bankPoolFor(role: string): BankItem[] {
  return loadBank()
    .filter((it) => !it.role || it.role === role)
    .sort((a, b) => a.used - b.used || b.addedAt - a.addedAt)
    .slice(0, PLAN_POOL);
}

/** 记录这些题被选进了一场面试 */
export function markUsed(ids: string[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  saveBank(loadBank().map((it) => (set.has(it.id) ? { ...it, used: it.used + 1 } : it)));
}
