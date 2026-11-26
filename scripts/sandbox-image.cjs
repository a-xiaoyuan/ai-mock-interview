// 构建算法题沙箱镜像。需要已经启动的 Docker 或 Podman。
const { spawnSync } = require('child_process');
const path = require('path');
const { inspectRuntime, DEFAULT_IMAGE } = require('../lib/sandbox');

const runtime = inspectRuntime();
if (!runtime) {
  console.error('没有可用的容器运行时。请先安装并启动 Docker 或 Podman，然后再构建沙箱镜像。');
  process.exit(1);
}

const root = path.join(__dirname, '..');
console.log(`使用 ${runtime} 构建 ${DEFAULT_IMAGE}`);
const result = spawnSync(
  runtime,
  ['build', '-t', DEFAULT_IMAGE, '-f', 'sandbox/Dockerfile', 'sandbox'],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
