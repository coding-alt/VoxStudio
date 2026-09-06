import { useEffect, useRef } from "react";
import { waveformPeaks } from "../lib/wav";

interface Props {
  samples: Float32Array | null;
  /** 播放进度 0~1 */
  progress: number;
  /** 流式生成中：用 rAF 持续重绘以跟上数据增长 */
  live?: boolean;
  onSeek?: (ratio: number) => void;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function Waveform({ samples, progress, live, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (!samples || samples.length === 0) {
        // 空状态：一条静默基线
        ctx.fillStyle = cssVar("--text-tertiary", "#9a9aa0");
        ctx.globalAlpha = 0.5;
        ctx.fillRect(0, h / 2 - 0.5, w, 1);
        ctx.globalAlpha = 1;
        return;
      }

      const accent = cssVar("--accent", "#007aff");
      const idle = cssVar("--text-tertiary", "#9a9aa0");
      const barW = 2.5;
      const gap = 1.5;
      const count = Math.max(1, Math.floor(w / (barW + gap)));
      const peaks = waveformPeaks(samples, count);
      const splitIndex = Math.floor(progressRef.current * count);
      const mid = h / 2;
      const maxH = h - 8;

      // roundRect 在 Safari 16 以下不可用，降级为直角矩形
      const canRound = typeof (ctx as CanvasRenderingContext2D).roundRect === "function";

      for (let i = 0; i < count; i++) {
        const played = i <= splitIndex;
        ctx.fillStyle = played ? accent : idle;
        ctx.globalAlpha = played ? 1 : 0.42;
        const amp = Math.max(1.5, peaks[i] * maxH);
        const x = i * (barW + gap);
        if (canRound) {
          ctx.beginPath();
          ctx.roundRect(x, mid - amp / 2, barW, amp, 1.2);
          ctx.fill();
        } else {
          ctx.fillRect(x, mid - amp / 2, barW, amp);
        }
      }
      ctx.globalAlpha = 1;
    };

    draw();

    if (!live) return;
    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [samples, live, progress]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || !samples || samples.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  return (
    <div className="waveform-wrap" ref={wrapRef} onClick={handleClick}>
      <canvas ref={canvasRef} />
    </div>
  );
}
