// 云端语音：用一个本地的假语音服务（OpenAI 兼容的 /audio/transcriptions 和 /audio/speech）验证转发逻辑和接口
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { speechConfig, speechFeatures, transcribe, synthesize, MAX_TTS_CHARS } = require('../lib/speech');

const root = path.join(__dirname, '..');
const FAKE_MP3 = Buffer.from('ID3fake-mp3-bytes');
const KEY = 'test-speech-key';

/** 假语音服务：记下收到的请求，识别固定返回一句话，合成返回固定字节 */
function startFakeSpeech() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body });
      if (req.headers.authorization !== `Bearer ${KEY}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end('{"error":"bad key"}');
      }
      if (req.url === '/v1/audio/transcriptions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ text: ' 我用哈希表一次遍历 ' }));
      }
      if (req.url === '/v1/audio/speech') {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        return res.end(FAKE_MP3);
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/v1` })));
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/config`);
      if (res.ok) return res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务没有启动');
}

test('配置：没填模型或密钥时不启用，换了地址不沿用大模型密钥', () => {
  assert.deepEqual(speechFeatures(speechConfig({})), { asr: false, tts: false });
  assert.deepEqual(speechFeatures(speechConfig({ ASR_MODEL: 'whisper-1' })), { asr: false, tts: false });
  assert.deepEqual(speechFeatures(speechConfig({ LLM_API_KEY: 'k', ASR_MODEL: 'whisper-1' })), { asr: true, tts: false });
  const sameHost = speechConfig({ LLM_BASE_URL: 'https://llm.example/v1/', LLM_API_KEY: 'llm-key', TTS_MODEL: 'tts-1' });
  assert.equal(sameHost.baseUrl, 'https://llm.example/v1');
  assert.equal(sameHost.apiKey, 'llm-key');
  const otherHost = speechConfig({ LLM_API_KEY: 'llm-key', SPEECH_BASE_URL: 'https://speech.example/v1', TTS_MODEL: 'tts-1' });
  assert.equal(otherHost.apiKey, '');
  assert.equal(speechFeatures(otherHost).tts, false);
});

test('识别和合成：按 OpenAI 兼容格式转发', async () => {
  const fake = await startFakeSpeech();
  try {
    const cfg = speechConfig({ SPEECH_BASE_URL: fake.url, SPEECH_API_KEY: KEY, ASR_MODEL: 'asr-x', TTS_MODEL: 'tts-x', TTS_VOICE: 'alloy', ASR_LANGUAGE: 'zh' });

    const text = await transcribe(cfg, Buffer.from('webm-bytes'), 'audio/webm;codecs=opus');
    assert.equal(text, '我用哈希表一次遍历');
    const asr = fake.seen.at(-1);
    assert.match(asr.type, /^multipart\/form-data/);
    const form = asr.body.toString();
    assert.match(form, /filename="answer\.webm"/);
    assert.match(form, /name="model"\r\n\r\nasr-x/);
    assert.match(form, /name="language"\r\n\r\nzh/);
    assert.match(form, /webm-bytes/);

    const res = await synthesize(cfg, 'x'.repeat(MAX_TTS_CHARS + 50));
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), FAKE_MP3);
    const tts = JSON.parse(fake.seen.at(-1).body);
    assert.equal(tts.model, 'tts-x');
    assert.equal(tts.voice, 'alloy');
    assert.equal(tts.input.length, MAX_TTS_CHARS);

    await assert.rejects(() => transcribe(cfg, Buffer.from('x'), 'video/x-msvideo'), /不支持的录音格式/);
    await assert.rejects(() => transcribe(cfg, Buffer.alloc(0), 'audio/webm'), /录音为空/);
    await assert.rejects(() => synthesize(cfg, '   '), /为空/);
    await assert.rejects(() => transcribe({ ...cfg, apiKey: 'wrong' }, Buffer.from('x'), 'audio/webm'), /语音服务返回 401/);
    // 连不上时给出看得懂的说明，并且不带出地址
    const down = { ...cfg, baseUrl: 'http://127.0.0.1:9/v1' };
    await assert.rejects(() => synthesize(down, '你好'), (e) => /连不上语音服务/.test(e.message) && !e.message.includes('127.0.0.1'));
  } finally {
    fake.server.close();
  }
});

test('接口：/api/config 报告开关，/api/asr 收原始录音，/api/tts 返回音频', { timeout: 30_000 }, async () => {
  const fake = await startFakeSpeech();
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LLM_API_KEY: '', SPEECH_BASE_URL: fake.url, SPEECH_API_KEY: KEY, ASR_MODEL: 'asr-x', TTS_MODEL: 'tts-x', TTS_VOICE: '', ASR_LANGUAGE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const config = await waitFor(port);
    assert.deepEqual(config.speech, { asr: true, tts: true });
    assert.equal(JSON.stringify(config).includes(KEY), false, '配置接口不能带出密钥');

    // 比 JSON 接口的 1MB 上限大，确认录音走的是单独的大小限制
    const audio = Buffer.alloc(1_500_000, 7);
    const asr = await fetch(`http://127.0.0.1:${port}/api/asr`, { method: 'POST', headers: { 'Content-Type': 'audio/ogg' }, body: audio });
    assert.equal(asr.status, 200, await asr.clone().text());
    assert.deepEqual(await asr.json(), { text: '我用哈希表一次遍历' });
    assert.equal(fake.seen.at(-1).body.includes(audio.subarray(0, 64)), true);

    const tts = await fetch(`http://127.0.0.1:${port}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '请介绍一下你自己' }) });
    assert.equal(tts.status, 200);
    assert.equal(tts.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual(Buffer.from(await tts.arrayBuffer()), FAKE_MP3);

    const bad = await fetch(`http://127.0.0.1:${port}/api/asr`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
    assert.equal(bad.status, 500);
    assert.match((await bad.json()).error, /不支持的录音格式/);
  } finally {
    child.kill();
    fake.server.close();
  }
});

test('接口：没配置云端语音时开关为关，调用接口直接报错', { timeout: 30_000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LLM_API_KEY: '', SPEECH_API_KEY: '', ASR_MODEL: '', TTS_MODEL: '' },
    stdio: 'ignore',
  });
  try {
    const config = await waitFor(port);
    assert.deepEqual(config.speech, { asr: false, tts: false });
    const res = await fetch(`http://127.0.0.1:${port}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"你好"}' });
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /没有配置云端语音合成/);
  } finally {
    child.kill();
  }
});
