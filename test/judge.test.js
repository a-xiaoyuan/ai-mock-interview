const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const {
  normalizeOutput,
  compareOutput,
  caseStatus,
  normCases,
  parseCaseBlock,
  summarizeJudge,
  mockJudgeFromCases,
  MAX_CASES,
} = require('../lib/cases');
const { ALGO_PROBLEMS } = require('../lib/algo-bank');
const { applyPreset, withMockAlgo } = require('../lib/preset');
const { parsePack } = require('../lib/packs');
const { judgeCases, detectLanguages, sandboxStatus } = require('../lib/runner');

const root = path.join(__dirname, '..');

test('输出对比忽略换行符、行尾空格和首尾空行', () => {
  assert.equal(normalizeOutput('3\r\n'), '3');
  assert.equal(normalizeOutput('3 \n'), '3');
  assert.equal(normalizeOutput('\n\n3\n\n'), '3');
  assert.equal(compareOutput('3\n', '3'), true);
  assert.equal(compareOutput('3\r\n', '3\n'), true);
  assert.equal(compareOutput('1\n2 \n', '1\n2'), true);
  assert.equal(compareOutput('1 2', '12'), false);
  assert.equal(compareOutput(' 1', '1'), false);
  assert.equal(compareOutput('', '\n'), true);
});

test('判题状态：超时、超限、退出码、答案、通过', () => {
  const base = { stage: 'run', exitCode: 0, stdout: '3', stderr: '', timeMs: 1, timedOut: false, truncated: false };
  assert.equal(caseStatus(base, '3\n'), 'passed');
  assert.equal(caseStatus({ ...base, stdout: '4' }, '3'), 'wrong_answer');
  assert.equal(caseStatus({ ...base, exitCode: 1 }, '3'), 'runtime_error');
  assert.equal(caseStatus({ ...base, timedOut: true }, '3'), 'timeout');
  assert.equal(caseStatus({ ...base, truncated: true }, '3'), 'truncated');
  assert.equal(caseStatus({ ...base, stage: 'compile', exitCode: 1 }, '3'), 'compile_error');
  assert.equal(caseStatus({ ...base, stage: 'compile', timedOut: true, exitCode: -1 }, '3'), 'timeout');
});

test('用例校验：丢掉多余的，截断过长的，跳过不像用例的项', () => {
  const many = Array.from({ length: MAX_CASES + 2 }, (_, i) => ({ name: `n${i}`, input: String(i), output: '1' }));
  assert.equal(normCases(many).length, MAX_CASES);
  assert.equal(normCases([{ input: 'a'.repeat(30000), output: 'b' }])[0].input.length, 20000);
  assert.deepEqual(normCases([null, 'x', { name: '空' }]), []);
  assert.deepEqual(normCases([{ input: '', output: '' }]), [{ name: '', input: '', output: '' }]);
});

test('题包用例块：名称、空输出、缺少分隔符', () => {
  const ok = parseCaseBlock('name: 样例\n1 2\n---\n3\n===\nname: 空输出\n\n---\n');
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.cases, [
    { name: '样例', input: '1 2', output: '3' },
    { name: '空输出', input: '', output: '' },
  ]);
  const bad = parseCaseBlock('1 2\n3');
  assert.equal(bad.cases.length, 0);
  assert.ok(bad.errors.length);
});

