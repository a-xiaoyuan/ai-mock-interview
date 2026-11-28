// 部署前加固：访问口令、登录尝试限制、按来源限流
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { guardConfig, createGuard, createLimiter, isAuthed, parseCookies } = require('../lib/guard');

const root = path.join(__dirname, '..');
const TOKEN = 'test-access-token';

/** 造一个只含用到字段的请求对象 */
const fakeReq = (headers = {}, ip = '10.0.0.1') => ({ headers, socket: { remoteAddress: ip } });

test('配置：默认不设口令、每分钟 60 次；RATE_LIMIT=0 关闭限流', () => {
  assert.deepEqual(guardConfig({}), { token: '', rateLimit: 60, trustProxy: false });
  assert.equal(guardConfig({ RATE_LIMIT: '0' }).rateLimit, 0);
  assert.equal(guardConfig({ RATE_LIMIT: '-3' }).rateLimit, 60);
  assert.equal(guardConfig({ RATE_LIMIT: 'abc' }).rateLimit, 60);
  assert.equal(guardConfig({ ACCESS_TOKEN: '  x  ' }).token, 'x');
});

test('口令：没设口令全部放行；设了以后只认 Bearer 或登录得到的 Cookie', () => {
  assert.equal(isAuthed({ token: '' }, fakeReq()), true);
  const cfg = guardConfig({ ACCESS_TOKEN: TOKEN });
  assert.equal(isAuthed(cfg, fakeReq()), false);
  assert.equal(isAuthed(cfg, fakeReq({ authorization: `Bearer ${TOKEN}` })), true);
  assert.equal(isAuthed(cfg, fakeReq({ authorization: 'Bearer wrong' })), false);

  const g = createGuard(cfg);
  const cookie = g.login(fakeReq(), TOKEN);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(cookie.includes(TOKEN), false, 'Cookie 里不能有口令原文');
  const value = cookie.split(';')[0];
  assert.equal(isAuthed(cfg, fakeReq({ cookie: `a=1; ${value}` })), true);
  // 换了口令，旧 Cookie 失效
  assert.equal(isAuthed(guardConfig({ ACCESS_TOKEN: 'another' }), fakeReq({ cookie: value })), false);
  assert.deepEqual(parseCookies('a=1; b = 2 ;c'), { a: '1', b: '2' });
});

test('分流：公开接口不要口令，其余要；耗额度的接口按来源限流', () => {
  const g = createGuard(guardConfig({ ACCESS_TOKEN: TOKEN, RATE_LIMIT: '2' }));
  assert.equal(g.check('GET /api/config', fakeReq()), null);
  assert.equal(g.check('POST /api/login', fakeReq()), null);
  assert.equal(g.check('GET /api/packs', fakeReq()).status, 401);
  assert.equal(g.check('POST /api/plan', fakeReq()).status, 401);

  const authed = { authorization: `Bearer ${TOKEN}` };
  assert.equal(g.check('POST /api/plan', fakeReq(authed)), null);
  assert.equal(g.check('POST /api/ask', fakeReq(authed)), null);
  const blocked = g.check('POST /api/judge', fakeReq(authed));
  assert.equal(blocked.status, 429);
  assert.match(blocked.headers['Retry-After'], /^\d+$/);
  // 不耗额度的接口不计数，换个来源也不受影响
  assert.equal(g.check('GET /api/packs', fakeReq(authed)), null);
  assert.equal(g.check('POST /api/judge', fakeReq(authed, '10.0.0.2')), null);
});

