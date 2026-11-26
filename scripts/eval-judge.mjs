#!/usr/bin/env node
// 评分回归集：用一组固定的问答反复调用 Judge（/api/judge），检查评分是否落在预期区间、
// 好答案是否稳定高于差答案，并和上次保存的基线对比，发现改 Prompt 或换模型后的评分漂移。
//
// 用法（先启动服务：npm start 或 npm run dev）：
//   npm run eval                      每个用例跑 3 次
//   npm run eval -- --runs 5          每个用例跑 5 次
//   npm run eval -- --only cache-strong,bplus-wrong
//   npm run eval -- --save-baseline   把这次的平均分保存为基线（evals/baseline.json）
//   npm run eval -- --base http://127.0.0.1:3000
//   npm run eval -- --pack java-backend-campus   评分时带上题包的评分要点，检查它会不会把通用评分带偏
//
// 退出码：有用例全部失败或对比不成立时为 1，方便放进 CI；只是不稳定或有漂移时为 0，但会提示。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASES_FILE = path.join(ROOT, 'evals', 'judge-cases.json');
const BASELINE_FILE = path.join(ROOT, 'evals', 'baseline.json');
const RESULTS_DIR = path.join(ROOT, 'evals', 'results');
const DIMS = [
  ['accuracy', '准确'],
  ['depth', '深度'],
  ['practical', '实战'],
  ['expression', '表达'],
];
/** 同一用例多次运行，总分极差超过这个值就算不稳定 */
const UNSTABLE_RANGE = 3;
/** 和基线相比，平均总分变化达到这个值就算漂移 */
const DRIFT_TOTAL = 2;
/** 对比用例默认要求好答案的平均总分至少高出这么多 */
const DEFAULT_MARGIN = 1;

