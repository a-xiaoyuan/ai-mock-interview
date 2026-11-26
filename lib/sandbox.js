// 算法题的容器沙箱。自定义运行和自动判题都走这里（由 runner.js 决定是否启用）。
// 限制：只读根文件系统、单独的工作目录、无网络、去掉全部 capabilities、禁止提权、
// 限制内存 / CPU / 进程数、非 root。不把宿主环境变量传进容器。
// 这能挡住常见的读密钥、出网和改系统文件，但不是绝对安全：容器逃逸、内核漏洞、磁盘占满仍然可能。

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_IMAGE = 'ai-mock-interview-sandbox:local';
/** 服务以 root 运行时，容器里用这个非 root 用户（镜像里有同名 uid） */
const FALLBACK_USER = '10001:10001';
const MEMORY = '768m';
const CPUS = '1';
const PIDS_LIMIT = '128';

/** 与本机运行同一套密钥规则。容器路径更严：只传下面的固定环境变量，不从宿主拷贝。 */
const SECRET_ENV = /^(LLM_|OPENAI|API_KEY|.*(SECRET|TOKEN|PASSWORD|_KEY)$)/i;

function isSecretEnvName(name) {
  return SECRET_ENV.test(String(name || ''));
}

/** 容器内仅有的环境变量。不要加 PATH、NODE_OPTIONS、JAVA_TOOL_OPTIONS、LD_PRELOAD，也不要从 process.env 复制。 */
function containerEnv() {
  return {
    HOME: '/tmp',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    GOCACHE: '/tmp/gocache',
    GOPATH: '/tmp/gopath',
    GOTMPDIR: '/tmp',
    GO111MODULE: 'off',
    CGO_ENABLED: '0',
    GOTOOLCHAIN: 'local',
    GOPROXY: 'off',
    GOSUMDB: 'off',
    GOTELEMETRY: 'off',
  };
}

/**
 * 非 root 的容器用户。服务进程不是 root 时用宿主 uid，这样工作目录里的产物属主一致、跑完能删掉。
 * 服务进程是 root（或无法取得 uid）时用镜像里的 10001，避免候选人代码以 root 运行。
 */
function containerUser() {
  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 0;
    if (uid > 0 && gid >= 0) return `${uid}:${gid}`;
  } catch {
    /* 取不到 uid 时用镜像内的非 root 用户 */
  }
  return FALLBACK_USER;
}

function imageName() {
  const raw = (process.env.CODE_SANDBOX_IMAGE || '').trim() || DEFAULT_IMAGE;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$/.test(raw)) {
    throw new Error('CODE_SANDBOX_IMAGE 不是合法的镜像名');
  }
  return raw;
}

function readMode() {
  const value = process.env.CODE_SANDBOX;
  return value === 'on' || value === 'off' ? value : 'auto';
}

/**
 * 纯决策：给定模式和运行时探测结果，决定用容器、回退，还是直接报错。
 * auto 缺少运行时或镜像时回退（error 为空）；on 缺少时给出 error，调用方不得改回本机进程。
 */
function resolveSandbox({ mode, runtime, image, imageReady }) {
  if (mode === 'off') {
    return { mode, useContainer: false, runtime: null, image: image || null, fallback: 'disabled', error: null };
  }
  if (!runtime) {
    return {
      mode,
      useContainer: false,
      runtime: null,
      image: image || null,
      fallback: mode === 'on' ? null : 'no-runtime',
      error:
        mode === 'on'
          ? '容器沙箱没有就绪：找不到可用的容器运行时（需要已启动的 Docker 或 Podman）。CODE_SANDBOX=on 时不会改回本机进程。本机练习请使用默认的 auto，或设为 off。'
          : null,
    };
  }
  if (!imageReady) {
    return {
      mode,
      useContainer: false,
      runtime,
      image: image || null,
      fallback: mode === 'on' ? null : 'no-image',
      error:
        mode === 'on'
          ? `容器沙箱没有就绪：找不到镜像 ${image}。请在项目目录执行 npm run sandbox-image。CODE_SANDBOX=on 时不会改回本机进程。`
          : null,
    };
  }
  return { mode, useContainer: true, runtime, image: image || null, fallback: null, error: null };
}

function describeStatus(status) {
  if (status.useContainer) return `容器沙箱（${status.runtime}，${status.image}）`;
  if (status.mode === 'on') return `容器沙箱未就绪：${status.error || '未知原因'}`;
  if (status.mode === 'off' || status.fallback === 'disabled') return '本机进程（CODE_SANDBOX=off，不是安全沙箱）';
  const why = {
    'no-runtime': '没有可用的 Docker 或 Podman',
    'no-image': '还没有沙箱镜像',
    'probe-failed': status.probeError ? `沙箱镜像无法运行：${String(status.probeError).slice(0, 180)}` : '沙箱镜像无法运行',
  }[status.fallback] || '容器沙箱不可用';
  return `本机进程（${why}，已回退，不是安全沙箱）`;
}

