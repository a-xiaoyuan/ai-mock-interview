import { dimensionAverages, questionPercent } from '../lib/score';
import type { InterviewRecord, ReportItem } from '../types';
import { PracticeButton, type StartPractice } from './PracticeButton';
import { ScoreBars } from './ScoreBars';

interface Props {
  record: InterviewRecord;
  onAgain: () => void;
  onPractice: StartPractice;
}

export function ReportPage({ record, onAgain, onPractice }: Props) {
  const { items, report } = record;

  return (
    <section className="card">
      <div className="report-head">
        <div className="total">
          <div className="num">{record.total}</div>
          <div className="muted">总分 / 100</div>
        </div>
        <div>
          <div className="muted report-meta">
            {record.focus && <span className="tag">专项 · {record.focus}</span>}
            {record.role} · {record.level}{record.pack ? ` · 题包：${record.pack}` : ''} · {new Date(record.at).toLocaleString()}
          </div>
          <ScoreBars scores={dimensionAverages(items)} suffix=" / 5" large />
        </div>
      </div>

      <div className="section">
        <h3>总体评价</h3>
        <p>{report.summary}</p>
        {report.highlights.length > 0 && (
          <ul>
            {report.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        )}
      </div>

      {report.weaknesses.length > 0 && (
        <div className="section">
          <h3>优先补的弱项</h3>
          {report.weaknesses.map((w, i) => (
            <div className="weak" key={i}>
              <div className="weak-head">
                <b>{w.topic}</b>
                <PracticeButton target={{ topic: w.topic, role: record.role, level: record.level }} onPractice={onPractice} />
              </div>
              <div>{w.why}</div>
              <div className="muted">怎么补：{w.action}</div>
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <h3>逐题复盘</h3>
        {items.map((it, i) => (
          <QuestionReview key={i} index={i} item={it} />
        ))}
      </div>

      <div className="row section">
        <button className="primary" onClick={onAgain}>
          再来一场
        </button>
      </div>
    </section>
  );
}

function ScorePill({ item }: { item: ReportItem }) {
  if (item.skipped || !item.scores) return <span className="pill bad">跳过</span>;
  const p = questionPercent(item.scores);
  return <span className={`pill ${p >= 75 ? 'good' : p >= 50 ? 'mid' : 'bad'}`}>{p}</span>;
}

function QuestionReview({ index, item }: { index: number; item: ReportItem }) {
  return (
    <details className="q">
      <summary>
        <span className="qt">
          {index + 1}. {item.question}
        </span>
        {item.from && <span className="tag">面经</span>}
        <span className="stage">{item.topic}</span>
        <ScorePill item={item} />
      </summary>
      <div className="qa">
        {item.chain.map((t, i) => (
          <p key={i}>
            <b>{t.role === 'interviewer' ? '面试官' : '我'}：</b>
            {t.text}
          </p>
        ))}
      </div>
      {!item.skipped && item.scores && (
        <>
          <div className="narrow">
            <ScoreBars scores={item.scores} />
          </div>
          <p>{item.comment}</p>
          {item.missed && item.missed.length > 0 && <div className="muted">遗漏：{item.missed.join('；')}</div>}
        </>
      )}
      {item.points.length > 0 && (
        <div className="points">
          <b>参考要点</b>
          <ul>
            {item.points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
