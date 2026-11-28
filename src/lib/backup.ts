// 数据备份：面试记录和面经题库只存在这个浏览器里（localStorage），换浏览器或清缓存就没了。
// 导出成一个 JSON 文件，换设备后再导入；导入是合并，不会覆盖已有的数据。
import type { BankItem, InterviewRecord } from '../types';
import { HISTORY_LIMIT, loadHistory, replaceHistory } from './history';
import { BANK_LIMIT, loadBank, replaceBank } from './bank';

const APP = 'ai-mock-interview';
const VERSION = 1;

export interface Backup {
  app: typeof APP;
  version: number;
  exportedAt: number;
  history: InterviewRecord[];
  bank: BankItem[];
}

export function makeBackup(now = Date.now()): Backup {
  return { app: APP, version: VERSION, exportedAt: now, history: loadHistory(), bank: loadBank() };
}

export function downloadBackup() {
  const backup = makeBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-mock-interview-backup-${new Date(backup.exportedAt).toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { history: backup.history.length, bank: backup.bank.length };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** 只收结构对得上的记录，防止导入一个不相干的文件把页面弄坏 */
function validRecord(x: unknown): x is InterviewRecord {
  return isObj(x) && typeof x.at === 'number' && typeof x.role === 'string' && typeof x.total === 'number' && Array.isArray(x.items) && isObj(x.report);
}
function validBankItem(x: unknown): x is BankItem {
  return isObj(x) && typeof x.id === 'string' && typeof x.question === 'string' && typeof x.topic === 'string' && Array.isArray(x.points);
}

export interface ImportResult {
  /** 新增了多少场记录、多少道题 */
  history: number;
  bank: number;
  /** 格式对但因为重复或超出上限没有加进来的 */
  skipped: number;
  /** 格式不对、直接跳过的 */
  invalid: number;
}

/** 把备份合并进当前数据：记录按时间去重，题目按编号去重 */
export function importBackup(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  if (!isObj(data) || data.app !== APP) throw new Error('这不是本应用导出的备份文件');
  if (typeof data.version !== 'number' || data.version > VERSION) throw new Error('备份文件的版本比当前应用新，请先更新应用');
  const records = Array.isArray(data.history) ? data.history.filter(validRecord) : [];
  const items = Array.isArray(data.bank) ? data.bank.filter(validBankItem) : [];

  const history = loadHistory();
  const seenAt = new Set(history.map((r) => r.at));
  const newRecords = records.filter((r) => !seenAt.has(r.at) && seenAt.add(r.at));
  // 新的在前，超出上限的丢掉最旧的
  const mergedHistory = [...history, ...newRecords].sort((a, b) => b.at - a.at).slice(0, HISTORY_LIMIT);
  const keptAt = new Set(mergedHistory.map((r) => r.at));
  const addedHistory = newRecords.filter((r) => keptAt.has(r.at)).length;

  const bank = loadBank();
  const seenId = new Set(bank.map((b) => b.id));
  const newItems = items.filter((b) => !seenId.has(b.id) && seenId.add(b.id));
  const room = Math.max(0, BANK_LIMIT - bank.length);
  const addedBank = Math.min(room, newItems.length);

  if (addedHistory) replaceHistory(mergedHistory);
  if (addedBank) replaceBank([...bank, ...newItems.slice(0, addedBank)]);
  const total = (Array.isArray(data.history) ? data.history.length : 0) + (Array.isArray(data.bank) ? data.bank.length : 0);
  const valid = records.length + items.length;
  return { history: addedHistory, bank: addedBank, skipped: valid - addedHistory - addedBank, invalid: total - valid };
}
