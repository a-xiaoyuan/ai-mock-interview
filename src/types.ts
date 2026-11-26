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

/** 算法题的预置测试用例：标准输入和期望的标准输出 */
export interface TestCase {
  /** 展示名，可空 */
  name?: string;
  input: string;
  output: string;
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
  /** 有则提交代码时自动判题 */
  cases?: TestCase[];
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

export interface SandboxStatus {
  mode: 'auto' | 'on' | 'off';
  /** 这次实际在容器里跑 */
  active: boolean;
  runtime: string | null;
  image: string | null;
  /** 没使用容器时的原因；容器启用时为 null */
  fallback: 'no-runtime' | 'no-image' | 'probe-failed' | 'disabled' | null;
  /** 要求沙箱但没就绪时的说明；能跑时为 null */
  error: string | null;
}

export interface ServerConfig {
  mock: boolean;
  model: string;
  /** 当前可以运行代码的语言；为空表示不能运行（关闭了、不是本机访问，或要求沙箱但沙箱没就绪） */
  runner?: RunnerLanguage[];
  /** 运行接口不可用时为 null */
  sandbox?: SandboxStatus | null;
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

export type CaseStatus = 'passed' | 'wrong_answer' | 'runtime_error' | 'timeout' | 'truncated' | 'compile_error';

export interface CaseResult {
  name: string;
  status: CaseStatus;
  passed: boolean;
  timeMs: number;
  stdout: string;
  stderr: string;
  input: string;
  expected: string;
}

/** /api/judge-code 的返回。summary 是给面试官看的文字摘要 */
export interface JudgeResult {
  passed: number;
  total: number;
  /** 编译阶段就失败了，用例没有真正运行 */
  compileError: boolean;
  cases: CaseResult[];
  summary: string;
}
