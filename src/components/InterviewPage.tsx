import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MAX_DEPTH } from '../constants';
import { useInterview } from '../hooks/useInterview';
import type { InterviewConfig, InterviewRecord, Plan } from '../types';
import { Icon } from './Icon';
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

  /** 已过去的题：有作答记为完成，没有作答就是跳过 */
  const stateOf = (i: number) =>
    i === iv.qi && !iv.finished ? 'now' : i < iv.qi || iv.finished ? (iv.chains[i]?.some((t) => t.role === 'candidate') ? 'done' : 'skipped') : 'todo';

  return (
    <section className="interview">
      <div className="card chat">
        <div className="chat-head">
          <span className="chip brand num">
            第 {iv.qi + 1} / {questions.length} 题
          </span>
          <b className="q-now">
            {current.from ? '面经' : current.stage} · {current.topic}
          </b>
          <span className="depth-meter" title={`追问深度 ${iv.depth} / ${MAX_DEPTH}`} aria-label={`追问深度 ${iv.depth} / ${MAX_DEPTH}`}>
            <span className="depth-label">追问深度</span>
            <span>
              {Array.from({ length: MAX_DEPTH }, (_, i) => (
                <i key={i} className={i < iv.depth ? 'on' : ''} />
              ))}
            </span>
          </span>
        </div>

        <div className="msgs" ref={msgsRef}>
          <div className="msgs-inner">
            {questions.slice(0, iv.shownUpTo + 1).map((q, i) => (
              <Fragment key={i}>
                <div className="q-divider">
                  第 {i + 1} 题 · {q.stage} · {q.topic}
                </div>
                {iv.chains[i].map((t, j) => (
                  <Message key={j} role={t.role} text={t.text} />
                ))}
              </Fragment>
            ))}
            {iv.streaming !== null && <Message role="interviewer" text={iv.streaming} typing />}
            {iv.notices.map((n, i) => (
              <div key={i} className="notice" role="alert">
                <Icon name="alert" size={14} />
                {n}
              </div>
            ))}
            {iv.finished && (
              <div className="notice info" role="status">
                <span className="spinner" />
                面试结束，正在生成复盘报告…
              </div>
            )}
          </div>
        </div>

        <div className="composer">
          <div className="composer-box">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="输入你的回答…（Ctrl + Enter 发送）"
              aria-label="你的回答"
              disabled={iv.busy}
            />
            <div className="composer-actions">
              <button className="sm ghost" onClick={iv.skip} disabled={iv.busy}>
                <Icon name="skip" size={14} />
                跳过本题
              </button>
              <button className="sm ghost danger" onClick={end} disabled={iv.busy}>
                <Icon name="stop" size={14} />
                结束面试
              </button>
              <span className="kbd-hint">
                <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 发送
              </span>
              <button className="primary icon-btn" onClick={send} disabled={iv.busy || !draft.trim()} aria-label="发送" title="发送">
                <Icon name="send" size={17} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <aside className="side">
        <div className="card">
          <div className="card-head">
            <h2>进度</h2>
            <span className="small muted num">
              {Math.min(iv.qi + (iv.finished ? 1 : 0), questions.length)} / {questions.length}
            </span>
          </div>
          {(config.focus || plan.pack) && (
            <div className="side-meta">
              {config.focus && (
                <span className="chip warn">
                  <Icon name="target" size={12} />
                  专项练习 · {config.focus}
                </span>
              )}
              {plan.pack && (
                <span className="chip">
                  <Icon name="layers" size={12} />
                  题包：{plan.pack.name}
                </span>
              )}
            </div>
          )}
          <ol className="qlist">
            {questions.map((q, i) => {
              const st = stateOf(i);
              const reached = i <= iv.qi;
              return (
                <li key={i} className={st} aria-current={st === 'now' ? 'step' : undefined}>
                  <span className="q-state">{st === 'done' ? <Icon name="check" size={12} strokeWidth={2.5} /> : i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="q-title">{reached ? q.topic : `第 ${i + 1} 题`}</div>
                    <div className="q-sub">{st === 'skipped' ? '已跳过' : reached ? (q.from ? '面经' : q.stage) : '未开始'}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="card">
          <div className="live-head">
            <h2>实时点评</h2>
            <label className="check">
              <input type="checkbox" checked={showLive} onChange={(e) => setShowLive(e.target.checked)} /> 显示实时点评
            </label>
          </div>
          <div className="live">
            {showLive && iv.last ? (
              <>
                <div className="small muted" style={{ marginBottom: 10 }}>
                  第 {iv.last.idx + 1} 题 · 最近一次回答
                </div>
                <ScoreBars scores={iv.last.judgement.scores} />
                <p>{iv.last.judgement.comment}</p>
                {iv.last.judgement.missed.length > 0 && <div className="missed">遗漏：{iv.last.judgement.missed.join('；')}</div>}
              </>
            ) : (
              <p className="muted small" style={{ marginTop: 0 }}>
                {showLive ? '回答第一题后显示。' : '关闭时更接近真实面试；结束后在报告里查看。'}
              </p>
            )}
          </div>
        </div>
      </aside>
    </section>
  );
}

function Message({ role, text, typing = false }: { role: 'interviewer' | 'candidate'; text: string; typing?: boolean }) {
  const body = typing && !text ? <span className="thinking dots">正在思考</span> : text;
  if (role === 'candidate') {
    return (
      <div className="msg candidate">
        <div className="bubble">
          <span className="visually-hidden">我：</span>
          <div className="text">{body}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="msg interviewer">
      <span className="avatar">
        <Icon name="user" size={17} />
      </span>
      <div>
        <div className="who">面试官</div>
        <div className={`text${typing && text ? ' caret' : ''}`}>{body}</div>
      </div>
    </div>
  );
}
