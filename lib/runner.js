// 算法手撕：在本机运行候选人写的代码（读标准输入、写标准输出）。
// 只用本机已安装的语言环境，启动时检测哪些可用；每次运行在临时目录里进行，有超时和输出上限。
// 注意：这不是安全沙箱，代码以服务进程的权限运行。默认只接受来自本机的请求，见 server.js 的 CODE_RUNNER 说明。

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TIME_LIMIT_MS = 10_000; // 含编译时间
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

/** 运行代码时不把服务端的环境变量（尤其是模型密钥）带给候选人的代码 */
function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(LLM_|OPENAI|API_KEY|.*(SECRET|TOKEN|PASSWORD|_KEY)$)/i.test(k)) env[k] = v;
  return { ...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' };
}

let detected = null;
/** 检测本机可用的语言环境（只做一次） */
function detectLanguages() {
  if (detected) return detected;
  detected = [];
  for (const lang of LANGS) {
    for (const cmd of lang.cmds) {
      try {
        const r = spawnSync(cmd, lang.versionArgs, { encoding: 'utf8', timeout: 8000, windowsHide: true });
        const out = `${r.stdout || ''}${r.stderr || ''}`;
        if (r.status === 0 && (!lang.versionMatch || lang.versionMatch.test(out))) {
          detected.push({ ...lang, cmd, version: out.trim().split(/\r?\n/)[0].slice(0, 80) });
          break;
        }
      } catch {
        /* 没装这个语言 */
      }
    }
  }
  return detected;
}

/** 结束进程及其子进程（Windows 上 kill 只会结束直接子进程） */
function killTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
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
      child = spawn(cmd, args, { cwd, env: childEnv(), windowsHide: true });
    } catch (e) {
      return resolve({ exitCode: -1, stdout: '', stderr: String(e.message), timeMs: 0, timedOut: false, truncated: false });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, Math.max(0, deadline - Date.now()));
    const collect = (which) => (chunk) => {
      const s = chunk.toString('utf8');
      if (which === 'out') stdout += s;
      else stderr += s;
      if (stdout.length + stderr.length > OUTPUT_LIMIT) {
        truncated = true;
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
  const lang = detectLanguages().find((l) => l.id === language);
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

module.exports = { detectLanguages, runCode, TIME_LIMIT_MS };
