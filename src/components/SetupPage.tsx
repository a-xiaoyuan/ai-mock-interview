import { useRef, useState, type DragEvent } from 'react';
import { createPlan, errorMessage } from '../api';
import { COUNTS, LEVELS, ROLES } from '../constants';
import { loadHistory } from '../lib/history';
import { ACCEPTED_RESUME_TYPES, ResumeFileError, readResumeFile } from '../lib/resumeFile';
import type { InterviewConfig, InterviewRecord, Plan } from '../types';

interface Props {
  onStart: (config: InterviewConfig, plan: Plan) => void;
  onOpenRecord: (record: InterviewRecord) => void;
}

const RESUME_PLACEHOLDER = `例：
项目：校园二手交易平台（Spring Boot + Redis + MySQL）
- 负责商品搜索与下单模块，用 Redis 缓存热门商品，QPS 从 300 提升到 2000
- 用 RabbitMQ 异步处理订单超时取消`;

export function SetupPage({ onStart, onOpenRecord }: Props) {
  const [config, setConfig] = useState<InterviewConfig>({
    role: ROLES[0],
    level: LEVELS[0],
    style: 'gentle',
    resume: '',
    jd: '',
    count: 5,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history] = useState(loadHistory);
  const [parsing, setParsing] = useState(false);
  const [fileStatus, setFileStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof InterviewConfig>(key: K, value: InterviewConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));

  async function loadFile(file: File | undefined) {
    if (!file || parsing) return;
    if (config.resume.trim() && !confirm('用文件内容替换当前已填写的简历？')) return;
    setParsing(true);
    setFileStatus(null);
    try {
      const text = await readResumeFile(file);
      set('resume', text);
      setFileStatus({ ok: true, text: `已从 ${file.name} 提取 ${text.length} 字，请检查一下，可以直接修改。` });
    } catch (e) {
      setFileStatus({ ok: false, text: e instanceof ResumeFileError ? e.message : `读取失败：${errorMessage(e)}` });
    } finally {
      setParsing(false);
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
      const plan = await createPlan({ ...config, resume: config.resume.trim(), jd: config.jd.trim() });
      onStart(config, plan);
    } catch (e) {
      setError(`启动失败：${errorMessage(e)}`);
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h2>开始一场模拟面试</h2>
      <p className="sub">贴上简历和目标 JD，AI 会按你的项目出题、层层追问，结束后给出复盘报告。</p>

      <div className="grid4">
        <div>
          <label htmlFor="role">岗位</label>
          <select id="role" value={config.role} onChange={(e) => set('role', e.target.value)}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="level">级别</label>
          <select id="level" value={config.level} onChange={(e) => set('level', e.target.value)}>
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="style">面试风格</label>
          <select id="style" value={config.style} onChange={(e) => set('style', e.target.value as InterviewConfig['style'])}>
            <option value="gentle">温和</option>
            <option value="pressure">压力面</option>
          </select>
        </div>
        <div>
          <label htmlFor="count">题目数量</label>
          <select id="count" value={config.count} onChange={(e) => set('count', Number(e.target.value))}>
            {COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid2">
        <div>
          <div className="label-row">
            <label htmlFor="resume">
              简历 <span className="hint">上传 PDF 或粘贴文本，重点是项目经历</span>
            </label>
            <button type="button" className="small" onClick={() => fileInput.current?.click()} disabled={parsing}>
              {parsing ? '正在读取…' : '上传简历'}
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
            <textarea id="resume" rows={10} placeholder={RESUME_PLACEHOLDER} value={config.resume} onChange={(e) => set('resume', e.target.value)} />
            {dragOver && <div className="drop-hint">松开即可导入 PDF / TXT / MD</div>}
          </div>
          {fileStatus ? (
            <div className={fileStatus.ok ? 'muted file-status' : 'error file-status'}>{fileStatus.text}</div>
          ) : (
            <div className="muted file-status">也可以把文件拖到上面的框里。文件只在你的浏览器里读取，不会上传。</div>
          )}
        </div>
        <div>
          <label htmlFor="jd">
            目标 JD <span className="hint">可选</span>
          </label>
          <textarea id="jd" rows={10} placeholder="粘贴岗位描述，AI 会参考其中的技术栈和要求出题" value={config.jd} onChange={(e) => set('jd', e.target.value)} />
        </div>
      </div>

      <div className="row">
        <button className="primary" onClick={start} disabled={loading}>
          开始面试
        </button>
        {loading && <span className="muted">正在根据简历生成面试大纲…</span>}
      </div>
      {error && <div className="error">{error}</div>}

      {history.length > 0 && (
        <div className="history">
          <h3>历史记录</h3>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>岗位</th>
                <th>级别</th>
                <th>总分</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.at}>
                  <td>{new Date(r.at).toLocaleString()}</td>
                  <td>{r.role}</td>
                  <td>{r.level}</td>
                  <td>
                    <b>{r.total}</b>
                  </td>
                  <td>
                    <button onClick={() => onOpenRecord(r)}>查看报告</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
