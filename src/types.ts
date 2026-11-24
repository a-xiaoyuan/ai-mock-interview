export type Dim = 'accuracy' | 'depth' | 'practical' | 'expression';
export type Scores = Record<Dim, number>;

export type InterviewStyle = 'gentle' | 'pressure';

export interface InterviewConfig {
  role: string;
  level: string;
  style: InterviewStyle;
  resume: string;
  jd: string;
  count: number;
  /** 专项练习的知识点；为空表示普通面试 */
  focus?: string;
  /** 是否从面经题库里选题，默认开启 */
  useBank?: boolean;
}

export interface Question {
  stage: string;
  topic: string;
  question: string;
  points: string[];
  /** 选自面经题库时为题库条目 id */
  from?: string;
}

/** 面经题库里的一道题 */
export interface BankItem {
  id: string;
  stage: string;
  topic: string;
  question: string;
  points: string[];
  /** 来源备注，例如公司和轮次 */
  source: string;
  role: string;
  addedAt: number;
  /** 被选进面试的次数 */
  used: number;
}

export interface Plan {
  questions: Question[];
}

export interface Turn {
  role: 'interviewer' | 'candidate';
  text: string;
}

export interface Judgement {
  scores: Scores;
  verdict: 'follow_up' | 'next';
  direction: string;
  comment: string;
  missed: string[];
}

export type QuestionResult = Judgement | { skipped: true };

export interface Weakness {
  topic: string;
  why: string;
  action: string;
}

export interface Review {
  summary: string;
  highlights: string[];
  weaknesses: Weakness[];
}

export interface ReportItem extends Question {
  chain: Turn[];
  skipped: boolean;
  scores?: Scores;
  comment?: string;
  missed?: string[];
}

export interface InterviewRecord {
  at: number;
  role: string;
  level: string;
  items: ReportItem[];
  report: Review;
  total: number;
  focus?: string;
}

export type AskMode = 'open' | 'follow' | 'next';

export interface ServerConfig {
  mock: boolean;
  model: string;
}