test('题包解析：算法题带上用例，八股题写用例算错，未闭合也算错', () => {
  const good = parsePack(
    [
      '---',
      'id: demo-pack',
      'name: 示例',
      'description: 测用例',
      'roles: [后端开发（Java）]',
      '---',
      '## 面试官指引',
      '出一道带用例的算法题。',
      '## 评分要点',
      '看用例过了没有。',
      '## 题目',
      '### [算法] 两数之和',
      '读入两个整数并输出和。',
      '- 正确处理负数',
      '- 时间 O(1)',
      '```cases',
      'name: 样例',
      '1 2',
      '---',
      '3',
      '```',
      '### [八股] 没有用例',
      '这是一道口述题？',
      '- 要点一',
      '- 要点二',
      '',
    ].join('\n'),
    'demo-pack.md',
  );
  assert.deepEqual(good.errors, []);
  assert.equal(good.pack.questions[0].cases.length, 1);
  assert.equal(good.pack.questions[0].cases[0].output, '3');
  assert.equal(good.pack.questions[1].cases, undefined);

  const wrongStage = parsePack(
    [
      '---',
      'id: demo-pack',
      'name: 示例',
      'roles: [后端开发（Java）]',
      '---',
      '## 面试官指引',
      '指引',
      '## 评分要点',
      '要点',
      '## 题目',
      '### [八股] 不该有用例',
      '口述题。',
      '- 要点一',
      '- 要点二',
      '```cases',
      '---',
      '1',
      '```',
      '',
    ].join('\n'),
    'demo-pack.md',
  );
  assert.ok(wrongStage.errors.some((e) => e.includes('只有算法题')));

  const open = parsePack(
    ['---', 'id: demo-pack', 'name: 示例', 'roles: [后端开发（Java）]', '---', '## 面试官指引', '指引', '## 评分要点', '要点', '## 题目', '### [算法] 没闭合', '题面', '- 要点一', '- 要点二', '```cases', '1', '---', '1', ''].join('\n'),
    'demo-pack.md',
  );
  assert.ok(open.errors.some((e) => e.includes('没有闭合')));
});

test('内置 Java 题包里的爬楼梯用例能被解析', () => {
  const text = fs.readFileSync(path.join(root, 'packs/java-backend-campus.md'), 'utf8');
  const { pack, errors } = parsePack(text, 'java-backend-campus.md');
  assert.deepEqual(errors, []);
  const q = pack.questions.find((item) => item.topic === '爬楼梯');
  assert.ok(q);
  assert.deepEqual(
    q.cases.map((c) => [c.name, c.input, c.output]),
    [
      ['三阶', '3', '3'],
      ['一阶', '1', '1'],
      ['两阶', '2', '2'],
      ['五阶', '5', '8'],
    ],
  );
  const lru = pack.questions.find((item) => item.topic === 'LRU 缓存');
  assert.equal(lru.cases, undefined);
});

test('预置题按编号贴回，题包有用例时换成原文', () => {
  const algo = applyPreset({ stage: '八股', topic: '占位', question: '占位', points: ['占位'] }, 'A1', null);
  assert.equal(algo.stage, '算法');
  assert.equal(algo.topic, ALGO_PROBLEMS[0].topic);
  assert.equal(algo.question, ALGO_PROBLEMS[0].question);
  assert.equal(algo.from, undefined);
  assert.equal(algo.cases.length, ALGO_PROBLEMS[0].cases.length);

  assert.equal(applyPreset({ stage: '算法', topic: 'x', question: 'y', points: ['a', 'b'] }, 'A99', null).question, 'y');

  const pack = {
    id: 'java-backend-campus',
    questions: [
      { stage: '八股', topic: 'HashMap', question: '题包原文', points: ['校对要点一', '校对要点二'] },
      { stage: '算法', topic: '爬楼梯', question: '题包题面', points: ['递推', '溢出'], cases: [{ name: '一阶', input: '1', output: '1' }] },
    ],
  };
  const oral = applyPreset({ stage: '八股', topic: '模型改写', question: '模型改写的题面', points: ['模型要点'] }, 'P1', pack);
  assert.equal(oral.question, '模型改写的题面');
  assert.deepEqual(oral.points, ['校对要点一', '校对要点二']);
  assert.equal(oral.cases, undefined);
  assert.equal(oral.pack, pack.id);

  const coded = applyPreset({ stage: '算法', topic: '模型', question: '模型编的题', points: ['模型'] }, 'P2', pack);
  assert.equal(coded.question, '题包题面');
  assert.equal(coded.cases[0].output, '1');

  const both = applyPreset({ stage: '算法', topic: '模型', question: '模型', points: ['a', 'b'] }, 'P2 A1', pack);
  assert.equal(both.question, '题包题面');
  assert.notEqual(both.topic, ALGO_PROBLEMS[0].topic);
});

