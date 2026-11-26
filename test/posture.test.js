const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

let posture;
let session;

before(async () => {
  posture = await import('../lib/posture.mjs');
  session = await import('../lib/video-session.mjs');
});

function blank() {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
}

function setPoint(pose, index, x, y, visibility = 0.95) {
  pose[index] = { x, y, visibility };
}

/** 正对镜头、头肩都在画面中部的一帧 */
function goodPose() {
  const pose = blank();
  setPoint(pose, 0, 0.5, 0.32);
  setPoint(pose, 2, 0.46, 0.3);
  setPoint(pose, 5, 0.54, 0.3);
  setPoint(pose, 7, 0.4, 0.32);
  setPoint(pose, 8, 0.6, 0.32);
  setPoint(pose, 11, 0.36, 0.58);
  setPoint(pose, 12, 0.64, 0.58);
  return pose;
}

function evenLight(extra = {}) {
  return { frameLuma: 130, personLuma: 140, leftLuma: 138, rightLuma: 146, ...extra };
}

function advise(poses, light = evenLight()) {
  return posture.analyzePosture({ poses, ...light });
}

function ids(cues) {
  return cues.map((cue) => cue.id);
}

test('取景和光线正常时给出肯定建议', () => {
  const cues = advise([goodPose()]);
  assert.deepEqual(ids(cues), ['ok']);
  assert.equal(cues[0].tone, 'good');
  assert.match(cues[0].text, /合适/);
});

test('没有人时提示入画，画面很暗时一并说明', () => {
  assert.deepEqual(ids(advise([])), ['no-person']);
  assert.deepEqual(ids(advise([], evenLight({ frameLuma: 20, personLuma: null, leftLuma: null, rightLuma: null }))), ['no-person', 'dark-frame']);
});

test('头太靠上、太靠下、不在画面里', () => {
  const high = goodPose();
  setPoint(high, 0, 0.5, 0.08);
  setPoint(high, 2, 0.46, 0.07);
  setPoint(high, 5, 0.54, 0.07);
  assert.ok(ids(advise([high])).includes('head-high'));

  const low = goodPose();
  setPoint(low, 0, 0.5, 0.7);
  setPoint(low, 2, 0.46, 0.68);
  setPoint(low, 5, 0.54, 0.68);
  setPoint(low, 7, 0.4, 0.7);
  setPoint(low, 8, 0.6, 0.7);
  setPoint(low, 11, 0.36, 0.88);
  setPoint(low, 12, 0.64, 0.88);
  assert.ok(ids(advise([low])).includes('head-low'));

  const noHead = blank();
  setPoint(noHead, 11, 0.36, 0.58);
  setPoint(noHead, 12, 0.64, 0.58);
  assert.deepEqual(ids(advise([noHead])), ['head-missing']);
});

test('身体偏离画幅：太近、太远、偏左、肩膀出画、肩膀不平', () => {
  const close = goodPose();
  setPoint(close, 11, 0.02, 0.58);
  setPoint(close, 12, 0.64, 0.58);
  const closeIds = ids(advise([close], evenLight({ personLuma: 40, leftLuma: 40, rightLuma: 44, frameLuma: 50 })));
  assert.deepEqual(closeIds, ['too-close', 'off-left', 'dark']);

  const far = goodPose();
  setPoint(far, 11, 0.44, 0.58);
  setPoint(far, 12, 0.56, 0.58);
  assert.ok(ids(advise([far])).includes('too-far'));

  const left = goodPose();
  setPoint(left, 0, 0.2, 0.32);
  setPoint(left, 2, 0.16, 0.3);
  setPoint(left, 5, 0.24, 0.3);
  setPoint(left, 7, 0.1, 0.32);
  setPoint(left, 8, 0.3, 0.32);
  setPoint(left, 11, 0.08, 0.58);
  setPoint(left, 12, 0.32, 0.58);
  assert.ok(ids(advise([left])).includes('off-left'));

  const right = goodPose();
  setPoint(right, 11, 0.7, 0.58);
  setPoint(right, 12, 0.94, 0.58);
  assert.ok(ids(advise([right])).includes('off-right'));

  const shoulders = goodPose();
  setPoint(shoulders, 11, 0.36, 0.58, 0);
  setPoint(shoulders, 12, 0.64, 0.58, 0);
  assert.deepEqual(ids(advise([shoulders])), ['shoulders-out']);

  const edge = goodPose();
  setPoint(edge, 0, 0.12, 0.32);
  setPoint(edge, 2, 0.08, 0.3);
  setPoint(edge, 5, 0.16, 0.3);
  setPoint(edge, 7, 0.05, 0.32);
  setPoint(edge, 8, 0.2, 0.32);
  setPoint(edge, 11, 0.1, 0.58, 0);
  setPoint(edge, 12, 0.3, 0.58, 0);
  assert.deepEqual(ids(advise([edge])), ['shoulders-out', 'off-left']);

  const tilt = goodPose();
  setPoint(tilt, 11, 0.36, 0.48);
  setPoint(tilt, 12, 0.64, 0.62);
  assert.ok(ids(advise([tilt])).includes('tilt'));
});

