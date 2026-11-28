// 语音面试：朗读面试官的话，把说的话转成文字。
// 默认用浏览器自带的语音合成和识别，不经过本项目的服务端；
// 服务端配置了云端语音（ASR_MODEL / TTS_MODEL）时改用云端，录音和要朗读的文字会发给配置的语音服务。
// 都不可用时，界面退回到打字作答。
import { useCallback, useEffect, useRef, useState } from 'react';
import { synthesizeSpeech, transcribeAudio } from '../api';

const SPEAK_KEY = 'mock-interview-speak';

/* ---------- 朗读 ---------- */

/** 优先用中文（大陆）语音，其次任意中文语音 */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === 'zh-CN' && v.localService) ??
    voices.find((v) => v.lang === 'zh-CN') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('zh')) ??
    null
  );
}

/** 按句切开再排队朗读：部分浏览器一段话读太久会被截断 */
function splitSentences(text: string): string[] {
  return (text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/** 云端朗读的文字上限，和服务端 MAX_TTS_CHARS 一致 */
const MAX_TTS_CHARS = 1000;

/** cloud：服务端配置了云端语音合成。云端失败时退回浏览器自带的朗读 */
export function useSpeaker(cloud = false) {
  const native = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const supported = cloud || native;
  const [enabled, setEnabled] = useState(() => supported && localStorage.getItem(SPEAK_KEY) === '1');
  const [speaking, setSpeaking] = useState(false);
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  // 云端朗读：正在请求的合成和正在播放的音频
  const pending = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const stopCloud = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    if (audio.current) {
      audio.current.onended = audio.current.onerror = null;
      audio.current.pause();
      URL.revokeObjectURL(audio.current.src);
      audio.current = null;
    }
  }, []);

  useEffect(() => {
    if (!native) return stopCloud;
    const load = () => {
      voice.current = pickVoice();
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load);
      window.speechSynthesis.cancel();
      stopCloud();
    };
  }, [native, stopCloud]);

  const stop = useCallback(() => {
    stopCloud();
    if (native) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [native, stopCloud]);

  const speakNative = useCallback(
    (text: string) => {
      if (!native) return setSpeaking(false);
      const synth = window.speechSynthesis;
      synth.cancel();
      const parts = splitSentences(text);
      parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        u.lang = 'zh-CN';
        if (voice.current) u.voice = voice.current;
        u.rate = 1.05;
        if (i === 0) u.onstart = () => setSpeaking(true);
        if (i === parts.length - 1) {
          u.onend = () => setSpeaking(false);
          u.onerror = () => setSpeaking(false);
        }
        synth.speak(u);
      });
    },
    [native],
  );

  const speakCloud = useCallback(
    async (text: string) => {
      const ctrl = new AbortController();
      pending.current = ctrl;
      setSpeaking(true);
      let a: HTMLAudioElement | null = null;
      try {
        const blob = await synthesizeSpeech(text.slice(0, MAX_TTS_CHARS), ctrl.signal);
        if (pending.current !== ctrl) return; // 已经停止或换了一句
        pending.current = null;
        a = new Audio(URL.createObjectURL(blob));
        audio.current = a;
        const done = () => {
          if (!a || audio.current !== a) return;
          URL.revokeObjectURL(a.src);
          audio.current = null;
          setSpeaking(false);
        };
        a.onended = done;
        a.onerror = done;
        await a.play();
      } catch (e) {
        // 中途被停止或换了一句：什么都不做
        if (ctrl.signal.aborted || (a && audio.current !== a)) return;
        // 云端合成失败或浏览器不让自动播放：这一句改用浏览器自带的朗读
        console.warn('云端朗读失败，改用浏览器朗读：', e);
        stopCloud();
        speakNative(text);
      }
    },
    [speakNative, stopCloud],
  );

  /** force：开关关闭时也读（用于“重读这一句”） */
  const speak = useCallback(
    (text: string, force = false) => {
      if (!supported || (!enabled && !force) || !text.trim()) return;
      stopCloud();
      if (native) window.speechSynthesis.cancel();
      if (cloud) void speakCloud(text);
      else speakNative(text);
    },
    [supported, enabled, cloud, native, speakCloud, speakNative, stopCloud],
  );

  // 打开时不打断：调用方可能刚用 force 读了一句试音
  const toggle = useCallback(() => {
    const next = !enabled;
    localStorage.setItem(SPEAK_KEY, next ? '1' : '0');
    setEnabled(next);
    if (!next) stop();
  }, [enabled, stop]);

  return { supported, enabled, speaking, speak, stop, toggle };
}

/* ---------- 语音输入 ---------- */

