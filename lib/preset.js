// 把预置算法题、题包里写好的用例贴回题目。
// 模型和 mock 只负责选编号；题面和期望输出以题库 / 题包为准，避免现编用例对不上。

const { ALGO_PROBLEMS } = require('./algo-bank');

function copyCases(cases) {
  return cases.map((c) => ({ name: c.name || '', input: String(c.input ?? ''), output: String(c.output ?? '') }));
}

/**
 * 按 from 里的 A 编号或 P 编号贴预置内容。
 * 同时写了 P 和 A 时以题包为准。题包的题没有用例时，只替换参考要点（和原来一样）。
 * 有用例时连题面一起换成题包原文，保证输入输出格式和用例一致。
 */
function applyPreset(question, from, pack) {
  const out = { ...question, points: Array.isArray(question.points) ? question.points.slice() : [] };
  delete out.cases;
  const text = String(from || '');
  const pm = text.match(/P(\d+)/i);
  const pq = pm && pack && Array.isArray(pack.questions) ? pack.questions[Number(pm[1]) - 1] : null;
  const am = text.match(/A(\d+)/i);
  const aq = !pq && am ? ALGO_PROBLEMS[Number(am[1]) - 1] : null;
  if (aq) {
    out.stage = '算法';
    out.topic = aq.topic.slice(0, 30);
    out.question = aq.question;
    out.points = aq.points.slice(0, 6);
    out.cases = copyCases(aq.cases);
    return out;
  }
  if (pq) {
    out.points = pq.points.slice(0, 6);
    out.pack = pack.id;
    if (Array.isArray(pq.cases) && pq.cases.length) {
      out.stage = pq.stage || out.stage;
      out.topic = String(pq.topic || out.topic).slice(0, 30);
      out.question = pq.question;
      out.cases = copyCases(pq.cases);
    }
  }
  return out;
}

/**
 * mock 模式没有模型挑题。题目不少于 3 道、且还没有带用例的题时，
 * 把最后一道非题包题换成预置算法题 A1，方便直接体验判题。
 */
function withMockAlgo(raw, { focus = '', count = 0 } = {}) {
  const qs = Array.isArray(raw?.questions) ? raw.questions.map((q) => ({ ...q })) : [];
  if (focus || count < 3 || !qs.length) return { questions: qs };
  const has = qs.some((q) => /^A\d+$/i.test(String(q?.from || '')) || (Array.isArray(q?.cases) && q.cases.length));
  if (has) return { questions: qs };
  let idx = qs.length - 1;
  for (let i = qs.length - 1; i >= 0; i--) {
    if (!/^P\d+$/i.test(String(qs[i]?.from || ''))) {
      idx = i;
      break;
    }
  }
  qs[idx] = { stage: '算法', topic: '预置算法题', question: '占位', points: ['占位'], from: 'A1' };
  return { questions: qs };
}

module.exports = { applyPreset, withMockAlgo };
