// 识别引擎和语言包在构建 / 开发时从 node_modules 拷到 /ocr，按静态文件提供。
// 简历图片不会发到这些地址，也不会发到本项目的接口。

const path = require('path');

const OCR_WORKER_PATH = '/ocr/worker.min.js';
const OCR_CORE_PATH = '/ocr/core';
const OCR_LANG_PATH = '/ocr/lang';

const CORE_FILES = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];

function ocrFiles(root) {
  const nm = path.join(root, 'node_modules');
  const coreDir = path.join(nm, 'tesseract.js-core');
  return [
    { urlPath: OCR_WORKER_PATH, abs: path.join(nm, 'tesseract.js', 'dist', 'worker.min.js') },
    ...CORE_FILES.map((name) => ({ urlPath: `${OCR_CORE_PATH}/${name}`, abs: path.join(coreDir, name) })),
    {
      urlPath: `${OCR_LANG_PATH}/chi_sim.traineddata.gz`,
      abs: path.join(nm, '@tesseract.js-data', 'chi_sim', '4.0.0_best_int', 'chi_sim.traineddata.gz'),
    },
    {
      urlPath: `${OCR_LANG_PATH}/eng.traineddata.gz`,
      abs: path.join(nm, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'),
    },
  ];
}

module.exports = {
  OCR_WORKER_PATH,
  OCR_CORE_PATH,
  OCR_LANG_PATH,
  CORE_FILES,
  ocrFiles,
};