test('mock 模式会补一道预置算法题，专项练习和短面试不补', () => {
  const base = { questions: [{ question: '一' }, { question: '二', from: 'P1' }, { question: '三', from: 'P2' }] };
  const added = withMockAlgo(base, { count: 3 });
  assert.equal(added.questions[0].from, 'A1');
  assert.equal(added.questions[1].from, 'P1');
  assert.equal(withMockAlgo(base, { count: 3, focus: '缓存' }).questions[0].from, undefined);
  assert.equal(withMockAlgo(base, { count: 2 }).questions[0].from, undefined);
  const has = { questions: [{ question: '已有', cases: [{ input: '1', output: '1' }] }] };
  assert.equal(withMockAlgo(has, { count: 3 }).questions[0].cases.length, 1);
});

test('判题摘要能被 mock 评分认出来，后一次结果为准', () => {
  const summary = summarizeJudge({
    passed: 1,
    total: 2,
    compileError: false,
    cases: [
      { name: '样例', status: 'passed', passed: true, timeMs: 12, stdout: '3', stderr: '', input: '1 2', expected: '3' },
      { name: '负数', status: 'wrong_answer', passed: false, timeMs: 8, stdout: '5', stderr: '', input: '-8 3', expected: '-5' },
    ],
  });
  assert.match(summary, /^判题结果：1\/2 通过/);
  assert.match(summary, /负数：答案错误/);
  assert.doesNotMatch(summary, /样例：答案错误/);
  const judged = mockJudgeFromCases(`前面有一句。\n${summary}`, 0);
  assert.equal(judged.scores.accuracy, 3);
  assert.equal(judged.verdict, 'follow_up');
  assert.match(judged.direction, /用例/);

  const all = mockJudgeFromCases('判题结果：0/2 通过\n后来又交了一次\n判题结果：2/2 通过', 1);
  assert.equal(all.scores.accuracy, 4);
  assert.equal(all.verdict, 'next');

  const compiled = summarizeJudge({
    passed: 0,
    total: 2,
    compileError: true,
    cases: [
      { name: '用例 1', status: 'compile_error', passed: false, timeMs: 20, stdout: '', stderr: 'error: expected', input: '1', expected: '1' },
      { name: '用例 2', status: 'compile_error', passed: false, timeMs: 20, stdout: '', stderr: 'error: expected', input: '2', expected: '2' },
    ],
  });
  assert.equal(compiled.split('error: expected').length, 2);
  assert.match(mockJudgeFromCases(compiled, 0).comment, /编译失败/);
  assert.equal(mockJudgeFromCases('只写了思路，没有代码', 0), null);
});

const SOLVERS = {
  'a-plus-b': `const fs = require('fs');
const [a, b] = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);
console.log(a + b);
`,
  'valid-parentheses': `const fs = require('fs');
const s = fs.readFileSync(0, 'utf8').trim();
const pair = { ')': '(', ']': '[', '}': '{' };
const st = [];
let ok = true;
for (const ch of s) {
  if ('([{'.includes(ch)) st.push(ch);
  else if (st.pop() !== pair[ch]) { ok = false; break; }
}
if (st.length) ok = false;
console.log(ok ? 'Yes' : 'No');
`,
  'max-subarray': `const fs = require('fs');
const data = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);
const a = data.slice(1, 1 + data[0]);
let best = a[0], cur = a[0];
for (let i = 1; i < a.length; i++) {
  cur = Math.max(a[i], cur + a[i]);
  best = Math.max(best, cur);
}
console.log(best);
`,
  'binary-search': `const fs = require('fs');
const lines = fs.readFileSync(0, 'utf8').trim().split(/\\n/);
const [n, target] = lines[0].split(/\\s+/).map(Number);
const a = lines[1].split(/\\s+/).map(Number);
let lo = 0, hi = n - 1, ans = -1;
while (lo <= hi) {
  const mid = (lo + hi) >> 1;
  if (a[mid] === target) { ans = mid; break; }
  if (a[mid] < target) lo = mid + 1;
  else hi = mid - 1;
}
console.log(ans);
`,
};

