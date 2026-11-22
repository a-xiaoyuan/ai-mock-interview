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
}

export interface Question {
  stage: string;
  topic: string;
  question: string;
  points: string[];
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
}

export type AskMode = 'open' | 'follow' | 'next';

export interface ServerConfig {
  mock: boolean;
  model: string;
}
