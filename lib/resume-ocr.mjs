// 简历读取的分流：有文字层的 PDF / Word 直接抽文本，扫描页和图片才走 OCR。
// 这里没有网络请求。文件字节只交给调用方注入的本地读取函数，不会上传到本项目服务端。

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PAGES = 10;
/** 去掉空白后少于此数，视为这一页没有可用文字层 */
const MIN_CHARS_PER_PAGE = 20;
/** 渲染扫描页时，长边大约对齐到这个像素，兼顾清晰度和识别速度 */
const PDF_OCR_LONG_EDGE = 2200;
const PDF_OCR_MAX_SCALE = 3;
/** 图片长边超过这个值就先缩小，避免识别过慢 */
const IMAGE_MAX_EDGE = 2400;
const IMAGE_MIN_EDGE = 900;
const IMAGE_UPSCALE_EDGE = 1600;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);

const ACCEPTED_RESUME_TYPES = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.bmp,.gif,image/png,image/jpeg,image/webp,image/bmp,image/gif';

const NOTE_TRUNC = '超过 10 页的部分没有读取。';
const NOTE_OCR = '扫描件和图片是在浏览器里识别的，可能有错字，请对照原件改一改。';

class ResumeFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResumeFileError';
  }
}

function extname(name) {
  const lower = String(name || '').toLowerCase();
  const i = lower.lastIndexOf('.');
  return i >= 0 ? lower.slice(i) : '';
}

function isImageResume(name, type) {
  if (IMAGE_EXT.has(extname(name))) return true;
  const t = String(type || '').toLowerCase();
  return t.startsWith('image/') && !t.includes('svg');
}

function textChars(text) {
  return String(text ?? '').replace(/\s/g, '').length;
}

function pageNeedsOcr(text) {
  return textChars(text) < MIN_CHARS_PER_PAGE;
}

/**
 * 每一页决定走文字层还是 OCR。
 * 文字够用的页永远不识别。只有「整份都几乎没字」或「这一页几乎没字但有图像」才识别，
 * 这样普通 PDF 末尾的空白页不会被送去 OCR。
 * @param {{ text: string, hasImage?: boolean }[]} pages
 * @returns {('text' | 'ocr')[]}
 */
function planPdfPages(pages) {
  const list = pages.map((p) => ({ text: String(p?.text ?? ''), hasImage: Boolean(p?.hasImage) }));
  const chars = list.reduce((n, p) => n + textChars(p.text), 0);
  const scannedDoc = list.length > 0 && chars < list.length * MIN_CHARS_PER_PAGE;
  return list.map((p) => {
    if (!pageNeedsOcr(p.text)) return 'text';
    if (p.hasImage || scannedDoc) return 'ocr';
    return 'text';
  });
}

/** 按 pdf.js 给出的换行标记和纵坐标变化拼出行 */
function itemsToText(items) {
  let out = '';
  let lastY = null;
  for (const raw of items) {
    const item = raw;
    if (typeof item?.str !== 'string') continue; // 标记内容，不含文字
    const y = item.transform?.[5] ?? null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
    out += item.str;
    // pdf.js 常在行尾放一个带 hasEOL 的空片段，避免重复换行
    if (item.hasEOL && !out.endsWith('\n')) out += '\n';
    if (y !== null) lastY = y;
  }
  return out;
}

function cleanText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t \u00a0\u3000]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeDocx(text) {
  return cleanText(text).replace(/\n{2,}/g, '\n'); // mammoth 每段之间空一行，与 PDF 输出保持一致
}

/** PDF 用户单位是 1/72 英寸。返回渲染倍率，使长边接近 PDF_OCR_LONG_EDGE，且不超过 3 倍 */
function pdfOcrScale(width, height) {
  const long = Math.max(Number(width) || 0, Number(height) || 0);
  if (long <= 0) return 1;
  return Math.min(PDF_OCR_LONG_EDGE / long, PDF_OCR_MAX_SCALE);
}

/** 图片送识别前的目标像素。过大缩小，过小适度放大 */
function fitOcrPixels(width, height) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const long = Math.max(w, h);
  if (long <= 0) return { width: 1, height: 1 };
  let scale = 1;
  if (long > IMAGE_MAX_EDGE) scale = IMAGE_MAX_EDGE / long;
  else if (long < IMAGE_MIN_EDGE) scale = Math.min(3, IMAGE_UPSCALE_EDGE / long);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function buildNote({ truncated, usedOcr }) {
  const parts = [];
  if (truncated) parts.push(NOTE_TRUNC);
  if (usedOcr) parts.push(NOTE_OCR);
  return parts.join('');
}