test('预置算法题的参考解能通过全部用例，写错的解会逐例失败', async () => {
  for (const problem of ALGO_PROBLEMS) {
    const ok = await judgeCases({ language: 'javascript', code: SOLVERS[problem.id], cases: problem.cases });
    assert.equal(ok.compileError, false, problem.id);
    assert.equal(ok.passed, ok.total, `${problem.id}: ${ok.summary}`);
  }
  const wrong = await judgeCases({
    language: 'javascript',
    code: `console.log(0);\n`,
    cases: [
      { name: '会过', input: '', output: '0' },
      { name: '不会过', input: '1', output: '1' },
    ],
  });
  assert.equal(wrong.passed, 1);
  assert.equal(wrong.cases[0].status, 'passed');
  assert.equal(wrong.cases[1].status, 'wrong_answer');
  assert.match(wrong.summary, /判题结果：1\/2 通过/);
});

test('运行错误、超时，以及密钥环境变量不会传给用户代码', { timeout: 60_000 }, async () => {
  const isolated = sandboxStatus().useContainer;
  const crashed = await judgeCases({
    language: 'javascript',
    code: `process.exit(2);\n`,
    cases: [{ name: '崩了', input: '', output: '' }],
  });
  assert.equal(crashed.cases[0].status, 'runtime_error');
  assert.equal(crashed.passed, 0);

  const timed = await judgeCases({
    language: 'javascript',
    code: `while (true) {}\n`,
    cases: [{ name: '死循环', input: '', output: '1' }],
    // 容器要先启动，时限太短会在程序跑起来之前被杀掉，仍然算超时，但这里留出启动时间
    timeLimitMs: isolated ? 8000 : 800,
  });
  assert.equal(timed.cases[0].status, 'timeout');
  assert.equal(timed.passed, 0);

  const keys = ['LLM_API_KEY', 'OPENAI_API_KEY', 'API_KEY', 'MY_SECRET', 'AUTH_TOKEN', 'DB_PASSWORD', 'SOME_KEY'];
  const previous = new Map(keys.map((k) => [k, process.env[k]]));
  process.env.MOCK_INTERVIEW_PLAIN = 'visible';
  for (const k of keys) process.env[k] = `secret-${k}`;
  // 本机进程会带上非密钥变量；容器只带固定环境变量，连这个普通变量也不会出现
  const expected = JSON.stringify({ leak: [], plain: isolated ? '' : 'visible' });
  try {
    const probe = await judgeCases({
      language: 'javascript',
      code: `const keys = ${JSON.stringify(keys)};
const leak = keys.filter((k) => process.env[k]);
console.log(JSON.stringify({ leak, plain: process.env.MOCK_INTERVIEW_PLAIN || '' }));
`,
      cases: [{ name: '环境', input: '', output: expected }],
    });
    assert.equal(probe.cases[0].status, 'passed', probe.cases[0].stdout + probe.cases[0].stderr);
  } finally {
    delete process.env.MOCK_INTERVIEW_PLAIN;
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('题包里的爬楼梯用例能被参考解通过', async () => {
  const text = fs.readFileSync(path.join(root, 'packs/java-backend-campus.md'), 'utf8');
  const { pack } = parsePack(text, 'java-backend-campus.md');
  const q = pack.questions.find((item) => item.topic === '爬楼梯');
  const code = `const n = Number(require('fs').readFileSync(0, 'utf8'));
let a = 1, b = 1;
for (let i = 0; i < n; i++) { const c = a + b; a = b; b = c; }
console.log(a);
`;
  const result = await judgeCases({ language: 'javascript', code, cases: q.cases });
  assert.equal(result.passed, result.total, result.summary);
});

test('有 C++ 时，编译失败只报一次，不逐例运行', async (t) => {
  if (!detectLanguages().some((l) => l.id === 'cpp')) {
    t.skip('本机没有 C++ 编译器');
    return;
  }
  const result = await judgeCases({
    language: 'cpp',
    code: `int main( { }\n`,
    cases: [
      { name: '一', input: '1', output: '1' },
      { name: '二', input: '2', output: '2' },
    ],
  });
  assert.equal(result.compileError, true);
  assert.equal(result.passed, 0);
  assert.ok(result.cases.every((c) => c.status === 'compile_error'));
  assert.match(result.summary, /判题结果：编译失败，2 个用例都没有运行/);
  assert.equal(result.summary.split('一').length, 1);
});

function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      { hostname: '127.0.0.1', port, path: pathname, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* 非 JSON */ }
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    req.on('error', reject);
    if (data) req.end(data);
    else req.end();
  });
}

