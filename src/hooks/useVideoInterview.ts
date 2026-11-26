// 面试页上的可选摄像头：预览、本地录像回放、本地仪态建议。
// 不申请麦克风，避免和语音作答抢设备。失败时只改自己的状态，不碰回答流程。

import { useCallback, useEffect, useRef, useState } from 'react';
import { holdCues, summarizeRecording } from '../../lib/posture.mjs';
import {
  MAX_RECORDING_MS,
  cameraPhaseFromError,
  cameraSupportOf,
  formatClock,
  initialCamera,
  initialRecording,
  pickRecorderMime,
  reduceCamera,
  reduceRecording,
  shouldAutoStop,
} from '../../lib/video-session.mjs';
import type { PostureEngine } from '../lib/postureEngine';

type CameraState = ReturnType<typeof initialCamera>;
type RecordingState = ReturnType<typeof initialRecording>;
type Cue = { id: string; tone: string; text: string };
type Summary = ReturnType<typeof summarizeRecording>;
type ModelStatus = 'idle' | 'loading' | 'ready' | 'failed';

function supportHost() {
  return { isSecureContext: window.isSecureContext, mediaDevices: navigator.mediaDevices };
}

async function openStream() {
  const preferred = {
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } },
    audio: false as const,
  };
  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    throw err;
  }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** 把预览的镜像画进录像，回放时不用再翻转控件 */
