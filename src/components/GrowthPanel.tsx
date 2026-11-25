import { useMemo, useState } from 'react';
import { DIMS } from '../constants';
import { computeGrowth } from '../lib/growth';
import type { InterviewRecord } from '../types';
import { Icon } from './Icon';
import { PracticeButton, type StartPractice } from './PracticeButton';

interface Props {
  history: InterviewRecord[];
  onPractice: StartPractice;
}

const ALL = '全部岗位';

/** 首页的能力成长：总分趋势、维度变化、反复出现的弱项。至少 2 场记录才显示。 */
export function GrowthPanel({ history, onPractice }: Props) {
  const roles = useMemo(() => [...new Set(history.map((r) => r.role))], [history]);
  const [role, setRole] = useState(ALL);
  const filtered = role === ALL ? history : history.filter((r) => r.role === role);
  const g = useMemo(() => computeGrowth(filtered), [filtered]);

  if (history.length < 2) return null;

  return (
    <section className="card growth">
      <div className="card-head">
        <h2>
          <Icon name="trend" />
          能力成长
        </h2>
        {roles.length > 1 && (
          <select style={{ width: 'auto', height: 30, fontSize: 12.5 }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="按岗位筛选">
            <option>{ALL}</option>
            {roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        )}
      </div>

      <div className="growth-body">
        {g.points.length < 2 ? (
          <p className="muted small">这个岗位还只有 {g.points.length} 场记录，再面一场就能看到趋势。</p>
        ) : (
          <>
            <TrendChart points={g.points} />
            {g.latest && g.before && (
              <div className="deltas">
                {DIMS.map(([k, name]) => {
                  const d = Math.round((g.latest![k] - g.before![k]) * 10) / 10;
                  return (
                    <div className="delta" key={k} title={`对比之前平均 ${g.before![k]}`}>
                      <div className="delta-top">
                        <span>{name}</span>
                        <span className={`delta-change ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{d > 0 ? `↑ ${d}` : d < 0 ? `↓ ${-d}` : '持平'}</span>
                      </div>
                      <div className="delta-num">{g.latest![k]}</div>
                      <div className="small muted">之前平均 {g.before![k]}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {g.weaknesses.length > 0 && (
          <div className="weak-block">
            <div className="label">反复出现的弱项</div>
            <ul className="weak-list">
              {g.weaknesses.map((w) => {
                const last = w.practice[w.practice.length - 1];
                return (
                  <li key={w.topic}>
                    <span className="weak-topic">
                      <b>{w.topic}</b>
                      <span>
                        出现 {w.count} 次{last && ` · 专项练过 ${w.practice.length} 次，最近 ${last.total} 分`}
                      </span>
                    </span>
                    <PracticeButton target={{ topic: w.topic, role: w.role, level: w.level }} onPractice={onPractice} />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

const W = 320;
const H = 150;
const PAD = { left: 26, right: 12, top: 18, bottom: 24 };

function TrendChart({ points }: { points: { at: number; total: number; role: string; level: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + (1 - v / 100) * innerH;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.total)}`).join('');
  const area = `${path}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const fmt = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  const last = points.length - 1;
  const hp = hover === null ? null : points[hover];

  return (
    <div className="trend">
      <div className="trend-title">
        <span>总分趋势</span>
        <span>最近 {points.length} 场</span>
      </div>
      <div className="trend-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`总分趋势，最近一场 ${points[last].total} 分`}>
          <defs>
            <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--brand)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="tick">
                {v}
              </text>
            </g>
          ))}
          <text x={x(0)} y={H - 6} textAnchor="start" className="tick">
            {fmt(points[0].at)}
          </text>
          <text x={x(last)} y={H - 6} textAnchor="end" className="tick">
            {fmt(points[last].at)}
          </text>
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="crosshair" />}
          <path d={area} className="area" />
          <path d={path} className="line" />
          {points.map((p, i) => (
            <circle key={p.at} cx={x(i)} cy={y(p.total)} r={hover === i ? 4.5 : 3} className={`dot${i === last ? ' last' : ''}`} />
          ))}
          {/* 最近一场直接标注分数 */}
          <text x={x(last)} y={y(points[last].total) - 9} textAnchor="end" className="value-label">
            {points[last].total}
          </text>
          {/* 命中区域比点大，方便悬停 */}
          {points.map((p, i) => (
            <rect
              key={`hit-${p.at}`}
              x={x(i) - innerW / Math.max(points.length - 1, 1) / 2}
              y={PAD.top}
              width={innerW / Math.max(points.length - 1, 1)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {hp && hover !== null && (
          <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hp.total) / H) * 100}%` }}>
            <b>{hp.total} 分</b>
            <div>{new Date(hp.at).toLocaleString()}</div>
            <div className="muted">
              {hp.role} · {hp.level}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
