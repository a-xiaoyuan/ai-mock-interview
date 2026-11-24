import { DIMS } from '../constants';
import type { InterviewRecord, Scores } from '../types';
import { dimensionAverages } from './score';

/** 至少回答过一题的记录才参与统计（全部跳过的场次没有维度分） */
const answered = (r: InterviewRecord) => r.items.some((i) => !i.skipped && i.scores);

export interface WeaknessStat {
  topic: string;
  count: number;
  lastAt: number;
  /** 最近一次出现这个弱项的场次的岗位和级别，专项练习沿用 */
  role: string;
  level: string;
  /** 针对这个知识点做过的专项练习，按时间从早到晚 */
  practice: { at: number; total: number }[];
}

export interface Growth {
  /** 综合面试的总分，按时间从早到晚（专项练习只考一个知识点，分数不可比，不放进趋势） */
  points: { at: number; total: number; role: string; level: string }[];
  latest: Scores | null;
  /** 最近一场之前所有场次的维度平均 */
  before: Scores | null;
  weaknesses: WeaknessStat[];
}

const norm = (topic: string) => topic.trim().toLowerCase();

/** history 为 loadHistory() 的结果（新的在前） */
export function computeGrowth(history: InterviewRecord[], limit = 20): Growth {
  const recentAll = history.slice(0, limit * 2).reverse();
  const recent = recentAll.filter((r) => !r.focus).slice(-limit);
  const points = recent.map((r) => ({ at: r.at, total: r.total, role: r.role, level: r.level }));

  const scored = recent.filter(answered);
  const latest = scored.length ? dimensionAverages(scored[scored.length - 1].items) : null;
  let before: Scores | null = null;
  if (scored.length >= 2) {
    const earlier = scored.slice(0, -1).map((r) => dimensionAverages(r.items));
    before = {} as Scores;
    for (const [k] of DIMS) before[k] = Math.round((earlier.reduce((a, s) => a + s[k], 0) / earlier.length) * 10) / 10;
  }

  const map = new Map<string, WeaknessStat>();
  for (const r of recentAll) {
    for (const w of r.report?.weaknesses || []) {
      const topic = w.topic.trim();
      if (!topic) continue;
      const key = norm(topic);
      const cur = map.get(key) || { topic, count: 0, lastAt: 0, role: r.role, level: r.level, practice: [] };
      cur.count++;
      if (r.at >= cur.lastAt) Object.assign(cur, { lastAt: r.at, role: r.role, level: r.level });
      map.set(key, cur);
    }
  }
  for (const r of recentAll) {
    if (r.focus) map.get(norm(r.focus))?.practice.push({ at: r.at, total: r.total });
  }
  const weaknesses = [...map.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, 5);

  return { points, latest, before, weaknesses };
}
