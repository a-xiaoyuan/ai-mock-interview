import { DIMS } from '../constants';
import type { Scores } from '../types';

interface Props {
  scores: Scores;
  /** 分数后缀，例如 " / 5" */
  suffix?: string;
  large?: boolean;
}

export function ScoreBars({ scores, suffix = '', large = false }: Props) {
  return (
    <div className={`scores${large ? ' scores-lg' : ''}`}>
      {DIMS.map(([key, name]) => (
        <div className="score-row" key={key}>
          <span>{name}</span>
          <div className="bar">
            <b style={{ width: `${(scores[key] / 5) * 100}%` }} />
          </div>
          <span className="score-num">
            {scores[key]}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  );
}
