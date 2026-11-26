import { dimensionAverages, questionPercent } from '../lib/score';
import type { InterviewRecord, ReportItem } from '../types';
import { Icon } from './Icon';
import { RichText } from './RichText';
import { PracticeButton, type StartPractice } from './PracticeButton';
import { ScoreBars } from './ScoreBars';

interface Props {
  record: InterviewRecord;
  onAgain: () => void;
  onPractice: StartPractice;
}

function verdict(total: number): [string, string] {
  if (total >= 80) return ['good', '表现良好'];
  if (total >= 60) return ['warn', '基本达标'];
  return ['bad', '需要加强'];
}

export function ReportPage({ record, onAgain, onPractice }: Props) {
  const { items, report } = record;
  const [tone, label] = verdict(record.total);
  const answered = items.filter((it) => !it.skipped && it.scores).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>复盘报告</h1>
          <p>
            {record.role} · {record.level} · {new Date(record.at).toLocaleString()}
          </p>
        </div>
        <button className="primary" onClick={onAgain}>
          <Icon name="refresh" size={15} />
          再来一场
        </button>
      </div>

      <section className="card report-hero">
        <div className="report-total">
          <div className="num">
            {record.total}
            <small>/ 100</small>
          </div>
          <div className="muted small">总分</div>
          <div className="verdict">
            <span className={`chip ${tone === 'good' ? 'good' : tone === 'warn' ? 'warn' : ''}`} style={tone === 'bad' ? { background: 'var(--bad-soft)', color: 'var(--bad)' } : undefined}>
              {label}
            </span>
          </div>
        </div>
        <div className="report-dims">
          <div className="report-meta">
            {record.focus && (
              <span className="chip warn">
                <Icon name="target" size={12} />
                专项 · {record.focus}
              </span>
            )}
            {record.pack && (
              <span className="chip">
                <Icon name="layers" size={12} />
                题包：{record.pack}
              </span>
            )}
            <span className="chip num">
              作答 {answered} / {items.length} 题
            </span>
          </div>
          <ScoreBars scores={dimensionAverages(items)} suffix=" / 5" large />
        </div>
      </section>

      <div className={`report-grid${report.weaknesses.length ? "" : " solo"}`}>
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>
                <Icon name="message" />
                总体评价
              </h2>
            </div>
            <div className="summary">
              <p>{report.summary}</p>
              {report.highlights.length > 0 && (
                <ul className="highlights">
                  {report.highlights.map((h, i) => (
                    <li key={i}>
                      <Icon name="checkCircle" size={15} />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>
                <Icon name="file" />
                逐题复盘
              </h2>
              <span className="small muted">点开查看对话、评分和参考要点</span>
            </div>
            {items.map((it, i) => (
              <QuestionReview key={i} index={i} item={it} />
            ))}
          </section>
        </div>

        {report.weaknesses.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h2>
                <Icon name="target" />
                优先补的弱项
              </h2>
            </div>
            {report.weaknesses.map((w, i) => (
              <div className="weak-card" key={i}>
                <div className="w-head">
                  <b>{w.topic}</b>
                  <PracticeButton target={{ topic: w.topic, role: record.role, level: record.level }} onPractice={onPractice} />
                </div>
                <div className="w-why">{w.why}</div>
                <div className="w-act">
                  <Icon name="bulb" size={15} />
                  <span>怎么补：{w.action}</span>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}

function ScorePill({ item }: { item: ReportItem }) {
  if (item.skipped || !item.scores) return <span className="chip">跳过</span>;
  const p = questionPercent(item.scores);
  return <span className={`score-badge ${p >= 75 ? 'good' : p >= 50 ? 'mid' : 'bad'}`}>{p}</span>;
}

function QuestionReview({ index, item }: { index: number; item: ReportItem }) {
  return (
    <details className="qreview">
      <summary>
        <span className="q-idx">{String(index + 1).padStart(2, '0')}</span>
        <span className="q-text" title={item.question}>
          {item.question}
        </span>
        <span className="q-tags">
          {item.from && <span className="chip brand">面经</span>}
          <span className="chip">{item.topic}</span>
          <ScorePill item={item} />
        </span>
        <Icon name="chevronDown" className="icon chev" />
      </summary>
      <div className="qreview-body">
        <div className="transcript">
          {item.chain.map((t, i) => (
            <div key={i} className={`t-row ${t.role === 'interviewer' ? 'iv' : 'me'}`}>
              <span className="t-who">{t.role === 'interviewer' ? '面试官' : '我'}</span>
              <span className="t-text">
                <RichText text={t.text} />
              </span>
            </div>
          ))}
        </div>
        {!item.skipped && item.scores && (
          <div className="judge-box">
            <ScoreBars scores={item.scores} />
            <div>
              <p>{item.comment}</p>
              {item.missed && item.missed.length > 0 && <div className="missed">遗漏：{item.missed.join('；')}</div>}
            </div>
          </div>
        )}
        {item.points.length > 0 && (
          <div className="points-box">
            <div className="label">参考要点</div>
            <ul>
              {item.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
