import type { AskMode, InterviewStyle, Judgement, Plan, Question, ReportItem, Review, ServerConfig, Turn } from './types';

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

export const createPlan = (body: { role: string; level: string; resume: string; jd: string; count: number }) =>
  request<Plan>('/api/plan', body);

export const judgeAnswer = (body: { q: Question; chain: Turn[]; depth: number }) => request<Judgement>('/api/judge', body);

export const createReview = (body: { role: string; level: string; items: ReportItem[] }) => request<Review>('/api/report', body);

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