async function waitFor(port) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 8000) {
    try {
      const res = await request(port, 'GET', '/api/config');
      if (res.status === 200) return res.json;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`服务没有起来：${last}`);
}

test('接口：大纲带上预置用例，提交后能判题，关闭运行器时拒绝', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LLM_API_KEY: '', CODE_RUNNER: 'local', CODE_SANDBOX: 'auto' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (c) => { logs += c; });
  child.stderr.on('data', (c) => { logs += c; });
  try {
    const config = await waitFor(port);
    assert.equal(config.mock, true);
    assert.ok(config.runner.some((l) => l.id === 'javascript'));
    assert.equal(config.sandbox.mode, 'auto');
    assert.equal(config.sandbox.error, null);
    if (config.sandbox.active) assert.equal(config.sandbox.fallback, null);
    else assert.ok(config.sandbox.fallback);

    const plan = await request(port, 'POST', '/api/plan', {
      role: '测试开发',
      level: '社招',
      count: 5,
      pack: 'none',
      resume: '',
      jd: '',
    });
    assert.equal(plan.status, 200, plan.text);
    const algo = plan.json.questions.find((q) => q.cases?.length);
    assert.ok(algo, `大纲里应该有一道带用例的题：${JSON.stringify(plan.json.questions.map((q) => q.topic))}`);
    assert.equal(algo.stage, '算法');
    assert.equal(algo.from, undefined);

    const judged = await request(port, 'POST', '/api/judge-code', {
      language: 'javascript',
      code: SOLVERS[ALGO_PROBLEMS[0].id],
      cases: algo.cases,
    });
    assert.equal(judged.status, 200, judged.text);
    assert.equal(judged.json.passed, judged.json.total);
    assert.match(judged.json.summary, /判题结果：/);

    const custom = await request(port, 'POST', '/api/run', {
      language: 'javascript',
      code: `process.stdout.write(require('fs').readFileSync(0, 'utf8'));\n`,
      stdin: 'hello',
    });
    assert.equal(custom.status, 200, custom.text);
    assert.equal(custom.json.stdout, 'hello');
  } finally {
    child.kill();
  }

  const offPort = port + 1;
  const off = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(offPort), LLM_API_KEY: '', CODE_RUNNER: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitFor(offPort);
    const denied = await request(offPort, 'POST', '/api/judge-code', {
      language: 'javascript',
      code: 'console.log(1)',
      cases: [{ input: '', output: '1' }],
    });
    assert.equal(denied.status, 500);
    assert.match(denied.json.error, /本机开放/);
    const config = await request(offPort, 'GET', '/api/config');
    assert.deepEqual(config.json.runner, []);
  } finally {
    off.kill();
    if (logs.includes('Error') && logs.includes('EADDRINUSE')) throw new Error(logs);
  }
});
