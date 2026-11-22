import { useState } from 'react';
import { createPlan, errorMessage } from '../api';
import { COUNTS, LEVELS, ROLES } from '../constants';
import { loadHistory } from '../lib/history';
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

  const set = <K extends keyof InterviewConfig>(key: K, value: InterviewConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));

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
          <label htmlFor="resume">
            简历 <span className="hint">粘贴文本，重点是项目经历</span>
          </label>
          <textarea id="resume" rows={10} placeholder={RESUME_PLACEHOLDER} value={config.resume} onChange={(e) => set('resume', e.target.value)} />
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
