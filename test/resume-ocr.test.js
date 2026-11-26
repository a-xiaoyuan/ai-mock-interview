const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

let MAX_SIZE;
let ResumeFileError;
let cleanText;
let itemsToText;
let planPdfPages;
let pdfOcrScale;
let fitOcrPixels;
let formatOcrProgress;
let readResumeLocally;
let normalizeDocx;

before(async () => {
  ({
    MAX_SIZE,
    ResumeFileError,
    cleanText,
    itemsToText,
    planPdfPages,
    pdfOcrScale,
    fitOcrPixels,
    formatOcrProgress,
    readResumeLocally,
    normalizeDocx,
  } = await import('../lib/resume-ocr.mjs'));
});
const { ocrFiles, OCR_WORKER_PATH, OCR_CORE_PATH, OCR_LANG_PATH } = require('../lib/ocr-assets');

const root = path.join(__dirname, '..');

function longText() {
  return '负责商品搜索与下单模块，用 Redis 缓存热门商品，QPS 从 300 提升到 2000。';
}

function io(overrides = {}) {
  const state = {
    pdf: 0,
    render: [],
    recognized: [],
    docx: 0,
    docxImages: 0,
    textReads: 0,
    closed: 0,
  };
  const api = {
    state,
    async readText() {
      state.textReads += 1;
      return overrides.text ?? '纯文本简历';
    },
    async extractDocx() {
      state.docx += 1;
      if (overrides.docxError) throw overrides.docxError;
      return overrides.docx ?? '项目：校园二手交易平台\n负责下单模块';
    },
    async extractDocxImages() {
      state.docxImages += 1;
      return overrides.images ?? [];
    },
    async extractPdfPageTexts() {
      state.pdf += 1;
      if (overrides.pdfError) throw overrides.pdfError;
      return {
        pages: overrides.pages ?? [{ text: longText(), hasImage: false }],
        pageCount: overrides.pageCount ?? (overrides.pages ? overrides.pages.length : 1),
        session: { id: 'pdf' },
      };
    },
    async renderPdfPage(_session, index) {
      state.render.push(index);
      return { token: `page-${index}` };
    },
    async closePdf() {
      state.closed += 1;
    },
    async recognize(image, onEngine) {
      state.recognized.push(image);
      if (overrides.recognize) return overrides.recognize(image, onEngine);
      onEngine?.({ status: 'recognizing text', progress: 1 });
      return overrides.ocrText ?? '张三\nJava 后端\n校园二手交易平台';
    },
  };
  return api;
}

async function withFetchSpy(fn) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (...args) => {
    calls.push(String(args[0]));
    throw new Error('不应该发起网络请求');
  };
  try {
    await fn(calls);
  } finally {
    global.fetch = original;
  }
}

test('文字层拼行：换行标记和纵坐标变化', () => {
  const text = itemsToText([
    { str: '张三', transform: [1, 0, 0, 1, 72, 700], hasEOL: false },
    { str: ' ', transform: [1, 0, 0, 1, 100, 700], hasEOL: true },
    { str: 'Java', transform: [1, 0, 0, 1, 72, 680], hasEOL: false },
    { str: '', transform: [1, 0, 0, 1, 90, 680], hasEOL: true },
  ]);
  assert.equal(text, '张三 \nJava\n');
  assert.equal(cleanText(text), '张三\nJava');
});

test('Word 文本仍压缩 mammoth 的空行', () => {
  assert.equal(normalizeDocx('项目\n\n负责下单\n\n\nRedis'), '项目\n负责下单\nRedis');
});

test('扫描页才进入 OCR：空白页、带图扫描页、整份扫描件', () => {
  const rich = longText();
  assert.deepEqual(
    planPdfPages([
      { text: rich, hasImage: false },
      { text: '', hasImage: false },
    ]),
    ['text', 'text'],
  );
  assert.deepEqual(
    planPdfPages([
      { text: '', hasImage: true },
      { text: rich, hasImage: true },
    ]),
    ['ocr', 'text'],
  );
  assert.deepEqual(
    planPdfPages([
      { text: '  ', hasImage: false },
      { text: '', hasImage: false },
    ]),
    ['ocr', 'ocr'],
  );
  assert.deepEqual(planPdfPages([{ text: 'a'.repeat(19), hasImage: false }]), ['ocr']);
  assert.deepEqual(planPdfPages([{ text: 'a'.repeat(20), hasImage: true }]), ['text']);
});

test('渲染倍率和图片缩放', () => {
  const a4 = pdfOcrScale(595, 842);
  assert.ok(a4 > 2 && a4 < 3);
  assert.equal(pdfOcrScale(2000, 4000), 2200 / 4000);
  assert.equal(pdfOcrScale(100, 100), 3);
  assert.deepEqual(fitOcrPixels(4000, 3000), { width: 2400, height: 1800 });
  assert.deepEqual(fitOcrPixels(1000, 800), { width: 1000, height: 800 });
  assert.deepEqual(fitOcrPixels(400, 200), { width: 1200, height: 600 });
});

