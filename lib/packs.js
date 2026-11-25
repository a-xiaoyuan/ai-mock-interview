// Skill 题包：packs/ 目录下的 Markdown 文件，描述“某类面试怎么面”——出题指引、评分要点和题目。
// 格式见 packs/README.md。服务端和校验脚本（npm run check-packs）共用这里的解析逻辑，零依赖。

const fs = require('fs');
const path = require('path');

const PACKS_DIR = path.join(__dirname, '..', 'packs');
const STAGES = ['八股', '场景题', '项目深挖', '算法'];
const LIMITS = { guide: 1500, rubric: 1500, questions: 40 };

/** 解析 frontmatter 里的值：[a, b] 是数组，纯数字是数字，其余是字符串 */
function parseValue(raw) {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    return v
      .slice(1, -1)
      .split(/[,，]/)
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  if (/^\d+$/.test(v)) return Number(v);
  return v.replace(/^['"]|['"]$/g, '');
}

/**
 * 解析一个题包文件。返回 { pack, errors, warnings }；有 errors 时 pack 不可用。
 * 题包结构：frontmatter + 「## 面试官指引」「## 评分要点」「## 题目」三节，题目用「### [阶段] 知识点」开头。
 */
function parsePack(text, file = '') {
  const errors = [];
  const warnings = [];
  const src = text.replace(/\r\n?/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { pack: null, errors: ['缺少开头的 --- frontmatter ---'], warnings };

  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = parseValue(kv[2]);
    else errors.push(`frontmatter 无法解析这一行：${line}`);
  }

  // 按二级标题切分
  const sections = {};
  let current = null;
  for (const line of m[2].split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h && !line.startsWith('###')) {
      current = h[1];
      sections[current] = [];
    } else if (current) sections[current].push(line);
  }
  const block = (name) => (sections[name] || []).join('\n').trim();

  const questions = [];
  let q = null;
  for (const line of sections['题目'] || []) {
    const h = line.match(/^###\s+\[(.+?)\]\s*(.+?)\s*$/);
    if (h) {
      q = { stage: h[1].trim(), topic: h[2].trim(), question: '', points: [] };
      questions.push(q);
      continue;
    }
    if (line.startsWith('###')) {
      errors.push(`题目标题格式应为「### [阶段] 知识点」：${line}`);
      q = null;
      continue;
    }
    if (!q || !line.trim()) continue;
    const point = line.match(/^\s*[-*]\s+(.+)$/);
    if (point) q.points.push(point[1].trim());
    else q.question += (q.question ? ' ' : '') + line.trim();
  }

  const id = String(meta.id || '');
  const pack = {
    id,
    name: String(meta.name || ''),
    description: String(meta.description || ''),
    version: Number(meta.version) || 1,
    author: String(meta.author || ''),
    roles: Array.isArray(meta.roles) ? meta.roles.map(String) : meta.roles ? [String(meta.roles)] : [],
    levels: Array.isArray(meta.levels) ? meta.levels.map(String) : meta.levels ? [String(meta.levels)] : [],
    guide: block('面试官指引'),
    rubric: block('评分要点'),
    questions,
  };

  // ---- 校验 ----
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) errors.push('id 只能用小写字母、数字和连字符，例如 java-backend-campus');
  const base = path.basename(file, '.md');
  if (file && base !== id) errors.push(`文件名应与 id 一致：${id}.md`);
  if (!pack.name) errors.push('缺少 name');
  if (!pack.roles.length) errors.push('roles 至少写一个岗位');
  if (!pack.description) warnings.push('建议写 description，一句话说明适合谁');
  if (!pack.guide) errors.push('缺少「## 面试官指引」');
  if (!pack.rubric) errors.push('缺少「## 评分要点」');
  if (pack.guide.length > LIMITS.guide) errors.push(`面试官指引太长（${pack.guide.length} 字，上限 ${LIMITS.guide}），它会放进每次出题的 Prompt`);
  if (pack.rubric.length > LIMITS.rubric) errors.push(`评分要点太长（${pack.rubric.length} 字，上限 ${LIMITS.rubric}），它会放进每次评分的 Prompt`);
  if (!questions.length) warnings.push('没有题目，只会用指引和评分要点');
  if (questions.length > LIMITS.questions) errors.push(`题目太多（${questions.length} 道，上限 ${LIMITS.questions}），可以拆成几个题包`);
  const seen = new Set();
  questions.forEach((qq, i) => {
    const where = `第 ${i + 1} 题「${qq.topic}」`;
    if (!STAGES.includes(qq.stage)) errors.push(`${where}：阶段应为 ${STAGES.join(' / ')} 之一，现在是「${qq.stage}」`);
    if (!qq.question) errors.push(`${where}：缺少题目正文`);
    if (qq.points.length < 2) errors.push(`${where}：参考要点至少 2 条（用 - 开头的列表）`);
    const key = qq.question.replace(/\s/g, '');
    if (seen.has(key)) errors.push(`${where}：和前面的题重复`);
    seen.add(key);
  });

  return { pack: errors.length ? null : pack, errors, warnings };
}

let cache = { stamp: '', packs: [] };

/** 读取 packs/ 下所有题包；文件有变化时才重新解析。解析失败的题包会被跳过并打印原因。 */
function loadPacks() {
  if (!fs.existsSync(PACKS_DIR)) return [];
  const files = fs
    .readdirSync(PACKS_DIR)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort();
  const stamp = files.map((f) => `${f}:${fs.statSync(path.join(PACKS_DIR, f)).mtimeMs}`).join('|');
  if (stamp === cache.stamp) return cache.packs;

  const packs = [];
  for (const f of files) {
    const { pack, errors } = parsePack(fs.readFileSync(path.join(PACKS_DIR, f), 'utf8'), f);
    if (pack) packs.push(pack);
    else console.warn(`题包 ${f} 有错误，已跳过：\n  - ${errors.join('\n  - ')}`);
  }
  cache = { stamp, packs };
  return packs;
}

const getPack = (id) => (id ? loadPacks().find((p) => p.id === id) || null : null);

/** 首页的题包选择：auto 按岗位和级别自动匹配第一个题包，none 或空表示不用，其余当作题包 id */
function resolvePack(selection, role, level) {
  if (!selection || selection === 'none') return null;
  if (selection !== 'auto') return getPack(selection);
  return loadPacks().find((p) => p.roles.includes(role) && (!p.levels.length || p.levels.includes(level))) || null;
}

module.exports = { PACKS_DIR, STAGES, parsePack, loadPacks, getPack, resolvePack };
