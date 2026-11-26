export const MAX_SIZE: number;
export const MAX_PAGES: number;
export const MIN_CHARS_PER_PAGE: number;
export const PDF_OCR_LONG_EDGE: number;
export const ACCEPTED_RESUME_TYPES: string;

export class ResumeFileError extends Error {}

export interface ResumeProgress {
  /** 0 到 1；还不知道进度时为 null */
  ratio: number | null;
  message: string;
}

export interface ResumeExtraction {
  text: string;
  /** 需要用户知道的限制，例如只读了前 10 页，或识别结果要核对 */
  note: string;
}

export interface ResumeSource {
  name?: string;
  type?: string;
  size?: number;
}

export interface PdfPageInfo {
  text: string;
  hasImage?: boolean;
}

export interface PdfExtract {
  pages: PdfPageInfo[];
  pageCount: number;
  session: unknown;
}

export interface ResumeIO {
  readText(file: ResumeSource): Promise<string>;
  extractDocx(file: ResumeSource): Promise<string>;
  extractDocxImages?(file: ResumeSource): Promise<unknown[]>;
  extractPdfPageTexts(file: ResumeSource): Promise<PdfExtract>;
  renderPdfPage(session: unknown, pageIndex: number): Promise<unknown>;
  closePdf?(session: unknown): Promise<void>;
  recognize(image: unknown, onEngine: (info: { status?: string; progress?: number }) => void): Promise<string>;
}

export function isImageResume(name: string, type?: string): boolean;
export function textChars(text: string): number;
export function pageNeedsOcr(text: string): boolean;
export function planPdfPages(pages: PdfPageInfo[]): Array<'text' | 'ocr'>;
export function itemsToText(items: unknown[]): string;
export function cleanText(text: string): string;
export function normalizeDocx(text: string): string;
export function pdfOcrScale(width: number, height: number): number;
export function fitOcrPixels(width: number, height: number): { width: number; height: number };
export function formatOcrProgress(info: { status?: string; progress?: number; page?: number; pages?: number }): ResumeProgress;
export function readResumeLocally(file: ResumeSource, io: ResumeIO, onProgress?: (progress: ResumeProgress) => void): Promise<ResumeExtraction>;
