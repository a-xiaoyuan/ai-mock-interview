// 云端语音：把语音识别（ASR）和语音合成（TTS）转发给 OpenAI 兼容的 /audio/transcriptions 和 /audio/speech 接口。
// 不配置模型时不启用，前端继续用浏览器自带的语音功能。
// 配置（.env）：
//   ASR_MODEL / TTS_MODEL      识别、合成用的模型，填了哪个就启用哪个
//   TTS_VOICE                  合成的音色（各家名字不同）
//   ASR_LANGUAGE               识别语言，例如 zh；不填交给服务商自动判断
//   SPEECH_BASE_URL / SPEECH_API_KEY  语音服务的地址和密钥，不填则沿用 LLM_BASE_URL / LLM_API_KEY；
//                              填了 SPEECH_BASE_URL 就必须同时填 SPEECH_API_KEY，不会沿用大模型的密钥

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 约等于几十分钟的 opus 录音，单次回答足够
const MAX_TTS_CHARS = 1000;

/** 录音格式 → 上传时的文件名后缀。服务商通常按后缀判断格式 */
const EXT = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

function speechConfig(env = process.env) {
  const own = (env.SPEECH_BASE_URL || '').trim();
  return {
    baseUrl: (own || env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    // 语音服务换了地址时只用 SPEECH_API_KEY，不把大模型的密钥发给另一家
    apiKey: env.SPEECH_API_KEY || (own ? '' : env.LLM_API_KEY || ''),
    asrModel: (env.ASR_MODEL || '').trim(),
    ttsModel: (env.TTS_MODEL || '').trim(),
    ttsVoice: (env.TTS_VOICE || '').trim(),
    asrLanguage: (env.ASR_LANGUAGE || '').trim(),
  };
}

/** 给前端看的开关：只说启用了什么，不带地址和密钥 */
function speechFeatures(cfg) {
  return { asr: !!(cfg.asrModel && cfg.apiKey), tts: !!(cfg.ttsModel && cfg.apiKey) };
}

function upstreamError(what, status, text) {
  return new Error(`${what}失败（语音服务返回 ${status}）：${String(text).slice(0, 200)}`);
}

/** 请求语音服务；连不上或超时时换成看得懂的说明（不带地址，和 /api/config 一样不对外暴露） */
async function callSpeech(what, url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error(`${what}失败：语音服务 60 秒内没有响应`);
    throw new Error(`${what}失败：连不上语音服务，请检查 SPEECH_BASE_URL 和网络`);
  }
}

/** 识别一段录音，返回文字 */
async function transcribe(cfg, audio, mime) {
  if (!speechFeatures(cfg).asr) throw new Error('没有配置云端语音识别（ASR_MODEL）');
  if (!audio?.length) throw new Error('录音为空');
  if (audio.length > MAX_AUDIO_BYTES) throw new Error('录音太长，请分段回答');
  const type = String(mime || '').split(';')[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) throw new Error(`不支持的录音格式：${type || '未知'}`);

  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `answer.${ext}`);
  form.append('model', cfg.asrModel);
  if (cfg.asrLanguage) form.append('language', cfg.asrLanguage);
  form.append('response_format', 'json');

  const res = await callSpeech('语音识别', `${cfg.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw upstreamError('语音识别', res.status, text);
  // 大多数服务商返回 {"text": "..."}；个别在 response_format=json 时仍返回纯文本
  try {
    return String(JSON.parse(text).text ?? '').trim();
  } catch {
    return text.trim();
  }
}

/** 合成一段话，返回上游的 Response（调用方把音频流转给浏览器） */
async function synthesize(cfg, input) {
  if (!speechFeatures(cfg).tts) throw new Error('没有配置云端语音合成（TTS_MODEL）');
  const text = String(input || '').trim().slice(0, MAX_TTS_CHARS);
  if (!text) throw new Error('要朗读的内容为空');
  const body = { model: cfg.ttsModel, input: text, response_format: 'mp3' };
  if (cfg.ttsVoice) body.voice = cfg.ttsVoice;
  const res = await callSpeech('语音合成', `${cfg.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw upstreamError('语音合成', res.status, await res.text());
  return res;
}

module.exports = { MAX_AUDIO_BYTES, MAX_TTS_CHARS, speechConfig, speechFeatures, transcribe, synthesize };
