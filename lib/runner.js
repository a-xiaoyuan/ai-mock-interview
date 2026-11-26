// 算法手撕：运行候选人写的代码（读标准输入、写标准输出），并按预置用例逐个对比输出。
// 自定义运行和自动判题是同一套机制。
// CODE_SANDBOX=auto（默认）：Docker / Podman 和沙箱镜像都可用时在容器里跑；否则回退到本机进程，启动日志会写明原因。
// CODE_SANDBOX=on：必须用容器，运行时或镜像没就绪就报错，不会改回本机进程。
// CODE_SANDBOX=off：始终用本机进程，代码以服务进程的权限运行，不是安全沙箱。
// 谁可以调用由 server.js 的 CODE_RUNNER 决定。本机进程和容器都不会把密钥类环境变量传给用户代码；容器只带固定的一小份环境变量。

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { caseStatus, normCases, summarizeJudge } = require('./cases');
const sandbox = require('./sandbox');

const TIME_LIMIT_MS = 10_000; // 含编译时间；容器启动也算在内
const OUTPUT_LIMIT = 64 * 1024;
const MAX_CONCURRENT = 2;

/** 候选的语言环境：cmds 依次尝试，第一个能跑通 version 的就用它。只在回退到本机进程时使用。 */
const LANGS = [
  {
    id: 'javascript',
    name: 'JavaScript',
    file: 'main.js',
    cmds: [process.execPath],
    versionArgs: ['--version'],
    run: (cmd) => [[cmd, ['main.js']]],
  },
  {
    id: 'python',
    name: 'Python',
    file: 'main.py',
    // Windows 上的 python3 可能是应用商店的占位程序，所以要真的跑一下 --version
    cmds: process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'],
    versionArgs: ['--version'],
    versionMatch: /Python 3/,
    run: (cmd) => [[cmd, ['-X', 'utf8', 'main.py']]],
  },
  {
    id: 'java',
    name: 'Java',
    file: 'Main.java',
    cmds: ['java'],
    versionArgs: ['-version'],
    // JDK 11+ 可以直接运行单个源文件；JDK 18+ 用 stdout.encoding 指定输出编码，避免 Windows 上中文乱码
    versionMatch: /version "(1[1-9]|[2-9]\d)/,
    run: (cmd) => [[cmd, ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-Xss64m', 'Main.java']]],
  },
  {
    id: 'cpp',
    name: 'C++',
    file: 'main.cpp',
    cmds: ['g++', 'clang++'],
    versionArgs: ['--version'],
    run: (cmd, dir) => [
      [cmd, ['-std=c++17', '-O2', '-o', 'main', 'main.cpp']],
      [path.join(dir, process.platform === 'win32' ? 'main.exe' : 'main'), []],
    ],
  },
  {
    id: 'go',
    name: 'Go',
    file: 'main.go',
    cmds: ['go'],
    versionArgs: ['version'],
    versionMatch: /go version/,
    run: (cmd, dir) => [
      [cmd, ['build', '-o', process.platform === 'win32' ? 'main.exe' : 'main', 'main.go']],
      [path.join(dir, process.platform === 'win32' ? 'main.exe' : 'main'), []],
    ],
  },
];

/** 本机运行时不把服务端的密钥环境变量带给候选人的代码。非密钥变量仍会传（容器路径不会）。 */
function childEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!sandbox.isSecretEnvName(key)) env[key] = value;
  return { ...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' };
}

let hostLangs = null;
let containerLangs = null;
let planCache = null;
let planKey = null;

function resetRuntimeCache() {
  hostLangs = null;
  containerLangs = null;
  planCache = null;
  planKey = null;
}

function remember(plan, key) {
  if (planKey !== key) containerLangs = null;
  planCache = plan;
  planKey = key;
  return plan;
}

/** 当前这次进程该用容器还是本机。结果会缓存；改环境变量后测试可调用 resetRuntimeCache。 */
function executionPlan() {
  const mode = sandbox.readMode();
  if (mode === 'off') return remember({ mode, useContainer: false, runtime: null, image: null, fallback: 'disabled', error: null, probeError: null }, 'off');
  let image;
  try {
    image = sandbox.imageName();
  } catch (error) {
    return remember(
      {
        mode,
        useContainer: false,
        runtime: null,
        image: null,
        fallback: mode === 'auto' ? 'no-image' : null,
        error: mode === 'on' ? `${error.message}。CODE_SANDBOX=on 时不会改回本机进程。` : null,
        probeError: null,
      },
      `${mode}\0invalid-image`,
    );
  }
  const key = `${mode}\0${image}`;
  if (planCache && planKey === key) return planCache;
  const runtime = sandbox.inspectRuntime();
  const imageReady = runtime ? sandbox.imageExists(runtime, image) : false;
  return remember({ ...sandbox.resolveSandbox({ mode, runtime, image, imageReady }), probeError: null }, key);
}

function detectHostLanguages() {
  if (hostLangs) return hostLangs;
  hostLangs = [];
  for (const lang of LANGS) {
    for (const cmd of lang.cmds) {
      try {
        const result = spawnSync(cmd, lang.versionArgs, { encoding: 'utf8', timeout: 8000, windowsHide: true });
        const out = `${result.stdout || ''}${result.stderr || ''}`;
        if (result.status === 0 && (!lang.versionMatch || lang.versionMatch.test(out))) {
          hostLangs.push({
            id: lang.id,
            name: lang.name,
            file: lang.file,
            version: out.trim().split(/\r?\n/)[0].slice(0, 80),
            steps: (dir) => lang.run(cmd, dir),
          });
          break;
        }
      } catch {
        /* 没装这个语言 */
      }
    }
  }
  return hostLangs;
}

/** 容器探测失败时：auto 回退到本机并记原因；on 写成错误，后续运行直接拒绝。 */
function languagesFor(plan) {
  if (plan.error) return [];
  if (!plan.useContainer) return detectHostLanguages();
  if (containerLangs) return containerLangs;
  const probed = sandbox.probe(plan);
  if (!probed.ok) {
    plan.useContainer = false;
    if (plan.mode === 'auto') {
      plan.fallback = 'probe-failed';
      plan.probeError = probed.error;
      plan.error = null;
      return detectHostLanguages();
    }
    plan.fallback = null;
    plan.probeError = probed.error;
    plan.error = `容器沙箱没有就绪：镜像无法运行（${probed.error || '未知原因'}）。CODE_SANDBOX=on 时不会改回本机进程。`;
    containerLangs = [];
    return [];
  }
  containerLangs = probed.languages;
  return containerLangs;
}

function languageError(plan, language) {
  if (plan.useContainer) return `沙箱镜像里没有可用的 ${language} 运行环境`;
  return `本机没有可用的 ${language} 运行环境`;
}

function requireLanguage(language) {
  const plan = executionPlan();
  languagesFor(plan);
  if (plan.error) throw new Error(plan.error);
  const lang = languagesFor(plan).find((item) => item.id === language);
  if (!lang) throw new Error(languageError(plan, language));
  return { plan, lang };
}

/** 结束进程及其子进程（Windows 上 kill 只会结束直接子进程） */
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
}

