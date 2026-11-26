import { useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage, judgeCode, runCode } from '../api';
import { CASE_STATUS_TEXT, LANGUAGES, TEMPLATES, runStatus, saveLanguage } from '../lib/code';
import type { JudgeResult, LanguageId, Question, RunResult, RunnerLanguage } from '../types';
import { Icon } from './Icon';

export interface CodeState {
  language: LanguageId;
  /** 每种语言各自保留写过的代码，切换语言不会丢 */
  codes: Partial<Record<LanguageId, string>>;
  stdin: string;
  /** 最近一次自定义运行；code 记下当时的代码，代码改过以后就不再随提交附上 */
  last?: { code: string; stdin: string; result: RunResult };
  /** 最近一次预置用例判题 */
  lastJudge?: { code: string; result: JudgeResult };
}

export const newCodeState = (language: LanguageId): CodeState => ({ language, codes: {}, stdin: '' });
export const currentCode = (s: CodeState) => s.codes[s.language] ?? TEMPLATES[s.language];

interface Props {
  question: Question;
  state: CodeState;
  onChange: (update: CodeUpdate) => void;
  runners: RunnerLanguage[];
  /** 一种语言都跑不了时的说明；不传则用原来的「只在本机访问时可用」 */
  runnerNote?: string;
  /** 面试官正在说话或评分时不能提交 */
  busy: boolean;
  onSubmit: (extra: {
    code: string;
    language: LanguageId;
    run?: { stdin: string; result: RunResult };
    judge?: JudgeResult;
    judgeError?: string;
    skippedCases?: boolean;
  }) => void;
}

type CodeUpdate = CodeState | ((prev: CodeState) => CodeState);

const INDENT = '    ';

