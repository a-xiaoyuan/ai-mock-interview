import { DIMS } from '../constants';
import type { ReportItem, Scores } from '../types';

export const scoreSum = (s: Scores) => DIMS.reduce((sum, [k]) => sum + s[k], 0);

/** 单题得分，百分制 */
export const questionPercent = (s: Scores) => Math.round((scoreSum(s) / 20) * 100);

/** 总分：所有题目的平均分（百分制），跳过的题记 0 分 */
export function totalScore(items: ReportItem[]): number {
  if (!items.length) return 0;
  const sum = items.reduce((acc, it) => acc + (it.skipped || !it.scores ? 0 : scoreSum(it.scores) / 20), 0);
  return Math.round((sum / items.length) * 100);
}

/** 各维度平均分（只算回答过的题），保留一位小数 */
export function dimensionAverages(items: ReportItem[]): Scores {
  const done = items.filter((i) => !i.skipped && i.scores);
  const out = {} as Scores;
  for (const [k] of DIMS) {
    out[k] = done.length ? Math.round((done.reduce((a, i) => a + i.scores![k], 0) / done.length) * 10) / 10 : 0;
  }
  return out;
}
