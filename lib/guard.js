// 部署前加固：访问口令和按来源限流。都是可选的，不配置时行为和以前一样。
// 配置（.env）：
//   ACCESS_TOKEN     访问口令。设置后，除了 /api/config、/api/login、/api/logout，所有接口都要先登录
//                    （浏览器里输入口令后拿到 HttpOnly Cookie；脚本可以用 Authorization: Bearer <口令>）
//   RATE_LIMIT       每个来源每分钟最多调用多少次耗额度的接口（模型、语音、代码运行），默认 60，0 表示不限
//   TRUST_PROXY      设为 1 时按 X-Forwarded-For 的第一个地址区分来源。只在前面确实有反向代理时打开，
//                    否则别人可以伪造这个头绕过限流
const crypto = require('crypto');

const COOKIE = 'mi_auth';
const COOKIE_MAX_AGE = 30 * 24 * 3600; // 30 天
/** 登录失败的限制：每个来源 10 分钟内最多试 10 次 */
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX = 10;

/** 这些接口会消耗模型、语音或计算额度，受 RATE_LIMIT 限制 */
const COSTLY = new Set([
  'POST /api/plan',
  'POST /api/ask',
  'POST /api/judge',
  'POST /api/report',
  'POST /api/extract',
  'POST /api/asr',
  'POST /api/tts',
  'POST /api/run',
  'POST /api/judge-code',
]);
/** 没登录也能访问的接口：前端要靠它们知道需不需要登录 */
const PUBLIC = new Set(['GET /api/config', 'POST /api/login', 'POST /api/logout']);

function guardConfig(env = process.env) {
  const n = Number(env.RATE_LIMIT);
  return {
    token: String(env.ACCESS_TOKEN || '').trim(),
    rateLimit: env.RATE_LIMIT === undefined || env.RATE_LIMIT === '' || !Number.isFinite(n) || n < 0 ? 60 : Math.floor(n),
    trustProxy: env.TRUST_PROXY === '1',
  };
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

/** 定长比较，避免按响应时间猜口令 */
function sameSecret(given, expected) {
  if (typeof given !== 'string' || !given || !expected) return false;
  return crypto.timingSafeEqual(sha256(given), sha256(expected));
}

/** Cookie 里不放口令原文，放口令的摘要；换了口令，旧 Cookie 自然失效 */
const cookieValue = (token) => crypto.createHmac('sha256', token).update('ai-mock-interview-session').digest('base64url');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** 这个请求有没有带对口令（Cookie 或 Bearer）。没设口令时总是 true */
function isAuthed(cfg, req) {
  if (!cfg.token) return true;
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (bearer && sameSecret(bearer[1].trim(), cfg.token)) return true;
  return sameSecret(parseCookies(req.headers.cookie)[COOKIE], cookieValue(cfg.token));
}

/** 经 HTTPS 反向代理访问时给 Cookie 加 Secure */
function isHttps(cfg, req) {
  return !!req.socket.encrypted || (cfg.trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

function loginCookie(cfg, req) {
  const secure = isHttps(cfg, req) ? '; Secure' : '';
  return `${COOKIE}=${cookieValue(cfg.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}${secure}`;
}
const logoutCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

function clientIp(cfg, req) {
  if (cfg.trustProxy) {
    const first = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || 'unknown';
}

/** 滑动窗口计数：每个 key 记下窗口内每次请求的时间 */
function createLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  return {
    /** 记一次；超出时返回需要等待的秒数，没超出返回 0 */
    take(key) {
      if (!max) return 0;
      const t = now();
      const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000));
      }
      list.push(t);
      hits.set(key, list);
      return 0;
    },
    /** 登录成功后清掉失败记录 */
    reset(key) {
      hits.delete(key);
    },
    /** 定期清掉过期的来源，免得内存一直涨 */
    prune() {
      const t = now();
      for (const [key, list] of hits) if (!list.some((x) => t - x < windowMs)) hits.delete(key);
    },
    size: () => hits.size,
  };
}

/**
 * 每个请求进来先过这里。返回 null 表示放行；否则返回 { status, error, headers? }，由调用方直接回给客户端。
 */
function createGuard(cfg) {
  const api = createLimiter({ max: cfg.rateLimit, windowMs: 60_000 });
  const logins = createLimiter({ max: LOGIN_MAX, windowMs: LOGIN_WINDOW_MS });
  const timer = setInterval(() => {
    api.prune();
    logins.prune();
  }, 5 * 60_000);
  timer.unref();

  return {
    cfg,
    check(route, req) {
      if (!PUBLIC.has(route) && !isAuthed(cfg, req)) return { status: 401, error: '需要访问口令，请先登录' };
      if (COSTLY.has(route)) {
        const wait = api.take(clientIp(cfg, req));
        if (wait) return { status: 429, error: `请求太频繁，请 ${wait} 秒后再试`, headers: { 'Retry-After': String(wait) } };
      }
      return null;
    },
    /** 校验口令。成功返回要设置的 Cookie；失败抛出带 status 的错误 */
    login(req, given) {
      if (!cfg.token) return null;
      const ip = clientIp(cfg, req);
      const wait = logins.take(ip);
      if (wait) throw Object.assign(new Error(`尝试次数太多，请 ${Math.ceil(wait / 60)} 分钟后再试`), { status: 429 });
      if (!sameSecret(String(given ?? ''), cfg.token)) throw Object.assign(new Error('口令不对'), { status: 401 });
      logins.reset(ip);
      return loginCookie(cfg, req);
    },
    logoutCookie,
    authState: (req) => ({ required: !!cfg.token, ok: isAuthed(cfg, req) }),
  };
}

module.exports = { guardConfig, createGuard, createLimiter, isAuthed, parseCookies, COSTLY, PUBLIC };
