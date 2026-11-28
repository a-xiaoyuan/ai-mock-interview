// 首页侧栏：导出、导入面试记录和面经题库
import { useRef, useState, type ChangeEvent } from 'react';
import { errorMessage } from '../api';
import { downloadBackup, importBackup } from '../lib/backup';
import { Icon } from './Icon';

export function BackupCard({ onImported }: { onImported: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function exportNow() {
    const n = downloadBackup();
    setResult({ ok: true, text: `已导出 ${n.history} 场记录、${n.bank} 道题库题。` });
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // 同一个文件可以再选一次
    if (!f) return;
    try {
      if (f.size > 20 * 1024 * 1024) throw new Error('文件太大，不像是备份文件');
      const r = importBackup(await f.text());
      const parts = [`新增 ${r.history} 场记录、${r.bank} 道题库题`];
      if (r.skipped) parts.push(`${r.skipped} 条已存在或超出上限，没有加入`);
      if (r.invalid) parts.push(`${r.invalid} 条格式不对，已跳过`);
      setResult({ ok: true, text: `导入完成：${parts.join('；')}。` });
      if (r.history || r.bank) onImported();
    } catch (err) {
      setResult({ ok: false, text: `导入失败：${errorMessage(err)}` });
    }
  }

  return (
    <section className="card backup">
      <div className="card-head">
        <h2>
          <Icon name="download" />
          数据备份
        </h2>
      </div>
      <div style={{ padding: '14px 20px 18px' }}>
        <p className="small muted">面试记录和题库只存在这个浏览器里，换浏览器或清缓存就没了。可以导出成文件，换设备后再导入；导入是合并，不会覆盖已有数据。</p>
        <div className="row">
          <button className="sm" onClick={exportNow}>
            <Icon name="download" size={14} />
            导出
          </button>
          <button className="sm ghost" onClick={() => file.current?.click()}>
            <Icon name="upload" size={14} />
            导入
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={onFile} />
        </div>
        {result && (
          <div className={`result small ${result.ok ? 'muted' : 'error-text'}`} role="status">
            {result.text}
          </div>
        )}
      </div>
    </section>
  );
}
