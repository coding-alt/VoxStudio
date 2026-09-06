import { useEffect, useState } from "react";
import type { VoicePlayer } from "../lib/audio";
import { Waveform } from "./Waveform";
import { IconPlay, IconPause, IconStop, IconVolumeLow } from "./Icons";

interface Props {
  player: VoicePlayer;
  samples: Float32Array | null;
  duration: number;
  /** 流式生成中：波形持续生长，且不允许跳转 */
  live: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
  onSeek?: (seconds: number) => void;
  onServerPlay?: () => void;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function Player({
  player,
  samples,
  duration,
  live,
  volume,
  onVolumeChange,
  onSeek,
  onServerPlay,
}: Props) {
  const [time, setTime] = useState(0);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);

  // 生成过程中波形持续增长，用高频轮询跟上；空闲时降低刷新频率
  useEffect(() => {
    const id = window.setInterval(() => {
      setTime(player.currentTime);
      setActive(player.isActive);
      setPaused(player.isPaused);
    }, live ? 60 : 120);
    return () => window.clearInterval(id);
  }, [player, live]);

  const hasAudio = duration > 0;
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  const toggle = () => {
    if (!hasAudio) return;
    if (!player.isActive) {
      // 播完后再点播放，从头开始
      if (samples && samples.length > 0) player.play(samples, player.rate, 0);
    } else if (player.isPaused) {
      void player.resume();
    } else {
      void player.pause();
    }
  };

  const stop = () => player.stop();

  return (
    <div className="player">
      <Waveform
        samples={samples}
        progress={progress}
        live={live}
        onSeek={live ? undefined : (r) => onSeek?.(r * duration)}
      />

      <div className="player-controls">
        <button className="play-btn" onClick={toggle} disabled={!hasAudio} title={active && !paused ? "暂停" : "播放"}>
          {active && !paused ? <IconPause size={14} /> : <IconPlay size={15} />}
        </button>

        <button className="btn btn-icon" onClick={stop} disabled={!active} title="停止">
          <IconStop />
        </button>

        <div
          className="progress"
          onClick={(e) => {
            if (live || !hasAudio) return;
            const rect = e.currentTarget.getBoundingClientRect();
            onSeek?.(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
          }}
          style={{ cursor: live || !hasAudio ? "default" : "pointer" }}
        >
          <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>

        <div className="time">
          {fmt(time)} / {fmt(duration)}
        </div>

        <div className="volume-wrap" title={`音量 ${Math.round(volume * 100)}%`}>
          <IconVolumeLow size={14} />
          <input
            className="slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
          />
        </div>

        {onServerPlay && (
          <button className="btn btn-secondary" onClick={onServerPlay} title="用服务器（Mac 扬声器）播放最新结果">
            服务端播放
          </button>
        )}
      </div>
    </div>
  );
}
