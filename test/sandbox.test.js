const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const {
  DEFAULT_IMAGE,
  FALLBACK_USER,
  containerEnv,
  containerRunArgs,
  containerUser,
  describeStatus,
  imageExists,
  inspectRuntime,
  isSecretEnvName,
  parseProbe,
  resolveSandbox,
} = require('../lib/sandbox');
const { childEnv, detectLanguages, judgeCases, resetRuntimeCache, runCode, sandboxStatus } = require('../lib/runner');

const root = path.join(__dirname, '..');
const SECRET = 'secret-should-not-leak-834a';

describe('容器沙箱', { concurrency: 1 }, () => {
  test('决策：auto 缺少运行时或镜像时回退，on 报错且不使用容器，off 始终不用容器', () => {
    const image = DEFAULT_IMAGE;
    const noRuntime = resolveSandbox({ mode: 'auto', runtime: null, image, imageReady: false });
    assert.equal(noRuntime.useContainer, false);
    assert.equal(noRuntime.fallback, 'no-runtime');
    assert.equal(noRuntime.error, null);

    const noImage = resolveSandbox({ mode: 'auto', runtime: 'docker', image, imageReady: false });
    assert.equal(noImage.useContainer, false);
    assert.equal(noImage.fallback, 'no-image');
    assert.equal(noImage.error, null);

    const ready = resolveSandbox({ mode: 'auto', runtime: 'podman', image, imageReady: true });
    assert.equal(ready.useContainer, true);
    assert.equal(ready.runtime, 'podman');
    assert.equal(ready.fallback, null);
    assert.equal(ready.error, null);

    for (const input of [
      { mode: 'on', runtime: null, image, imageReady: false },
      { mode: 'on', runtime: 'docker', image, imageReady: false },
    ]) {
      const denied = resolveSandbox(input);
      assert.equal(denied.useContainer, false);
      assert.equal(denied.error.includes('不会改回本机进程'), true);
    }

    const forcedOff = resolveSandbox({ mode: 'off', runtime: 'docker', image, imageReady: true });
    assert.equal(forcedOff.useContainer, false);
    assert.equal(forcedOff.fallback, 'disabled');
    assert.equal(forcedOff.error, null);

    assert.match(describeStatus(noRuntime), /已回退/);
    assert.match(describeStatus(noRuntime), /不是安全沙箱/);
    assert.match(describeStatus(resolveSandbox({ mode: 'on', runtime: null, image, imageReady: false })), /不会改回本机进程/);
    assert.match(describeStatus(forcedOff), /不是安全沙箱/);
  });

  test('密钥变量名识别，容器环境变量是固定白名单', () => {
    for (const key of ['LLM_API_KEY', 'OPENAI_API_KEY', 'API_KEY', 'MY_SECRET', 'AUTH_TOKEN', 'DB_PASSWORD', 'SOME_KEY']) {
      assert.equal(isSecretEnvName(key), true, key);
    }
    assert.equal(isSecretEnvName('MOCK_INTERVIEW_PLAIN'), false);
    assert.equal(isSecretEnvName('PATH'), false);

    const previousKey = process.env.LLM_API_KEY;
    const previousPlain = process.env.MOCK_INTERVIEW_PLAIN;
    process.env.LLM_API_KEY = SECRET;
    process.env.MOCK_INTERVIEW_PLAIN = 'visible';
    try {
      const env = containerEnv();
      const host = childEnv();
      assert.equal(JSON.stringify(env).includes(SECRET), false);
      assert.equal(host.LLM_API_KEY, undefined);
      assert.equal(host.MOCK_INTERVIEW_PLAIN, 'visible');
      assert.equal(env.MOCK_INTERVIEW_PLAIN, undefined);
      assert.equal(env.PATH, undefined);
      assert.equal(env.NODE_OPTIONS, undefined);
      assert.equal(env.LD_PRELOAD, undefined);
      assert.equal(env.HOME, '/tmp');
      for (const key of Object.keys(env)) assert.equal(isSecretEnvName(key), false, key);
    } finally {
      if (previousKey === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = previousKey;
      if (previousPlain === undefined) delete process.env.MOCK_INTERVIEW_PLAIN;
      else process.env.MOCK_INTERVIEW_PLAIN = previousPlain;
    }
  });

  test('容器参数限制网络、文件系统和权限，并且不带密钥', () => {
    const user = containerUser();
    assert.match(user, /^\d+:\d+$/);
    assert.notEqual(user, '0:0');
    assert.equal(user.startsWith('0:'), false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-args-'));
    const previous = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = SECRET;
    try {
      const args = containerRunArgs({
        image: DEFAULT_IMAGE,
        name: 'miabc123',
        workDir: dir,
        command: 'node',
        commandArgs: ['main.js'],
        env: containerEnv(),
      });
      assert.equal(args.some((item) => String(item).includes(SECRET)), false);
      assert.equal(args.join('\n').includes('docker.sock'), false);
      assert.equal(args.includes('--privileged'), false);
      assert.equal(args[args.indexOf('--network') + 1], 'none');
      assert.equal(args.includes('-i'), true);
      assert.equal(args.includes('-t'), false);
      assert.equal(args.includes('--read-only'), true);
      assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
      assert.equal(args[args.indexOf('--security-opt') + 1], 'no-new-privileges');
      assert.equal(args[args.indexOf('--user') + 1], user);
      assert.equal(args[args.indexOf('--pids-limit') + 1], '128');
      const volumes = args.filter((item, index) => args[index - 1] === '-v');
      assert.deepEqual(volumes, [`${path.resolve(dir)}:/work:rw`]);
      assert.equal(args.filter((item) => item === '--network=host' || item === '--pid=host').length, 0);
      assert.equal(args.includes('--userns'), false);
      const podmanArgs = containerRunArgs({
        image: DEFAULT_IMAGE,
        name: 'miabc123',
        workDir: dir,
        command: 'node',
        commandArgs: ['main.js'],
        env: containerEnv(),
        runtime: 'podman',
      });
      // 取得到宿主 uid（Linux / macOS）时才需要 keep-id；Windows 上没有 uid，用镜像里的非 root 用户，不加 --userns
      if (user === FALLBACK_USER) assert.equal(podmanArgs.includes('--userns'), false);
      else assert.equal(podmanArgs[podmanArgs.indexOf('--userns') + 1], 'keep-id');
      assert.equal(podmanArgs[podmanArgs.indexOf('--user') + 1], user);
      assert.throws(
        () => containerRunArgs({ image: DEFAULT_IMAGE, name: 'miabc123', workDir: '/etc', command: 'node', commandArgs: [], env: containerEnv() }),
        /临时目录/,
      );
      assert.throws(
        () => containerRunArgs({ image: DEFAULT_IMAGE, name: 'miabc123', workDir: null, command: 'node', commandArgs: [], env: containerEnv(), user: '0:0' }),
        /root/,
      );
      assert.throws(
        () => containerRunArgs({ image: DEFAULT_IMAGE, name: 'miabc123', workDir: null, command: 'node', commandArgs: [], env: { LLM_API_KEY: SECRET } }),
        /密钥/,
      );
    } finally {
      if (previous === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('镜像探测结果能认出五种语言，并丢掉不存在的命令', () => {
    const output = [
      'javascript v18.20.4',
      'python Python 3.11.2',
      'java openjdk version "17.0.13" 2024-10-15',
      'cpp g++ (Debian 12.2.0-14) 12.2.0',
      'go go version go1.19.8 linux/amd64',
    ].join('\n');
    assert.deepEqual(parseProbe(output).map((lang) => lang.id), ['javascript', 'python', 'java', 'cpp', 'go']);
    const missing = parseProbe('javascript sh: 1: node: not found\njava openjdk version "1.8.0_402"\npython Python 2.7.18\n');
    assert.deepEqual(missing.map((lang) => lang.id), []);
  });

  test('Dockerfile 只装工具链，不复制仓库', () => {
    const text = fs.readFileSync(path.join(root, 'sandbox/Dockerfile'), 'utf8');
    assert.match(text, /--uid 10001/);
    assert.match(text, /openjdk-17-jdk-headless/);
    assert.match(text, /python3/);
    assert.match(text, /golang-go/);
    assert.match(text, /\bg\+\+/);
    assert.match(text, /nodejs/);
    assert.doesNotMatch(text, /\bCOPY\b|\bADD\b/);
    assert.doesNotMatch(text, /LLM_API_KEY|API_KEY/);
  });

  test('CODE_SANDBOX=off 即使镜像名非法也走本机，且不把密钥传进去', async () => {
    await withEnv({ CODE_SANDBOX: 'off', CODE_SANDBOX_IMAGE: 'bad image', MOCK_INTERVIEW_PLAIN: 'visible', LLM_API_KEY: SECRET }, async () => {
      const status = sandboxStatus();
      assert.equal(status.mode, 'off');
      assert.equal(status.useContainer, false);
      assert.equal(status.fallback, 'disabled');
      const result = await runCode({
        language: 'javascript',
        code: "process.stdout.write((process.env.MOCK_INTERVIEW_PLAIN || '') + '|' + (process.env.LLM_API_KEY || ''))",
        stdin: '',
      });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, 'visible|');
    });
  });

  test('默认 auto：没有沙箱时回退到本机，有沙箱时不带宿主环境变量', async () => {
    await withEnv({ CODE_SANDBOX: 'auto', MOCK_INTERVIEW_PLAIN: 'visible', LLM_API_KEY: SECRET }, async () => {
      const status = sandboxStatus();
      const result = await runCode({
        language: 'javascript',
        code: "process.stdout.write(JSON.stringify({ plain: process.env.MOCK_INTERVIEW_PLAIN || '', key: process.env.LLM_API_KEY || '' }))",
        stdin: '',
      });
      assert.equal(result.exitCode, 0, result.stderr);
      const body = JSON.parse(result.stdout);
      assert.equal(body.key, '');
      if (!inspectRuntime()) assert.equal(status.fallback, 'no-runtime');
      if (status.useContainer) {
        assert.equal(body.plain, '');
        assert.equal(status.fallback, null);
      } else {
        assert.equal(body.plain, 'visible');
        assert.ok(status.fallback);
        assert.match(describeSandboxOf(status), /不是安全沙箱/);
      }
    });
  });

  test('自定义运行能在时限后停掉死循环', { timeout: 60_000 }, async () => {
    await withEnv({ CODE_SANDBOX: 'auto' }, async () => {
      const isolated = sandboxStatus().useContainer;
      const result = await runCode({
        language: 'javascript',
        code: 'while (true) {}\n',
        stdin: '',
        timeLimitMs: isolated ? 8000 : 700,
      });
      assert.equal(result.timedOut, true);
      assert.equal(result.stage, 'run');
    });
  });

  test('CODE_SANDBOX=on 不会在沙箱不可用时改回本机执行', async () => {
    const marker = path.join(os.tmpdir(), `mi-should-not-run-${process.pid}`);
    fs.rmSync(marker, { force: true });
    const code = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`;
    await withEnv({ CODE_SANDBOX: 'on', CODE_SANDBOX_IMAGE: 'bad image' }, async () => {
      await assert.rejects(() => runCode({ language: 'javascript', code, stdin: '' }), /不会改回本机进程/);
    });
    assert.equal(fs.existsSync(marker), false);

    if (!inspectRuntime()) {
      await withEnv({ CODE_SANDBOX: 'on' }, async () => {
        await assert.rejects(() => runCode({ language: 'javascript', code, stdin: '' }), /容器运行时/);
        const status = sandboxStatus();
        assert.equal(status.useContainer, false);
        assert.equal(status.fallback, null);
        assert.match(status.error, /不会改回本机进程/);
      });
      assert.equal(fs.existsSync(marker), false);
    }
  });

  test('接口：CODE_SANDBOX=on 但沙箱不可用时拒绝运行，不会改在本机执行', { timeout: 30_000 }, async () => {
    const marker = path.join(os.tmpdir(), `mi-api-should-not-run-${process.pid}`);
    fs.rmSync(marker, { force: true });
    const port = await freePort();
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        LLM_API_KEY: '',
        CODE_RUNNER: 'local',
        CODE_SANDBOX: 'on',
        // 非法镜像名在任何机器上都会让 on 失败，用来钉住接口不会悄悄改回本机
        CODE_SANDBOX_IMAGE: 'bad image',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    child.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    try {
      const config = await waitFor(port);
      assert.deepEqual(config.runner, []);
      assert.equal(config.sandbox.mode, 'on');
      assert.equal(config.sandbox.active, false);
      assert.match(config.sandbox.error, /不会改回本机进程/);
      const denied = await request(port, 'POST', '/api/run', {
        language: 'javascript',
        code: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
        stdin: '',
      });
      assert.equal(denied.status, 500, denied.text);
      assert.match(denied.json.error, /不会改回本机进程/);
      assert.equal(fs.existsSync(marker), false);
      if (!inspectRuntime()) {
        const runtimePort = await freePort();
        const runtimeChild = spawn(process.execPath, ['server.js'], {
          cwd: root,
          env: {
            ...process.env,
            PORT: String(runtimePort),
            LLM_API_KEY: '',
            CODE_RUNNER: 'local',
            CODE_SANDBOX: 'on',
            CODE_SANDBOX_IMAGE: '',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        try {
          const runtimeConfig = await waitFor(runtimePort);
          assert.match(runtimeConfig.sandbox.error, /容器运行时/);
        } finally {
          runtimeChild.kill();
        }
      }
    } finally {
      child.kill();
      if (logs.includes('EADDRINUSE')) throw new Error(logs);
    }
  });

  test('接口：CODE_RUNNER=on 但代码不在容器里跑时，拒绝非本机请求，本机请求照常', { timeout: 30_000 }, async (t) => {
    // 用本机的局域网地址发请求，服务看到的就不是 127.0.0.1
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((it) => it && it.family === 'IPv4' && !it.internal);
    if (!lan) return t.skip('没有可用的局域网地址');
    const marker = path.join(os.tmpdir(), `mi-remote-should-not-run-${process.pid}`);
    fs.rmSync(marker, { force: true });
    const port = await freePort();
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      // CODE_SANDBOX=off 模拟 auto 回退到本机进程的情况：代码不在容器里跑
      env: { ...process.env, PORT: String(port), LLM_API_KEY: '', CODE_RUNNER: 'on', CODE_SANDBOX: 'off' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await waitFor(port);
      const remoteConfig = await request(port, 'GET', '/api/config', undefined, lan.address);
      assert.deepEqual(remoteConfig.json.runner, []);
      const code = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`;
      const denied = await request(port, 'POST', '/api/run', { language: 'javascript', code, stdin: '' }, lan.address);
      assert.equal(denied.status, 500, denied.text);
      assert.match(denied.json.error, /容器沙箱没有就绪/);
      const judged = await request(port, 'POST', '/api/judge-code', { language: 'javascript', code, cases: [{ name: 'x', input: '', output: '' }] }, lan.address);
      assert.equal(judged.status, 500, judged.text);
      assert.equal(fs.existsSync(marker), false);
      // 本机请求仍可以在本机进程里练习
      const local = await request(port, 'POST', '/api/run', { language: 'javascript', code: 'console.log(1)', stdin: '' });
      assert.equal(local.status, 200, local.text);
      assert.equal(local.json.stdout.trim(), '1');
    } finally {
      child.kill();
      fs.rmSync(marker, { force: true });
    }
  });

  test('容器可用时：无网络、读不到宿主机文件、写不了系统目录、五种语言可判题、超时能停', { timeout: 180_000 }, async (t) => {
    const runtime = inspectRuntime();
    const ready = !!(runtime && imageExists(runtime, DEFAULT_IMAGE));
    if (!runtime || !ready) {
      t.skip(`跳过真实容器：运行时=${runtime || '无'}，镜像=${ready ? '有' : '无'}`);
      return;
    }
    const hostFile = path.join(os.tmpdir(), `mi-host-only-${process.pid}`);
    fs.writeFileSync(hostFile, 'host-secret-value');
    try {
      await withEnv({ CODE_SANDBOX: 'on', LLM_API_KEY: 'secret-container-value', OPENAI_API_KEY: 'secret-openai' }, async () => {
        const status = sandboxStatus();
        assert.equal(status.useContainer, true);
        assert.equal(status.runtime, runtime);
        const langs = detectLanguages().map((lang) => lang.id);
        for (const id of ['javascript', 'python', 'java', 'cpp', 'go']) assert.ok(langs.includes(id), langs.join(','));

        const probe = await runCode({
          language: 'javascript',
          timeLimitMs: 20_000,
          stdin: '',
          code: [
            "const fs = require('fs');",
            "const net = require('net');",
            `const hostFile = ${JSON.stringify(hostFile)};`,
            "let read = 'missing';",
            "try { read = fs.readFileSync(hostFile, 'utf8'); } catch (e) { read = 'denied'; }",
            "let wrote = 'yes';",
            "try { fs.writeFileSync('/etc/pwned-by-candidate', 'x'); } catch (e) { wrote = 'denied'; }",
            "const leak = ['LLM_API_KEY', 'OPENAI_API_KEY'].filter((k) => process.env[k]);",
            "const hit = Object.values(process.env).some((v) => String(v).includes('secret-container-value'));",
            "const socket = net.connect({ host: '1.1.1.1', port: 80 });",
            'let done = false;',
            'const end = (netResult) => {',
            '  if (done) return;',
            '  done = true;',
            '  socket.destroy();',
            '  console.log(JSON.stringify({ read, wrote, leak, hit, net: netResult }));',
            '  process.exit(0);',
            '};',
            "socket.on('connect', () => end('connected'));",
            "socket.on('error', () => end('blocked'));",
            "setTimeout(() => end('blocked'), 1500);",
          ].join('\n'),
        });
        assert.equal(probe.exitCode, 0, probe.stderr);
        const body = JSON.parse(probe.stdout);
        assert.equal(body.read, 'denied');
        assert.equal(body.wrote, 'denied');
        assert.deepEqual(body.leak, []);
        assert.equal(body.hit, false);
        assert.equal(body.net, 'blocked');
        assert.equal(fs.readFileSync(hostFile, 'utf8'), 'host-secret-value');

        const cases = [{ name: '和', input: '20 22\n', output: '42' }];
        const programs = {
          javascript: "const fs=require('fs'); const [a,b]=fs.readFileSync(0,'utf8').trim().split(/\\s+/).map(Number); console.log(a+b);\n",
          python: 'import sys\na, b = map(int, sys.stdin.read().split())\nprint(a + b)\n',
          java: 'import java.util.*;\npublic class Main {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    System.out.println(sc.nextInt() + sc.nextInt());\n  }\n}\n',
          cpp: '#include <iostream>\nint main() {\n  int a, b;\n  if (!(std::cin >> a >> b)) return 0;\n  std::cout << (a + b) << "\\n";\n}\n',
          go: 'package main\nimport ("fmt"\n"os")\nfunc main() {\n  var a, b int\n  fmt.Fscan(os.Stdin, &a, &b)\n  fmt.Println(a + b)\n}\n',
        };
        for (const [language, code] of Object.entries(programs)) {
          const judged = await judgeCases({ language, code, cases });
          assert.equal(judged.passed, judged.total, `${language}: ${judged.summary}\n${judged.cases.map((item) => item.stderr).join('\n')}`);
        }

        const timed = await runCode({ language: 'javascript', code: 'while (true) {}\n', stdin: '', timeLimitMs: 8000 });
        assert.equal(timed.timedOut, true);
      });
    } finally {
      fs.rmSync(hostFile, { force: true });
    }
  });
});

function describeSandboxOf(status) {
  return describeStatus(status);
}

async function withEnv(extra, fn) {
  const prev = { ...process.env };
  for (const [key, value] of Object.entries(extra)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  resetRuntimeCache();
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in prev)) delete process.env[key];
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetRuntimeCache();
  }
}

function request(port, method, pathname, body, hostname = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname,
        port,
        path: pathname,
        method,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* 非 JSON */
          }
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    req.on('error', reject);
    if (data) req.end(data);
    else req.end();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(port) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 8000) {
    try {
      const res = await request(port, 'GET', '/api/config');
      if (res.status === 200) return res.json;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`服务没有起来：${last}`);
}
