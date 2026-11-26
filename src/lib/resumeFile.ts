// 在浏览器本地把简历文件转成文本：文件不会上传到本项目服务端。
// 有文字层的 PDF / Word 直接抽文本；扫描页和图片才懒加载 OCR。提取出的文字由用户确认后再用于出题。

import {
  ACCEPTED_RESUME_TYPES,
  MAX_PAGES,
  ResumeFileError,
  itemsToText,
  pageNeedsOcr,
  pdfOcrScale,
  readResumeLocally,
  type ResumeExtraction,
  type ResumeProgress,
} from '../../lib/resume-ocr.mjs';
import { createOcrSession } from './ocrEngine';

export { ACCEPTED_RESUME_TYPES, ResumeFileError };
export type { ResumeExtraction, ResumeProgress };

const RASTER_SKIP = /svg|emf|wmf/i;

interface PdfSession {
  doc: import('pdfjs-dist').PDFDocumentProxy;
  destroy: () => Promise<void>;
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })().catch((e: unknown) => {
      // 加载失败不缓存这个 rejected Promise，否则本次会话内所有 PDF 都读不了
      pdfjsPromise = null;
      throw e;
    });
  }
  return pdfjsPromise;
}

function pdfReadError(e: unknown): ResumeFileError {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/password/i.test(msg)) return new ResumeFileError('这个 PDF 设置了密码，请去掉密码后再上传。');
  return new ResumeFileError('无法读取这个 PDF，文件可能已损坏。');
}

async function pageHasImage(page: import('pdfjs-dist').PDFPageProxy, pdfjs: typeof import('pdfjs-dist')): Promise<boolean> {
  const opList = await page.getOperatorList();
  const ops = pdfjs.OPS;
  const imageOps = new Set(
    [
      ops.paintImageXObject,
      ops.paintImageXObjectRepeat,
      ops.paintInlineImageXObject,
      ops.paintInlineImageXObjectGroup,
      ops.paintImageMaskXObject,
      ops.paintImageMaskXObjectGroup,
      ops.paintImageMaskXObjectRepeat,
      ops.beginInlineImage,
    ].filter((n): n is number => typeof n === 'number'),
  );
  return opList.fnArray.some((fn) => imageOps.has(fn));
}

async function extractPdfPageTexts(file: File) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc: import('pdfjs-dist').PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => {});
    throw pdfReadError(e);
  }
  try {
    const pageCount = doc.numPages;
    const n = Math.min(pageCount, MAX_PAGES);
    const pages: { text: string; hasImage: boolean }[] = [];
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = itemsToText(content.items);
      let hasImage = false;
      // 文字够用的页不查图像，保持原来的提取速度
      if (pageNeedsOcr(text)) {
        try {
          hasImage = await pageHasImage(page, pdfjs);
        } catch {
          hasImage = false;
        }
      }
      pages.push({ text, hasImage });
      page.cleanup();
    }
    const session: PdfSession = { doc, destroy: () => task.destroy() };
    return { pages, pageCount, session };
  } catch (e) {
    await task.destroy().catch(() => {});
    if (e instanceof ResumeFileError) throw e;
    throw pdfReadError(e);
  }
}

async function renderPdfPage(session: unknown, pageIndex: number) {
  const doc = (session as PdfSession).doc;
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: pdfOcrScale(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ResumeFileError('浏览器无法创建画布，没法识别这一页。');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    await page.render({ canvas, viewport }).promise;
  } finally {
    page.cleanup();
  }
  return canvas;
}

async function closePdf(session: unknown) {
  await (session as PdfSession).destroy();
}

async function extractDocxRaw(file: File): Promise<string> {
  const { default: mammoth } = await import('mammoth');
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

function isRaster(contentType: string) {
  return contentType.toLowerCase().startsWith('image/') && !RASTER_SKIP.test(contentType);
}

async function extractDocxImages(file: File): Promise<Blob[]> {
  const { default: mammoth } = await import('mammoth');
  const images: Blob[] = [];
  let unsupported = false;
  try {
    await mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          if (images.length >= MAX_PAGES) return { src: '' };
          if (!isRaster(image.contentType || '')) {
            unsupported = true;
            return { src: '' };
          }
          const buf = await image.readAsArrayBuffer();
          images.push(new Blob([buf], { type: image.contentType }));
          return { src: '' };
        }),
      },
    );
  } catch (e) {
    if (e instanceof ResumeFileError) throw e;
    throw new ResumeFileError('无法读取这个 Word 里的图片。可以另存为 PDF 或图片后再试。');
  }
  if (!images.length && unsupported) {
    throw new ResumeFileError('这个 Word 里的图片不是 PNG、JPEG 这类常见格式，请另存为 PDF 或图片后再上传。');
  }
  return images;
}

export async function readResumeFile(file: File, onProgress?: (progress: ResumeProgress) => void): Promise<ResumeExtraction> {
  const ocr = createOcrSession();
  try {
    return await readResumeLocally(
      file,
      {
        readText: (f) => (f as File).text(),
        extractDocx: (f) => extractDocxRaw(f as File),
        extractDocxImages: (f) => extractDocxImages(f as File),
        extractPdfPageTexts: (f) => extractPdfPageTexts(f as File),
        renderPdfPage,
        closePdf,
        recognize: (image, onEngine) => ocr.recognize(image, onEngine),
      },
      onProgress,
    );
  } finally {
    await ocr.close();
  }
}
