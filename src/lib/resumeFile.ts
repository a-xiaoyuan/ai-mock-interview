// 在浏览器本地把简历文件转成文本：文件不会上传到服务器，提取出的文字由用户确认后再用于出题。

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PAGES = 10;
/** 平均每页少于这么多字，基本可以判定为扫描件（图片），没有文字层 */
const MIN_CHARS_PER_PAGE = 20;

export const ACCEPTED_RESUME_TYPES = '.pdf,.txt,.md';

export class ResumeFileError extends Error {}

export async function readResumeFile(file: File): Promise<string> {
  if (file.size > MAX_SIZE) throw new ResumeFileError('文件超过 10 MB，请压缩后再上传，或直接粘贴文字。');
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return extractPdfText(file);
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) return cleanText(await file.text());
  throw new ResumeFileError('暂时只支持 PDF、TXT、Markdown。Word 简历可以先另存为 PDF。');
}

async function extractPdfText(file: File): Promise<string> {
  // pdf.js 体积较大，用到时才加载
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
    if (/password/i.test(msg)) throw new ResumeFileError('这个 PDF 设置了密码，请去掉密码后再上传。');
    throw new ResumeFileError('无法读取这个 PDF，文件可能已损坏。');
  }

  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const parts: string[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(itemsToText(content.items));
    }
    const text = cleanText(parts.join('\n\n'));
    if (text.replace(/\s/g, '').length < pages * MIN_CHARS_PER_PAGE) {
      throw new ResumeFileError('这个 PDF 里几乎没有可提取的文字，可能是扫描件或图片导出的。请复制简历文字粘贴进来。');
    }
    return text;
  } finally {
    await task.destroy();
  }
}

interface TextLike {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
}

/** 按 pdf.js 给出的换行标记和纵坐标变化拼出行 */
function itemsToText(items: unknown[]): string {
  let out = '';
  let lastY: number | null = null;
  for (const raw of items) {
    const item = raw as TextLike;
    if (typeof item.str !== 'string') continue; // 标记内容，不含文字
    const y = item.transform?.[5] ?? null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
    out += item.str;
    // pdf.js 常在行尾放一个带 hasEOL 的空片段，避免重复换行
    if (item.hasEOL && !out.endsWith('\n')) out += '\n';
    if (y !== null) lastY = y;
  }
  return out;
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t 　 ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