function runHostStep([cmd, args], { cwd, stdin, deadline }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: childEnv(), windowsHide: true });
    } catch (error) {
      return resolve({ exitCode: -1, stdout: '', stderr: String(error.message), timeMs: 0, timedOut: false, truncated: false });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, Math.max(0, deadline - Date.now()));
    const collect = (which) => (chunk) => {
      const text = chunk.toString('utf8');
      if (which === 'out') stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > OUTPUT_LIMIT) {
        truncated = true;
        killTree(child);
      }
    };
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));
    child.on('error', (error) => {
      stderr += error.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout: stdout.replace(/\r\n/g, '\n').slice(0, OUTPUT_LIMIT),
        stderr: stderr.replace(/\r\n/g, '\n').slice(0, OUTPUT_LIMIT),
        timeMs: Date.now() - started,
        timedOut,
        truncated,
      });
    });
    child.stdin.on('error', () => {}); // 程序不读输入就退出时，写 stdin 会报 EPIPE
    child.stdin.end(stdin);
  });
}

function makeRunner(plan) {
  if (!plan.useContainer) return runHostStep;
  return (step, options) => sandbox.runContainerStep(plan, step, { ...options, outputLimit: OUTPUT_LIMIT });
}

let running = 0;

async function withDir(lang, code, plan, fn) {
  if (running >= MAX_CONCURRENT) throw new Error('正在运行的代码太多，请稍后再试');
  running++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-interview-run-'));
  try {
    fs.writeFileSync(path.join(dir, lang.file), code);
    if (plan.useContainer) sandbox.prepareWorkDir(dir);
    return await fn(dir);
  } finally {
    running--;
    // Windows 上进程刚退出时文件可能还被占用，稍后再删
    const clean = () => fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }, () => {});
    setTimeout(clean, 500);
  }
}