test('侧脸、逆光、过亮、侧面来光、多人', () => {
  const side = goodPose();
  setPoint(side, 5, 0.54, 0.3, 0);
  setPoint(side, 7, 0.4, 0.32, 0);
  setPoint(side, 8, 0.6, 0.32, 0);
  assert.ok(ids(advise([side])).includes('side-face'));

  const frontal = goodPose();
  setPoint(frontal, 8, 0.6, 0.32, 0);
  assert.ok(!ids(advise([frontal])).includes('side-face'));

  assert.ok(ids(advise([goodPose()], evenLight({ personLuma: 70, frameLuma: 160, leftLuma: 68, rightLuma: 74 }))).includes('backlight'));
  assert.ok(ids(advise([goodPose()], evenLight({ personLuma: 230, frameLuma: 200, leftLuma: 228, rightLuma: 232 }))).includes('blown'));
  assert.ok(ids(advise([goodPose()], evenLight({ personLuma: 140, frameLuma: 140, leftLuma: 70, rightLuma: 190 }))).includes('edge-light'));

  const cues = advise([goodPose(), goodPose()]);
  assert.deepEqual(ids(cues), ['multi']);
  assert.match(cues[0].text, /多人/);
});

test('建议文案不包含上传或接口地址', () => {
  const samples = [
    advise([]),
    advise([goodPose()]),
    advise([goodPose()], evenLight({ personLuma: 20, frameLuma: 10, leftLuma: 10, rightLuma: 80 })),
  ];
  for (const cues of samples) {
    for (const cue of cues) assert.doesNotMatch(cue.text, /上传|https?:|\/api\//);
  }
});

test('亮度取样能分出左右，脸部区域不包含肩膀', () => {
  const width = 4;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % width;
    const value = x < 2 ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  const stats = posture.luminanceStats({ width, height, data }, { x: 0, y: 0, w: 1, h: 1 });
  assert.ok(stats.frameLuma > 100 && stats.frameLuma < 160);
  assert.ok(stats.leftLuma < 5);
  assert.ok(stats.rightLuma > 250);
  const box = posture.faceBox(goodPose());
  assert.ok(box);
  assert.ok(box.y + box.h < 0.5);
});

test('预览镜像会翻转左右，连续两帧才显示建议', () => {
  const mirrored = posture.mirrorPoses([[{ x: 0.2, y: 0.3, visibility: 1 }]]);
  assert.equal(mirrored[0][0].x, 0.8);
  const cue = { id: 'off-left', tone: 'warn', text: '偏左' };
  const first = posture.holdCues({}, [cue], 2);
  assert.equal(first.cues.length, 0);
  const second = posture.holdCues(first.history, [cue], 2);
  assert.equal(second.cues.length, 1);
  const dropped = posture.holdCues(second.history, [], 2);
  assert.equal(dropped.cues.length, 0);
  assert.equal(dropped.history['off-left'], undefined);
});

test('录像摘要统计反复出现的问题，空样本和模型失败有说明', () => {
  const warn = (id, text) => ({ id, tone: 'warn', text });
  const left = warn('off-left', '人偏到画面左边了。');
  const dark = warn('dark', '脸部偏暗。');
  const samples = [[left], [left], [left, dark], [left], [{ id: 'ok', tone: 'good', text: '合适' }]];
  const summary = posture.summarizeRecording(samples);
  assert.equal(summary.tone, 'warn');
  assert.deepEqual(summary.ids, ['off-left']);
  assert.match(summary.lines[0], /80%/);
  assert.match(summary.lines[0], /偏到画面左边/);
  const stable = posture.summarizeRecording([[{ id: 'ok', tone: 'good', text: '合适' }]]);
  assert.equal(stable.tone, 'good');
  assert.match(posture.summarizeRecording([]).lines[0], /太短/);
  assert.match(posture.summarizeRecording([], { modelReady: false }).lines[0], /还没准备好/);
  assert.match(posture.summarizeRecording([[left]], { modelFailed: true }).lines[0], /没能加载/);
  assert.equal(posture.POSTURE_PRIVACY.uploadsVideoToAppServer, false);
  assert.equal(posture.POSTURE_PRIVACY.sendsFramesToModelProvider, false);
});

test('没有摄像头或拒绝授权时，文字回答和面试流程仍可用', () => {
  const phases = ['open', 'granted', 'stop', 'denied', 'missing', 'unsupported', 'busy', 'insecure', 'error', 'unknown'];
  let camera = session.initialCamera();
  for (const phase of phases) {
    camera = session.reduceCamera(camera, phase);
    assert.equal(camera.blocksInterview, false);
    assert.equal(session.interviewCanProceed(camera), true);
    assert.equal(session.canSendAnswer({ busy: false, text: '我会用缓存', camera: phase }), true);
  }
  assert.equal(session.interviewCanProceed(null), true);
  assert.equal(session.canSendAnswer({ busy: true, text: '有内容' }), false);
  assert.equal(session.canSendAnswer({ busy: false, text: '   ' }), false);
  assert.match(session.cameraMessage('denied'), /拒绝|权限/);
  assert.match(session.cameraMessage('denied'), /语音/);
  assert.match(session.cameraMessage('missing'), /语音/);
  assert.match(session.cameraMessage('unsupported'), /语音/);
  assert.equal(session.canRetryCamera('denied'), true);
  assert.equal(session.canRetryCamera('unsupported'), false);
  assert.equal(session.canRetryCamera('insecure'), false);
});

test('摄像头支持检测和失败原因', () => {
  assert.equal(session.cameraSupportOf(null), 'unsupported');
  assert.equal(session.cameraSupportOf({ isSecureContext: false, mediaDevices: { getUserMedia() {} } }), 'insecure');
  assert.equal(session.cameraSupportOf({ isSecureContext: true, mediaDevices: {} }), 'unsupported');
  assert.equal(session.cameraSupportOf({ isSecureContext: true, mediaDevices: { getUserMedia() {} } }), 'ok');
  assert.equal(session.cameraPhaseFromError({ name: 'NotAllowedError' }), 'denied');
  assert.equal(session.cameraPhaseFromError({ name: 'NotFoundError' }), 'missing');
  assert.equal(session.cameraPhaseFromError({ name: 'NotReadableError' }), 'busy');
  assert.equal(session.cameraPhaseFromError({ name: 'SecurityError' }), 'insecure');
  assert.equal(session.cameraPhaseFromError({ name: 'NotSupportedError' }), 'unsupported');
  assert.equal(session.cameraPhaseFromError({ name: 'AbortError' }), 'error');
});

test('录像留在本地内存，可回放，再次录制会丢掉上一段，上传被忽略', () => {
  let state = session.initialRecording();
  assert.equal(state.uploaded, false);
  assert.equal(state.storage, 'browser-memory');
  state = session.reduceRecording(state, { type: 'start', at: 1_000 });
  assert.equal(state.phase, 'recording');
  state = session.reduceRecording(state, { type: 'upload', url: 'https://example.invalid/video' });
  assert.equal(state.uploaded, false);
  assert.equal(state.phase, 'recording');
  assert.equal(state.clip, null);
  state = session.reduceRecording(state, { type: 'stop', url: '', bytes: 0 });
  assert.equal(state.phase, 'idle');
  state = session.reduceRecording(state, { type: 'start', at: 2_000 });
  state = session.reduceRecording(state, { type: 'stop', url: 'blob:local-1', bytes: 2048, mimeType: 'video/webm', durationMs: 1500 });
  assert.equal(state.phase, 'ready');
  assert.equal(state.clip.url, 'blob:local-1');
  assert.equal(state.clip.bytes, 2048);
  assert.equal(state.uploaded, false);
  state = session.reduceRecording(state, { type: 'play' });
  assert.equal(state.playing, true);
  state = session.reduceRecording(state, { type: 'pause' });
  assert.equal(state.playing, false);
  assert.equal(session.reduceRecording(session.initialRecording(), { type: 'play' }).playing, false);
  state = session.reduceRecording(state, { type: 'start', at: 5_000 });
  assert.equal(state.phase, 'recording');
  assert.equal(state.clip, null);
  assert.deepEqual(state.revoked, ['blob:local-1']);
  state = session.reduceRecording(state, { type: 'stop', url: 'blob:local-2', bytes: 80, mimeType: 'video/webm', durationMs: 400 });
  state = session.reduceRecording(state, { type: 'camera-off' });
  assert.equal(state.phase, 'idle');
  assert.equal(state.clip, null);
  assert.deepEqual(state.revoked, ['blob:local-1', 'blob:local-2']);
  assert.equal(state.uploaded, false);
  assert.equal(session.VIDEO_PRIVACY.uploadsVideoToAppServer, false);
  assert.equal(session.VIDEO_PRIVACY.sendsFramesToModelProvider, false);
  assert.equal(session.shouldAutoStop(0, session.MAX_RECORDING_MS - 1), false);
  assert.equal(session.shouldAutoStop(0, session.MAX_RECORDING_MS), true);
  assert.equal(session.formatClock(0), '0:00');
  assert.equal(session.formatClock(65_000), '1:05');
  assert.equal(session.pickRecorderMime((type) => type === 'video/webm'), 'video/webm');
  assert.equal(session.pickRecorderMime(() => false), '');
});

test('姿态资源在本地，面试页不把摄像头当成发送回答的条件', () => {
  const { postureFiles, POSTURE_MODEL_PATH } = require('../lib/posture-assets');
  const files = postureFiles(root);
  assert.ok(files.some((file) => file.urlPath === POSTURE_MODEL_PATH));
  for (const file of files) {
    assert.match(file.urlPath, /^\/posture\//);
    assert.equal(fs.existsSync(file.abs), true, file.abs);
  }
  const page = fs.readFileSync(path.join(root, 'src/components/InterviewPage.tsx'), 'utf8');
  assert.match(page, /useInterview\(/);
  assert.match(page, /useDictation\(/);
  assert.match(page, /<CameraPanel \/>/);
  assert.match(page, /canSendAnswer\(\{ busy: iv\.busy, text: draft \}\)/);
  assert.doesNotMatch(page, /camera\.phase|getUserMedia/);
  const setup = fs.readFileSync(path.join(root, 'src/components/SetupPage.tsx'), 'utf8');
  assert.doesNotMatch(setup, /getUserMedia|CameraPanel/);
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.doesNotMatch(server, /\/api\/(video|upload|posture|camera)/);
  const watched = [
    'src/hooks/useVideoInterview.ts',
    'src/lib/postureEngine.ts',
    'src/components/CameraPanel.tsx',
    'lib/posture.mjs',
    'lib/video-session.mjs',
  ];
  for (const rel of watched) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(text, /\/api\/|FormData|LLM_|sendBeacon|WebSocket/);
  }
  const hook = fs.readFileSync(path.join(root, 'src/hooks/useVideoInterview.ts'), 'utf8');
  assert.match(hook, /URL\.createObjectURL/);
  assert.match(hook, /audio:\s*false/);
  const engine = fs.readFileSync(path.join(root, 'src/lib/postureEngine.ts'), 'utf8');
  assert.match(engine, /import\('@mediapipe\/tasks-vision'\)/);
  assert.match(engine, /pose_landmarker_lite\.task/);
});
