// 浏览器里的 Tesseract.js。只在真正要识别时才加载，避免拖慢首屏。
// 引擎和语言包从本站 /ocr 静态资源读取；简历图片留在本地，不上传。

import type { Worker } from 'tesseract.js';
import { ResumeFileError, fitOcrPixels } from '../../lib/resume-ocr.mjs';

const WORKER_PATH = '/ocr/worker.min.js';
const CORE_PATH = '/ocr/core';
const LANG_PATH = '/ocr/lang';

export interface EngineInfo {
  status?: string;
  progress?: number;
}

function asset(urlPath: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${urlPath}`;
}

function scaleCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const next = fitOcrPixels(source.width, source.height);
  if (next.width === source.width && next.height === source.height) return source;
  const canvas = document.createElement('canvas');
  canvas.width = next.width;
  canvas.height = next.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ResumeFileError('浏览器无法创建画布，没法识别这张图片。');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function drawBitmap(bitmap: ImageBitmap): HTMLCanvasElement {
  const next = fitOcrPixels(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = next.width;
  canvas.height = next.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ResumeFileError('浏览器无法创建画布，没法识别这张图片。');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      throw new ResumeFileError('这张图片无法打开。请换成 PNG 或 JPEG，或直接粘贴文字。');
    }
  }
  try {
    return drawBitmap(bitmap);
  } finally {
    bitmap.close();
  }
}

async function prepareImage(image: unknown): Promise<HTMLCanvasElement> {
  if (image instanceof HTMLCanvasElement) return scaleCanvas(image);
  if (typeof Blob !== 'undefined' && image instanceof Blob) return blobToCanvas(image);
  throw new ResumeFileError('无法读取这张图片。');
}

export function createOcrSession() {
  let workerPromise: Promise<Worker> | null = null;
  const sink: { report: (info: EngineInfo) => void } = { report: () => {} };

  async function ensure(): Promise<Worker> {
    if (!workerPromise) {
      workerPromise = (async () => {
        const { createWorker, OEM, PSM } = await import('tesseract.js');
        const worker = await createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
          workerPath: asset(WORKER_PATH),
          corePath: asset(CORE_PATH),
          langPath: asset(LANG_PATH),
          workerBlobURL: false,
          gzip: true,
          logger: (m) => sink.report(m),
        });
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: '1',
          user_defined_dpi: '200',
        });
        return worker;
      })().catch((e: unknown) => {
        workerPromise = null;
        throw e;
      });
    }
    return workerPromise;
  }

  return {
    async recognize(image: unknown, onEngine: (info: EngineInfo) => void): Promise<string> {
      sink.report = onEngine;
      const worker = await ensure();
      const prepared = await prepareImage(image);
      const { data } = await worker.recognize(prepared);
      return data.text ?? '';
    },
    async close() {
      const pending = workerPromise;
      workerPromise = null;
      if (!pending) return;
      try {
        const worker = await pending;
        await worker.terminate();
      } catch {
        // 引擎没起来时没有可关闭的 worker
      }
    },
  };
}
