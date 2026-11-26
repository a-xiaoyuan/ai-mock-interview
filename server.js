// AI 模拟面试后端 —— 零依赖 Node 服务（Node 18+）
// 开发：npm run dev（Vite 5173 + 本服务 3000）  生产：npm run build && npm start
// 配置 .env（可选）：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / LLM_FAST_MODEL / PORT / CODE_RUNNER
// 没有配置 LLM_API_KEY 时自动进入 mock 模式，可直接体验完整流程。

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadPacks, getPack, resolvePack } = require('./lib/packs');
const runner = require('./lib/runner');
const { normCases, mockJudgeFromCases } = require('./lib/cases');
const { algoCatalog } = require('./lib/algo-bank');
const { applyPreset, withMockAlgo } = require('./lib/preset');

// ---------- 配置 ----------
loadEnv(path.join(__dirname, '.env'));
const CFG = {
  port: Number(process.env.PORT || 3000),
  baseUrl: (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'deepseek-chat',
  fastModel: process.env.LLM_FAST_MODEL || process.env.LLM_MODEL || 'deepseek-chat',
  jsonMode: process.env.LLM_JSON_MODE === '1',
  // 算法题的自定义运行和预置用例判题共用这个开关：local（默认）只接受本机请求；on 允许任何来源（公网部署不要开，这不是沙箱）；off 关闭
  codeRunner: ['on', 'off'].includes(process.env.CODE_RUNNER) ? process.env.CODE_RUNNER : 'local',
};
const MOCK = !CFG.apiKey;
const MAX_DEPTH = 3;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

// ---------- Prompts ----------
const STYLE = {
  gentle: '语气友好、鼓励，但问题本身不放水。',
  pressure: '语气冷静、直接，像大厂压力面：不认可模糊回答，会追问具体数字和细节。',
};

const PROMPTS = {
  planner: ({ role, level, resume, jd, count, focus, bank, pack }) => [
    {
      role: 'system',
      content:
        '你是一位资深技术面试官，负责为一场模拟面试制定大纲。只输出 JSON，不要任何解释或 markdown。\n' +
        'JSON 格式：{"questions":[{"stage":"项目深挖|八股|场景题|算法","topic":"知识点短语","question":"主问题","points":["参考要点1","参考要点2","参考要点3"],"from":"选自面经题库填编号如 B3，选自题包填编号如 P2，选自预置算法题填编号如 A1，否则填空字符串"}]}\n' +
        (pack ? `本场使用题包「${pack.name}」，以下是这类面试的出题指引，必须遵守：\n${pack.guide}\n\n` : '') +
        '规则：\n' +
        (focus
          ? `- 这是一场针对「${focus}」的专项练习，候选人之前在这个知识点上反复答得不好。共 ${count} 道题，全部围绕这个知识点，从不同角度考察：先考核心概念和原理，再考边界和取舍，最后一道是场景题；如果简历里有相关项目，其中一道结合项目来问。\n` +
            '- topic 写这道题具体考察的子知识点。\n'
          : resume
            ? `- 共 ${count} 道题；约一半来自候选人简历里的具体项目（引用项目名和技术点），其余为与岗位和 JD 相关的八股和场景题。\n`
            : `- 共 ${count} 道题；候选人没有提供简历，不要出项目深挖题，也不要虚构候选人做过的项目，全部出与岗位和 JD 相关的八股题和场景题（场景题可以设定一个通用业务背景，但不能说成是候选人的项目）。\n`) +
        '- 题目由浅入深；每题只问一件事，不要一题多问。\n' +
        '- points 写 3-5 条优秀回答应覆盖的要点，供评分对照，要准确。\n' +
        '- 算法题会给候选人一个代码编辑器，可以在本机试跑，带预置用例的题在提交后会自动判题。编程题优先从下面的预置算法题里选一道（一场最多一道），from 填 A 编号；题面和测试用例以预置题为准，不要自己编输入输出。预置题都是从标准输入读、向标准输出写。题包里标了「有预置测试用例」的算法题同样会自动判题，from 填 P 编号即可。不选这些题时可以出口述题（讲思路和复杂度），不要编测试用例。\n' +
        '预置算法题：\n' +
        algoCatalog() +
        '\n' +
        (bank.length
          ? '\n- 用户消息里附有候选人收集的真实面经题库（编号 B1、B2…，来自真实面试，优先级高）。' +
            (focus
              ? `只选与「${focus}」相关的题，有几道选几道，不够的再自己出。`
              : `从中挑选与岗位相关的题，约占一半（${Math.ceil(count / 2)} 道左右，题库不够就全用）；优先挑「已考次数」少的。`) +
            '选用的题保留原意，可以稍作口语化改写；题库给了参考要点的可以沿用并补充；选用的题 from 填对应编号，自己出的题 from 填空字符串。'
          : '') +
        (pack && pack.questions.length
          ? '\n- 用户消息里附有题包的精选题（编号 P1、P2…，参考要点经过人工校对）。' +
            (focus
              ? `只选与「${focus}」相关的题。`
              : `八股和场景题优先从题包里选${bank.length ? '（面经题库的题优先级更高，题包补足其余）' : ''}，挑和简历、JD 相关的；`) +
            '选用的题 from 填对应编号，题目可以稍作口语化改写，但不要改变考察点。'
          : ''),
    },
    {
      role: 'user',
      content:
        `岗位：${role}\n级别：${level}\n${focus ? `专项知识点：${focus}\n` : ''}\n简历：\n${resume || '（未提供）'}\n\nJD：\n${jd || '（未提供）'}` +
        (bank.length
          ? '\n\n面经题库：\n' +
            bank
              .map((b, i) => `B${i + 1}【${b.topic}】${b.question}（已考 ${b.used} 次）${b.points.length ? `\n  参考要点：${b.points.join('；')}` : ''}`)
              .join('\n')
          : '') +
        (pack && pack.questions.length
          ? '\n\n题包精选题：\n' +
            pack.questions.map((q, i) => `P${i + 1}【${q.stage}·${q.topic}】${q.question}${q.cases?.length ? '（有预置测试用例，提交后自动判题）' : ''}`).join('\n')
          : ''),
    },
  ],

  extractor: ({ text, role }) => [
    {
      role: 'system',
      content:
        '你负责把候选人记录的真实面经整理成题库。只输出 JSON，不要任何解释或 markdown。\n' +
        'JSON 格式：{"questions":[{"stage":"项目深挖|八股|场景题|算法","topic":"知识点名称","question":"题目","points":["参考要点1","参考要点2","参考要点3"]}]}\n' +
        '规则：\n' +
        '- 只提取面试官问的技术问题；寒暄、HR 问题、薪资、反问环节、面经作者的感想都不要。\n' +
        '- 口语化或记录不全的问题，改写成清晰完整的一句话，但不能改变考察点；一句话里问了几件不相关的事，拆成几道题；重复的问题只保留一道。\n' +
        '- 追问如果考的是新知识点，单独成题；只是对上一题的深挖，就并入上一题的参考要点。\n' +
        '- 针对面经作者本人项目的问题（例如“你们项目的 QPS 多少”），改写成任何候选人都能回答的通用问法（例如“讲讲你项目里最高的 QPS 是多少、怎么测出来的”），stage 填项目深挖。\n' +
        '- 算法题写清题意，points 写思路和复杂度。\n' +
        '- topic 是 2-12 个字的知识点名称，例如“缓存一致性”“MySQL 索引”“TCP 握手”。\n' +
        '- points 写 3-5 条优秀回答应覆盖的要点，要准确；面经原文里如果记了答案或面试官的反馈，可以参考，但以正确性为准。\n' +
        '- 最多 30 道题。原文里没有技术问题就返回空数组。',
    },
    { role: 'user', content: `岗位：${role || '（未注明）'}\n\n面经原文：\n${text}` },
  ],

  // 和提题分开做：放在一次调用里，模型容易只输出重复的题、漏掉新题
  deduper: ({ fresh, existing }) => [
    {
      role: 'system',
      content:
        '判断新题和题库里已有的题是否重复。只输出 JSON：{"pairs":[{"new":"N1","existing":"E3"}]}。\n' +
        '两道题考察的是同一件事就算重复，说法不同也算（例如“索引什么时候失效”和“MySQL 索引在哪些场景下会失效”）；' +
        '同一知识点下的不同问题不算（例如 TCP 三次握手和四次挥手、MVCC 原理和 ReadView 生成时机）。没有重复就返回空数组。',
    },
    {
      role: 'user',
      content:
        '新题：\n' + fresh.map((q, i) => `N${i + 1}【${q.topic}】${q.question}`).join('\n') +
        '\n\n题库已有的题：\n' + existing.map((e, i) => `E${i + 1}【${e.topic}】${e.question}`).join('\n'),
    },
  ],

  judge: ({ q, chain, depth, pack }) => [
    {
      role: 'system',
      content:
        '你是技术面试的评分官，不直接和候选人对话。根据一道题的完整问答链给出评分，并决定是否追问。只输出 JSON。\n' +
        'JSON 格式：{"scores":{"accuracy":1-5,"depth":1-5,"practical":1-5,"expression":1-5},"verdict":"follow_up|next","direction":"若追问：只写一个最关键的追问点","comment":"一两句点评，指出最关键的问题","missed":["遗漏的要点"]}\n' +
        '评分标准（每维 1-5）：\n' +
        '- accuracy 准确性：事实和原理是否正确（有明显错误 ≤2）。\n' +
        '- depth 深度：是否讲到底层机制、边界、取舍。\n' +
        '- practical 实战关联：是否结合自己的项目或真实场景、有具体数据。\n' +
        '- expression 表达：是否先结论后展开、有条理。\n' +
        '算法题：候选人可能贴出代码、自己试跑的结果，以及「判题结果」（预置用例通过了几个）。有判题结果时，accuracy 以通过情况为主：全部通过再看实现是否真按题意、有没有取巧；没全部通过就按失败扣分，direction 指向一个失败用例的边界，不要把期望输出写进 direction。没有判题结果时仍按原规则：accuracy 看思路和代码是否正确，depth 看复杂度分析和能否优化，practical 看是否自己构造了边界用例；只说思路没写代码的，accuracy 不超过 3。追问优先问复杂度、失败用例或更优解。\n' +
        '追问规则：回答好 → 往深挖（原理/边界/为什么不用替代方案）；回答模糊 → 要具体（数据量、QPS、个人负责部分）；答错或不会 → 给一次提示性追问，再不会就 next。\n' +
        'direction 要求：只写一个点，一句话，描述“要考察什么”，不要写出答案、不要列出可选的技术方案名（面试官会照着问，写了等于泄题）；不要重复问答链里已经问过的点。' +
        '提示性追问只指出思考方向（例如“从并发写入的先后顺序想想会出什么问题”），不能说出方案本身。\n' +
        `已追问 ${depth} 层，上限 ${MAX_DEPTH} 层，达到上限必须 next。回答已经很完整也可以 next。评分要严格，不要被冗长但空洞的回答骗到。` +
        (pack ? `\n\n这场面试使用题包「${pack.name}」，以下是这个方向的评分要点，打分时一并参照：\n${pack.rubric}` : ''),
    },
    {
      role: 'user',
      content:
        `主问题：${q.question}\n参考要点：\n- ${q.points.join('\n- ')}\n\n问答链：\n` +
        chain.map((t) => `${t.role === 'interviewer' ? '面试官' : '候选人'}：${t.text}`).join('\n'),
    },
  ],

  interviewer: ({ style, role, mode, q, chain, direction, isLast }) => {
    const sys =
      `你是一位${role}方向的技术面试官，正在进行一场模拟面试。${STYLE[style] || STYLE.gentle}\n` +
      '要求：只输出你要说的话（口语化，1-3 句），不要旁白、不要 markdown、不要给出答案或提示正确答案、不要评价候选人刚才答得好坏。' +
      '如果候选人贴出了判题结果，追问可以指出哪一个用例没通过，但不要把期望输出说出来。';
    let task;
    if (mode === 'open') task = `先用一句话简短开场（不要自我介绍太长），然后问第一道题：「${q.question}」。可以稍作口语化改写，但不要改变考察点。`;
    else if (mode === 'follow')
      task =
        `针对候选人上一轮回答继续追问，追问方向：${direction}\n` +
        '要求：只问一件事，整段话只能有一个问号，不超过 50 个字，不要用逗号串起两个子问题；不要列举可选方案（例如“用 A 还是 B”），不要说出技术方案名替候选人作答；' +
        '直接提问，不要用“我们先回到”之类的开场；只有候选人明显答非所问时，才用半句话把话题拉回来。\n\n本题问答链：\n' +
        chain.map((t) => `${t.role === 'interviewer' ? '面试官' : '候选人'}：${t.text}`).join('\n');
    else task = `自然地过渡到下一道题：「${q.question}」。可以口语化改写，但不要改变考察点。${isLast ? '这是最后一道题。' : ''}`;
    return [
      { role: 'system', content: sys },
      { role: 'user', content: task },
    ];
  },

  reviewer: ({ role, level, items, focus, knownTopics }) => [
    {
      role: 'system',
      content:
        '你是技术面试复盘教练。根据整场面试每道题的评分和点评，写复盘。只输出 JSON。\n' +
        'JSON 格式：{"summary":"两三句总体评价，像面试官给 HR 的评语","highlights":["做得好的地方"],"weaknesses":[{"topic":"弱项","why":"为什么是弱项（引用具体题目表现）","action":"具体怎么补（看什么、练什么）"}]}\n' +
        'weaknesses 最多 3 条，按严重程度排序，action 要具体可执行。\n' +
        'topic 必须是一个知识点名称（2-12 个字的名词短语，例如“缓存一致性”“MySQL 索引”“线程池”），不能写成评价句（错误示例：“缓存更新策略知识不全面”“对并发问题理解不深”），具体哪里不足写在 why 里。' +
        '同一场里不要出现同一知识点的两条弱项，要合并。' +
        (knownTopics.length
          ? `\n候选人以往的弱项名称：${knownTopics.join('、')}。如果这次的弱项属于其中某个知识点（同一个知识点或它的子问题），topic 必须原样沿用那个名称，方便跟踪进步；确实是新知识点时才起新名字。`
          : '') +
        (focus
          ? `\n这是一场针对「${focus}」的专项练习：如果候选人在「${focus}」上仍有不足，topic 就写「${focus}」，把具体子问题写进 why；只有暴露出与它无关的其他知识点问题时才另起一条。`
          : ''),
    },
    {
      role: 'user',
      content:
        `岗位：${role}，级别：${level}\n\n` +
        items
          .map(
            (it, i) =>
              `第${i + 1}题【${it.topic}】${it.question}\n` +
              (it.skipped ? '（候选人跳过）' : `评分：${JSON.stringify(it.scores)}\n点评：${it.comment}\n遗漏：${(it.missed || []).join('；')}`)
          )
          .join('\n\n'),
    },
  ],
};

// ---------- LLM 调用（OpenAI 兼容） ----------
async function chat(messages, { model = CFG.model, json = false, stream = false, temperature = 0.3 } = {}) {
  const body = { model, messages, temperature, stream };
  if (json && CFG.jsonMode) body.response_format = { type: 'json_object' };
  const res = await fetch(`${CFG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (stream) return res;
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function parseJSON(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('模型没有返回 JSON：' + text.slice(0, 200));
  return JSON.parse(text.slice(s, e + 1));
}

async function chatJSON(messages, opts) {
  try {
    return parseJSON(await chat(messages, { ...opts, json: true }));
  } catch (err) {
    // 重试一次，提醒模型只输出 JSON
    const retry = [...messages, { role: 'user', content: '只输出合法 JSON，不要其他任何文字。' }];
    return parseJSON(await chat(retry, { ...opts, json: true }));
  }
}

// 把上游 SSE 流转成纯文本分块推给浏览器
async function pipeStream(upstream, res) {
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (delta) res.write(delta);
      } catch {}
    }
  }
  res.end();
}

// ---------- 校验与归一化 ----------
const clamp = (n) => Math.max(1, Math.min(5, Math.round(Number(n) || 1)));
function normJudge(j, depth) {
  const s = j.scores || {};
  const out = {
    scores: { accuracy: clamp(s.accuracy), depth: clamp(s.depth), practical: clamp(s.practical), expression: clamp(s.expression) },
    verdict: j.verdict === 'follow_up' && depth < MAX_DEPTH ? 'follow_up' : 'next',
    direction: String(j.direction || ''),
    comment: String(j.comment || ''),
    missed: Array.isArray(j.missed) ? j.missed.map(String) : [],
  };
  return out;
}
function normQuestion(q) {
  return {
    stage: String(q.stage || '八股'),
    topic: String(q.topic || q.stage || '综合').slice(0, 30),
    question: String(q.question),
    points: Array.isArray(q.points) ? q.points.map(String).slice(0, 6) : [],
  };
}

/** bank 为本次传给模型的题库；模型用 B1、B2… 引用，这里换回题库条目的 id */
function normPlan(p, count, bank = [], pack = null) {
  const used = new Set();
  const qs = (p.questions || [])
    .filter((q) => q && q.question)
    .slice(0, count)
    .map((q) => {
      const m = String(q.from || '').match(/B(\d+)/i);
      const b = m && bank[Number(m[1]) - 1];
      // 预置算法题、带用例的题包题：题面和用例以服务端为准。普通题包题仍只替换参考要点。
      const out = applyPreset(normQuestion(q), q.from, pack);
      if (b && !used.has(b.id)) {
        used.add(b.id);
        out.from = b.id;
      }
      return out;
    });
  if (!qs.length) throw new Error('大纲为空');
  return { questions: qs };
}

function normBank(list) {
  return (Array.isArray(list) ? list : [])
    .filter((b) => b && b.id && b.question)
    .slice(0, 30)
    .map((b) => ({
      id: String(b.id).slice(0, 40),
      question: String(b.question).slice(0, 300),
      topic: String(b.topic || '').slice(0, 30),
      points: Array.isArray(b.points) ? b.points.map((s) => String(s).slice(0, 120)).slice(0, 6) : [],
      used: Math.max(0, Number(b.used) || 0),
    }));
}

// ---------- Mock 模式 ----------
const mock = {
  /** 按行切分：以问号结尾、或带“问/题”编号的行当作题目 */
  extract({ text }) {
    const questions = text
      .split(/\n+/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.、)）]|Q\d*[:：]?|问[:：])\s*/, '').trim())
      .filter((l) => l.length >= 6 && /[?？]$/.test(l))
      .slice(0, 30)
      .map((question) => ({ stage: '八股', topic: '面经', question, points: [] }));
    return { questions };
  },
  plan({ role, count, focus, bank: library = [], pack = null }) {
    if (pack && pack.questions.length && !focus) {
      // mock：后一半题直接取题包里的题
      const n = Math.min(Math.floor(count / 2), pack.questions.length);
      const picked = pack.questions.slice(0, n).map((q, i) => ({ ...q, from: `P${i + 1}` }));
      const rest = this.plan({ role, count: count - n, focus, bank: library }).questions;
      return { questions: [...rest, ...picked] };
    }
    if (library.length && !focus) {
      // mock：前一半题直接取题库里考得最少的题
      const picked = library
        .map((b, i) => ({ ...b, ref: `B${i + 1}` }))
        .sort((a, b) => a.used - b.used)
        .slice(0, Math.ceil(count / 2))
        .map((b) => ({ stage: '面经', topic: b.topic, question: b.question, points: b.points, from: b.ref }));
      const rest = this.plan({ role, count: count - picked.length, focus, bank: [] }).questions;
      return { questions: [...picked, ...rest] };
    }
    if (focus) {
      const qs = [
        { stage: '八股', topic: `${focus} · 概念`, question: `用你自己的话讲讲「${focus}」是什么，解决了什么问题？`, points: ['定义准确', '说清要解决的问题', '举一个例子'] },
        { stage: '八股', topic: `${focus} · 原理`, question: `「${focus}」底层是怎么实现的？关键机制有哪些？`, points: ['核心机制', '关键数据结构或流程', '性能特点'] },
        { stage: '场景题', topic: `${focus} · 取舍`, question: `「${focus}」有哪些常见的坑或边界情况？你会怎么规避？`, points: ['至少两个典型问题', '原因分析', '规避方案及代价'] },
        { stage: '场景题', topic: `${focus} · 实战`, question: `如果线上和「${focus}」相关的部分出了故障，你会怎么排查？`, points: ['先止血', '定位思路', '监控指标', '复盘改进'] },
      ];
      return { questions: Array.from({ length: count }, (_, i) => qs[i % qs.length]) };
    }
    const bank = [
      { stage: '项目深挖', topic: '项目难点', question: '挑一个你简历里最有挑战的项目，讲讲你负责的部分和遇到的最大技术难点。', points: ['背景与目标清晰', '个人职责明确', '难点有技术深度', '方案有取舍', '结果有数据'] },
      { stage: '八股', topic: 'Redis', question: 'Redis 为什么这么快？单线程模型下怎么处理高并发？', points: ['内存操作', 'IO 多路复用', '单线程避免锁竞争', '高效数据结构', '6.0 之后的多线程 IO'] },
      { stage: '八股', topic: 'MySQL 索引', question: 'MySQL InnoDB 为什么用 B+ 树做索引？', points: ['树高低磁盘 IO 少', '叶子节点链表利于范围查询', '非叶子节点只存键', '对比 B 树和哈希'] },
      { stage: '场景题', topic: '缓存一致性', question: '如果要保证数据库和缓存的一致性，你会怎么设计？', points: ['先更新库再删缓存', '延迟双删', '订阅 binlog 异步删除', '最终一致与强一致取舍'] },
      { stage: '场景题', topic: '系统设计', question: '设计一个短链接服务，日均 1 亿次访问，你会怎么做？', points: ['发号器或哈希生成短码', '存储选型', '缓存热点', '301/302 取舍', '防刷与过期'] },
      { stage: '八股', topic: '并发', question: '讲讲线程池的核心参数，以及任务提交后的执行流程。', points: ['核心/最大线程数', '队列', '拒绝策略', '提交流程顺序'] },
    ];
    return { questions: bank.slice(0, count).map((q) => ({ ...q, question: q.question.replace('你简历里', `你简历里（${role}方向）`) })) };
  },
  judge({ chain, depth }) {
    const ans = chain.filter((t) => t.role === 'candidate').map((t) => t.text).join('');
    const fromCases = mockJudgeFromCases(ans, depth);
    if (fromCases) return fromCases;
    const len = ans.length;
    const base = len > 200 ? 4 : len > 80 ? 3 : len > 20 ? 2 : 1;
    const hasNum = /\d/.test(ans);
    return {
      scores: { accuracy: base, depth: Math.max(1, base - (depth ? 0 : 1)), practical: hasNum ? base : Math.max(1, base - 1), expression: base },
      verdict: depth < 1 && len < 200 ? 'follow_up' : 'next',
      direction: hasNum ? '追问方案的取舍：为什么不用其他方案' : '要求给出具体数据：数据量、QPS 或耗时',
      comment: len < 80 ? '回答偏短，核心机制没有展开。（mock 模式：按回答长度打分）' : '思路基本清楚，可以再讲讲边界条件。（mock 模式）',
      missed: ['（mock）对照参考要点检查遗漏'],
    };
  },
  interviewer({ mode, q, direction }) {
    if (mode === 'open') return `你好，我们开始吧，先从第一个问题聊起。${q.question}`;
    if (mode === 'follow') {
      if (direction.includes('用例') || direction.includes('编译') || direction.includes('报错')) return '有个用例没过。你觉得是哪种边界没考虑到？';
      if (direction.includes('复杂度') || direction.includes('优化')) return '时间和空间复杂度分别是多少？还有没有更省的写法？';
      return direction.includes('数据') ? '能具体一点吗？比如当时的数据量、QPS 或者耗时大概是多少？' : '为什么选这个方案？有没有考虑过别的做法，取舍是什么？';
    }
    return `好的，我们换个话题。${q.question}`;
  },
  reviewer({ items, focus }) {
    const scored = items.filter((i) => !i.skipped);
    const weak = [...scored].sort((a, b) => sum(a.scores) - sum(b.scores)).slice(0, 2);
    return {
      summary: '（mock 模式）整体能回答基本问题，但深度和实战数据不足，追问两层后容易卡住。',
      highlights: ['表达比较有条理'],
      weaknesses: weak.map((w, i) => ({ topic: focus && i === 0 ? focus : w.topic, why: `「${w.question.slice(0, 20)}…」得分偏低：${w.comment}`, action: `回顾参考要点，用 STAR 结构重答一遍，并准备一个具体数据。` })),
    };
  },
};
const sum = (s) => (s ? s.accuracy + s.depth + s.practical + s.expression : 0);

async function streamText(res, text) {
  for (const ch of text) {
    res.write(ch);
    await new Promise((r) => setTimeout(r, 18));
  }
  res.end();
}

// ---------- 路由 ----------
const routes = {
  'GET /api/config': async (_b, _res, req) => ({
    mock: MOCK,
    model: MOCK ? 'mock' : CFG.model,
    runner: runnerAllowed(req) ? runner.detectLanguages().map(({ id, name, version }) => ({ id, name, version })) : [],
  }),

  'POST /api/run': async (b, _res, req) => {
    if (!runnerAllowed(req)) throw new Error('代码运行只对本机开放（可以用 CODE_RUNNER=on 打开，公网部署时不要这样做）');
    const code = String(b.code || '');
    if (!code.trim()) throw new Error('代码为空');
    if (code.length > 50000) throw new Error('代码太长');
    return runner.runCode({ language: String(b.language || ''), code, stdin: String(b.stdin || '').slice(0, 100000) });
  },

  // 预置用例判题。和 /api/run 同一套运行器、同一道 CODE_RUNNER 开关，不是容器沙箱。
  'POST /api/judge-code': async (b, _res, req) => {
    if (!runnerAllowed(req)) throw new Error('代码运行只对本机开放（可以用 CODE_RUNNER=on 打开，公网部署时不要这样做）');
    const code = String(b.code || '');
    if (!code.trim()) throw new Error('代码为空');
    if (code.length > 50000) throw new Error('代码太长');
    const cases = normCases(b.cases);
    if (!cases.length) throw new Error('没有可运行的测试用例');
    return runner.judgeCases({ language: String(b.language || ''), code, cases });
  },

  // 题包列表（只返回概要，指引和评分要点留在服务端）
  'GET /api/packs': async () =>
    loadPacks().map((p) => ({ id: p.id, name: p.name, description: p.description, version: p.version, author: p.author, roles: p.roles, levels: p.levels, questionCount: p.questions.length })),

  'POST /api/plan': async (b) => {
    const count = Math.max(2, Math.min(10, Number(b.count) || 5));
    const focus = String(b.focus || '').trim().slice(0, 60);
    const bank = normBank(b.bank);
    const pack = resolvePack(String(b.pack || ''), String(b.role || ''), String(b.level || ''));
    const args = { role: String(b.role || '后端开发'), level: String(b.level || '校招'), resume: String(b.resume || '').slice(0, 8000), jd: String(b.jd || '').slice(0, 4000), count, focus, bank, pack };
    const planned = MOCK ? mock.plan(args) : await chatJSON(PROMPTS.planner(args), { model: CFG.model, temperature: 0.7 });
    const raw = MOCK ? withMockAlgo(planned, args) : planned;
    return { ...normPlan(raw, count, bank, pack), pack: pack ? { id: pack.id, name: pack.name } : null };
  },

  'POST /api/extract': async (b) => {
    const text = String(b.text || '').trim().slice(0, 20000);
    if (!text) throw new Error('面经内容为空');
    // 题库已有的题，用来让模型判断重复（只需要题目和知识点）
    const existing = (Array.isArray(b.existing) ? b.existing : [])
      .filter((e) => e && e.id && e.question)
      .slice(0, 150)
      .map((e) => ({ id: String(e.id).slice(0, 40), question: String(e.question).slice(0, 200), topic: String(e.topic || '').slice(0, 30) }));
    const args = { text, role: String(b.role || '').slice(0, 30) };
    const raw = MOCK ? mock.extract(args) : await chatJSON(PROMPTS.extractor(args), { model: CFG.model, temperature: 0.2 });
    const questions = (raw.questions || []).filter((q) => q && q.question).slice(0, 30).map(normQuestion);
    if (MOCK || !questions.length || !existing.length) return { questions };

    // 第二步：判重。失败不影响提题结果，前端还有字面相似度兜底
    try {
      const { pairs } = await chatJSON(PROMPTS.deduper({ fresh: questions, existing }), { model: CFG.fastModel, temperature: 0 });
      for (const p of Array.isArray(pairs) ? pairs : []) {
        const q = questions[Number(String(p.new).replace(/\D/g, '')) - 1];
        const e = existing[Number(String(p.existing).replace(/\D/g, '')) - 1];
        if (q && e && !q.duplicateOf) q.duplicateOf = e.id;
      }
    } catch (err) {
      console.warn('判重失败：', err.message);
    }
    return { questions };
  },

  'POST /api/judge': async (b) => {
    const depth = Number(b.depth) || 0;
    const args = { q: b.q, chain: b.chain || [], depth, pack: getPack(String(b.pack || '')) };
    const raw = MOCK ? mock.judge(args) : await chatJSON(PROMPTS.judge(args), { model: CFG.model, temperature: 0 });
    return normJudge(raw, depth);
  },

  'POST /api/ask': async (b, res) => {
    const args = { style: b.style, role: b.role, mode: b.mode, q: b.q, chain: b.chain || [], direction: b.direction || '', isLast: !!b.isLast };
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
    if (MOCK) return streamText(res, mock.interviewer(args));
    const upstream = await chat(PROMPTS.interviewer(args), { model: CFG.fastModel, stream: true, temperature: 0.6 });
    return pipeStream(upstream, res);
  },

  'POST /api/report': async (b) => {
    const items = Array.isArray(b.items) ? b.items : [];
    const focus = String(b.focus || '').trim().slice(0, 60);
    const knownTopics = (Array.isArray(b.knownTopics) ? b.knownTopics : [])
      .map((t) => String(t).trim().slice(0, 30))
      .filter(Boolean)
      .slice(0, 20);
    const args = { role: String(b.role || ''), level: String(b.level || ''), items, focus, knownTopics };
    const raw = MOCK ? mock.reviewer(args) : await chatJSON(PROMPTS.reviewer(args), { model: CFG.model, temperature: 0.3 });
    return {
      summary: String(raw.summary || ''),
      highlights: Array.isArray(raw.highlights) ? raw.highlights.map(String) : [],
      weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses.slice(0, 3).map((w) => ({ topic: String(w.topic || ''), why: String(w.why || ''), action: String(w.action || '') })) : [],
    };
  },
};

/** 代码以服务进程的权限运行（自定义运行和自动判题都走这里），默认只接受来自本机的请求 */
function runnerAllowed(req) {
  if (CFG.codeRunner === 'off') return false;
  if (CFG.codeRunner === 'on') return true;
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// ---------- 静态文件（npm run build 生成的 dist/） ----------
const DIST = path.join(__dirname, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  // 语言包是 gzip 压缩后的原始字节，由浏览器里的识别引擎自己解压，不要加 Content-Encoding
  '.gz': 'application/octet-stream',
};

function serveStatic(url, res) {
  const index = path.join(DIST, 'index.html');
  if (!fs.existsSync(index)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('前端还没有构建。请先运行 npm run build，或者用 npm run dev 启动开发模式（访问 http://localhost:5173）。');
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { rel = '/'; }
  let file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST + path.sep)) file = index; // 防止路径穿越
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = index; // 前端路由回退
  const hashed = file.startsWith(path.join(DIST, 'assets') + path.sep);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new Error('请求体过大')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('JSON 格式错误')); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) return serveStatic(url, res);
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) { res.writeHead(404); return res.end('Not found'); }
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await handler(body, res, req);
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    }
  } catch (err) {
    console.error(`[${url.pathname}]`, err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    } else res.end(`\n[出错了：${err.message}]`);
  }
});

server.listen(CFG.port, () => {
  console.log(`AI 模拟面试服务已启动：http://localhost:${CFG.port}`);
  if (!fs.existsSync(path.join(DIST, 'index.html'))) console.log('（dist/ 不存在：开发请访问 Vite 的 http://localhost:5173，或先 npm run build）');
  console.log(MOCK ? '当前为 mock 模式（未配置 LLM_API_KEY）' : `模型：${CFG.model} @ ${CFG.baseUrl}`);
  if (CFG.codeRunner !== 'off') {
    const langs = runner.detectLanguages().map((l) => l.name);
    console.log(`算法题可运行的语言：${langs.join('、') || '无'}${CFG.codeRunner === 'local' ? '（只对本机开放）' : ''}`);
  }
});
