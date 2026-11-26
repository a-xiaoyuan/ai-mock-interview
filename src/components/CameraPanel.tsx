import { cameraMessage, canRetryCamera } from '../../lib/video-session.mjs';
import { useVideoInterview } from '../hooks/useVideoInterview';
import { Icon } from './Icon';

export function CameraPanel() {
  const video = useVideoInterview();
  const phase = video.camera.phase;
  const clip = video.recording.clip;
  const playing = video.recording.playing && !!clip;
  const recording = video.recording.phase === 'recording';
  const live = phase === 'live';
  const failure = cameraMessage(phase);

  return (
    <div className="card camera-card" data-camera-phase={phase} data-recording={video.recording.phase}>
      <div className="card-head">
        <h2>
          <Icon name={live ? 'video' : 'videoOff'} size={16} />
          视频
        </h2>
        <span className="hint">可选</span>
      </div>
      <div className="camera-body">
        {phase === 'off' && !clip && (
          <>
            <p className="camera-note">
              打开后可以预览、录像和回放。仪态建议在这台浏览器里看取景、光线、头和上半身是否出画。画面和录像不会上传，也不会发给模型服务商。不打开也能打字或语音作答。
            </p>
            <button className="sm primary" onClick={video.openCamera}>
              <Icon name="video" size={14} />
              打开摄像头
            </button>
          </>
        )}

        {phase === 'opening' && (
          <p className="camera-note" role="status">
            <span className="spinner" />
            正在请求摄像头权限。可以先打字或语音作答，不必等它。
          </p>
        )}

        {failure && (
          <div className="camera-fallback" role="status">
            <p className="camera-note">{failure}</p>
            {canRetryCamera(phase) && (
              <button className="sm" onClick={video.openCamera}>
                重试摄像头
              </button>
            )}
          </div>
        )}

        {(live || clip) && (
          <div className="camera-stage">
            <video ref={video.liveRef} className={playing || !live ? 'is-hidden mirrored' : 'mirrored'} muted playsInline autoPlay aria-label="摄像头预览" />
            {clip && (
              <video
                ref={video.playRef}
                className={`${playing ? '' : 'is-hidden'}${video.bakedMirror ? '' : ' mirrored'}`}
                src={clip.url}
                controls
                playsInline
                aria-label="录像回放"
              />
            )}
            {recording && (
              <span className="cam-badge">
                <span className="rec-dot" />
                录像中 {video.clock}
              </span>
            )}
            {playing && <span className="cam-badge quiet">回放</span>}
            {live && !recording && !playing && <span className="cam-badge quiet">预览</span>}
          </div>
        )}

        {live && (
          <div className="camera-actions">
            {recording ? (
              <button className="sm cam-stop" onClick={video.stopRecording}>
                <Icon name="stop" size={14} />
                停止录像
              </button>
            ) : (
              <button className="sm primary" onClick={video.startRecording} disabled={!video.recordable}>
                开始录像
              </button>
            )}
            {clip && !recording && (
              <button className="sm ghost" onClick={playing ? video.showLive : video.showPlayback}>
                {playing ? '回到预览' : '回放'}
              </button>
            )}
            {clip && !recording && (
              <button className="sm ghost" onClick={video.discardClip}>
                清除录像
              </button>
            )}
            <button className="sm ghost" onClick={video.closeCamera} disabled={recording}>
              关闭摄像头
            </button>
          </div>
        )}

        {!live && clip && (
          <div className="camera-actions">
            <button className="sm" onClick={video.openCamera}>
              重新打开摄像头
            </button>
            <button className="sm ghost" onClick={video.discardClip}>
              清除录像
            </button>
          </div>
        )}

        {video.recordError && (
          <p className="camera-note warn-text" role="alert">
            {video.recordError}
          </p>
        )}
        {live && !video.recordable && <p className="camera-note">这个浏览器不能录像。预览和文字、语音作答仍然可用。</p>}

        {live && video.model === 'loading' && (
          <p className="camera-note" role="status">
            正在加载本地仪态模型…第一次要下一份大约 11 MB 的引擎和 5.5 MB 的模型，画面不会离开这台浏览器。
          </p>
        )}
        {live && video.model === 'failed' && (
          <p className="camera-note" role="status">
            仪态模型没能加载，暂时没有建议。预览和录像仍可用，回答可以继续打字或语音输入。
          </p>
        )}
        {live && video.model === 'ready' && (
          <ul className="camera-cues" aria-live="polite">
            {video.cues.length === 0 && <li>正在观察画面…</li>}
            {video.cues.map((cue) => (
              <li key={cue.id} className={cue.tone}>
                {cue.text}
              </li>
            ))}
          </ul>
        )}

        {video.summary && video.recording.phase === 'ready' && (
          <div className={`clip-summary ${video.summary.tone}`}>
            <div className="label">这段录像</div>
            {video.summary.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}

        {(live || clip) && (
          <p className="camera-note">
            录像不含麦克风，避免占用语音输入。单段最长 3 分钟，只留在这次页面的内存里，刷新或离开就没有了，不会上传。
          </p>
        )}
      </div>
    </div>
  );
}