/** 工作目录必须是本次任务在系统临时目录里创建的路径，避免 -v 挂到仓库或家目录。 */
function assertSafeWorkDir(dir) {
  const resolved = path.resolve(String(dir || ''));
  const tmp = path.resolve(os.tmpdir());
  const prefix = tmp.endsWith(path.sep) ? tmp : tmp + path.sep;
  if (resolved !== tmp && !resolved.startsWith(prefix)) throw new Error('沙箱工作目录必须在系统临时目录里');
  if (/[\r\n\0]/.test(resolved)) throw new Error('工作目录无效');
  const winDrive = process.platform === 'win32' && /^[A-Za-z]:[\\/]/.test(resolved);
  const rest = winDrive ? resolved.slice(2) : resolved;
  if (rest.includes(':')) throw new Error('工作目录不能包含冒号');
  return resolved;
}

function containerName() {
  return `mi${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * 组装一次容器运行的参数。命令和参数由调用方以数组传入，不经过 shell。
 * 只挂载一个工作目录；探测工具链时不挂载宿主目录，改用内存里的 /work。
 */
function containerRunArgs({ image, name, workDir, command, commandArgs, env, user, runtime }) {
  if (!command || String(command).startsWith('-')) throw new Error('拒绝的容器命令');
  const uid = user || containerUser();
  if (uid === '0' || uid === '0:0' || uid === 'root') throw new Error('容器不能以 root 运行');
  const args = [
    'run',
    '--rm',
    // -i 把标准输入送进容器。不要加 -t，没有终端时会失败，输出也会被改写。
    '-i',
    '--name',
    name,
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    PIDS_LIMIT,
    '--memory',
    MEMORY,
    '--memory-swap',
    MEMORY,
    '--cpus',
    CPUS,
    '--ulimit',
    'core=0',
  ];
  // rootless Podman 默认会把宿主用户映射成容器里的 root。keep-id 让 --user 和挂载目录的属主对齐。
  if (runtime === 'podman' && uid !== FALLBACK_USER) args.push('--userns', 'keep-id');
  args.push('--user', uid, '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '-w', '/work');
  if (workDir) args.push('-v', `${assertSafeWorkDir(workDir)}:/work:rw`);
  else args.push('--tmpfs', '/work:rw,nosuid,nodev,size=32m');
  for (const [key, value] of Object.entries(env || {})) {
    if (isSecretEnvName(key)) throw new Error(`拒绝把密钥环境变量传给容器：${key}`);
    if (/[\r\n\0]/.test(key) || /[\r\n\0]/.test(String(value))) throw new Error('环境变量含有换行');
    args.push('-e', `${key}=${value}`);
  }
  args.push(image, command, ...(commandArgs || []));
  return args;
}

/** 服务以 root 跑时，工作目录需要让 uid 10001 可写。非 root 时目录已属当前用户，保持 0700。 */
function prepareWorkDir(dir) {
  assertSafeWorkDir(dir);
  if (containerUser() !== FALLBACK_USER) return;
  fs.chmodSync(dir, 0o777);
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).isFile()) fs.chmodSync(file, 0o666);
    } catch {
      /* 忽略无法改权限的条目 */
    }
  }
}

function runtimeReady(cmd) {
  let result;
  try {
    result = spawnSync(cmd, ['info'], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return false;
  }
  return result.status === 0;
}

/** 返回 'docker'、'podman'，或 null（未安装、未启动、探测超时都算没有）。 */
function inspectRuntime() {
  if (runtimeReady('docker')) return 'docker';
  if (runtimeReady('podman')) return 'podman';
  return null;
}

function imageExists(runtime, image) {
  let result;
  try {
    result = spawnSync(runtime, ['image', 'inspect', image], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return false;
  }
  return result.status === 0;
}

/** 镜像里应有的语言。命令都是 Linux 容器内的路径，不随宿主平台变成 .exe。 */
const CONTAINER_LANGS = [
  {
    id: 'javascript',
    name: 'JavaScript',
    file: 'main.js',
    run: () => [['node', ['main.js']]],
  },
  {
    id: 'python',
    name: 'Python',
    file: 'main.py',
    versionMatch: /Python 3/,
    run: () => [['python3', ['-X', 'utf8', 'main.py']]],
  },
  {
    id: 'java',
    name: 'Java',
    file: 'Main.java',
    versionMatch: /version "(1[1-9]|[2-9]\d)/,
    run: () => [
      [
        'java',
        [
          '-Dfile.encoding=UTF-8',
          '-Dstdout.encoding=UTF-8',
          '-Dstderr.encoding=UTF-8',
          '-Duser.home=/tmp',
          '-Djava.io.tmpdir=/tmp',
          '-Xmx192m',
          '-Xss64m',
          'Main.java',
        ],
      ],
    ],
  },
  {
    id: 'cpp',
    name: 'C++',
    file: 'main.cpp',
    run: () => [
      ['g++', ['-std=c++17', '-O2', '-o', 'main', 'main.cpp']],
      ['./main', []],
    ],
  },
  {
    id: 'go',
    name: 'Go',
    file: 'main.go',
    versionMatch: /go version/,
    run: () => [
      ['go', ['build', '-o', 'main', 'main.go']],
      ['./main', []],
    ],
  },
];

/** 固定脚本，不拼接用户输入。某种语言缺失时仍继续看别的。 */
const PROBE_SCRIPT = [
  'echo "javascript $(node --version 2>&1 | head -n 1)"',
  'echo "python $(python3 --version 2>&1 | head -n 1)"',
  'echo "java $(java -version 2>&1 | head -n 1)"',
  'echo "cpp $(g++ --version 2>&1 | head -n 1)"',
  'echo "go $(go version 2>&1 | head -n 1)"',
].join('\n');

function parseProbe(output) {
  const found = new Map();
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^(javascript|python|java|cpp|go)\s+(.+)$/);
    if (match) found.set(match[1], match[2].trim());
  }
  const languages = [];
  for (const lang of CONTAINER_LANGS) {
    const version = found.get(lang.id) || '';
    if (!version || /not found|command not found|No such file/i.test(version)) continue;
    if (lang.versionMatch && !lang.versionMatch.test(version)) continue;
    languages.push({
      id: lang.id,
      name: lang.name,
      file: lang.file,
      version: version.slice(0, 80),
      steps: () => lang.run(),
    });
  }
  return languages;
}

function killContainer(runtime, name) {
  spawnSync(runtime, ['kill', '--signal', 'KILL', name], { timeout: 5000, windowsHide: true, stdio: 'ignore' });
  spawnSync(runtime, ['rm', '-f', name], { timeout: 5000, windowsHide: true, stdio: 'ignore' });
}

/** 在镜像里看一遍工具链。失败时由 runner 决定回退还是报错。 */
function probe(plan) {
  const name = containerName();
  const argv = containerRunArgs({
    image: plan.image,
    name,
    workDir: null,
    command: 'sh',
    commandArgs: ['-c', PROBE_SCRIPT],
    env: containerEnv(),
    runtime: plan.runtime,
  });
  let result;
  try {
    result = spawnSync(plan.runtime, argv, { encoding: 'utf8', timeout: 20000, windowsHide: true });
  } catch (error) {
    killContainer(plan.runtime, name);
    return { ok: false, error: String(error.message || error).slice(0, 400), languages: [] };
  }
  if (result.error) {
    killContainer(plan.runtime, name);
    const message = result.error.code === 'ETIMEDOUT' ? '探测镜像超时' : result.error.message;
    return { ok: false, error: String(message).slice(0, 400), languages: [] };
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const languages = parseProbe(output);
  if (result.status !== 0 && !languages.length) {
    return { ok: false, error: output.trim().slice(0, 400) || '镜像探测失败', languages: [] };
  }
  if (!languages.length) return { ok: false, error: '镜像里没有认出已支持的语言工具链', languages: [] };
  return { ok: true, error: null, languages };
}

/**
 * 跑容器里的一个步骤（编译或运行）。超时和输出超限时按容器名杀掉，避免只结束 docker 客户端、容器还在跑。
 * 返回形状与本机 runStep 一致。
 */
function runContainerStep(plan, [command, commandArgs], { cwd, stdin, deadline, outputLimit }) {
  return new Promise((resolve) => {
    const name = containerName();
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let child;
    const kill = () => {
      spawn(plan.runtime, ['kill', '--signal', 'KILL', name], { windowsHide: true, stdio: 'ignore' });
      if (child && child.exitCode === null && child.pid) {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else child.kill('SIGKILL');
      }
    };
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout: stdout.replace(/\r\n/g, '\n').slice(0, outputLimit),
        stderr: stderr.replace(/\r\n/g, '\n').slice(0, outputLimit),
        timeMs: Date.now() - started,
        timedOut,
        truncated,
      });
    };
    let argv;
    try {
      argv = containerRunArgs({
        image: plan.image,
        name,
        workDir: cwd,
        command,
        commandArgs,
        env: containerEnv(),
        runtime: plan.runtime,
      });
    } catch (error) {
      return resolve({ exitCode: -1, stdout: '', stderr: String(error.message), timeMs: 0, timedOut: false, truncated: false });
    }
    try {
      child = spawn(plan.runtime, argv, { windowsHide: true });
    } catch (error) {
      return resolve({ exitCode: -1, stdout: '', stderr: String(error.message), timeMs: 0, timedOut: false, truncated: false });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, Math.max(0, deadline - Date.now()));
    const collect = (which) => (chunk) => {
      const text = chunk.toString('utf8');
      if (which === 'out') stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > outputLimit) {
        truncated = true;
        kill();
      }
    };
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));
    child.on('error', (error) => {
      stderr += error.message;
      finish(-1);
    });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
  });
}

module.exports = {
  DEFAULT_IMAGE,
  FALLBACK_USER,
  MEMORY,
  CPUS,
  PIDS_LIMIT,
  SECRET_ENV,
  CONTAINER_LANGS,
  isSecretEnvName,
  containerEnv,
  containerUser,
  imageName,
  readMode,
  resolveSandbox,
  describeStatus,
  assertSafeWorkDir,
  containerRunArgs,
  prepareWorkDir,
  inspectRuntime,
  imageExists,
  parseProbe,
  probe,
  runContainerStep,
};
