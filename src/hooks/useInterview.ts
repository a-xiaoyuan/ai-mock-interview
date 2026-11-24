import { useEffect, useReducer, useRef, useState } from 'react';
import { createReview, errorMessage, judgeAnswer, streamAsk } from '../api';
import { knownWeaknessTopics } from '../lib/history';
import { totalScore } from '../lib/score';
import type { AskMode, InterviewConfig, InterviewRecord, Judgement, Plan, QuestionResult, ReportItem, Turn } from '../types';

interface Session {
  qi: number; // 当前题号
  depth: number; // 当前题已追问层数
  chains: Turn[][]; // 每题的问答链
  results: (QuestionResult | undefined)[];
  last: { idx: number; judgement: Judgement } | null; // 最近一次评分，用于实时点评
  busy: boolean;
  finished: boolean;
}

/**
 * 一场面试的流程状态机：
 * 开场提问 → 候选人回答 → Judge 评分 → 追问（同一题，≤ MAX_DEPTH 层）或下一题 → … → Reviewer 复盘
 *
 * 流程中有多段连续的异步调用，所以会话数据放在 ref 里，每次修改后手动触发重渲染，
 * 避免闭包里读到过期的 state。
 */
export function useInterview(config: InterviewConfig, plan: Plan, onDone: (record: InterviewRecord) => void) {
  const total = plan.questions.length;
  const ref = useRef<Session>({
    qi: 0,
    depth: 0,
    chains: plan.questions.map(() => []),
    results: [],
    last: null,
    busy: false,
    finished: false,
  });
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const started = useRef(false);

  const s = ref.current;
  const notice = (text: string) => setNotices((list) => [...list, text]);
  const setBusy = (busy: boolean) => {
    s.busy = busy;
    rerender();
  };

  async function ask(mode: AskMode, direction = '') {
    const q = plan.questions[s.qi];
    setStreaming('');
    try {
      const text = await streamAsk(
        { mode, direction, q, chain: s.chains[s.qi], style: config.style, role: config.role, isLast: s.qi === total - 1 },
        setStreaming,
      );
      s.chains[s.qi].push({ role: 'interviewer', text });
    } catch (e) {
      notice(`面试官出错了：${errorMessage(e)}`);
    }
    setStreaming(null);
    rerender();
  }

  async function nextQuestion() {
    s.qi++;
    s.depth = 0;
    rerender();
    if (s.qi >= total) {
      setStreaming(null);
      return finish();
    }
    await ask('next');
  }

  async function finish() {
    if (s.finished) return;
    s.finished = true;
    setBusy(true);
    const items: ReportItem[] = plan.questions.map((q, i) => {
      const r = s.results[i];
      const judged = r && !('skipped' in r) ? r : undefined;
      return { ...q, chain: s.chains[i], skipped: !judged, scores: judged?.scores, comment: judged?.comment, missed: judged?.missed };
    });
    try {
      const report = await createReview({ role: config.role, level: config.level, items, focus: config.focus, knownTopics: knownWeaknessTopics() });
      // 中途离开了面试页就不再跳转到报告
      if (alive.current) onDone({ at: Date.now(), role: config.role, level: config.level, items, report, total: totalScore(items), focus: config.focus });
    } catch (e) {
      s.finished = false;
      notice(`生成报告失败：${errorMessage(e)}，可以再点一次「结束面试」重试`);
      setBusy(false);
    }
  }

  /** 提交一轮回答；失败时返回 false，调用方应恢复输入框内容 */
  async function answer(text: string): Promise<boolean> {
    if (s.busy || s.finished || s.qi >= total) return false;
    const chain = s.chains[s.qi];
    chain.push({ role: 'candidate', text });
    setStreaming(''); // 评分期间先显示“正在思考”，随后由追问/下一题的流式输出接上
    setBusy(true);
    let judgement: Judgement;
    try {
      judgement = await judgeAnswer({ q: plan.questions[s.qi], chain, depth: s.depth });
    } catch (e) {
      setStreaming(null);
      chain.pop();
      notice(`评分出错：${errorMessage(e)}，请重新发送`);
      setBusy(false);
      return false;
    }
    s.results[s.qi] = judgement;
    s.last = { idx: s.qi, judgement };
    if (judgement.verdict === 'follow_up') {
      s.depth++;
      rerender();
      await ask('follow', judgement.direction);
    } else {
      await nextQuestion();
    }
    if (!s.finished) setBusy(false);
    return true;
  }

  async function skip() {
    if (s.busy || s.finished || s.qi >= total) return;
    s.results[s.qi] = { skipped: true };
    setBusy(true);
    await nextQuestion();
    if (!s.finished) setBusy(false);
  }

  async function end() {
    if (s.busy) return;
    await finish();
  }

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 开场：只执行一次（React 严格模式下 effect 会跑两遍）
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setBusy(true);
    ask('open').finally(() => setBusy(false));
  }, []);

  return {
    qi: Math.min(s.qi, total - 1),
    depth: s.depth,
    chains: s.chains,
    shownUpTo: Math.min(s.qi, total - 1),
    last: s.last,
    busy: s.busy,
    finished: s.finished,
    streaming,
    notices,
    answer,
    skip,
    end,
  };
}
