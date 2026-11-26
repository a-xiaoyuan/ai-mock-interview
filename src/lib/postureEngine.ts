// 浏览器里的姿态模型。只在打开摄像头后才加载，避免拖慢首屏。
// 画面留在本地：模型读的是 <video> 元素，结果只是几条文字建议。

import { analyzePosture, faceBox, luminanceStats, mirrorPoses, selectPrimary } from '../../lib/posture.mjs';

const WASM_PATH = '/posture/wasm';
const MODEL_PATH = '/posture/pose_landmarker_lite.task';

function asset(urlPath: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${urlPath}`;
}

type Landmark = { x: number; y: number; visibility: number };
type PoseLandmarker = {
  detectForVideo: (frame: HTMLVideoElement, timestamp: number) => {
    landmarks?: { x?: number; y?: number; visibility?: number }[][];
    close?: () => void;
  };
  close: () => void;
};

interface VisionModule {
  FilesetResolver: { forVisionTasks: (basePath: string) => Promise<unknown> };
  PoseLandmarker: {
    createFromOptions: (fileset: unknown, options: unknown) => Promise<PoseLandmarker>;
  };
}

function plainPose(pose: { x?: number; y?: number; visibility?: number }[]): Landmark[] {
  return pose.map((lm) => ({
    x: typeof lm.x === 'number' ? lm.x : 0,
    y: typeof lm.y === 'number' ? lm.y : 0,
    visibility: typeof lm.visibility === 'number' ? lm.visibility : 0,
  }));
}

async function createLandmarker(vision: VisionModule, fileset: unknown, delegate: 'GPU' | 'CPU') {
  return vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: asset(MODEL_PATH), delegate },
    runningMode: 'VIDEO',
    numPoses: 2,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
}

export async function loadPostureEngine() {
  const vision = (await import('@mediapipe/tasks-vision')) as unknown as VisionModule;
  const fileset = await vision.FilesetResolver.forVisionTasks(asset(WASM_PATH));
  let landmarker: PoseLandmarker;
  try {
    landmarker = await createLandmarker(vision, fileset, 'GPU');
  } catch {
    landmarker = await createLandmarker(vision, fileset, 'CPU');
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let lastTs = 0;

  return {
    /** 返回这一帧的建议；视频还没出画面时返回 null。不上传这一帧。 */
    sample(video: HTMLVideoElement) {
      if (!ctx || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      const result = landmarker.detectForVideo(video, ts);
      let poses: Landmark[][] = [];
      try {
        poses = mirrorPoses((result.landmarks || []).map(plainPose));
      } finally {
        try {
          result.close?.();
        } catch {
          /* 没有分割蒙版时关闭结果可以忽略 */
        }
      }
      const w = 96;
      const h = Math.max(1, Math.round((w * video.videoHeight) / video.videoWidth));
      canvas.width = w;
      canvas.height = h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
      const image = ctx.getImageData(0, 0, w, h);
      const stats = luminanceStats(image, faceBox(selectPrimary(poses)));
      return analyzePosture({ poses, ...stats });
    },
    close() {
      landmarker.close();
    },
  };
}

export type PostureEngine = Awaited<ReturnType<typeof loadPostureEngine>>;
