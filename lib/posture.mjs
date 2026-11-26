// 仪态建议：只根据画面里已经拿到的关键点和亮度做判断。
// 这里没有网络请求，也不接收视频文件。坐标以用户看到的预览为准（预览是镜像的）。

const VISIBLE = 0.5;
const MISSING = 0.35;

const NOSE = 0;
const LEFT_EYE = 2;
const RIGHT_EYE = 5;
const LEFT_EAR = 7;
const RIGHT_EAR = 8;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

const FACE_INDEXES = [NOSE, LEFT_EYE, RIGHT_EYE, LEFT_EAR, RIGHT_EAR];
const BODY_INDEXES = [LEFT_SHOULDER, RIGHT_SHOULDER];

/** 建议最多同时显示几条，避免侧栏被刷屏 */
const MAX_CUES = 3;
const HOLD_DEFAULT = 2;

const ORDER = [
  'no-person',
  'multi',
  'head-missing',
  'too-close',
  'too-far',
  'shoulders-out',
  'off-left',
  'off-right',
  'head-high',
  'head-low',
  'side-face',
  'backlight',
  'dark',
  'dark-frame',
  'blown',
  'edge-light',
  'tilt',
  'ok',
];

/** 仪态判断不上传画面，也不把画面交给用户配置的模型服务商 */
const POSTURE_PRIVACY = {
  uploadsVideoToAppServer: false,
  sendsFramesToModelProvider: false,
  runsInBrowser: true,
};

function point(pose, index) {
  const lm = pose?.[index];
  if (!lm || typeof lm.x !== 'number' || typeof lm.y !== 'number' || Number.isNaN(lm.x) || Number.isNaN(lm.y)) return null;
  return lm;
}

function visibility(lm) {
  return lm && typeof lm.visibility === 'number' ? lm.visibility : 0;
}

function inside(lm) {
  return !!lm && visibility(lm) >= VISIBLE && lm.x >= 0.02 && lm.x <= 0.98 && lm.y >= 0.02 && lm.y <= 0.98;
}

function missing(lm) {
  if (!lm) return true;
  if (visibility(lm) < MISSING) return true;
  return lm.x < 0 || lm.x > 1 || lm.y < 0 || lm.y > 1;
}

function posePresent(pose) {
  if (!pose) return false;
  const face = FACE_INDEXES.some((i) => inside(point(pose, i)));
  const body = BODY_INDEXES.some((i) => inside(point(pose, i)));
  return face || body;
}

function scorePose(pose) {
  return [...FACE_INDEXES, ...BODY_INDEXES].reduce((sum, i) => sum + (inside(point(pose, i)) ? 1 : 0), 0);
}

/** 多人时选关键点更完整的那个作为主要建议对象 */
function selectPrimary(poses) {
  const present = (poses || []).filter(posePresent);
  let best = null;
  let bestScore = -1;
  for (const pose of present) {
    const score = scorePose(pose);
    if (score > bestScore) {
      best = pose;
      bestScore = score;
    }
  }
  return best;
}

function mirrorPoses(poses) {
  return (poses || []).map((pose) => pose.map((lm) => (lm && typeof lm.x === 'number' ? { ...lm, x: 1 - lm.x } : lm)));
}

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

function boxFrom(points, padX, padY) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = clamp01(minX - padX);
  const y = clamp01(minY - padY);
  const right = clamp01(maxX + padX);
  const bottom = clamp01(maxY + padY);
  const w = right - x;
  const h = bottom - y;
  if (w < 0.04 || h < 0.04) return null;
  return { x, y, w, h };
}

/** 亮度尽量只取样脸部，避免深色衣服把整个人判成“脸很暗” */
function faceBox(pose) {
  if (!pose) return null;
  const face = FACE_INDEXES.map((i) => point(pose, i)).filter(inside);
  if (face.length >= 2) return boxFrom(face, 0.04, 0.07);
  const body = [...FACE_INDEXES, ...BODY_INDEXES].map((i) => point(pose, i)).filter(inside);
  if (body.length >= 2) return boxFrom(body, 0.03, 0.04);
  return null;
}

function warn(id, text) {
  return { id, tone: 'warn', text };
}

function good(id, text) {
  return { id, tone: 'good', text };
}

function lumaNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function prioritize(cues) {
  const rank = (id) => {
    const i = ORDER.indexOf(id);
    return i === -1 ? ORDER.length : i;
  };
  const seen = new Set();
  return [...cues]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .filter((cue) => {
      if (seen.has(cue.id)) return false;
      seen.add(cue.id);
      return true;
    })
    .slice(0, MAX_CUES);
}

function sideFace(pose) {
  const leftEye = inside(point(pose, LEFT_EYE));
  const rightEye = inside(point(pose, RIGHT_EYE));
  if (leftEye === rightEye) return false;
  const leftEar = inside(point(pose, LEFT_EAR));
  const rightEar = inside(point(pose, RIGHT_EAR));
  if (leftEar && rightEar) return false;
  const hiddenEye = leftEye ? point(pose, RIGHT_EYE) : point(pose, LEFT_EYE);
  return missing(hiddenEye);
}