test('识别进度会写成中文，多页带页码', () => {
  const loading = formatOcrProgress({ status: 'loading language traineddata', progress: 0.5, page: 2, pages: 3 });
  assert.match(loading.message, /第 2\/3 页/);
  assert.match(loading.message, /简体中文和英文语言包/);
  assert.ok(loading.ratio > 0 && loading.ratio < 1);
  const single = formatOcrProgress({ status: 'recognizing text', progress: 0.4 });
  assert.equal(single.message, '正在识别文字…');
  assert.equal(single.ratio, 0.7 + 0.4 * 0.3);
});

test('可抽文字的 PDF 仍走原路径，不渲染、不识别、不请求网络', async () => {
  await withFetchSpy(async (calls) => {
    const messages = [];
    const local = io();
    const result = await readResumeLocally({ name: '简历.PDF', type: 'application/pdf', size: 100 }, local, (p) => messages.push(p.message));
    assert.equal(result.text, cleanText(longText()));
    assert.equal(result.note, '');
    assert.equal(local.state.pdf, 1);
    assert.deepEqual(local.state.render, []);
    assert.deepEqual(local.state.recognized, []);
    assert.equal(local.state.closed, 1);
    assert.ok(messages.some((m) => m.includes('PDF')));
    assert.ok(messages.every((m) => !m.includes('识别')));
    assert.deepEqual(calls, []);
  });
});

test('扫描件 PDF 只渲染没有文字的图像页，文字页保持原样', async () => {
  await withFetchSpy(async (calls) => {
    const messages = [];
    const pages = [
      { text: '', hasImage: true },
      { text: longText(), hasImage: false },
    ];
    const local = io({
      pages,
      recognize(_image, onEngine) {
        onEngine({ status: 'recognizing text', progress: 0.5 });
        return '扫描得到的项目经历';
      },
    });
    const result = await readResumeLocally({ name: 'scan.pdf', type: '', size: 100 }, local, (p) => messages.push(p));
    assert.deepEqual(local.state.render, [0]);
    assert.equal(local.state.recognized.length, 1);
    assert.equal(local.state.recognized[0].token, 'page-0');
    assert.match(result.text, /扫描得到的项目经历/);
    assert.match(result.text, /Redis/);
    assert.match(result.note, /错字/);
    assert.ok(messages.some((p) => p.message.includes('第 1/2 页') && p.message.includes('正在识别文字')));
    assert.deepEqual(calls, []);
  });
});

test('整份都没有文字层时，每一页都走 OCR', async () => {
  const local = io({
    pages: [
      { text: '', hasImage: false },
      { text: 'logo', hasImage: false },
    ],
    recognize(image) {
      return `第${image.token}页`;
    },
  });
  const result = await readResumeLocally({ name: 'scan.pdf', type: 'application/pdf', size: 10 }, local);
  assert.deepEqual(local.state.render, [0, 1]);
  assert.match(result.text, /第page-0页/);
  assert.match(result.text, /第page-1页/);
  assert.match(result.note, /错字/);
});

test('图片简历走 OCR，不打开 PDF', async () => {
  await withFetchSpy(async (calls) => {
    const local = io();
    const png = await readResumeLocally({ name: '简历.png', type: '', size: 20 }, local);
    assert.equal(local.state.pdf, 0);
    assert.equal(local.state.recognized.length, 1);
    assert.match(png.text, /张三/);
    assert.match(png.note, /错字/);

    const local2 = io();
    await readResumeLocally({ name: 'camera', type: 'image/jpeg', size: 20 }, local2);
    assert.equal(local2.state.pdf, 0);
    assert.equal(local2.state.recognized.length, 1);
    assert.equal(local2.state.recognized[0].name, 'camera');
    assert.deepEqual(calls, []);
  });
});

test('有正文的 Word 不识别图片', async () => {
  const local = io({
    images() {
      throw new Error('不应该读取图片');
    },
  });
  local.extractDocxImages = async () => {
    local.state.docxImages += 1;
    throw new Error('不应该读取图片');
  };
  const result = await readResumeLocally({ name: '简历.docx', type: '', size: 20 }, local);
  assert.equal(local.state.docx, 1);
  assert.equal(local.state.docxImages, 0);
  assert.equal(local.state.recognized.length, 0);
  assert.match(result.text, /校园二手交易平台/);
  assert.equal(result.note, '');
});

