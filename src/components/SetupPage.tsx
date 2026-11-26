import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { createPlan, errorMessage, getPacks } from '../api';
import { COUNTS, LEVELS, ROLES } from '../constants';
import { loadBank } from '../lib/bank';
import { loadHistory } from '../lib/history';
import { ACCEPTED_RESUME_TYPES, ResumeFileError, readResumeFile, type ResumeProgress } from '../lib/resumeFile';
import type { InterviewConfig, InterviewRecord, PackSummary, Plan } from '../types';
import { FileReadProgress, parsingLabel } from './FileReadProgress';
import { GrowthPanel } from './GrowthPanel';
import { Icon, type IconName } from './Icon';
import type { StartPractice } from './PracticeButton';

interface Props {
  /** 上一次填写的设置，回到首页时恢复 */
  initial: InterviewConfig | null;
  onPractice: StartPractice;
  /** 表单每次变化都同步给上层，离开首页再回来时恢复 */
  onChange: (config: InterviewConfig) => void;
  onOpenBank: () => void;
  onStart: (config: InterviewConfig, plan: Plan) => void;
  onOpenRecord: (record: InterviewRecord) => void;
}

const RESUME_PLACEHOLDER = `例：
项目：校园二手交易平台（Spring Boot + Redis + MySQL）
- 负责商品搜索与下单模块，用 Redis 缓存热门商品，QPS 从 300 提升到 2000
- 用 RabbitMQ 异步处理订单超时取消`;

const STYLES: [InterviewConfig['style'], string][] = [
  ['gentle', '温和'],
  ['pressure', '压力面'],
];

const HOW_TO: [IconName, string, string][] = [
  ['file', '贴上简历和 JD', '项目经历写得越具体，追问越贴近你做过的事。'],
  ['message', '像真面试一样作答', '每题会根据你的回答追问，最多三层，可以随时跳过。'],
  ['target', '看复盘、练弱项', '每题按维度打分，弱项可以一键开一场专项练习。'],
];

/** 生成大纲通常要 10–30 秒，显示已等待时间，免得用户以为卡住了 */
function PlanTimer() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="plan-timer" role="status">
      <span className="spinner" />
      <span>
        正在根据简历生成面试大纲… 已用 <span className="num">{sec}</span> 秒{sec >= 5 && '，通常需要 10–30 秒'}
      </span>
    </span>
  );
}

export function scoreTone(n: number) {
  return n >= 80 ? 'good' : n >= 60 ? 'mid' : 'bad';
}

