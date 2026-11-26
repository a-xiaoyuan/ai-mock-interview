import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { ocrFiles } = require('./lib/ocr-assets.js') as {
  ocrFiles: (root: string) => { urlPath: string; abs: string }[];
};
const { postureFiles } = require('./lib/posture-assets.js') as {
  postureFiles: (root: string) => { urlPath: string; abs: string }[];
};

function contentType(file: string) {
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

// 姿态模型和 WASM 挂到 /posture。摄像头画面不会发到这里。
function postureAssets(): Plugin {
  let root = process.cwd();
  return {
    name: 'posture-assets',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const map = new Map(postureFiles(root).map((file) => [file.urlPath, file.abs]));
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        const abs = map.get(url);
        if (!abs || !fs.existsSync(abs)) return next();
        res.setHeader('Content-Type', contentType(abs));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        // MediaPipe 用 crossorigin=anonymous 注入脚本，同源也要带这个头
        res.setHeader('Access-Control-Allow-Origin', '*');
        fs.createReadStream(abs).pipe(res);
      });
    },
    writeBundle(options) {
      const outDir = options.dir ?? path.join(root, 'dist');
      for (const file of postureFiles(root)) {
        if (!fs.existsSync(file.abs)) throw new Error(`缺少仪态分析资源：${file.abs}`);
        const dest = path.join(outDir, file.urlPath.slice(1));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file.abs, dest);
      }
    },
  };
}

// 开发时把 node_modules 里的识别引擎和语言包挂到 /ocr；构建时复制进 dist/ocr。
// 这些是静态资源，简历文件不会发到这里。
function ocrAssets(): Plugin {
  let root = process.cwd();
  return {
    name: 'ocr-assets',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const map = new Map(ocrFiles(root).map((file) => [file.urlPath, file.abs]));
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        const abs = map.get(url);
        if (!abs || !fs.existsSync(abs)) return next();
        res.setHeader('Content-Type', contentType(abs));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(abs).pipe(res);
      });
    },
    writeBundle(options) {
      const outDir = options.dir ?? path.join(root, 'dist');
      for (const file of ocrFiles(root)) {
        if (!fs.existsSync(file.abs)) throw new Error(`缺少 OCR 资源：${file.abs}`);
        const dest = path.join(outDir, file.urlPath.slice(1));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file.abs, dest);
      }
    },
  };
}

// 开发时 Vite 跑在 5173，/api 请求转发给 Node 服务（3000）
export default defineConfig({
  plugins: [react(), ocrAssets(), postureAssets()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