/**
 * @param {{ poses?: { x: number, y: number, visibility?: number }[][], frameLuma?: number | null, personLuma?: number | null, leftLuma?: number | null, rightLuma?: number | null }} input
 * 亮度是 0–255。person / left / right 取自脸部区域（预览坐标系，左是用户看到的左边）。
 */
function analyzePosture(input) {
  const poses = (input?.poses || []).filter(posePresent);
  const frameLuma = lumaNumber(input?.frameLuma);
  const personLuma = lumaNumber(input?.personLuma);
  const leftLuma = lumaNumber(input?.leftLuma);
  const rightLuma = lumaNumber(input?.rightLuma);

  if (!poses.length) {
    const cues = [warn('no-person', '画面里没有看到人。请坐到镜头前，让头和肩膀进入画面。')];
    if (frameLuma != null && frameLuma < 42) {
      cues.push(warn('dark-frame', '画面很暗，人会更难被看到。打开面前的灯，或面向有光的一侧。低照度时也可能把人认丢。'));
    }
    return prioritize(cues);
  }

  const cues = [];
  if (poses.length >= 2) {
    cues.push(warn('multi', '画面里好像有多个人。建议只留自己，多人入画时仪态判断容易不准。'));
  }

  const pose = selectPrimary(poses);
  const nose = point(pose, NOSE);
  const leftShoulder = point(pose, LEFT_SHOULDER);
  const rightShoulder = point(pose, RIGHT_SHOULDER);
  const headIn = inside(nose) || inside(point(pose, LEFT_EYE)) || inside(point(pose, RIGHT_EYE));
  const shouldersIn = inside(leftShoulder) && inside(rightShoulder);

  if (!headIn) {
    cues.push(warn('head-missing', '头部不在画面里，或不清楚。请把脸完整放进镜头，头顶留出一点空隙。'));
  } else if (nose && inside(nose) && nose.y < 0.12) {
    cues.push(warn('head-high', '头太靠上，容易被画面切掉。人稍往下坐，或把摄像头抬高一点。'));
  } else if (nose && inside(nose) && nose.y > 0.58) {
    cues.push(warn('head-low', '头在画面偏下的位置。让眼睛靠近画面上三分之一，上半身会更清楚。'));
  }

  if (shouldersIn) {
    const width = Math.abs(leftShoulder.x - rightShoulder.x);
    const mid = (leftShoulder.x + rightShoulder.x) / 2;
    if (width > 0.58) cues.push(warn('too-close', '离镜头太近，肩膀容易出画。往后坐一点，让上半身完整出现。'));
    else if (width < 0.15) cues.push(warn('too-far', '离镜头较远，面部不够清楚。靠近一些，让上半身大约占画面的一半。'));
    if (mid < 0.34) cues.push(warn('off-left', '人偏到画面左边了。坐到中间，左右都留出一些空间。'));
    else if (mid > 0.66) cues.push(warn('off-right', '人偏到画面右边了。坐到中间，左右都留出一些空间。'));
    if (Math.abs(leftShoulder.y - rightShoulder.y) > 0.09 && width >= 0.15 && width <= 0.58) {
      cues.push(warn('tilt', '肩膀一边高一边低。坐正一些，摄像头也尽量放平。'));
    }
  } else if (headIn) {
    cues.push(warn('shoulders-out', '肩膀不在画面里。往后坐一点，或把摄像头拉远，让上半身入画。'));
    if (nose && inside(nose) && nose.x < 0.28) cues.push(warn('off-left', '人偏到画面左边了。坐到中间，左右都留出一些空间。'));
    else if (nose && inside(nose) && nose.x > 0.72) cues.push(warn('off-right', '人偏到画面右边了。坐到中间，左右都留出一些空间。'));
  }

  if (headIn && sideFace(pose)) {
    cues.push(warn('side-face', '现在更像侧脸。正对摄像头，让两边脸颊都在画面里。侧脸时判断容易不准。'));
  }

  const light = [];
  if (personLuma != null && frameLuma != null && frameLuma > personLuma + 55 && personLuma < 105) {
    light.push(warn('backlight', '背后比脸亮，容易变成剪影。让光源在面前，不要只开身后的灯。'));
  } else if (personLuma != null && personLuma < 48) {
    light.push(warn('dark', '脸部偏暗。打开面前的灯，或面向窗户。低照度时也可能把人认丢。'));
  } else if (personLuma != null && personLuma > 220) {
    light.push(warn('blown', '脸部过亮，细节发白。避开正对的强光，或把灯调暗一点。'));
  }
  if (leftLuma != null && rightLuma != null && Math.abs(leftLuma - rightLuma) > 48) {
    light.push(warn('edge-light', '左右脸亮度差较大，可能是侧面来光。补一点正面的光。边缘光下容易误判。'));
  }
  cues.push(...light);

  if (!cues.some((cue) => cue.tone === 'warn')) {
    cues.push(good('ok', '取景和光线看起来合适：人在画面中间，脸部清楚。'));
  }
  return prioritize(cues);
}

