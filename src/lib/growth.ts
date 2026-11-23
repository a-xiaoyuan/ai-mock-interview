import { DIMS } from '../constants';
import type { InterviewRecord, Scores } from '../types';
import { dimensionAverages } from './score';

/** 至少回答过一题的记录才参与统计（全部跳过的场次没有维度分） */
const answered = (r: InterviewRecord) => r.items.some((i) => !i.skipped && i.scores);

export interface Growth {
  /** 按时间从早到晚 */
  points: { at: number; total: number; role: string; level: string }[];
  latest: Scores | null;
  /** 最近一场之前所有场次的维度平均 */
  before: Scores | null;
  weaknesses: { topic: string; count: number; lastAt: number }[];
}

/** history 为 loadHistory() 的结果（新的在前） */
export function computeGrowth(history: InterviewRecord[], limit = 20): Growth {
  const recent = history.slice(0, limit).reverse();
  const points = recent.map((r) => ({ at: r.at, total: r.total, role: r.role, level: r.level }));

  const scored = recent.filter(answered);
  const latest = scored.length ? dimensionAverages(scored[scored.length - 1].items) : null;
  let before: Scores | null = null;
  if (scored.length >= 2) {
    const earlier = scored.slice(0, -1).map((r) => dimensionAverages(r.items));
    before = {} as Scores;
    for (const [k] of DIMS) before[k] = Math.round((earlier.reduce((a, s) => a + s[k], 0) / earlier.length) * 10) / 10;
  }

  const map = new Map<string, { topic: string; count: number; lastAt: number }>();
  for (const r of recent) {
    for (const w of r.report?.weaknesses || []) {
      const topic = w.topic.trim();
      if (!topic) continue;
      const key = topic.toLowerCase();
      const cur = map.get(key) || { topic, count: 0, lastAt: 0 };
      cur.count++;
      cur.lastAt = Math.max(cur.lastAt, r.at);
      map.set(key, cur);
    }
  }
  const weaknesses = [...map.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, 5);

  return { points, latest, before, weaknesses };
}
