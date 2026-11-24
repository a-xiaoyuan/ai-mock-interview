import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, extractQuestions } from '../api';
import { ROLES } from '../constants';
import { addToBank, findDuplicate, loadBank, removeFromBank } from '../lib/bank';
import { ResumeFileError, readResumeFile } from '../lib/resumeFile';
import type { BankItem, Question } from '../types';

const PLACEHOLDER = `把面经原文贴进来，记得乱也没关系，例如：
一面（45 分钟）
1. 自我介绍
2. 项目里 Redis 怎么用的？缓存和数据库不一致怎么办
3. 讲讲 MySQL 的 MVCC
4. 手撕：LRU 缓存
反问：团队做什么业务`;

const ANY_ROLE = '';

interface Draft extends Question {
  checked: boolean;
  /** 与之重复的题库题目，空字符串表示不重复 */
  duplicate: string;
}

/** 面经题库：粘贴或上传面经 → AI 整理成题目 → 确认后存进本地题库；出题时优先使用 */
export function BankPage() {
  const [items, setItems] = useState<BankItem[]>(loadBank);
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [role, setRole] = useState(ANY_ROLE);
  const [extracting, setExtracting] = useState(false);
  const [sec, setSec] = useState(0);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [saved, setSaved] = useState('');
  const [query, setQuery] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!extracting) return;
    setSec(0);
    const t = setInterval(() => setSec((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [extracting]);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      setText(await readResumeFile(file));
    } catch (e) {
      setError(e instanceof ResumeFileError ? e.message.replace('简历', '面经') : `读取失败：${errorMessage(e)}`);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function extract() {
    setError('');
    setSaved('');
    setExtracting(true);
    try {
      const bank = loadBank();
      const existing = bank.slice(0, 150).map(({ id, question, topic }) => ({ id, question, topic }));
      const { questions } = await extractQuestions({ text: text.trim(), role, existing });
      if (!questions.length) {
        setError('没有从这段文字里找到技术问题。');
        setDrafts(null);
      } else {
        setDrafts(
          questions.map(({ duplicateOf, ...q }) => {
            const same = bank.find((it) => it.id === duplicateOf) ?? findDuplicate(q.question, bank);
            return { ...q, duplicate: same?.question ?? '', checked: !same };
          }),
        );
      }
    } catch (e) {
      setError(`整理失败：${errorMessage(e)}`);
    } finally {
      setExtracting(false);
    }
  }

  function save() {
    if (!drafts) return;
    const picked = drafts.filter((d) => d.checked);
    const n = addToBank(picked, { source: source.trim(), role });
    const skipped = picked.length - n;
    setItems(loadBank());
    setDrafts(null);
    setText('');
    setSaved(`已加入 ${n} 道题${skipped ? `，${skipped} 道与题库里的题重复，已跳过` : ''}。`);
  }

  function remove(id: string) {
    removeFromBank([id]);
    setItems(loadBank());
  }

  const toggle = (i: number) => setDrafts((list) => list && list.map((d, j) => (j === i ? { ...d, checked: !d.checked } : d)));
  const checkedCount = drafts?.filter((d) => d.checked).length ?? 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => [it.question, it.topic, it.source].some((s) => s.toLowerCase().includes(q)));
  }, [items, query]);

  const topics = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) map.set(it.topic, (map.get(it.topic) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [items]);

  return (
    <section className="card">
      <h2>面经题库</h2>
      <p className="sub">把你或朋友的真实面经贴进来，AI 会整理成题目和参考要点。开始面试时，会优先从题库里挑题。题库只存在这个浏览器里。</p>

      <div className="grid2 bank-meta">
        <div>
          <label htmlFor="bank-source">
            来源 <span className="hint">可选，例如「字节 后端 一面」</span>
          </label>
          <input id="bank-source" value={source} onChange={(e) => setSource(e.target.value)} maxLength={40} />
        </div>
        <div>
          <label htmlFor="bank-role">适用岗位</label>
          <select id="bank-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value={ANY_ROLE}>不限岗位</option>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="label-row">
        <label htmlFor="bank-text">面经原文</label>
        <button type="button" className="small" onClick={() => fileInput.current?.click()}>
          上传文件
        </button>
        <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
      </div>
      <textarea id="bank-text" rows={9} placeholder={PLACEHOLDER} value={text} onChange={(e) => setText(e.target.value)} />

      <div className="row bank-actions">
        <button className="primary" onClick={extract} disabled={extracting || !text.trim()}>
          整理成题目
        </button>
        {extracting && (
          <span className="muted">
            正在整理… 已用 {sec} 秒{sec >= 5 && '，面经越长越慢，通常 15–60 秒'}
          </span>
        )}
        {saved && <span className="muted">{saved}</span>}
      </div>
      {error && <div className="error">{error}</div>}

      {drafts && (
        <div className="section">
          <h3>
            整理出 {drafts.length} 道题 <span className="muted">勾选要加入题库的题</span>
          </h3>
          <ul className="draft-list">
            {drafts.map((d, i) => (
              <li key={i} className={d.checked ? '' : 'off'}>
                <label className="draft">
                  <input type="checkbox" checked={d.checked} onChange={() => toggle(i)} />
                  <span>
                    <span className="draft-q">{d.question}</span>
                    <span className="draft-tags">
                      <span className="stage">{d.stage}</span>
                      <span className="stage">{d.topic}</span>
                      {d.duplicate && (
                        <span className="tag" title={`题库里的：${d.duplicate}`}>
                          题库里已有
                        </span>
                      )}
                    </span>
                    {d.points.length > 0 && <span className="muted draft-points">要点：{d.points.join('；')}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="primary" onClick={save} disabled={!checkedCount}>
              加入题库（{checkedCount} 题）
            </button>
            <button onClick={() => setDrafts(null)}>放弃</button>
          </div>
        </div>
      )}

      <div className="section bank-list">
        <div className="label-row">
          <h3>已收录 {items.length} 道题</h3>
          {items.length > 0 && (
            <input className="compact-input" placeholder="搜索题目、知识点、来源" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
        </div>
        {topics.length > 0 && (
          <div className="topic-chips">
            {topics.map(([t, n]) => (
              <button key={t} type="button" className={`chip${query === t ? ' on' : ''}`} onClick={() => setQuery(query === t ? '' : t)}>
                {t} <span className="muted">{n}</span>
              </button>
            ))}
          </div>
        )}
        {items.length === 0 ? (
          <p className="muted">题库还是空的。贴一份面经试试。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>题目</th>
                <th>知识点</th>
                <th>来源</th>
                <th>已考</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id}>
                  <td title={it.points.length ? `要点：${it.points.join('；')}` : undefined}>{it.question}</td>
                  <td className="nowrap">{it.topic}</td>
                  <td className="muted">{[it.source, it.role].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{it.used}</td>
                  <td>
                    <button className="small" onClick={() => remove(it.id)} aria-label={`删除：${it.question}`}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
