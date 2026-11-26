// 面经题库：存在浏览器本地（localStorage），和面试记录一样不经过服务器保存。
import type { BankItem, Question } from '../types';

const KEY = 'mock-interview-bank';
const LIMIT = 500;
/** 一次出题最多带多少道题库题给模型，太多会拖慢出题 */
const PLAN_POOL = 30;
/** 两道题的字符二元组重合度超过这个值，就当作同一道题 */
const SIMILAR = 0.75;

/** 逐条校验存量条目的形状：坏元素直接丢弃，避免搜索、出题时解引用崩溃 */
function isBankItem(data: unknown): data is BankItem {
  if (!data || typeof data !== 'object') return false;
  const it = data as BankItem;
  if ([it.id, it.stage, it.topic, it.question, it.source, it.role].some((v) => typeof v !== 'string')) return false;
  if (!Array.isArray(it.points) || it.points.some((p) => typeof p !== 'string')) return false;
  return typeof it.addedAt === 'number' && typeof it.used === 'number';
}

export function loadBank(): BankItem[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(data) ? data.filter(isBankItem) : [];
  } catch {
    return [];
  }
}

function saveBank(items: BankItem[]) {
  const list = items.slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 配额满了：丢掉最旧的 1/4 再试一次，再失败就放弃这次保存
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, list.length - Math.ceil(list.length / 4))));
    } catch {
      /* 保存失败不抛错，避免中断调用方 */
    }
  }
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

/** 加入题库（新的在前），跳过与已有题目重复的；返回实际加入数和被上限挤掉的旧题数 */
export function addToBank(questions: Question[], meta: { source: string; role: string }): { added: number; dropped: number } {
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
  const merged = [...added, ...items];
  const dropped = Math.max(0, merged.length - LIMIT);
  saveBank(merged);
  return { added: added.length, dropped };
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
