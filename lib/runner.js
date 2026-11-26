// 算法手撕：在本机运行候选人写的代码（读标准输入、写标准输出），并按预置用例逐个对比输出。
// 只用本机已安装的语言环境，启动时检测哪些可用；每次运行在临时目录里进行，有超时和输出上限。
// 注意：这不是安全沙箱，也没有容器隔离。自定义运行和自动判题是同一套机制，代码以服务进程的权限运行。
// 默认只接受来自本机的请求，见 server.js 的 CODE_RUNNER 说明。运行时不会把密钥类环境变量传给用户代码。

const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { caseStatus, normCases, summarizeJudge } = require('./cases');

const TIME_LIMIT_MS = 10_000; // 含编译时间
const JUDGE_TOTAL_MS = 45_000; // 一场判题的总时限，编译和所有用例共享
const OUTPUT_LIMIT = 64 * 1024;
const MAX_CONCURRENT = 2;

/** 候选的语言环境：cmds 依次尝试，第一个能跑通 version 的就用它 */
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

/** 运行代码时只给白名单里的环境变量，服务端的密钥类变量一律不带给候选人的代码 */
const ENV_WHITELIST = ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TZ'];
function childEnv() {
  const env = {};
  for (const k of ENV_WHITELIST) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' };
}

let detectedPromise = null;
/** 异步探测单个命令的版本输出；跑不通返回 null（不阻塞事件循环） */
function probeVersion(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch {
      return resolve(null);
    }
    let out = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(null); }, 8000);
    child.stdout.on('data', (c) => { out += c.toString('utf8'); });
    child.stderr.on('data', (c) => { out += c.toString('utf8'); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : null);
    });
  });
}

/** 检测本机可用的语言环境（只做一次，缓存 promise 防重复探测） */
async function detectLanguages() {
  if (detectedPromise) return detectedPromise;
  detectedPromise = (async () => {
    const detected = [];
    for (const lang of LANGS) {
      for (const cmd of lang.cmds) {
        const out = await probeVersion(cmd, lang.versionArgs);
        if (out !== null && (!lang.versionMatch || lang.versionMatch.test(out))) {
          detected.push({ ...lang, cmd, version: out.trim().split(/\r?\n/)[0].slice(0, 80) });
          break;
        }
      }
    }
    return detected;
  })();
  return detectedPromise;
}

/** 结束进程及其子进程：Windows 用 taskkill /T，POSIX 按进程组杀（子进程是 detached 起的组长） */
function killTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { child.kill('SIGKILL'); }
  }
}

function runStep([cmd, args], { cwd, stdin, deadline }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let child;
    try {
      // POSIX 下独立进程组启动，超时才能连子进程一起杀干净（见 killTree）
      child = spawn(cmd, args, { cwd, env: childEnv(), windowsHide: true, detached: process.platform !== 'win32' });
    } catch (e) {
      return resolve({ exitCode: -1, stdout: '', stderr: String(e.message), timeMs: 0, timedOut: false, truncated: false });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, Math.max(0, deadline - Date.now()));
    // 用 StringDecoder 跨 chunk 解码，多字节字符被分块切开时不要变乱码（会误判 wrong_answer）
    const decOut = new StringDecoder('utf8');
    const decErr = new StringDecoder('utf8');
    const collect = (which) => (chunk) => {
      if (truncated) return;
      const s = (which === 'out' ? decOut : decErr).write(chunk);
      if (which === 'out') stdout += s;
      else stderr += s;
      if (stdout.length + stderr.length > OUTPUT_LIMIT) {
        truncated = true; // 超限后不再继续攒内存
        killTree(child);
      }
    };
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));
    child.on('error', (e) => {
      stderr += e.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!truncated) {
        stdout += decOut.end();
        stderr += decErr.end();
      }
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

let running = 0;

/** 运行一段代码，返回 { stage: 'compile'|'run', exitCode, stdout, stderr, timeMs, timedOut, truncated } */
async function runCode({ language, code, stdin }) {
  const lang = (await detectLanguages()).find((l) => l.id === language);
  if (!lang) throw new Error(`本机没有可用的 ${language} 运行环境`);
  if (running >= MAX_CONCURRENT) throw new Error('正在运行的代码太多，请稍后再试');
  running++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-interview-run-'));
  try {
    fs.writeFileSync(path.join(dir, lang.file), code);
    const deadline = Date.now() + TIME_LIMIT_MS;
    const steps = lang.run(lang.cmd, dir);
    let result;
    for (let i = 0; i < steps.length; i++) {
      const last = i === steps.length - 1;
      result = await runStep(steps[i], { cwd: dir, stdin: last ? stdin : '', deadline });
      result.stage = last ? 'run' : 'compile';
      if (!last && (result.exitCode !== 0 || result.timedOut)) break; // 编译失败
    }
    return result;
  } finally {
    running--;
    // Windows 上进程刚退出时文件可能还被占用，稍后再删
    const clean = () => fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }, () => {});
    setTimeout(clean, 500);
  }
}

