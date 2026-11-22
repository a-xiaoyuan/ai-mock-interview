import type { Dim } from './types';

export const DIMS: [Dim, string][] = [
  ['accuracy', '准确性'],
  ['depth', '深度'],
  ['practical', '实战关联'],
  ['expression', '表达'],
];

/** 每题最多追问层数，需与 server.js 的 MAX_DEPTH 一致 */
export const MAX_DEPTH = 3;

export const ROLES = ['后端开发（Java）', '后端开发（Go）', '前端开发', '客户端开发', '算法工程师', '测试开发'];
export const LEVELS = ['校招', '社招 1-3 年', '社招 3-5 年'];
export const COUNTS = [3, 5, 8];
