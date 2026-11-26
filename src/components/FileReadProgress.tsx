import { useEffect, useState } from 'react';

export function parsingLabel(message: string) {
  return /识别|语言包|引擎/.test(message) ? '正在识别…' : '正在读取…';
}

/** 读简历时的进度。识别可能要几十秒，把引擎状态和已用时间摆出来。 */
export function FileReadProgress({ message, ratio }: { message: string; ratio: number | null }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const pct = ratio == null ? null : Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return (
    <div className="file-parse" role="status" aria-live="polite">
      <div className="row">
        <span className="spinner" />
        <span>
          {message} 已用 <span className="num">{sec}</span> 秒
          {sec >= 8 && '。文件只在这个浏览器里处理，不会上传'}
          {sec >= 15 && '。页数多或第一次加载语言包时会更慢，请先不要关掉页面'}
        </span>
      </div>
      <span className="file-bar" aria-hidden="true">
        <span style={pct == null ? undefined : { width: `${pct}%` }} className={pct == null ? 'indeterminate' : undefined} />
      </span>
    </div>
  );
}