/**
 * 按预置用例判题。需要编译的语言只编译一次，再对每个用例单独运行。
 * 编译、每个用例各自有 timeLimitMs（默认 10 秒），整场判题另有 JUDGE_TOTAL_MS 总时限。自定义运行仍是编译和运行共用一个时限，见 runCode。
 * 编译失败时不运行用例。返回 { passed, total, compileError, cases, summary }。
 */
async function judgeCases({ language, code, cases, timeLimitMs = TIME_LIMIT_MS }) {
  const lang = (await detectLanguages()).find((l) => l.id === language);
  if (!lang) throw new Error(`本机没有可用的 ${language} 运行环境`);
  const list = normCases(cases);
  if (!list.length) throw new Error('没有测试用例');
  if (running >= MAX_CONCURRENT) throw new Error('正在运行的代码太多，请稍后再试');
  running++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-interview-run-'));
  const finish = (out) => {
    out.summary = summarizeJudge(out);
    return out;
  };
  const totalDeadline = Date.now() + JUDGE_TOTAL_MS;
  try {
    fs.writeFileSync(path.join(dir, lang.file), code);
    const steps = lang.run(lang.cmd, dir);
    const compileSteps = steps.slice(0, -1);
    const runCmd = steps[steps.length - 1];
    if (compileSteps.length) {
      const deadline = Math.min(Date.now() + timeLimitMs, totalDeadline);
      for (const step of compileSteps) {
        const compiled = await runStep(step, { cwd: dir, stdin: '', deadline });
        if (compiled.exitCode !== 0 || compiled.timedOut || compiled.truncated) {
          const status = caseStatus({ ...compiled, stage: 'compile' }, '');
          const results = list.map((c, i) => ({
            name: c.name || `用例 ${i + 1}`,
            status,
            passed: false,
            timeMs: compiled.timeMs,
            stdout: '',
            stderr: compiled.stderr,
            input: c.input,
            expected: c.output,
          }));
          return finish({ passed: 0, total: results.length, compileError: true, cases: results });
        }
      }
    }
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      // 总时限用完时，本例和剩余用例直接记超时，不再真正运行
      if (Date.now() >= totalDeadline) {
        const run = { exitCode: -1, stdout: '', stderr: '判题总时限已用完', timeMs: 0, timedOut: true, truncated: false, stage: 'run' };
        for (let j = i; j < list.length; j++) {
          results.push({
            name: list[j].name || `用例 ${j + 1}`,
            status: caseStatus(run, list[j].output),
            passed: false,
            timeMs: 0,
            stdout: '',
            stderr: run.stderr,
            input: list[j].input,
            expected: list[j].output,
          });
        }
        break;
      }
      const deadline = Math.min(Date.now() + timeLimitMs, totalDeadline);
      const run = await runStep(runCmd, { cwd: dir, stdin: c.input, deadline });
      const status = caseStatus({ ...run, stage: 'run' }, c.output);
      results.push({
        name: c.name || `用例 ${i + 1}`,
        status,
        passed: status === 'passed',
        timeMs: run.timeMs,
        stdout: run.stdout,
        stderr: run.stderr,
        input: c.input,
        expected: c.output,
      });
    }
    return finish({
      passed: results.filter((r) => r.passed).length,
      total: results.length,
      compileError: false,
      cases: results,
    });
  } finally {
    running--;
    const clean = () => fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }, () => {});
    setTimeout(clean, 500);
  }
}

module.exports = { detectLanguages, runCode, judgeCases, TIME_LIMIT_MS };
