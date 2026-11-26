import { useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage, runCode } from '../api';
import { LANGUAGES, TEMPLATES, runStatus, saveLanguage } from '../lib/code';
import type { LanguageId, Question, RunResult, RunnerLanguage } from '../types';
import { Icon } from './Icon';

export interface CodeState {
  language: LanguageId;
  /** 每种语言各自保留写过的代码，切换语言不会丢 */
  codes: Partial<Record<LanguageId, string>>;
  stdin: string;
  /** 最近一次运行；code 记下当时的代码，代码改过以后就不再随提交附上 */
  last?: { code: string; stdin: string; result: RunResult };
}

export const newCodeState = (language: LanguageId): CodeState => ({ language, codes: {}, stdin: '' });
export const currentCode = (s: CodeState) => s.codes[s.language] ?? TEMPLATES[s.language];

interface Props {
  question: Question;
  state: CodeState;
  onChange: (next: CodeState) => void;
  runners: RunnerLanguage[];
  /** 面试官正在说话或评分时不能提交 */
  busy: boolean;
  onSubmit: () => void;
}

const INDENT = '    ';

/** 算法题的代码面板：题目、编辑器、自定义输入和运行结果 */
export function CodePanel({ question, state, onChange, runners, busy, onSubmit }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'input' | 'output'>('input');
  const code = currentCode(state);
  const runner = runners.find((r) => r.id === state.language);
  const last = state.last;

  const setCode = (value: string) => onChange({ ...state, codes: { ...state.codes, [state.language]: value } });

  function setLanguage(id: LanguageId) {
    saveLanguage(id);
    onChange({ ...state, language: id });
  }

  function reset() {
    if (confirm('恢复成初始代码？当前这门语言写的代码会清空。')) setCode(TEMPLATES[state.language]);
  }

  async function run() {
    if (!runner || running) return;
    setError('');
    setRunning(true);
    setTab('output');
    try {
      const result = await runCode({ language: state.language, code, stdin: state.stdin });
      onChange({ ...state, last: { code, stdin: state.stdin, result } });
    } catch (e) {
      setError(`运行失败：${errorMessage(e)}`);
    } finally {
      setRunning(false);
    }
  }

  const status = last && runStatus(last.result);
  const stale = last && last.code !== code;

  return (
    <section className="card code-panel" aria-label="代码编辑器">
      <div className="code-head">
        <select value={state.language} onChange={(e) => setLanguage(e.target.value as LanguageId)} aria-label="编程语言">
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {runners.length > 0 && !runners.some((r) => r.id === l.id) ? '（本机不能运行）' : ''}
            </option>
          ))}
        </select>
        <button className="sm ghost" onClick={reset} title="恢复成初始代码">
          <Icon name="refresh" size={14} />
          重置
        </button>
        <span className="spacer" />
        <button className="sm" onClick={run} disabled={!runner || running} title={runner ? `${runner.version}（Ctrl + Enter）` : runnerHint(runners)}>
          {running ? <span className="spinner" /> : <Icon name="play" size={13} />}
          运行
        </button>
        <button className="sm primary" onClick={onSubmit} disabled={busy || !code.trim()} title="把代码和最近一次运行结果发给面试官">
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
      </details>

      <CodeEditor value={code} onChange={setCode} onRun={run} />

      <div className="code-io">
        <div className="io-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'input'} onClick={() => setTab('input')}>
            自定义输入
          </button>
          <button role="tab" aria-selected={tab === 'output'} onClick={() => setTab('output')}>
            运行结果
            {status && <i className={status.ok ? 'ok' : 'bad'} />}
          </button>
          {!runner && <span className="io-note">{runnerHint(runners)}</span>}
        </div>
        {tab === 'input' ? (
          <textarea
            className="mono io-input"
            value={state.stdin}
            onChange={(e) => onChange({ ...state, stdin: e.target.value })}
            placeholder="程序从标准输入读到的内容，例如题目里的样例输入"
            aria-label="自定义输入"
            spellCheck={false}
          />
        ) : (
          <div className="io-output" aria-live="polite">
            {error ? (
              <div className="error-box" style={{ marginTop: 0 }}>
                <Icon name="alert" size={15} />
                <span>{error}</span>
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

function runnerHint(runners: RunnerLanguage[]) {
  return runners.length ? '本机没有这门语言的运行环境，可以换一门语言，或者直接提交代码' : '代码运行只在本机访问时可用，仍然可以写好后提交';
}

/** 等宽编辑器：Tab 缩进、回车保持缩进、Ctrl + Enter 运行，左侧显示行号 */
function CodeEditor({ value, onChange, onRun }: { value: string; onChange: (v: string) => void; onRun: () => void }) {
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