function emptyMessage(kind) {
  if (kind === 'image') return '没有从这张图片里识别出文字。请换一张更清晰、正向的图片，或直接粘贴文字。';
  if (kind === 'docx') return '没有从 Word 里的图片识别出文字。请换一张更清晰的图片，或直接粘贴文字。';
  return '没有从扫描页里识别出文字。请尽量使用清晰、正向的扫描件，或直接粘贴文字。';
}

function wrapOcrError(e) {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const msg = raw.replace(/\s+/g, ' ').trim().slice(0, 180);
  if (/Network error|Failed to fetch|NetworkError|importScripts|traineddata|\.wasm|load worker|Worker/i.test(msg)) {
    return new ResumeFileError('文字识别引擎没有加载成功。请检查网络后重试。文件只在浏览器里处理，没有上传。');
  }
  return new ResumeFileError(`文字识别失败（${msg || '未知错误'}）。文件只在浏览器里处理，没有上传。`);
}

/**
 * 把 Tesseract 的进度译成界面文案。ratio 为 0–1；未知时为 null。
 * @param {{ status?: string, progress?: number, page?: number, pages?: number }} info
 */
function formatOcrProgress(info) {
  const status = info?.status || '';
  const p = typeof info?.progress === 'number' && info.progress >= 0 && info.progress <= 1 ? info.progress : null;
  let ratio = null;
  let message = '正在识别文字…';
  if (status === 'loading tesseract core') {
    ratio = p == null ? 0.08 : 0.02 + p * 0.18;
    message = '正在加载识别引擎…';
  } else if (status === 'initializing tesseract') {
    ratio = 0.22;
    message = '正在初始化识别引擎…';
  } else if (status === 'loading language traineddata') {
    ratio = p == null ? 0.4 : 0.24 + p * 0.4;
    message = '正在加载简体中文和英文语言包… 首次使用会久一些';
  } else if (status === 'initializing api') {
    ratio = 0.68;
    message = '正在准备识别…';
  } else if (status === 'recognizing text') {
    ratio = p == null ? 0.8 : 0.7 + p * 0.3;
    message = '正在识别文字…';
  }
  const pages = Number(info?.pages) || 0;
  const page = Number(info?.page) || 0;
  if (pages > 1 && page > 0) {
    const inner = ratio == null ? 0 : ratio;
    ratio = ((page - 1) + inner) / pages;
    message = `第 ${page}/${pages} 页：${message}`;
  }
  return { ratio, message };
}

function report(onProgress, progress) {
  if (onProgress) onProgress(progress);
}

function assertSize(file) {
  if (Number(file?.size) > MAX_SIZE) throw new ResumeFileError('文件超过 10 MB，请压缩后再上传，或直接粘贴文字。');
}

async function recognizeInto(io, image, onProgress, page, pages) {
  try {
    return await io.recognize(image, (info) => {
      report(onProgress, formatOcrProgress({ ...info, page, pages }));
    });
  } catch (e) {
    if (e instanceof ResumeFileError) throw e;
    throw wrapOcrError(e);
  }
}

async function readImage(file, io, onProgress) {
  report(onProgress, { ratio: 0, message: '正在准备识别图片中的文字（简体中文 + 英文）…' });
  const text = cleanText(await recognizeInto(io, file, onProgress));
  if (!text) throw new ResumeFileError(emptyMessage('image'));
  return { text, note: buildNote({ usedOcr: true }) };
}

async function readDocx(file, io, onProgress) {
  report(onProgress, { ratio: null, message: '正在读取 Word…' });
  let raw;
  try {
    raw = await io.extractDocx(file);
  } catch (e) {
    if (e instanceof ResumeFileError) throw e;
    throw new ResumeFileError('无法读取这个 Word 文件，文件可能已损坏。可以另存为 PDF 再试。');
  }
  const text = normalizeDocx(raw);
  // 有正文就沿用原来的文字提取，不把图片再送去识别
  if (text) return { text, note: '' };
  if (!io.extractDocxImages) {
    throw new ResumeFileError('这个 Word 文件里没有找到文字。如果简历是图片，请把图片或扫描件 PDF 直接上传，也可以粘贴文字。');
  }
  let images;
  try {
    images = await io.extractDocxImages(file);
  } catch (e) {
    if (e instanceof ResumeFileError) throw e;
    throw new ResumeFileError('无法读取这个 Word 里的图片。可以另存为 PDF 或图片后再试。');
  }
  const all = Array.isArray(images) ? images : [];
  const picked = all.slice(0, MAX_PAGES);
  if (!picked.length) {
    throw new ResumeFileError('这个 Word 文件里没有找到文字。如果简历是图片，请把图片或扫描件 PDF 直接上传，也可以粘贴文字。');
  }
  report(onProgress, { ratio: 0, message: '正在识别 Word 里的图片（简体中文 + 英文）…' });
  const parts = [];
  for (let i = 0; i < picked.length; i++) {
    const piece = cleanText(await recognizeInto(io, picked[i], onProgress, i + 1, picked.length));
    if (piece) parts.push(piece);
  }
  const merged = cleanText(parts.join('\n\n'));
  if (!merged) throw new ResumeFileError(emptyMessage('docx'));
  return { text: merged, note: buildNote({ truncated: all.length > MAX_PAGES, usedOcr: true }) };
}