function mirroredCapture(video: HTMLVideoElement | null): { stream: MediaStream | null; stop: () => void } {
  const empty = { stream: null, stop() {} };
  if (!video || !video.videoWidth || !video.videoHeight || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return empty;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return empty;
  let timer = 0;
  const draw = () => {
    if (!video.videoWidth) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  };
  draw();
  timer = window.setInterval(draw, 1000 / 15);
  const stream = canvas.captureStream(15);
  return {
    stream,
    stop() {
      window.clearInterval(timer);
      // 捕获流的轨道也要停，只清定时器的话每录一段就漏一份视频轨道
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

export function useVideoInterview() {
  const [camera, setCamera] = useState<CameraState>(initialCamera);
  const [recording, setRecording] = useState<RecordingState>(initialRecording);
  const [model, setModel] = useState<ModelStatus>('idle');
  const [cues, setCues] = useState<Cue[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [clock, setClock] = useState('0:00');
  const [recordError, setRecordError] = useState('');
  const [bakedMirror, setBakedMirror] = useState(false);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const modelRef = useRef(model);
  modelRef.current = model;

  const liveRef = useRef<HTMLVideoElement>(null);
  const playRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const engineRef = useRef<PostureEngine | null>(null);
  const openTicket = useRef(0);
  const mounted = useRef(true);
  const historyRef = useRef<Record<string, number>>({});
  const samplesRef = useRef<Cue[][]>([]);
  const cuesRef = useRef<Cue[]>([]);
  const loopRef = useRef(0);
  const failsRef = useRef(0);
  const captureStopRef = useRef<(() => void) | null>(null);
  const recordable = typeof MediaRecorder !== 'undefined';

  const applyRecording = useCallback((event: { type: string; at?: number; url?: string; bytes?: number; mimeType?: string; durationMs?: number }) => {
    const prev = recordingRef.current;
    const next = reduceRecording(prev, event);
    const newlyRevoked = next.revoked.filter((url) => !prev.revoked.includes(url));
    for (const url of newlyRevoked) URL.revokeObjectURL(url);
    recordingRef.current = next;
    setRecording(next);
    return next;
  }, []);

  const stopRecorder = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return;
    try {
      rec.stop();
    } catch {
      /* 已经停了 */
    }
  }, []);

  const closeCamera = useCallback(() => {
    openTicket.current += 1;
    stopRecorder();
    stopStream(streamRef.current);
    streamRef.current = null;
    if (liveRef.current) liveRef.current.srcObject = null;
    setCamera(reduceCamera(cameraRef.current, 'stop'));
    setModel('idle');
    setCues([]);
    cuesRef.current = [];
    historyRef.current = {};
    failsRef.current = 0;
  }, [stopRecorder]);

  const openCamera = useCallback(async () => {
    const support = cameraSupportOf(supportHost());
    if (support !== 'ok') {
      setCamera(reduceCamera(cameraRef.current, support));
      return;
    }
    const ticket = ++openTicket.current;
    setCamera(reduceCamera(cameraRef.current, 'open'));
    setRecordError('');
    try {
      const stream = await openStream();
      if (!mounted.current || ticket !== openTicket.current) {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      setCamera(reduceCamera(cameraRef.current, 'granted'));
    } catch (err) {
      if (!mounted.current || ticket !== openTicket.current) return;
      stopStream(streamRef.current);
      streamRef.current = null;
      setCamera(reduceCamera(cameraRef.current, cameraPhaseFromError(err)));
    }
  }, []);

  useEffect(() => {
    const video = liveRef.current;
    const stream = streamRef.current;
    if (camera.phase !== 'live' || !video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(() => {});
  }, [camera.phase, recording.playing]);

  useEffect(() => {
    if (camera.phase !== 'live') {
      window.clearInterval(loopRef.current);
      return;
    }
    let cancel = false;
    failsRef.current = 0;
    historyRef.current = {};
    setModel(engineRef.current ? 'ready' : 'loading');

    const tick = () => {
      const engine = engineRef.current;
      const video = liveRef.current;
      if (!engine || !video || !mounted.current) return;
      let next: Cue[] | null;
      try {
        next = engine.sample(video);
      } catch {
        failsRef.current += 1;
        if (failsRef.current >= 3) {
          setModel('failed');
          modelRef.current = 'failed';
          window.clearInterval(loopRef.current);
        }
        return;
      }
      if (!next) return;
      failsRef.current = 0;
      const held = holdCues(historyRef.current, next, 2);
      historyRef.current = held.history;
      const visible = held.cues as Cue[];
      if (visible.length !== cuesRef.current.length || visible.some((cue, i) => cue.id !== cuesRef.current[i]?.id)) {
        cuesRef.current = visible;
        setCues(visible);
      }
      if (recordingRef.current.phase === 'recording' && visible.length) samplesRef.current.push(visible);
    };

    (async () => {
      try {
        if (!engineRef.current) {
          const { loadPostureEngine } = await import('../lib/postureEngine');
          const engine = await loadPostureEngine();
          if (cancel) {
            engine.close();
            return;
          }
          engineRef.current = engine;
        }
        if (cancel) return;
        setModel('ready');
        modelRef.current = 'ready';
        tick();
        loopRef.current = window.setInterval(tick, 450);
      } catch {
        if (!cancel) {
          setModel('failed');
          modelRef.current = 'failed';
        }
      }
    })();

    return () => {
      cancel = true;
      window.clearInterval(loopRef.current);
    };
  }, [camera.phase]);

  const finishClip = useCallback(
    (blob: Blob, startedAt: number) => {
      if (!mounted.current) return;
      if (!blob.size) {
        applyRecording({ type: 'stop' });
        setSummary(summarizeRecording([], { modelReady: modelRef.current === 'ready', modelFailed: modelRef.current === 'failed' }));
        return;
      }
      const url = URL.createObjectURL(blob);
      const durationMs = Math.max(0, Date.now() - startedAt);
      applyRecording({ type: 'stop', url, bytes: blob.size, mimeType: blob.type || 'video/webm', durationMs });
      const modelFailed = modelRef.current === 'failed';
      const modelReady = modelRef.current === 'ready';
      setSummary(summarizeRecording(samplesRef.current, { modelFailed, modelReady }));
      applyRecording({ type: 'play' });
    },
    [applyRecording],
  );

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (cameraRef.current.phase !== 'live' || !stream || recordingRef.current.phase === 'recording' || !recordable) return;
    setRecordError('');
    const mime = pickRecorderMime((type) => MediaRecorder.isTypeSupported(type));
    const capture = mirroredCapture(liveRef.current);
    const target = capture.stream ?? stream;
    if (capture.stream) captureStopRef.current = capture.stop;
    setBakedMirror(!!capture.stream);
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(target, mime ? { mimeType: mime, videoBitsPerSecond: 700_000 } : { videoBitsPerSecond: 700_000 });
    } catch (err) {
      capture.stop();
      captureStopRef.current = null;
      setRecordError(err instanceof Error ? err.message : '这个浏览器不能开始录像。');
      return;
    }
    chunksRef.current = [];
    samplesRef.current = [];
    setSummary(null);
    const play = playRef.current;
    if (play) {
      play.pause();
      play.removeAttribute('src');
      play.load();
    }
    const startedAt = Date.now();
    rec.ondataavailable = (event) => {
      if (event.data && event.data.size) chunksRef.current.push(event.data);
    };
    rec.onerror = () => {
      if (mounted.current) setRecordError('录像中断了。已经录下的片段会留在这次页面里，没有上传。');
    };
    rec.onstop = () => {
      recorderRef.current = null;
      captureStopRef.current?.();
      captureStopRef.current = null;
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || 'video/webm' });
      chunksRef.current = [];
      finishClip(blob, startedAt);
    };
    try {
      rec.start(1000);
    } catch (err) {
      capture.stop();
      captureStopRef.current = null;
      setRecordError(err instanceof Error ? err.message : '这个浏览器不能开始录像。');
      return;
    }
    recorderRef.current = rec;
    applyRecording({ type: 'start', at: startedAt });
  }, [applyRecording, finishClip, recordable]);

  const stopRecording = useCallback(() => {
    if (recordingRef.current.phase !== 'recording') return;
    stopRecorder();
  }, [stopRecorder]);

  useEffect(() => {
    if (recording.phase !== 'recording') return;
    const id = window.setInterval(() => {
      const startedAt = recordingRef.current.startedAt;
      setClock(formatClock(Date.now() - startedAt));
      if (shouldAutoStop(startedAt, Date.now(), MAX_RECORDING_MS)) stopRecording();
    }, 250);
    setClock(formatClock(0));
    return () => window.clearInterval(id);
  }, [recording.phase, recording.startedAt, stopRecording]);

  const showPlayback = useCallback(() => {
    if (recordingRef.current.phase !== 'ready') return;
    applyRecording({ type: 'play' });
  }, [applyRecording]);

  const showLive = useCallback(() => {
    applyRecording({ type: 'pause' });
  }, [applyRecording]);

  const discardClip = useCallback(() => {
    const play = playRef.current;
    if (play) {
      play.pause();
      play.removeAttribute('src');
      play.load();
    }
    applyRecording({ type: 'discard' });
    setSummary(null);
  }, [applyRecording]);

  useEffect(() => {
    const play = playRef.current;
    if (!play || !recording.clip) return;
    if (recording.playing) {
      play.currentTime = 0;
      play.play().catch(() => {});
    } else {
      play.pause();
    }
  }, [recording.playing, recording.clip]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearInterval(loopRef.current);
      openTicket.current += 1;
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        rec.ondataavailable = null;
        try {
          rec.stop();
        } catch {
          /* 离开页面时停掉即可 */
        }
      }
      recorderRef.current = null;
      captureStopRef.current?.();
      captureStopRef.current = null;
      stopStream(streamRef.current);
      streamRef.current = null;
      const clip = recordingRef.current.clip;
      if (clip?.url) URL.revokeObjectURL(clip.url);
      for (const url of recordingRef.current.revoked) URL.revokeObjectURL(url);
      engineRef.current?.close();
      engineRef.current = null;
    };
  }, []);

  return {
    camera,
    recording,
    model,
    cues,
    summary,
    clock,
    recordError,
    bakedMirror,
    recordable,
    liveRef,
    playRef,
    openCamera,
    closeCamera,
    startRecording,
    stopRecording,
    showPlayback,
    showLive,
    discardClip,
  };
}
