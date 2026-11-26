// 预置测试用例：校验、输出对比、判题摘要。
// 比较规则：统一换行，去掉每行行尾空格，再去掉整段开头和结尾的空行；其余字符都要一致。

const MAX_CASES = 8;
const MAX_CASE_CHARS = 20_000;
const MAX_CASE_NAME = 40;

const STATUS_TEXT = {
  passed: '通过',
  wrong_answer: '答案错误',
  runtime_error: '运行错误',
  timeout: '超时',
  truncated: '输出超限',
  compile_error: '编译失败',
};

function normalizeOutput(s) {
  const lines = String(s ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function compareOutput(actual, expected) {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

/** 单次运行对应的判题状态。run.stage 为 compile 时表示编译阶段。 */
function caseStatus(run, expected) {
  if (run.stage === 'compile') return run.timedOut ? 'timeout' : run.truncated ? 'truncated' : 'compile_error';
  if (run.timedOut) return 'timeout';
  if (run.truncated) return 'truncated';
  if (run.exitCode !== 0) return 'runtime_error';
  if (!compareOutput(run.stdout, expected)) return 'wrong_answer';
  return 'passed';
}

function normCases(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list) {
    if (out.length >= MAX_CASES) break;
    if (!c || typeof c !== 'object') continue;
    if (!('input' in c) && !('output' in c)) continue;
    out.push({
      name: String(c.name || '').trim().slice(0, MAX_CASE_NAME),
      input: String(c.input ?? '').slice(0, MAX_CASE_CHARS),
      output: String(c.output ?? '').slice(0, MAX_CASE_CHARS),
    });
  }
  return out;
}

/**
 * 解析题包 ```cases 代码块。
 * 用例之间用单独一行的 === 分隔；每个用例用单独一行的 --- 分开输入和输出。
 * 输入的第一行如果是「name: 名称」，则当作展示名，不计入输入。
 */
function parseCaseBlock(body) {
  const errors = [];
  const lines = String(body ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const chunks = [];
  let cur = [];
  const push = () => {
    if (cur.some((l) => l.trim())) chunks.push(cur);
    cur = [];
  };
  for (const line of lines) {
    if (line.trim() === '===') push();
    else cur.push(line);
  }
  push();
  if (!chunks.length) {
    errors.push('测试用例是空的');
    return { cases: [], errors };
  }
  const cases = [];
  for (const chunk of chunks) {
    const idx = chunk.findIndex((l) => l.trim() === '---');
    if (idx < 0) {
      errors.push('用例缺少单独一行的 --- 来分隔输入和输出');
      continue;
    }
    let inputLines = chunk.slice(0, idx);
    let outputLines = chunk.slice(idx + 1);
    let name = '';
    if (inputLines.length && /^name:\s*/.test(inputLines[0])) {
      name = inputLines[0].replace(/^name:\s*/, '').trim().slice(0, MAX_CASE_NAME);
      inputLines = inputLines.slice(1);
    }
    while (inputLines.length && inputLines[0] === '') inputLines.shift();
    while (inputLines.length && inputLines[inputLines.length - 1] === '') inputLines.pop();
    while (outputLines.length && outputLines[outputLines.length - 1] === '') outputLines.pop();
    cases.push({ name, input: inputLines.join('\n'), output: outputLines.join('\n') });
  }
  return { cases, errors };
}

function clip(s, n) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}\n…（共 ${t.length} 字，已截断）` : t;
}

function fence(s, n = 400) {
  const body = clip(String(s ?? '').replace(/\s+$/, ''), n);
  return '```\n' + (body || '（空）') + '\n```';
}

/** 给面试官和聊天记录看的判题摘要。编译失败只写一次，不把每个用例重复一遍。 */
function summarizeJudge(result) {
  const cases = result.cases || [];
  if (result.compileError) {
    const status = cases[0]?.status;
    const title = status === 'timeout' ? '编译超时' : status === 'truncated' ? '编译输出超限' : '编译失败';
    return `判题结果：${title}，${result.total} 个用例都没有运行\n${fence(cases[0]?.stderr || '', 800)}`;
  }
  const lines = [`判题结果：${result.passed}/${result.total} 通过`];
  for (const c of cases) {
    const label = c.name || '用例';
    if (c.passed) {
      lines.push(`- ${label}：通过（${c.timeMs} ms）`);
      continue;
    }
    lines.push(`- ${label}：${STATUS_TEXT[c.status] || c.status}（${c.timeMs} ms）`);
    lines.push(`  输入：\n${fence(c.input)}`);
    lines.push(`  期望输出：\n${fence(c.expected)}`);
    lines.push(`  实际输出：\n${fence(c.stdout)}`);
    if (c.stderr) lines.push(`  错误输出：\n${fence(c.stderr)}`);
  }
  return lines.join('\n');
}

/**
 * mock 模式没有模型，就从候选人消息里最后一条判题摘要估一个分数。
 * 认的是 summarizeJudge 打出来的抬头。没有判题摘要时返回 null。
 */
function mockJudgeFromCases(text, depth) {
  const src = String(text ?? '');
  let last = null;
  for (const m of src.matchAll(/判题结果：(编译失败|编译超时|编译输出超限|\d+\/\d+ 通过)/g)) last = m;
  if (!last) return null;
  const follow = depth < 1 ? 'follow_up' : 'next';
  const kind = last[1];
  if (kind.startsWith('编译')) {
    return {
      scores: { accuracy: 1, depth: 1, practical: 2, expression: 3 },
      verdict: follow,
      direction: '代码没有编译通过，让候选人看报错自己改',
      comment: `${kind}，预置用例还没跑起来。（mock 模式）`,
      missed: ['代码需要能编译并运行'],
    };
  }
  const nums = kind.match(/(\d+)\/(\d+)/);
  const passed = Number(nums[1]);
  const total = Number(nums[2]);
  if (!total || passed > total) return null;
  const all = passed === total;
  const base = all ? 4 : passed === 0 ? 2 : 3;
  return {
    scores: { accuracy: base, depth: all ? 3 : 2, practical: 3, expression: 3 },
    verdict: follow,
    direction: all ? '追问时间和空间复杂度，以及能不能再优化' : '追问没有通过的用例，看边界差在哪里',
    comment: all ? `预置用例 ${passed}/${total} 都通过了。（mock 模式）` : `预置用例通过了 ${passed}/${total}。（mock 模式）`,
    missed: all ? [] : ['还有预置用例没有通过'],
  };
}

module.exports = {
  MAX_CASES,
  MAX_CASE_CHARS,
  STATUS_TEXT,
  normalizeOutput,
  compareOutput,
  caseStatus,
  normCases,
  parseCaseBlock,
  summarizeJudge,
  mockJudgeFromCases,
};
