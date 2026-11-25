#!/usr/bin/env node
// 检查 packs/ 下的题包格式：npm run check-packs
// 有错误时退出码为 1（可以放进 CI），只有提醒时为 0。

const fs = require('fs');
const path = require('path');
const { PACKS_DIR, parsePack } = require('../lib/packs');

/** 从前端常量里读出岗位和级别选项，题包的 roles / levels 要和它们写法一致 */
function readOptions(name) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'constants.ts'), 'utf8');
  const m = src.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
}

const ROLES = readOptions('ROLES');
const LEVELS = readOptions('LEVELS');
const files = fs.existsSync(PACKS_DIR) ? fs.readdirSync(PACKS_DIR).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md') : [];

let failed = 0;
const ids = new Map();
for (const f of files.sort()) {
  const { pack, errors, warnings } = parsePack(fs.readFileSync(path.join(PACKS_DIR, f), 'utf8'), f);
  if (pack) {
    for (const r of pack.roles) if (!ROLES.includes(r)) warnings.push(`岗位「${r}」不在首页的选项里（${ROLES.join('、')}），不会被自动匹配`);
    for (const l of pack.levels) if (!LEVELS.includes(l)) warnings.push(`级别「${l}」不在首页的选项里（${LEVELS.join('、')}）`);
    if (ids.has(pack.id)) errors.push(`id 与 ${ids.get(pack.id)} 重复`);
    ids.set(pack.id, f);
  }
  if (errors.length) failed++;
  const head = errors.length ? '✗' : '✓';
  const info = pack ? `${pack.name}，${pack.questions.length} 道题` : '';
  console.log(`${head} ${f}${info ? `（${info}）` : ''}`);
  for (const e of errors) console.log(`    错误：${e}`);
  for (const w of warnings) console.log(`    提醒：${w}`);
}

if (!files.length) console.log('packs/ 下还没有题包');
console.log(`\n共 ${files.length} 个题包，${failed} 个有错误。`);
process.exitCode = failed ? 1 : 0;
