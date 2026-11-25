// 语音面试：用浏览器自带的语音合成朗读面试官的话，用语音识别把说的话转成文字。
// 不需要额外依赖，也不经过本项目的服务端。浏览器不支持时，界面退回到打字作答。
import { useCallback, useEffect, useRef, useState } from 'react';

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

export function useSpeaker() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [enabled, setEnabled] = useState(() => supported && localStorage.getItem(SPEAK_KEY) === '1');
  const [speaking, setSpeaking] = useState(false);
  const voice = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      voice.current = pickVoice();
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load);
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  /** force：开关关闭时也读（用于“重读这一句”） */
  const speak = useCallback(
    (text: string, force = false) => {
      if (!supported || (!enabled && !force) || !text.trim()) return;
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
    [supported, enabled],
  );

  const toggle = useCallback(() => {
    setEnabled((on) => {
      const next = !on;
      localStorage.setItem(SPEAK_KEY, next ? '1' : '0');
      if (!next) window.speechSynthesis.cancel();
      return next;
    });
    setSpeaking(false);
  }, []);

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

/** 语音输入：识别出的整句通过 onFinal 交给调用方，还没说完的部分放在 interim 里实时显示 */
export function useDictation(onFinal: (text: string) => void) {
  const Ctor = getRecognition();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback(() => {
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
  }, [Ctor]);

  /** 说完了：把最后一句识别完再结束 */
  const stop = useCallback(() => rec.current?.stop(), []);
  /** 丢掉还没识别完的部分，立刻结束（例如已经发送了回答） */
  const cancel = useCallback(() => {
    if (rec.current) {
      rec.current.onresult = null;
      rec.current.abort();
    }
    rec.current = null;
    setListening(false);
    setInterim('');
  }, []);

  return { supported: !!Ctor, listening, interim, error, start, stop, cancel, clearError: () => setError('') };
}
