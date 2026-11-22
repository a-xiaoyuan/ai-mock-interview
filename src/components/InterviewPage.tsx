import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MAX_DEPTH } from '../constants';
import { useInterview } from '../hooks/useInterview';
import type { InterviewConfig, InterviewRecord, Plan } from '../types';
import { ScoreBars } from './ScoreBars';

interface Props {
  config: InterviewConfig;
  plan: Plan;
  onDone: (record: InterviewRecord) => void;
}

export function InterviewPage({ config, plan, onDone }: Props) {
  const iv = useInterview(config, plan, onDone);
  const [draft, setDraft] = useState('');
  const [showLive, setShowLive] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const questions = plan.questions;
  const current = questions[iv.qi];

  // 新消息或流式输出时滚到底部
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  useEffect(() => {
    if (!iv.busy) inputRef.current?.focus();
  }, [iv.busy]);

  async function send() {
    const text = draft.trim();
    if (!text || iv.busy) return;
    setDraft('');
    const ok = await iv.answer(text);
    if (!ok) setDraft(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  }

  function end() {
    if (confirm('确定结束面试并生成报告？未回答的题会记为跳过。')) iv.end();
  }

  return (
    <section className="interview">
      <div className="card chat">
        <div className="msgs" ref={msgsRef}>
          {questions.slice(0, iv.shownUpTo + 1).map((q, i) => (
            <Fragment key={i}>
              <div className="divider">
                {q.stage} · {q.topic}
              </div>
              {iv.chains[i].map((t, j) => (
                <Message key={j} role={t.role} text={t.text} />
              ))}
            </Fragment>
          ))}
          {iv.streaming !== null && <Message role="interviewer" text={iv.streaming} typing />}
          {iv.notices.map((n, i) => (
            <div key={i} className="divider error-text">
              {n}
            </div>
          ))}
          {iv.finished && <div className="divider">面试结束，正在生成复盘报告…</div>}
        </div>

        <div className="composer">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入你的回答…（Ctrl + Enter 发送）"
            disabled={iv.busy}
          />
          <div className="row between">
            <div className="row">
              <button onClick={iv.skip} disabled={iv.busy}>
                跳过本题
              </button>
              <button onClick={end} disabled={iv.busy}>
                结束面试
              </button>
            </div>
            <button className="primary" onClick={send} disabled={iv.busy || !draft.trim()}>
              发送
            </button>
          </div>
        </div>
      </div>

      <aside className="side">
        <div className="card">
          <h3>进度</h3>
          <div>
            <b>
              第 {iv.qi + 1} / {questions.length} 题
            </b>{' '}
            <span className="stage">
              {current.stage} · {current.topic}
            </span>
          </div>
          <div className="progress">
            {questions.map((_, i) => (
              <span key={i} className={i < iv.qi ? 'done' : i === iv.qi ? 'now' : ''} />
            ))}
          </div>
          <div className="muted depth-row">
            追问深度
            <span className="depth">
              {Array.from({ length: MAX_DEPTH }, (_, i) => (
                <i key={i} className={i < iv.depth ? 'on' : ''} />
              ))}
            </span>
          </div>
        </div>

        <div className="card">
          <label className="switch">
            <input type="checkbox" checked={showLive} onChange={(e) => setShowLive(e.target.checked)} /> 显示实时点评
          </label>
          {showLive && iv.last ? (
            <div className="live">
              <div className="muted">第 {iv.last.idx + 1} 题 · 最近一次回答</div>
              <ScoreBars scores={iv.last.judgement.scores} />
              <p>{iv.last.judgement.comment}</p>
              {iv.last.judgement.missed.length > 0 && <div className="muted">遗漏：{iv.last.judgement.missed.join('；')}</div>}
            </div>
          ) : (
            <p className="muted live-hint">{showLive ? '回答第一题后显示。' : '关闭时更接近真实面试；结束后在报告里查看。'}</p>
          )}
        </div>
      </aside>
    </section>
  );
}

function Message({ role, text, typing = false }: { role: 'interviewer' | 'candidate'; text: string; typing?: boolean }) {
  return (
    <div className={`msg ${role}${typing ? ' typing' : ''}`}>
      <span className="who">{role === 'interviewer' ? '面试官' : '我'}</span>
      {text}
    </div>
  );
}
