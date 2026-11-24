import { useMemo, useState } from 'react';
import { DIMS } from '../constants';
import { computeGrowth } from '../lib/growth';
import type { InterviewRecord } from '../types';
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
    <div className="growth">
      <div className="label-row">
        <h3>能力成长</h3>
        {roles.length > 1 && (
          <select className="compact" value={role} onChange={(e) => setRole(e.target.value)} aria-label="按岗位筛选">
            <option>{ALL}</option>
            {roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        )}
      </div>

      {g.points.length < 2 ? (
        <p className="muted">这个岗位还只有 {g.points.length} 场记录，再面一场就能看到趋势。</p>
      ) : (
        <>
          <TrendChart points={g.points} />
          {g.latest && g.before && (
            <div className="deltas">
              {DIMS.map(([k, name]) => {
                const d = Math.round((g.latest![k] - g.before![k]) * 10) / 10;
                return (
                  <div className="delta" key={k}>
                    <div className="muted">{name}</div>
                    <div className="delta-num">{g.latest![k]}</div>
                    <div className={`delta-change ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>
                      {d > 0 ? `↑ ${d}` : d < 0 ? `↓ ${-d}` : '— 持平'}
                      <span className="muted"> 对比之前平均 {g.before![k]}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {g.weaknesses.length > 0 && (
        <div className="repeat-weak">
          <div className="muted">反复出现的弱项</div>
          <ul className="weak-list">
            {g.weaknesses.map((w) => {
              const last = w.practice[w.practice.length - 1];
              return (
                <li key={w.topic}>
                  <span className="weak-topic">
                    {w.topic}
                    <span className="muted"> · 出现 {w.count} 次</span>
                    {last && (
                      <span className="muted">
                        {' '}
                        · 专项练过 {w.practice.length} 次，最近 {last.total} 分
                      </span>
                    )}
                  </span>
                  <PracticeButton target={{ topic: w.topic, role: w.role, level: w.level }} onPractice={onPractice} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const W = 640;
const H = 200;
const PAD = { left: 36, right: 16, top: 12, bottom: 28 };

function TrendChart({ points }: { points: { at: number; total: number; role: string; level: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + (1 - v / 100) * innerH;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.total)}`).join('');
  const fmt = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  const last = points.length - 1;
  const hp = hover === null ? null : points[hover];

  return (
    <div className="trend">
      <div className="muted trend-title">总分趋势（最近 {points.length} 场）</div>
      <div className="trend-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`总分趋势，最近一场 ${points[last].total} 分`}>
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
              <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="tick">
                {v}
              </text>
            </g>
          ))}
          <text x={x(0)} y={H - 8} textAnchor="start" className="tick">
            {fmt(points[0].at)}
          </text>
          <text x={x(last)} y={H - 8} textAnchor="end" className="tick">
            {fmt(points[last].at)}
          </text>
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="crosshair" />}
          <path d={path} className="line" />
          {points.map((p, i) => (
            <circle key={p.at} cx={x(i)} cy={y(p.total)} r={hover === i ? 5.5 : 4} className="dot" />
          ))}
          {/* 最近一场直接标注分数 */}
          <text x={x(last)} y={y(points[last].total) - 10} textAnchor="end" className="value-label">
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