async function readPdf(file, io, onProgress) {
  report(onProgress, { ratio: null, message: '正在读取 PDF 里的文字…' });
  let session;
  try {
    let opened;
    try {
      opened = await io.extractPdfPageTexts(file);
    } catch (e) {
      if (e instanceof ResumeFileError) throw e;
      throw new ResumeFileError('无法读取这个 PDF，文件可能已损坏。');
    }
    session = opened.session;
    const all = Array.isArray(opened.pages) ? opened.pages : [];
    const pages = all.slice(0, MAX_PAGES);
    const truncated = Number(opened.pageCount) > MAX_PAGES || all.length > MAX_PAGES;
    const plan = planPdfPages(pages);
    if (plan.every((kind) => kind === 'text')) {
      const text = cleanText(pages.map((p) => p.text).join('\n\n'));
      if (!text) throw new ResumeFileError('这个 PDF 里没有找到文字。');
      return { text, note: buildNote({ truncated }) };
    }
    report(onProgress, { ratio: 0, message: '正在浏览器里识别扫描页（简体中文 + 英文）…' });
    const parts = [];
    for (let i = 0; i < plan.length; i++) {
      if (plan[i] === 'text') {
        parts.push(pages[i].text);
        continue;
      }
      let image;
      try {
        image = await io.renderPdfPage(session, i);
      } catch (e) {
        if (e instanceof ResumeFileError) throw e;
        throw new ResumeFileError(`第 ${i + 1} 页无法转成图片来识别。可以改用图片上传，或直接粘贴文字。`);
      }
      const ocrText = cleanText(await recognizeInto(io, image, onProgress, i + 1, plan.length));
      parts.push(ocrText || pages[i].text);
    }
    const text = cleanText(parts.join('\n\n'));
    if (!text) throw new ResumeFileError(emptyMessage('pdf'));
    return { text, note: buildNote({ truncated, usedOcr: true }) };
  } finally {
    if (session != null && io.closePdf) {
      try {
        await io.closePdf(session);
      } catch {
        // 释放文档失败不影响已经抽出的文字
      }
    }
  }
}

/**
 * @param {{ name?: string, type?: string, size?: number }} file
 * @param {object} io 本地读取函数。本函数不会调用 fetch，也不会把文件发给服务端。
 * @param {(progress: { ratio: number | null, message: string }) => void} [onProgress]
 * @returns {Promise<{ text: string, note: string }>}
 */
async function readResumeLocally(file, io, onProgress) {
  assertSize(file);
  const name = String(file?.name || '');
  const type = String(file?.type || '');
  const lower = name.toLowerCase();

  if (isImageResume(name, type)) return readImage(file, io, onProgress);
  if (lower.endsWith('.pdf') || type === 'application/pdf') return readPdf(file, io, onProgress);
  if (lower.endsWith('.docx') || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return readDocx(file, io, onProgress);
  }
  if (lower.endsWith('.doc')) throw new ResumeFileError('不支持旧版 .doc 格式，请在 Word 里另存为 .docx 或 PDF。');
  if (lower.endsWith('.txt') || lower.endsWith('.md') || type.startsWith('text/')) {
    return { text: cleanText(await io.readText(file)), note: '' };
  }
  throw new ResumeFileError('暂时只支持 PDF、Word（.docx）、TXT、Markdown，以及 PNG、JPEG、WebP、BMP、GIF 图片。');
}

export {
  MAX_SIZE,
  MAX_PAGES,
  MIN_CHARS_PER_PAGE,
  PDF_OCR_LONG_EDGE,
  ACCEPTED_RESUME_TYPES,
  ResumeFileError,
  isImageResume,
  textChars,
  pageNeedsOcr,
  planPdfPages,
  itemsToText,
  cleanText,
  normalizeDocx,
  pdfOcrScale,
  fitOcrPixels,
  formatOcrProgress,
  readResumeLocally,
};