const args = parseArgs(process.argv.slice(2));
const BASE = (args.base || process.env.EVAL_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '');
const RUNS = Math.max(1, Number(args.runs) || 3);
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 2); // 免费模型限流，默认只并发 2 个
const PACK = typeof args.pack === 'string' ? args.pack : '';
if (PACK && args['save-baseline']) {
  console.error('基线只记录不带题包的通用评分，--pack 和 --save-baseline 不能一起用。');
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const sum = (s) => DIMS.reduce((a, [k]) => a + s[k], 0);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x) => Math.round(x * 10) / 10;
const inRange = (v, [lo, hi]) => v >= lo && v <= hi;
const pad = (s, n) => {
  // 按显示宽度补齐（中文算两个字符）
  const w = [...String(s)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};

async function judge(q, chain, depth) {
  const res = await fetch(`${BASE}/api/judge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, chain, depth, pack: PACK }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  // 换模型/改 Prompt 后最常见的漂移就是返回缺 scores；在这里拦下，让这次运行走失败分支，而不是汇总时崩溃
  if (!data.scores || !DIMS.every(([k]) => Number.isFinite(data.scores[k]))) throw new Error('Judge 返回缺少 scores 或维度非法');
  return data;
}

/** 检查一次评分结果，返回不满足的约束（空数组表示通过） */
function check(expect, r) {
  const fails = [];
  for (const [k, range] of Object.entries(expect.scores || {})) {
    if (!inRange(r.scores[k], range)) fails.push(`${k}=${r.scores[k]} 不在 [${range}]`);
  }
  if (expect.total && !inRange(sum(r.scores), expect.total)) fails.push(`总分=${sum(r.scores)} 不在 [${expect.total}]`);
  if (expect.verdict && r.verdict !== expect.verdict) fails.push(`verdict=${r.verdict}，应为 ${expect.verdict}`);
  return fails;
}

async function pool(tasks, n) {
  const results = new Array(tasks.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
      done++;
      if (process.stdout.isTTY) process.stdout.write(`\r  已完成 ${done}/${tasks.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(30) + '\r');
  return results;
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  const only = typeof args.only === 'string' ? new Set(args.only.split(',').map((s) => s.trim())) : null;
  const cases = spec.cases.filter((c) => !only || only.has(c.id));
  if (!cases.length) throw new Error('没有匹配的用例');
  for (const c of cases) if (!spec.questions[c.q]) throw new Error(`用例 ${c.id} 引用了不存在的题目 ${c.q}`);

  let config;
  try {
    config = await (await fetch(`${BASE}/api/config`)).json();
  } catch {
    throw new Error(`连不上 ${BASE}，请先启动服务（npm start 或 npm run dev）`);
  }
  if (config.mock) console.warn('⚠ 服务处于 mock 模式（按回答长度打分），结果没有参考意义。请先在 .env 配置模型。\n');
  if (PACK) {
    const packs = await (await fetch(`${BASE}/api/packs`)).json();
    if (!packs.some((p) => p.id === PACK)) throw new Error(`服务端没有题包 ${PACK}（可用：${packs.map((p) => p.id).join('、') || '无'}）`);
  }
  console.log(`模型：${config.model}  用例：${cases.length} 个 × ${RUNS} 次  并发：${CONCURRENCY}${PACK ? `  题包：${PACK}` : ''}\n`);

  const started = Date.now();
  const tasks = cases.flatMap((c) =>
    Array.from({ length: RUNS }, () => async () => {
      const t = Date.now();
      try {
        const r = await judge(spec.questions[c.q], c.chain, c.depth || 0);
        return { id: c.id, ok: true, ms: Date.now() - t, ...r };
      } catch (e) {
        return { id: c.id, ok: false, ms: Date.now() - t, error: e.message };
      }
    }),
  );
  const runs = await pool(tasks, CONCURRENCY);

  // ---- 逐个用例汇总 ----
  const summary = {};
  let failedCases = 0;
  let unstableCases = 0;
  console.log(pad('用例', 22) + pad('结果', 14) + pad('总分（每次）', 18) + DIMS.map(([, n]) => pad(n, 6)).join('') + '追问率');
  for (const c of cases) {
    const rs = runs.filter((r) => r.id === c.id);
    const okRuns = rs.filter((r) => r.ok);
    const errors = rs.filter((r) => !r.ok);
    const checks = okRuns.map((r) => check(c.expect || {}, r));
    const passed = checks.filter((f) => !f.length).length;
    const totals = okRuns.map((r) => sum(r.scores));
    const range = totals.length ? Math.max(...totals) - Math.min(...totals) : 0;

    let status;
    if (!okRuns.length) status = '出错';
    else if (passed === rs.length) status = range > UNSTABLE_RANGE ? '不稳定' : '通过';
    else if (passed === 0) status = '失败';
    else status = '不稳定';
    if (status === '失败' || status === '出错') failedCases++;
    if (status === '不稳定') unstableCases++;

    const dimMeans = Object.fromEntries(DIMS.map(([k]) => [k, okRuns.length ? round1(mean(okRuns.map((r) => r.scores[k]))) : null]));
    const followRate = okRuns.length ? okRuns.filter((r) => r.verdict === 'follow_up').length / okRuns.length : null;
    summary[c.id] = { status, total: totals.length ? round1(mean(totals)) : null, totals, scores: dimMeans, followRate, passed, runs: rs.length };

    const icon = { 通过: '✓', 不稳定: '~', 失败: '✗', 出错: '!' }[status];
    console.log(
      pad(c.id, 22) +
        pad(`${icon} ${status} ${passed}/${rs.length}`, 14) +
        pad(totals.join(' ') || '—', 18) +
        DIMS.map(([k]) => pad(dimMeans[k] ?? '—', 6)).join('') +
        (followRate === null ? '—' : `${Math.round(followRate * 100)}%`),
    );
    // 列出没通过的原因（去重）
    const reasons = [...new Set(checks.flat())];
    for (const reason of reasons) console.log(`    ${reason}`);
    for (const e of [...new Set(errors.map((r) => r.error))]) console.log(`    请求出错：${e}`);
  }

  // ---- 好坏对比 ----
  let failedComparisons = 0;
  const comparisons = (spec.comparisons || []).filter((p) => summary[p.better] && summary[p.worse]);
  if (comparisons.length) {
    console.log('\n好坏对比（平均总分）');
    for (const p of comparisons) {
      const a = summary[p.better].total;
      const b = summary[p.worse].total;
      const margin = p.margin ?? DEFAULT_MARGIN;
      const ok = a !== null && b !== null && a >= b + margin;
      if (!ok) failedComparisons++;
      console.log(`  ${ok ? '✓' : '✗'} ${p.better} ${a} ${ok ? '≥' : '<'} ${p.worse} ${b}${margin ? ` + ${margin}` : ''}${p.note ? `   （${p.note}）` : ''}`);
    }
  }

  // ---- 和基线对比 ----
  let drifted = 0;
  if (fs.existsSync(BASELINE_FILE) && !args['save-baseline']) {
    const base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    console.log(`\n与基线对比（基线：${base.model}，${base.at.slice(0, 10)}）`);
    if (base.model !== config.model) console.log(`  注意：基线用的模型是 ${base.model}，这次是 ${config.model}`);
    if (PACK) console.log('  注意：基线是不带题包的通用评分，这次带了题包的评分要点，有变化是正常的，重点看变化方向是否符合题包的本意');
    let shown = 0;
    for (const c of cases) {
      const b = base.cases[c.id];
      const s = summary[c.id];
      if (!b || s.total === null) continue;
      const d = round1(s.total - b.total);
      const dimDiffs = DIMS.filter(([k]) => Math.abs(s.scores[k] - b.scores[k]) >= 1).map(([k, n]) => `${n} ${b.scores[k]}→${s.scores[k]}`);
      if (Math.abs(d) >= DRIFT_TOTAL || dimDiffs.length) {
        drifted++;
        shown++;
        console.log(`  ⚠ ${c.id}：总分 ${b.total} → ${s.total}（${d > 0 ? '+' : ''}${d}）${dimDiffs.length ? '；' + dimDiffs.join('，') : ''}`);
      }
    }
    if (!shown) console.log('  没有明显漂移');
  }

  // ---- 保存结果 ----
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const resultFile = path.join(RESULTS_DIR, `${stamp}.json`);
  fs.writeFileSync(resultFile, JSON.stringify({ model: config.model, at: new Date().toISOString(), runs: RUNS, summary, raw: runs }, null, 2));

  if (args['save-baseline']) {
    const baseline = {
      model: config.model,
      at: new Date().toISOString(),
      runs: RUNS,
      cases: Object.fromEntries(Object.entries(summary).filter(([, s]) => s.total !== null).map(([id, s]) => [id, { total: s.total, scores: s.scores, followRate: s.followRate }])),
    };
    if (only && fs.existsSync(BASELINE_FILE)) {
      // 只跑了部分用例时，合并进已有基线
      const old = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
      baseline.cases = { ...old.cases, ...baseline.cases };
    }
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`\n已保存基线：${path.relative(ROOT, BASELINE_FILE)}`);
  }

  const secs = Math.round((Date.now() - started) / 1000);
  console.log(
    `\n共 ${cases.length} 个用例：失败 ${failedCases}，不稳定 ${unstableCases}；对比不成立 ${failedComparisons}；漂移 ${drifted}。用时 ${secs} 秒。` +
      `\n详细结果：${path.relative(ROOT, resultFile)}`,
  );
  process.exitCode = failedCases || failedComparisons ? 1 : 0;
}

main().catch((e) => {
  console.error(`评分回归失败：${e.message}`);
  process.exitCode = 2;
});
