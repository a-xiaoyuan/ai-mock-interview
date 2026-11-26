// 姿态模型和平移用的 WASM 在构建 / 开发时挂到 /posture。
// 这些是静态资源。摄像头画面和录像不会发到这些地址，也不会发到本项目的接口。
// 模型：MediaPipe Pose Landmarker lite（float16），Apache-2.0，见 assets/posture/NOTICE。

const path = require('path');

const POSTURE_WASM_PATH = '/posture/wasm';
const POSTURE_MODEL_PATH = '/posture/pose_landmarker_lite.task';

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

function postureFiles(root) {
  const wasmDir = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  return [
    ...WASM_FILES.map((name) => ({ urlPath: `${POSTURE_WASM_PATH}/${name}`, abs: path.join(wasmDir, name) })),
    { urlPath: POSTURE_MODEL_PATH, abs: path.join(root, 'assets', 'posture', 'pose_landmarker_lite.task') },
  ];
}

module.exports = {
  POSTURE_WASM_PATH,
  POSTURE_MODEL_PATH,
  WASM_FILES,
  postureFiles,
};