/** 连续出现才显示，避免关键点抖一下就换一条建议 */
/**
 * @param {Record<string, number> | null | undefined} history
 * @param {{ id: string, tone: string, text: string }[]} cues
 * @param {number} [hold]
 * @returns {{ history: Record<string, number>, cues: { id: string, tone: string, text: string }[] }}
 */
function holdCues(history, cues, hold = HOLD_DEFAULT) {
  const prev = history || {};
  const next = {};
  for (const cue of cues || []) next[cue.id] = (prev[cue.id] || 0) + 1;
  return {
    history: next,
    cues: (cues || []).filter((cue) => next[cue.id] >= hold),
  };
}

/**
 * @param {{ id: string, tone: string, text: string }[][]} samples
 * @param {{ modelFailed?: boolean, modelReady?: boolean }} [options]
 * @returns {{ tone: 'warn' | 'good' | 'muted', ids: string[], lines: string[] }}
 */
function summarizeRecording(samples, options = {}) {
  const list = samples || [];
  if (options.modelFailed) {
    return { tone: 'muted', ids: [], lines: ['仪态模型没能加载，这段录像没有仪态建议。录像本身仍只留在浏览器里。'] };
  }
  if (!list.length) {
    return {
      tone: 'muted',
      ids: [],
      lines: [options.modelReady === false ? '仪态模型还没准备好，这段录像没有仪态建议。' : '这段录像太短，还不够给出仪态建议。'],
    };
  }
  const counts = new Map();
  for (const sample of list) {
    const seen = new Set();
    for (const cue of sample || []) {
      if (!cue || cue.tone === 'good' || seen.has(cue.id)) continue;
      seen.add(cue.id);
      const prev = counts.get(cue.id) || { count: 0, text: cue.text };
      prev.count += 1;
      prev.text = cue.text;
      counts.set(cue.id, prev);
    }
  }
  const ranked = [...counts.entries()]
    .map(([id, row]) => ({ id, ...row, ratio: row.count / list.length }))
    .filter((row) => row.ratio >= 0.4)
    .sort((a, b) => b.ratio - a.ratio || a.id.localeCompare(b.id))
    .slice(0, 3);
  if (!ranked.length) return { tone: 'good', ids: [], lines: ['这段录像的取景和光线整体稳定。'] };
  return {
    tone: 'warn',
    ids: ranked.map((row) => row.id),
    lines: ranked.map((row) => `约 ${Math.round(row.ratio * 100)}% 的时间：${row.text}`),
  };
}

function meanLuma(data, width, x0, y0, x1, y1) {
  let sum = 0;
  let n = 0;
  const xStart = Math.max(0, x0);
  const yStart = Math.max(0, y0);
  const xEnd = Math.min(width, x1);
  const yEnd = Math.max(yStart, y1);
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const i = (y * width + x) * 4;
      if (i + 2 >= data.length) continue;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n += 1;
    }
  }
  return n ? sum / n : null;
}

/**
 * @param {{ width: number, height: number, data: ArrayLike<number> }} frame
 * @param {{ x: number, y: number, w: number, h: number } | null} region 归一化区域，左上角为原点
 */
function luminanceStats(frame, region) {
  const empty = { frameLuma: null, personLuma: null, leftLuma: null, rightLuma: null };
  if (!frame || !frame.width || !frame.height || !frame.data) return empty;
  const { width, height, data } = frame;
  const frameLuma = meanLuma(data, width, 0, 0, width, height);
  if (!region || region.w < 0.04 || region.h < 0.04) return { frameLuma, personLuma: null, leftLuma: null, rightLuma: null };
  const x0 = Math.floor(clamp01(region.x) * width);
  const y0 = Math.floor(clamp01(region.y) * height);
  const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil((region.x + region.w) * width)));
  const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil((region.y + region.h) * height)));
  const mid = Math.floor((x0 + x1) / 2);
  return {
    frameLuma,
    personLuma: meanLuma(data, width, x0, y0, x1, y1),
    leftLuma: meanLuma(data, width, x0, y0, Math.max(mid, x0 + 1), y1),
    rightLuma: meanLuma(data, width, Math.min(mid, x1 - 1), y0, x1, y1),
  };
}

export {
  POSTURE_PRIVACY,
  MAX_CUES,
  NOSE,
  LEFT_EYE,
  RIGHT_EYE,
  LEFT_EAR,
  RIGHT_EAR,
  LEFT_SHOULDER,
  RIGHT_SHOULDER,
  mirrorPoses,
  selectPrimary,
  faceBox,
  analyzePosture,
  holdCues,
  summarizeRecording,
  luminanceStats,
};
