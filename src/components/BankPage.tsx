import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, extractQuestions } from '../api';
import { ROLES } from '../constants';
import { addToBank, findDuplicate, loadBank, removeFromBank } from '../lib/bank';
import { ResumeFileError, readResumeFile } from '../lib/resumeFile';
import type { BankItem, Question } from '../types';
import { Icon } from './Icon';

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
    <>
      <div className="page-head">
        <div>
          <h1>面经题库</h1>
          <p>把你或朋友的真实面经贴进来，AI 会整理成题目和参考要点。开始面试时，会优先从题库里挑题。题库只存在这个浏览器里。</p>
        </div>
      </div>

      <div className="bank">
        <section className="card bank-add">
          <div className="card-head">
            <h2>
              <Icon name="upload" />
              添加面经
            </h2>
          </div>
          <div className="block">
            <div className="grid-2">
              <div>
                <label htmlFor="bank-source" className="field-label">
                  来源 <span className="hint">可选，例如「字节 后端 一面」</span>
                </label>
                <input id="bank-source" value={source} onChange={(e) => setSource(e.target.value)} maxLength={40} />
              </div>
              <div>
                <label htmlFor="bank-role" className="field-label">
                  适用岗位
                </label>
                <select id="bank-role" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value={ANY_ROLE}>不限岗位</option>
                  {ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <div className="field-label">
                <label htmlFor="bank-text">面经原文</label>
                <button type="button" className="sm" onClick={() => fileInput.current?.click()}>
                  <Icon name="upload" size={14} />
                  上传文件
                </button>
                <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
              </div>
              <textarea id="bank-text" rows={9} placeholder={PLACEHOLDER} value={text} onChange={(e) => setText(e.target.value)} />
            </div>

            <div className="extract-bar">
              <button className="primary" onClick={extract} disabled={extracting || !text.trim()}>
                {extracting ? <span className="spinner" /> : <Icon name="layers" size={15} />}
                整理成题目
              </button>
              {extracting && (
                <span className="small muted" role="status">
                  正在整理… 已用 <span className="num">{sec}</span> 秒{sec >= 5 && '，面经越长越慢，通常 15–60 秒'}
                </span>
              )}
              {saved && (
                <span className="file-status ok" style={{ marginTop: 0 }} role="status">
                  <Icon name="checkCircle" size={14} />
                  {saved}
                </span>
              )}
            </div>
            {error && (
              <div className="error-box" role="alert">
                <Icon name="alert" size={15} />
                <span>{error}</span>
              </div>
            )}
          </div>

          {drafts && (
            <>
              <div className="card-head" style={{ borderTop: '1px solid var(--line)' }}>
                <h2>
                  整理出 {drafts.length} 道题 <span className="hint">勾选要加入题库的题</span>
                </h2>
              </div>
              <ul className="draft-list">
                {drafts.map((d, i) => (
                  <li key={i} className={d.checked ? '' : 'off'}>
                    <label className="draft">
                      <input type="checkbox" checked={d.checked} onChange={() => toggle(i)} />
                      <span>
                        <span className="draft-q">{d.question}</span>
                        <span className="draft-tags">
                          <span className="chip">{d.stage}</span>
                          <span className="chip">{d.topic}</span>
                          {d.duplicate && (
                            <span className="chip warn" title={`题库里的：${d.duplicate}`}>
                              题库里已有
                            </span>
                          )}
                        </span>
                        {d.points.length > 0 && <span className="draft-points">要点：{d.points.join('；')}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="card-foot" style={{ justifyContent: 'flex-end' }}>
                <button className="ghost" onClick={() => setDrafts(null)}>
                  放弃
                </button>
                <button className="primary" onClick={save} disabled={!checkedCount}>
                  <Icon name="check" size={15} />
                  加入题库（{checkedCount} 题）
                </button>
              </div>
            </>
          )}
        </section>

        <section className="card bank-list">
          <div className="card-head">
            <h2>
              <Icon name="library" />
              已收录 <span className="num">{items.length}</span> 道题
            </h2>
            {items.length > 0 && (
              <div className="search">
                <Icon name="search" size={14} />
                <input placeholder="搜索题目、知识点、来源" aria-label="搜索题库" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            )}
          </div>
          {topics.length > 0 && (
            <div className="topic-chips">
              {topics.map(([t, n]) => (
                <button key={t} type="button" aria-pressed={query === t} onClick={() => setQuery(query === t ? '' : t)}>
                  {t} <span className="n">{n}</span>
                </button>
              ))}
            </div>
          )}
          {items.length === 0 ? (
            <div className="empty">
              <Icon name="library" size={28} style={{ margin: '0 auto 10px', color: 'var(--faint)' }} />
              题库还是空的。贴一份面经试试。
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="bank-table">
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
                      <td className="q-cell">
                        {it.question}
                        {it.points.length > 0 && <div className="q-points">要点：{it.points.join('；')}</div>}
                      </td>
                      <td className="nowrap">
                        <span className="chip">{it.topic}</span>
                      </td>
                      <td className="muted">{[it.source, it.role].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="num">{it.used}</td>
                      <td>
                        <button className="sm ghost danger icon-btn" onClick={() => remove(it.id)} aria-label={`删除：${it.question}`} title="删除">
                          <Icon name="trash" size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="empty">没有匹配的题目。</div>}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