/** 算法题的代码面板：题目、编辑器、自定义输入和运行结果 */
export function CodePanel({ question, state, onChange, runners, runnerNote, busy, onSubmit }: Props) {
  const [running, setRunning] = useState(false);
  const [judging, setJudging] = useState(false);
  const [error, setError] = useState<{ scope: 'run' | 'judge'; text: string } | null>(null);
  const cases = question.cases ?? [];
  const [tab, setTab] = useState<'input' | 'output' | 'cases' | 'judge'>(cases.length ? 'cases' : 'input');
  const code = currentCode(state);
  const runner = runners.find((r) => r.id === state.language);
  const last = state.last;
  const judged = state.lastJudge;
  const judgeFresh = judged && judged.code === code ? judged.result : undefined;

  const setCode = (value: string) => onChange((prev) => ({ ...prev, codes: { ...prev.codes, [prev.language]: value } }));

  function setLanguage(id: LanguageId) {
    saveLanguage(id);
    onChange((prev) => ({ ...prev, language: id }));
  }

  function reset() {
    if (confirm('恢复成初始代码？当前这门语言写的代码会清空。')) setCode(TEMPLATES[state.language]);
  }

  async function run() {
    if (!runner || running || judging) return;
    const stdin = state.stdin;
    setError(null);
    setRunning(true);
    setTab('output');
    try {
      const result = await runCode({ language: state.language, code, stdin });
      onChange((prev) => ({ ...prev, last: { code, stdin, result } }));
    } catch (e) {
      setError({ scope: 'run', text: `运行失败：${errorMessage(e)}` });
    } finally {
      setRunning(false);
    }
  }

  /** 跑预置用例。失败时返回错误文字，成功返回结果。 */
  async function judgeNow(): Promise<{ result?: JudgeResult; error?: string }> {
    if (!runner || !cases.length) return {};
    setError(null);
    setJudging(true);
    setTab('judge');
    try {
      const result = await judgeCode({ language: state.language, code, cases });
      onChange((prev) => ({ ...prev, lastJudge: { code, result } }));
      return { result };
    } catch (e) {
      const message = errorMessage(e);
      setError({ scope: 'judge', text: `判题失败：${message}` });
      return { error: message };
    } finally {
      setJudging(false);
    }
  }

  async function judge() {
    if (!runner || running || judging || !cases.length) return;
    await judgeNow();
  }

  async function submit() {
    if (busy || running || judging || !code.trim()) return;
    const language = state.language;
    const run = state.last && state.last.code === code ? { stdin: state.last.stdin, result: state.last.result } : undefined;
    let judgeResult = judgeFresh;
    let judgeError = '';
    if (cases.length && runner && !judgeResult) {
      const out = await judgeNow();
      judgeResult = out.result;
      judgeError = out.error || '';
    }
    onSubmit({ code, language, run, judge: judgeResult, judgeError, skippedCases: cases.length > 0 && !runner });
  }

  const status = last && runStatus(last.result);
  const stale = last && last.code !== code;
  const judgeStatus = judgeFresh ? { ok: judgeFresh.passed === judgeFresh.total && !judgeFresh.compileError, text: judgeFresh.compileError ? '编译失败' : `${judgeFresh.passed}/${judgeFresh.total} 通过` } : undefined;
  const judgeStale = judged && judged.code !== code;

  return (
    <section className="card code-panel" aria-label="代码编辑器">
      <div className="code-head">
        <select value={state.language} onChange={(e) => setLanguage(e.target.value as LanguageId)} aria-label="编程语言" disabled={running || judging}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {runners.length > 0 && !runners.some((r) => r.id === l.id) ? '（不能运行）' : ''}
            </option>
          ))}
        </select>
        <button className="sm ghost" onClick={reset} title="恢复成初始代码">
          <Icon name="refresh" size={14} />
          重置
        </button>
        <span className="spacer" />
        <button className="sm" onClick={run} disabled={!runner || running || judging} title={runner ? `${runner.version}（Ctrl + Enter）` : runnerHint(runners, runnerNote)}>
          {running ? <span className="spinner" /> : <Icon name="play" size={13} />}
          运行
        </button>
        {cases.length > 0 && (
          <button className="sm" onClick={judge} disabled={!runner || running || judging} title={runner ? '用预置用例判题' : runnerHint(runners, runnerNote)}>
            {judging ? <span className="spinner" /> : <Icon name="check" size={14} />}
            判题
          </button>
        )}
        <button
          className="sm primary"
          onClick={submit}
          disabled={busy || running || judging || !code.trim()}
          title={cases.length ? '先自动判题，再把代码和结果发给面试官' : '把代码和最近一次运行结果发给面试官'}
        >
          <Icon name="send" size={14} />
          提交代码
        </button>
      </div>

      <details className="code-question" open>
        <summary>
          <Icon name="file" size={14} />
          题目 · {question.topic}
          <Icon name="chevronDown" size={14} className="icon chev" />
        </summary>
        <p>{question.question}</p>
        {cases.length > 0 && <p className="case-hint">本题有 {cases.length} 个预置用例。可以先用自定义输入试跑，点「判题」或「提交代码」时会逐例运行。</p>}
      </details>

      <CodeEditor value={code} onChange={setCode} onRun={run} locked={running || judging} />

      <div className="code-io">
        <div className="io-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'input'} onClick={() => setTab('input')}>
            自定义输入
          </button>
          <button role="tab" aria-selected={tab === 'output'} onClick={() => setTab('output')}>
            运行结果
            {status && <i className={status.ok ? 'ok' : 'bad'} />}
          </button>
          {cases.length > 0 && (
            <button role="tab" aria-selected={tab === 'cases'} onClick={() => setTab('cases')}>
              测试用例
            </button>
          )}
          {cases.length > 0 && (
            <button role="tab" aria-selected={tab === 'judge'} onClick={() => setTab('judge')}>
              判题结果
              {judgeStatus && <i className={judgeStatus.ok ? 'ok' : 'bad'} />}
            </button>
          )}
          {!runner && <span className="io-note">{runnerHint(runners, runnerNote)}</span>}
        </div>
        {tab === 'input' ? (
          <textarea
            className="mono io-input"
            value={state.stdin}
            onChange={(e) => onChange((prev) => ({ ...prev, stdin: e.target.value }))}
            placeholder="程序从标准输入读到的内容，例如题目里的样例输入"
            aria-label="自定义输入"
            spellCheck={false}
            readOnly={running || judging}
          />
        ) : tab === 'cases' ? (
          <div className="io-output" aria-label="预置测试用例">
            <ol className="case-list">
              {cases.map((c, i) => (
                <li key={i}>
                  <div className="case-name">{c.name || `用例 ${i + 1}`}</div>
                  <div className="case-io">
                    <span>输入</span>
                    <pre className="mono">{c.input || '（空）'}</pre>
                    <span>期望输出</span>
                    <pre className="mono">{c.output || '（空）'}</pre>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : tab === 'judge' ? (
          <div className="io-output" aria-live="polite">
            {error?.scope === 'judge' ? (
              <div className="error-box" style={{ marginTop: 0 }}>
                <Icon name="alert" size={15} />
                <span>{error.text}</span>
              </div>
            ) : judging ? (
              <span className="muted small">
                <span className="dots">正在判题</span>
              </span>
            ) : judged ? (
              <>
                <div className={`run-status ${!judged.result.compileError && judged.result.passed === judged.result.total ? 'ok' : 'bad'}`}>
                  <Icon name={!judged.result.compileError && judged.result.passed === judged.result.total ? 'checkCircle' : 'alert'} size={15} />
                  {judged.result.compileError ? '编译失败' : `${judged.result.passed}/${judged.result.total} 通过`}
                  {judgeStale && <span className="muted">· 代码已修改，提交时会重新判题</span>}
                </div>
                {judged.result.compileError ? (
                  <pre className="mono err">{judged.result.cases[0]?.stderr || '编译失败'}</pre>
                ) : (
                  <ol className="case-list">
                    {judged.result.cases.map((c, i) => (
                      <li key={i} className={c.passed ? 'pass' : 'fail'}>
                        <div className="case-name">
                          <Icon name={c.passed ? 'check' : 'alert'} size={13} />
                          {c.name}
                          <span className="muted">{CASE_STATUS_TEXT[c.status]}</span>
                          <span className="muted num">{c.timeMs} ms</span>
                        </div>
                        {!c.passed && (
                          <div className="case-io">
                            <span>输入</span>
                            <pre className="mono">{c.input || '（空）'}</pre>
                            <span>期望输出</span>
                            <pre className="mono">{c.expected || '（空）'}</pre>
                            <span>实际输出</span>
                            <pre className="mono">{c.stdout || '（空）'}</pre>
                            {c.stderr && (
                              <>
                                <span>错误输出</span>
                                <pre className="mono err">{c.stderr}</pre>
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <span className="muted small">还没有判过。写好代码后点「判题」，或直接「提交代码」，会自动跑这些用例。</span>
            )}
          </div>
        ) : (
          <div className="io-output" aria-live="polite">
            {error?.scope === 'run' ? (
              <div className="error-box" style={{ marginTop: 0 }}>
                <Icon name="alert" size={15} />
                <span>{error.text}</span>
              </div>
            ) : running ? (
              <span className="muted small">
                <span className="dots">正在运行</span>
              </span>
            ) : last && status ? (
              <>
                <div className={`run-status ${status.ok ? 'ok' : 'bad'}`}>
                  <Icon name={status.ok ? 'checkCircle' : 'alert'} size={15} />
                  {status.text}
                  <span className="muted num">{last.result.timeMs} ms</span>
                  {stale && <span className="muted">· 代码已修改，提交时不附这次结果</span>}
                </div>
                {last.result.stage === 'run' && <pre className="mono">{last.result.stdout || <span className="muted">（无输出）</span>}</pre>}
                {last.result.stderr && <pre className="mono err">{last.result.stderr}</pre>}
              </>
            ) : (
              <span className="muted small">还没有运行过。写好代码后点「运行」，或按 Ctrl + Enter。</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function runnerHint(runners: RunnerLanguage[], note?: string) {
  if (!runners.length) return note || '代码运行只在本机访问时可用，仍然可以写好后提交';
  return '这门语言当前不能运行，可以换一门，或者直接提交代码';
}

/** 等宽编辑器：Tab 缩进、回车保持缩进、Ctrl + Enter 运行，左侧显示行号 */
function CodeEditor({ value, onChange, onRun, locked = false }: { value: string; onChange: (v: string) => void; onRun: () => void; locked?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split('\n').length;

  /** 用 insertText 插入，保留浏览器自带的撤销 */
  function insert(text: string) {
    const el = ref.current!;
    if (!document.execCommand('insertText', false, text)) {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
      onChange(el.value);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRun();
    } else if (e.key === 'Tab' && !e.shiftKey && el.selectionStart === el.selectionEnd) {
      e.preventDefault();
      insert(INDENT);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      const before = el.value.slice(0, el.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const indent = line.match(/^[\t ]*/)![0];
      const extra = /[{[(:]\s*$/.test(line) ? INDENT : '';
      e.preventDefault();
      insert(`\n${indent}${extra}`);
    }
  }

  return (
    <div className="editor">
      <div className="gutter mono" ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={ref}
        className="mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        readOnly={locked}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        wrap="off"
        aria-label="代码"
      />
    </div>
  );
}