// TypeScript 自带的 DOM 类型里没有 Web Speech 识别接口，这里只声明用到的部分
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getRecognition(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const ERRORS: Record<string, string> = {
  'not-allowed': '没有麦克风权限，请在地址栏左侧允许使用麦克风。',
  'service-not-allowed': '浏览器不允许使用语音识别，可以直接打字作答。',
  'audio-capture': '没有找到麦克风，请检查设备。',
  network: '连不上浏览器的语音识别服务（Chrome 需要访问 Google），可以换 Edge 浏览器，或者直接打字作答。',
  'language-not-supported': '浏览器的语音识别不支持中文，可以直接打字作答。',
};

/** 录音格式：优先 opus，Safari 只支持 mp4 */
function pickRecordMime(): string {
  const all = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return all.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

/** 一次录音最长时间，到了自动结束并识别；和服务端的大小上限相比留足余量 */
const MAX_RECORD_MS = 5 * 60_000;

const fmtTime = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function micError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return ERRORS['not-allowed'];
  if (name === 'NotFoundError' || name === 'NotReadableError') return ERRORS['audio-capture'];
  return `无法开始录音：${e instanceof Error ? e.message : String(e)}`;
}

/**
 * 语音输入：识别出的整句通过 onFinal 交给调用方，还没说完的部分放在 interim 里实时显示。
 * cloud：服务端配置了云端语音识别。这时改成录音，点结束后整段上传识别；interim 显示录音时长和识别进度。
 */
export function useDictation(onFinal: (text: string) => void, cloud = false) {
  const Ctor = getRecognition();
  const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const [listening, setListening] = useState(false);
  /** 云端识别：录音已结束，正在等识别结果 */
  const [transcribing, setTranscribing] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  // 云端识别用到的录音状态
  const recorder = useRef<MediaRecorder | null>(null);
  const upload = useRef<AbortController | null>(null);
  const timers = useRef<number[]>([]);
  /** 每次开始或取消录音加一；等麦克风权限时被取消，回来后据此放弃 */
  const gen = useRef(0);
  const starting = useRef(false);
  const clearTimers = () => {
    timers.current.forEach((t) => clearInterval(t));
    timers.current = [];
  };

  /** 停掉录音和上传，不交出结果 */
  const dropCloud = useCallback(() => {
    gen.current++;
    starting.current = false;
    clearTimers();
    const r = recorder.current;
    recorder.current = null;
    if (r) {
      r.ondataavailable = r.onstop = null;
      if (r.state !== 'inactive') r.stop();
      r.stream.getTracks().forEach((t) => t.stop());
    }
    upload.current?.abort();
    upload.current = null;
  }, []);

  useEffect(
    () => () => {
      rec.current?.abort();
      dropCloud();
    },
    [dropCloud],
  );

  const startCloud = useCallback(async () => {
    if (recorder.current || upload.current || starting.current) return;
    setError('');
    const my = ++gen.current;
    starting.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      if (gen.current === my) {
        starting.current = false;
        setError(micError(e));
      }
      return;
    }
    if (gen.current !== my) return stream.getTracks().forEach((t) => t.stop()); // 等权限时已取消
    starting.current = false;
    const mime = pickRecordMime();
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      return setError(micError(e));
    }
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = async () => {
      clearTimers();
      stream.getTracks().forEach((t) => t.stop());
      if (recorder.current !== r) return; // 被取消
      recorder.current = null;
      setListening(false);
      const blob = new Blob(chunks, { type: (r.mimeType || mime || 'audio/webm').split(';')[0] });
      if (!blob.size) {
        setInterim('');
        return setError('没有录到声音，请检查麦克风后再试，或者直接打字作答。');
      }
      const ctrl = new AbortController();
      upload.current = ctrl;
      setTranscribing(true);
      setInterim('正在识别…');
      try {
        const text = (await transcribeAudio(blob, ctrl.signal)).trim();
        if (upload.current !== ctrl) return;
        if (text) onFinalRef.current(text);
        else setError('没有识别出内容，可以再说一次，或者直接打字作答。');
      } catch (e) {
        if (upload.current !== ctrl) return;
        setError(`${e instanceof Error ? e.message : String(e)}。可以再试一次，或者直接打字作答。`);
      } finally {
        if (upload.current === ctrl) {
          upload.current = null;
          setTranscribing(false);
          setInterim('');
        }
      }
    };
    recorder.current = r;
    r.start(1000);
    const began = Date.now();
    setListening(true);
    setInterim(`录音中 ${fmtTime(0)}`);
    timers.current.push(
      window.setInterval(() => {
        const ms = Date.now() - began;
        setInterim(`录音中 ${fmtTime(ms)}`);
        if (ms >= MAX_RECORD_MS && r.state === 'recording') r.stop();
      }, 500),
    );
  }, []);

  const start = useCallback(() => {
    if (cloud) return void startCloud();
    if (!Ctor || rec.current) return;
    setError('');
    const r = new Ctor();
    r.lang = 'zh-CN';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) onFinalRef.current(res[0].transcript.trim());
        else pending += res[0].transcript;
      }
      setInterim(pending);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(ERRORS[e.error] ?? `语音识别出错（${e.error}），可以直接打字作答。`);
    };
    r.onend = () => {
      if (rec.current && rec.current !== r) return; // 已经开始了新的一次识别
      rec.current = null;
      setListening(false);
      setInterim('');
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch (e) {
      rec.current = null;
      setError(`无法开始语音识别：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [Ctor, cloud, startCloud]);

  /** 说完了：把最后一句识别完再结束（云端识别：结束录音并上传） */
  const stop = useCallback(() => {
    const r = recorder.current;
    if (r && r.state === 'recording') r.stop();
    rec.current?.stop();
  }, []);
  /** 丢掉还没识别完的部分，立刻结束（例如已经发送了回答） */
  const cancel = useCallback(() => {
    if (rec.current) {
      rec.current.onresult = null;
      rec.current.abort();
    }
    rec.current = null;
    dropCloud();
    setListening(false);
    setTranscribing(false);
    setInterim('');
  }, [dropCloud]);

  return {
    supported: cloud ? canRecord : !!Ctor,
    /** 识别发生在哪：云端时录音会上传给配置的语音服务 */
    cloud,
    listening,
    transcribing,
    interim,
    error,
    start,
    stop,
    cancel,
    clearError: () => setError(''),
  };
}