test('只有图片的 Word 会识别图片', async () => {
  const local = io({
    docx: '   \n',
    images: [{ id: 'img-1' }],
    ocrText: '图片简历里的 Spring Boot',
  });
  const result = await readResumeLocally(
    { name: '简历.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 20 },
    local,
  );
  assert.equal(local.state.docxImages, 1);
  assert.equal(local.state.recognized.length, 1);
  assert.equal(result.text, '图片简历里的 Spring Boot');
  assert.match(result.note, /错字/);
});

test('识别不到文字时给出说明，而不是空结果', async () => {
  const local = io({ ocrText: ' \n\t ' });
  await assert.rejects(
    () => readResumeLocally({ name: '空.png', type: 'image/png', size: 10 }, local),
    (e) => e instanceof ResumeFileError && /没有从这张图片里识别出文字/.test(e.message),
  );
});

test('识别引擎加载失败时说明文件没有上传', async () => {
  const local = io({
    recognize() {
      throw new Error('Network error while fetching /ocr/lang/chi_sim.traineddata.gz');
    },
  });
  await assert.rejects(
    () => readResumeLocally({ name: 'a.jpg', type: 'image/jpeg', size: 10 }, local),
    (e) => e instanceof ResumeFileError && /没有上传/.test(e.message) && /没有加载成功/.test(e.message),
  );
});

test('文本文件和旧版 doc、超大文件、不支持的类型', async () => {
  const local = io({ text: '  你好\r\n世界  ' });
  const txt = await readResumeLocally({ name: 'a.txt', type: '', size: 4 }, local);
  assert.equal(txt.text, '你好\n世界');
  assert.equal(local.state.recognized.length, 0);

  const md = await readResumeLocally({ name: 'a.md', type: 'text/markdown', size: 4 }, io({ text: '# 标题' }));
  assert.equal(md.text, '# 标题');

  await assert.rejects(
    () => readResumeLocally({ name: 'a.doc', type: '', size: 4 }, io()),
    (e) => e instanceof ResumeFileError && /另存为/.test(e.message),
  );
  await assert.rejects(
    () => readResumeLocally({ name: 'a.svg', type: 'image/svg+xml', size: 4 }, io()),
    (e) => e instanceof ResumeFileError && /暂时只支持/.test(e.message),
  );
  const big = io();
  await assert.rejects(
    () => readResumeLocally({ name: 'a.pdf', type: 'application/pdf', size: MAX_SIZE + 1 }, big),
    /10 MB/,
  );
  assert.equal(big.state.pdf, 0);
});

test('超过 10 页只处理前 10 页，文字 PDF 不加识别说明', async () => {
  const pages = Array.from({ length: 12 }, () => ({ text: longText(), hasImage: false }));
  const local = io({ pages, pageCount: 12 });
  const result = await readResumeLocally({ name: 'long.pdf', type: 'application/pdf', size: 10 }, local);
  assert.equal(local.state.recognized.length, 0);
  assert.match(result.note, /超过 10 页/);
  assert.doesNotMatch(result.note, /错字/);
  assert.equal(result.text.split('Redis').length - 1, 10);
});

test('读取实现本身不调用本项目接口', () => {
  for (const rel of ['lib/resume-ocr.mjs', 'src/lib/resumeFile.ts', 'src/lib/ocrEngine.ts']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(src, /\/api\//, rel);
    assert.doesNotMatch(src, /\bfetch\s*\(/, rel);
  }
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const routes = [...server.matchAll(/'(GET|POST|PUT|DELETE) (\/api\/[^']+)'/g)].map((m) => m[2]);
  assert.ok(routes.length >= 4);
  assert.ok(routes.every((route) => !/ocr|upload|resume/i.test(route)));
});

test('OCR 静态资源指向本地语言包和引擎，而不是远程地址', () => {
  const files = ocrFiles(root);
  assert.ok(files.length >= 5);
  for (const file of files) {
    assert.equal(file.urlPath.startsWith('/ocr/'), true, file.urlPath);
    assert.equal(file.urlPath.includes('..'), false);
    assert.equal(fs.existsSync(file.abs), true, file.abs);
    assert.ok(fs.statSync(file.abs).size > 1000, file.abs);
  }
  const chi = files.find((f) => f.urlPath.endsWith('chi_sim.traineddata.gz'));
  const eng = files.find((f) => f.urlPath.endsWith('eng.traineddata.gz'));
  assert.ok(chi.abs.includes('4.0.0_best_int'));
  assert.ok(eng.abs.includes('4.0.0_best_int'));
  assert.ok(fs.statSync(chi.abs).size > 1_000_000);
  assert.ok(fs.statSync(eng.abs).size > 1_000_000);
  const engine = fs.readFileSync(path.join(root, 'src/lib/ocrEngine.ts'), 'utf8');
  assert.match(engine, new RegExp(OCR_WORKER_PATH.replace(/\//g, '\\/')));
  assert.match(engine, new RegExp(OCR_CORE_PATH.replace(/\//g, '\\/')));
  assert.match(engine, new RegExp(OCR_LANG_PATH.replace(/\//g, '\\/')));
  assert.match(engine, /chi_sim/);
  assert.match(engine, /eng/);
  assert.match(engine, /import\('tesseract\.js'\)/);
});

test('PDF 读完后即使识别失败也会关闭文档', async () => {
  const local = io({
    pages: [{ text: '', hasImage: true }],
    recognize() {
      throw new Error('boom');
    },
  });
  await assert.rejects(() => readResumeLocally({ name: 'a.pdf', type: 'application/pdf', size: 10 }, local));
  assert.equal(local.state.closed, 1);
});