test('限流：按 X-Forwarded-For 区分来源只在 TRUST_PROXY=1 时生效', () => {
  const plain = createGuard(guardConfig({ RATE_LIMIT: '1' }));
  assert.equal(plain.check('POST /api/plan', fakeReq({ 'x-forwarded-for': '1.1.1.1' }, '127.0.0.1')), null);
  // 不信任代理头：伪造不同的 X-Forwarded-For 也算同一个来源
  assert.equal(plain.check('POST /api/plan', fakeReq({ 'x-forwarded-for': '2.2.2.2' }, '127.0.0.1')).status, 429);

  const proxied = createGuard(guardConfig({ RATE_LIMIT: '1', TRUST_PROXY: '1' }));
  assert.equal(proxied.check('POST /api/plan', fakeReq({ 'x-forwarded-for': '1.1.1.1, 127.0.0.1' }, '127.0.0.1')), null);
  assert.equal(proxied.check('POST /api/plan', fakeReq({ 'x-forwarded-for': '2.2.2.2' }, '127.0.0.1')), null);
  assert.equal(proxied.check('POST /api/plan', fakeReq({ 'x-forwarded-for': '1.1.1.1' }, '127.0.0.1')).status, 429);
});

test('限流窗口：一分钟后恢复，过期来源会被清掉', () => {
  let t = 0;
  const lim = createLimiter({ max: 2, windowMs: 60_000, now: () => t });
  assert.equal(lim.take('a'), 0);
  assert.equal(lim.take('a'), 0);
  assert.equal(lim.take('a'), 60);
  t = 30_000;
  assert.equal(lim.take('a'), 30);
  t = 60_001;
  assert.equal(lim.take('a'), 0);
  t = 200_000;
  lim.prune();
  assert.equal(lim.size(), 0);
});

test('登录：口令错误计入尝试次数，10 次后暂时锁住，成功后清零', () => {
  const g = createGuard(guardConfig({ ACCESS_TOKEN: TOKEN }));
  const req = fakeReq({}, '10.9.9.9');
  for (let i = 0; i < 9; i++) assert.throws(() => g.login(req, 'wrong'), (e) => e.status === 401);
  assert.ok(g.login(req, TOKEN)); // 第 10 次对了：放行并清零
  for (let i = 0; i < 10; i++) assert.throws(() => g.login(req, 'wrong'), (e) => e.status === 401);
  assert.throws(() => g.login(req, TOKEN), (e) => e.status === 429 && /分钟后再试/.test(e.message));
});

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/config`);
      if (res.ok) return res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务没有启动');
}

test('接口：设置口令后先登录，Cookie 和 Bearer 都能用，限流返回 429', { timeout: 30_000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LLM_API_KEY: '', ACCESS_TOKEN: TOKEN, RATE_LIMIT: '3', TRUST_PROXY: '', ASR_MODEL: '', TTS_MODEL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const anon = await waitFor(port);
    assert.deepEqual(anon.auth, { required: true, ok: false });
    assert.equal(anon.runner, undefined, '没登录时不返回运行环境');

    const res = await fetch(`${base}/api/packs`);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    // 静态页面不需要口令，否则连登录界面都打不开
    const page = await fetch(`${base}/`);
    assert.notEqual(page.status, 401);

    assert.equal((await post('/api/login', { token: 'wrong' })).status, 401);
    const ok = await post('/api/login', { token: TOKEN });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie').split(';')[0];

    const authed = await (await fetch(`${base}/api/config`, { headers: { cookie } })).json();
    assert.deepEqual(authed.auth, { required: true, ok: true });
    assert.ok(Array.isArray(authed.runner));
    assert.equal((await fetch(`${base}/api/packs`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 200);

    // RATE_LIMIT=3：第 4 次耗额度的请求被拦下
    const plan = { role: '后端开发（Java）', level: '校招', resume: '', jd: '', count: 1 };
    for (let i = 0; i < 3; i++) assert.equal((await post('/api/plan', plan, { cookie })).status, 200);
    const limited = await post('/api/plan', plan, { cookie });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.match((await limited.json()).error, /太频繁/);

    const out = await post('/api/logout', {}, { cookie });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  } finally {
    child.kill();
  }
});

test('接口：不设口令时和以前一样直接可用', { timeout: 30_000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LLM_API_KEY: '', ACCESS_TOKEN: '', RATE_LIMIT: '' },
    stdio: 'ignore',
  });
  try {
    const config = await waitFor(port);
    assert.deepEqual(config.auth, { required: false, ok: true });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/packs`)).status, 200);
  } finally {
    child.kill();
  }
});
