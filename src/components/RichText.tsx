import { splitCodeBlocks } from '../lib/code';

/** 普通文字原样显示，``` 包起来的部分显示成代码块 */
export function RichText({ text }: { text: string }) {
  if (!text.includes('```')) return <>{text}</>;
  return (
    <>
      {splitCodeBlocks(text).map((p, i) =>
        p.code ? (
          <pre key={i} className="code-block" data-lang={p.lang || undefined}>
            <code>{p.text}</code>
          </pre>
        ) : (
          <span key={i}>{p.text.replace(/^\n+|\n+$/g, '')}</span>
        ),
      )}
    </>
  );
}