export function SetupPage({ initial, onStart, onPractice, onChange, onOpenBank, onOpenRecord }: Props) {
  const [config, setConfig] = useState<InterviewConfig>(
    () =>
      initial ?? {
        role: ROLES[0],
        level: LEVELS[0],
        style: 'gentle',
        resume: '',
        jd: '',
        count: 5,
      },
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history] = useState(loadHistory);
  const [packs, setPacks] = useState<PackSummary[]>([]);
  useEffect(() => {
    getPacks()
      .then(setPacks)
      .catch(() => setPacks([])); // 拿不到题包列表不影响面试
  }, []);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState<ResumeProgress | null>(null);
  const [fileStatus, setFileStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange(config);
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps
  const packSel = config.pack ?? 'auto';
  // 与服务端 resolvePack 的规则一致：按岗位和级别匹配第一个题包
  const activePack =
    packSel === 'none'
      ? null
      : packSel === 'auto'
        ? packs.find((p) => p.roles.includes(config.role) && (!p.levels.length || p.levels.includes(config.level))) ?? null
        : packs.find((p) => p.id === packSel) ?? null;
  const bankCount = useMemo(() => loadBank().filter((it) => !it.role || it.role === config.role).length, [config.role]);

  const set = <K extends keyof InterviewConfig>(key: K, value: InterviewConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));

  async function loadFile(file: File | undefined) {
    if (!file || parsing) return;
    if (config.resume.trim() && !confirm('用文件内容替换当前已填写的简历？')) return;
    setParsing(true);
    setProgress({ ratio: null, message: '正在读取文件…' });
    setFileStatus(null);
    try {
      const { text, note } = await readResumeFile(file, setProgress);
      set('resume', text);
      setFileStatus({ ok: true, text: `已从 ${file.name} 提取 ${text.length} 字，请检查一下，可以直接修改。${note}` });
    } catch (e) {
      setFileStatus({ ok: false, text: e instanceof ResumeFileError ? e.message : `读取失败：${errorMessage(e)}` });
    } finally {
      setParsing(false);
      setProgress(null);
      if (fileInput.current) fileInput.current.value = ''; // 允许重复选择同一个文件
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    loadFile(e.dataTransfer.files[0]);
  }

  async function start() {
    setError('');
    setLoading(true);
    try {
      onStart(config, await createPlan(config));
    } catch (e) {
      setError(`启动失败：${errorMessage(e)}`);
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>开始一场模拟面试</h1>
          <p>贴上简历和目标 JD，AI 会按你的项目出题、层层追问，结束后给出复盘报告。</p>
        </div>
      </div>

      <div className="setup">
        <section className="card setup-form" aria-label="面试设置">
          <div className="block">
            <div className="config-grid">
              <div>
                <label htmlFor="role" className="field-label">
                  岗位
                </label>
                <select id="role" value={config.role} onChange={(e) => set('role', e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="level" className="field-label">
                  级别
                </label>
                <select id="level" value={config.level} onChange={(e) => set('level', e.target.value)}>
                  {LEVELS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <span className="label field-label" id="style-label">
                  面试风格
                </span>
                <div className="segmented" role="group" aria-labelledby="style-label">
                  {STYLES.map(([v, name]) => (
                    <button key={v} type="button" aria-pressed={config.style === v} onClick={() => set('style', v)}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="label field-label" id="count-label">
                  题目数量
                </span>
                <div className="segmented" role="group" aria-labelledby="count-label">
                  {COUNTS.map((n) => (
                    <button key={n} type="button" aria-pressed={config.count === n} onClick={() => set('count', n)}>
                      <span className="num">{n}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {packs.length > 0 && (
              <div className="field" style={{ marginTop: 16 }}>
                <label htmlFor="pack" className="field-label">
                  题包
                </label>
                <select id="pack" value={packSel} onChange={(e) => set('pack', e.target.value)}>
                  <option value="auto">按岗位自动匹配</option>
                  <option value="none">不使用题包</option>
                  {packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div className="pack-note">
                  <Icon name="layers" size={14} />
                  <span>
                    {activePack
                      ? `${packSel === 'auto' ? '将使用「' + activePack.name + '」：' : ''}${activePack.description}（${activePack.questionCount} 道精选题）`
                      : packSel === 'auto'
                        ? '这个岗位和级别还没有题包，按通用方式出题。'
                        : '按通用方式出题。'}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="block">
            <div className="field-label">
              <label htmlFor="resume">
                简历 <span className="hint">上传 PDF、Word、图片或粘贴文本，重点是项目经历</span>
              </label>
              <button type="button" className="sm" onClick={() => fileInput.current?.click()} disabled={parsing}>
                {parsing ? <span className="spinner" /> : <Icon name="upload" size={14} />}
                {parsing ? parsingLabel(progress?.message ?? '') : '上传简历'}
              </button>
              <input ref={fileInput} type="file" accept={ACCEPTED_RESUME_TYPES} hidden onChange={(e) => loadFile(e.target.files?.[0])} />
            </div>
            <div
              className={`dropzone${dragOver ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <textarea id="resume" rows={9} placeholder={RESUME_PLACEHOLDER} value={config.resume} onChange={(e) => set('resume', e.target.value)} />
              {dragOver && (
                <div className="drop-hint">
                  <span>
                    <Icon name="upload" size={22} style={{ margin: '0 auto 6px' }} />
                    松开即可导入 PDF / Word / TXT / 图片
                  </span>
                </div>
              )}
            </div>
            {parsing && progress ? (
              <FileReadProgress message={progress.message} ratio={progress.ratio} />
            ) : fileStatus ? (
              <div className={`file-status ${fileStatus.ok ? 'ok' : 'err'}`}>
                <Icon name={fileStatus.ok ? 'checkCircle' : 'alert'} size={14} />
                {fileStatus.text}
              </div>
            ) : (
              <div className="file-status">也可以把文件拖到上面的框里。文件只在你的浏览器里读取，不会上传。扫描件和图片会在本地识别，第一次要加载语言包。</div>
            )}

            <div className="field">
              <div className="field-label">
                <label htmlFor="jd">
                  目标 JD <span className="hint">可选</span>
                </label>
              </div>
              <textarea id="jd" rows={4} placeholder="粘贴岗位描述，AI 会参考其中的技术栈和要求出题" value={config.jd} onChange={(e) => set('jd', e.target.value)} />
            </div>
          </div>

          <div className="card-foot start-bar">
            <div className="start-meta small muted">
              {bankCount > 0 ? (
                <label className="check">
                  <input type="checkbox" checked={config.useBank !== false} onChange={(e) => set('useBank', e.target.checked)} />
                  优先用面经题库里的题（这个岗位可用 <span className="num">{bankCount}</span> 道）
                </label>
              ) : (
                <span>想练真实面试题？</span>
              )}
              <button type="button" className="link small" onClick={onOpenBank}>
                {bankCount > 0 ? '管理题库' : '去添加面经'}
              </button>
            </div>
            <div className="start-right">
              {loading && <PlanTimer />}
              <button className="primary lg" onClick={start} disabled={loading || parsing}>
                {loading ? <span className="spinner" /> : <Icon name="play" size={16} />}
                开始面试
              </button>
            </div>
          </div>
          {error && (
            <div className="error-box" style={{ margin: '0 20px 20px' }} role="alert">
              <Icon name="alert" size={15} />
              <span>{error}</span>
            </div>
          )}
        </section>

        <aside className="stack">
          {history.length >= 2 && <GrowthPanel history={history} onPractice={onPractice} />}
          {history.length > 0 ? (
            <section className="card">
              <div className="card-head">
                <h2>
                  <Icon name="clock" />
                  历史记录
                </h2>
                <span className="small muted num">{history.length} 场</span>
              </div>
              <ul className="recent">
                {history.map((r) => (
                  <li key={r.at}>
                    <button onClick={() => onOpenRecord(r)} title="查看报告">
                      <span className={`score-badge ${scoreTone(r.total)}`}>{r.total}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="r-title" style={{ display: 'block' }}>
                          {r.focus ? `专项 · ${r.focus}` : r.role}
                        </span>
                        <span className="r-sub">
                          {r.focus ? `${r.role} · ` : ''}
                          {r.level} · {new Date(r.at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </span>
                      <Icon name="arrowRight" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="card">
              <div className="card-head">
                <h2>怎么用</h2>
              </div>
              <ol className="howto">
                {HOW_TO.map(([icon, title, text]) => (
                  <li key={title}>
                    <span className="step-icon">
                      <Icon name={icon} />
                    </span>
                    <div>
                      <b>{title}</b>
                      <p>{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
