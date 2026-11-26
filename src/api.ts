import { bankPoolFor } from './lib/bank';
import type { AskMode, InterviewConfig, JudgeResult, LanguageId, PackSummary, InterviewStyle, Judgement, Plan, Question, ReportItem, Review, RunResult, ServerConfig, TestCase, Turn } from './types';

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

export const getConfig = () => request<ServerConfig>('/api/config');

/** 生成面试大纲；开启题库时带上同岗位的面经题，由模型挑选 */
export function createPlan(config: InterviewConfig) {
  const bank = config.useBank === false ? [] : bankPoolFor(config.role);
  return request<Plan>('/api/plan', {
    role: config.role,
    level: config.level,
    resume: config.resume.trim(),
    jd: config.jd.trim(),
    count: config.count,
    pack: config.pack ?? 'auto',
    focus: config.focus,
    bank: bank.map(({ id, question, topic, points, used }) => ({ id, question, topic, points, used })),
  });
}

/** 把面经原文整理成题目；existing 是题库已有的题，模型据此标出重复（duplicateOf 为重复的题库条目 id） */
export const extractQuestions = (body: { text: string; role: string; existing: { id: string; question: string; topic: string }[] }) =>
  request<{ questions: (Question & { duplicateOf?: string })[] }>('/api/extract', body);

/** 在本机运行算法题代码 */
export const runCode = (body: { language: LanguageId; code: string; stdin: string }) => request<RunResult>('/api/run', body);

/** 用题目上的预置用例判题。和 runCode 同一套运行器，不是容器沙箱 */
export const judgeCode = (body: { language: LanguageId; code: string; cases: TestCase[] }) => request<JudgeResult>('/api/judge-code', body);

export const getPacks = () => request<PackSummary[]>('/api/packs');

export const judgeAnswer = (body: { q: Question; chain: Turn[]; depth: number; pack?: string }) => request<Judgement>('/api/judge', body);

export const createReview = (body: { role: string; level: string; items: ReportItem[]; focus?: string; knownTopics?: string[] }) => request<Review>('/api/report', body);

export interface AskBody {
  mode: AskMode;
  direction?: string;
  q: Question;
  chain: Turn[];
  style: InterviewStyle;
  role: string;
  isLast: boolean;
}

/** 流式获取面试官的下一句话，每收到一段就回调一次（参数为目前的完整文本） */
export async function streamAsk(body: AskBody, onText: (text: string) => void): Promise<string> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  return text.trim();
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
