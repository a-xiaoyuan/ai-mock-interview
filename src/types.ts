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
  /** 题包选择：'auto' 按岗位和级别自动匹配（默认），'none' 不用，其余为题包 id */
  pack?: string;
}

export interface Question {
  stage: string;
  topic: string;
  question: string;
  points: string[];
  /** 选自面经题库时为题库条目 id */
  from?: string;
  /** 选自题包时为题包 id */
  pack?: string;
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
  /** 这场面试实际使用的题包 */
  pack?: { id: string; name: string } | null;
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
  /** 使用的题包名称 */
  pack?: string;
}

/** /api/packs 返回的题包概要 */
export interface PackSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  author: string;
  roles: string[];
  levels: string[];
  questionCount: number;
}

export type AskMode = 'open' | 'follow' | 'next';

export interface ServerConfig {
  mock: boolean;
  model: string;
  /** 本机可以运行代码的语言；为空表示不能运行（服务端关闭了，或不是本机访问） */
  runner?: RunnerLanguage[];
}

export type LanguageId = 'javascript' | 'python' | 'java' | 'cpp' | 'go';

export interface RunnerLanguage {
  id: LanguageId;
  name: string;
  version: string;
}

export interface RunResult {
  /** compile：编译阶段就失败了；run：程序运行的结果 */
  stage: 'compile' | 'run';
  exitCode: number;
  stdout: string;
  stderr: string;
  timeMs: number;
  timedOut: boolean;
  truncated: boolean;
}
