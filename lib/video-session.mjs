// 摄像头和录像的状态。视频只存在浏览器内存里的 Blob / 对象 URL，没有上传这一步。
// 任何状态都不挡住文字或语音作答。

const MAX_RECORDING_MS = 3 * 60 * 1000;

const VIDEO_PRIVACY = {
  uploadsVideoToAppServer: false,
  sendsFramesToModelProvider: false,
  storage: 'browser-memory',
};

const CAMERA_MESSAGES = {
  denied: '没有获得摄像头权限。如果刚拒绝了授权，可以在地址栏重新允许后再试。不打开也不影响打字和语音作答。',
  missing: '没有找到可用的摄像头。文字和语音面试可以继续。',
  unsupported: '这个浏览器不能使用摄像头。文字和语音面试可以继续。',
  busy: '摄像头正被别的程序占用。关掉占用它的页面后再试。文字和语音作答不受影响。',
  insecure: '当前页面不是安全连接，浏览器不允许打开摄像头。文字和语音面试可以继续。',
  error: '摄像头打开失败。文字和语音作答不受影响，可以稍后重试。',
};

const RETRYABLE = new Set(['denied', 'missing', 'busy', 'error']);

/**
 * @typedef {'off' | 'opening' | 'live' | 'denied' | 'missing' | 'unsupported' | 'busy' | 'insecure' | 'error'} CameraPhase
 * @typedef {{ phase: CameraPhase, blocksInterview: boolean }} CameraState
 * @typedef {{ url: string, bytes: number, mimeType: string, durationMs: number }} LocalClip
 * @typedef {{
 *   phase: 'idle' | 'recording' | 'ready',
 *   clip: LocalClip | null,
 *   playing: boolean,
 *   startedAt: number,
 *   revoked: string[],
 *   uploaded: boolean,
 *   storage: 'browser-memory',
 * }} RecordingState
 * @typedef {{ type: string, at?: number, url?: string, bytes?: number, mimeType?: string, durationMs?: number }} RecordingEvent
 */

/** @returns {CameraState} */
function initialCamera() {
  return { phase: 'off', blocksInterview: false };
}

/**
 * @param {CameraState | null | undefined} state
 * @param {string} type
 * @returns {CameraState}
 */
function reduceCamera(state, type) {
  const prev = state || initialCamera();
  const base = { blocksInterview: false };
  switch (type) {
    case 'open':
      if (prev.phase === 'live' || prev.phase === 'opening') return { ...prev, ...base };
      return { phase: 'opening', ...base };
    case 'granted':
      return { phase: 'live', ...base };
    case 'stop':
      return { phase: 'off', ...base };
    case 'denied':
    case 'missing':
    case 'unsupported':
    case 'busy':
    case 'insecure':
    case 'error':
      return { phase: type, ...base };
    default:
      return { ...prev, ...base };
  }
}

function cameraMessage(phase) {
  return CAMERA_MESSAGES[phase] || '';
}

function canRetryCamera(phase) {
  return RETRYABLE.has(phase);
}

/** 开始面试、发送回答都不看摄像头状态 */
function interviewCanProceed(camera) {
  return !camera || camera.blocksInterview !== true;
}

function canSendAnswer(input) {
  return !input?.busy && String(input?.text ?? '').trim().length > 0;
}

function cameraSupportOf(host) {
  if (!host || host.isSecureContext !== true) {
    if (host && host.isSecureContext === false) return 'insecure';
    return 'unsupported';
  }
  const gum = host.mediaDevices && host.mediaDevices.getUserMedia;
  if (typeof gum !== 'function') return 'unsupported';
  return 'ok';
}

function cameraPhaseFromError(err) {
  const name = typeof err === 'string' ? err : err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'missing';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'busy';
  if (name === 'SecurityError') return 'insecure';
  if (name === 'NotSupportedError') return 'unsupported';
  return 'error';
}

/** @returns {RecordingState} */
function initialRecording() {
  return {
    phase: 'idle',
    clip: null,
    playing: false,
    startedAt: 0,
    revoked: [],
    uploaded: false,
    storage: 'browser-memory',
  };
}

/** @param {RecordingEvent} event @returns {LocalClip} */
function localClip(event) {
  return {
    url: event.url,
    bytes: event.bytes,
    mimeType: event.mimeType || 'video/webm',
    durationMs: event.durationMs || 0,
  };
}

/**
 * @param {RecordingState | null | undefined} state
 * @param {RecordingEvent} event
 * @returns {RecordingState}
 */
function reduceRecording(state, event) {
  const prev = state || initialRecording();
  const keep = { uploaded: false, storage: 'browser-memory' };
  const type = event?.type;
  switch (type) {
    case 'start': {
      if (prev.phase === 'recording') return { ...prev, ...keep };
      const revoked = prev.clip ? [...prev.revoked, prev.clip.url] : prev.revoked;
      return { phase: 'recording', clip: null, playing: false, startedAt: event.at || 0, revoked, ...keep };
    }
    case 'stop': {
      if (prev.phase !== 'recording') return { ...prev, ...keep };
      if (!event.url || !event.bytes) return { ...prev, phase: 'idle', clip: null, playing: false, ...keep };
      return { phase: 'ready', clip: localClip(event), playing: false, startedAt: prev.startedAt, revoked: prev.revoked, ...keep };
    }
    case 'play':
      if (prev.phase !== 'ready' || !prev.clip) return { ...prev, playing: false, ...keep };
      return { ...prev, playing: true, ...keep };
    case 'pause':
      return { ...prev, playing: false, ...keep };
    case 'discard':
    case 'camera-off': {
      const revoked = prev.clip ? [...prev.revoked, prev.clip.url] : prev.revoked;
      return { phase: 'idle', clip: null, playing: false, startedAt: 0, revoked, ...keep };
    }
    case 'upload':
      return { ...prev, ...keep };
    default:
      return { ...prev, ...keep };
  }
}

function shouldAutoStop(startedAt, now, maxMs = MAX_RECORDING_MS) {
  return typeof startedAt === 'number' && typeof now === 'number' && now - startedAt >= maxMs;
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** @param {(type: string) => boolean} isSupported */
function pickRecorderMime(isSupported) {
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  for (const type of types) {
    if (isSupported(type)) return type;
  }
  return '';
}

export {
  MAX_RECORDING_MS,
  VIDEO_PRIVACY,
  CAMERA_MESSAGES,
  initialCamera,
  reduceCamera,
  cameraMessage,
  canRetryCamera,
  interviewCanProceed,
  canSendAnswer,
  cameraSupportOf,
  cameraPhaseFromError,
  initialRecording,
  reduceRecording,
  shouldAutoStop,
  formatClock,
  pickRecorderMime,
};