/** 检测当前模式下可运行的语言（容器或本机，只探测一次） */
function detectLanguages() {
  const plan = executionPlan();
  return languagesFor(plan).map(({ id, name, version }) => ({ id, name, version }));
}

function sandboxStatus() {
  const plan = executionPlan();
  languagesFor(plan);
  return {
    mode: plan.mode,
    useContainer: plan.useContainer,
    runtime: plan.runtime,
    image: plan.image,
    fallback: plan.useContainer ? null : plan.fallback,
    error: plan.error,
    probeError: plan.probeError,
  };
}

function describeSandbox(status = sandboxStatus()) {
  return sandbox.describeStatus(status);
}

/** 运行一段代码，返回 { stage: 'compile'|'run', exitCode, stdout, stderr, timeMs, timedOut, truncated } */
async function runCode({ language, code, stdin, timeLimitMs = TIME_LIMIT_MS }) {
  const { plan, lang } = requireLanguage(language);
  return withDir(lang, code, plan, async (dir) => {
    const deadline = Date.now() + timeLimitMs;
    const steps = lang.steps(dir);
    const run = makeRunner(plan);
    let result;
    for (let i = 0; i < steps.length; i++) {
      const last = i === steps.length - 1;
      result = await run(steps[i], { cwd: dir, stdin: last ? stdin : '', deadline });
      result.stage = last ? 'run' : 'compile';
      if (!last && (result.exitCode !== 0 || result.timedOut)) break; // 编译失败
    }
    return result;
  });
}

/**
 * 按预置用例判题。需要编译的语言只编译一次，再对每个用例单独运行。
 * 编译、每个用例各自有 timeLimitMs（默认 10 秒）。自定义运行仍是编译和运行共用一个时限，见 runCode。
 * 编译失败时不运行用例。返回 { passed, total, compileError, cases, summary }。
 */
async function judgeCases({ language, code, cases, timeLimitMs = TIME_LIMIT_MS }) {
  const { plan, lang } = requireLanguage(language);
  const list = normCases(cases);
  if (!list.length) throw new Error('没有测试用例');
  const finish = (out) => {
    out.summary = summarizeJudge(out);
    return out;
  };
  return withDir(lang, code, plan, async (dir) => {
    const steps = lang.steps(dir);
    const compileSteps = steps.slice(0, -1);
    const runCmd = steps[steps.length - 1];
    const run = makeRunner(plan);
    if (compileSteps.length) {
      const deadline = Date.now() + timeLimitMs;
      for (const step of compileSteps) {
        const compiled = await run(step, { cwd: dir, stdin: '', deadline });
        if (compiled.exitCode !== 0 || compiled.timedOut || compiled.truncated) {
          const status = caseStatus({ ...compiled, stage: 'compile' }, '');
          const results = list.map((item, index) => ({
            name: item.name || `用例 ${index + 1}`,
            status,
            passed: false,
            timeMs: compiled.timeMs,
            stdout: '',
            stderr: compiled.stderr,
            input: item.input,
            expected: item.output,
          }));
          return finish({ passed: 0, total: results.length, compileError: true, cases: results });
        }
      }
    }
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const deadline = Date.now() + timeLimitMs;
      const runResult = await run(runCmd, { cwd: dir, stdin: item.input, deadline });
      const status = caseStatus({ ...runResult, stage: 'run' }, item.output);
      results.push({
        name: item.name || `用例 ${i + 1}`,
        status,
        passed: status === 'passed',
        timeMs: runResult.timeMs,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        input: item.input,
        expected: item.output,
      });
    }
    return finish({
      passed: results.filter((item) => item.passed).length,
      total: results.length,
      compileError: false,
      cases: results,
    });
  });
}

module.exports = {
  detectLanguages,
  runCode,
  judgeCases,
  sandboxStatus,
  describeSandbox,
  resetRuntimeCache,
  childEnv,
  TIME_LIMIT_MS,
};
