/**
 * 播放引擎：支持「流式边生成边播」与「完整音频播放」。
 *
 * 流式的关键是增量调度——每收到一块 PCM 就把它排进 AudioContext 的时间轴，
 * 用 nextStartTime 串起来，避免块与块之间出现缝隙或重叠。
 * 暂停/恢复复用 AudioContext.suspend()/resume()，suspend 期间 currentTime
 * 会停止推进，所以进度计算天然正确，无需手工补偿。
 */

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext!;
}

export class VoicePlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  private samples = new Float32Array(0);
  private sampleCount = 0;
  private sampleRate = 48000;

  private nextStartTime = 0;
  private startedAt = 0;
  private startOffset = 0;

  private playing = false;
  private paused = false;
  private streaming = false;
  private volume = 1;
  private timer: number | null = null;

  onEnded?: () => void;
  onTick?: () => void;

  get isPlaying(): boolean {
    return this.playing && !this.paused;
  }
  get isPaused(): boolean {
    return this.paused;
  }
  get isActive(): boolean {
    return this.playing;
  }
  get duration(): number {
    return this.sampleRate > 0 ? this.sampleCount / this.sampleRate : 0;
  }
  get currentTime(): number {
    if (!this.ctx || !this.playing) return 0;
    const elapsed = this.ctx.currentTime - this.startedAt;
    return Math.min(Math.max(0, this.startOffset + elapsed), this.duration);
  }
  get rate(): number {
    return this.sampleRate;
  }

  /** 取当前已累积样本的快照，用于绘制波形 */
  getSamples(): Float32Array {
    return this.samples.subarray(0, this.sampleCount);
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = getAudioContextCtor();
      this.ctx = new Ctor();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended" && !this.paused) {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
  }

  /** 清空缓冲，准备一段新的音频 */
  reset(sampleRate: number) {
    this.stopSources();
    this.clearTimer();
    this.sampleRate = sampleRate || 48000;
    this.sampleCount = 0;
    this.samples = new Float32Array(0);
    this.playing = false;
    this.paused = false;
    this.streaming = false;
    this.startOffset = 0;
    this.startedAt = 0;
    this.nextStartTime = 0;
  }

  private ensureCapacity(needed: number) {
    if (this.samples.length >= needed) return;
    let cap = Math.max(this.samples.length, this.sampleRate);
    while (cap < needed) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.samples.subarray(0, this.sampleCount), 0);
    this.samples = next;
  }

  private scheduleRange(startSample: number, endSample: number) {
    if (!this.ctx || !this.gain) return;
    const chunk = Math.floor(this.sampleRate); // 每块约 1 秒
    let pos = startSample;
    while (pos < endSample) {
      const end = Math.min(pos + chunk, endSample);
      const len = end - pos;
      if (len <= 0) break;

      const buf = this.ctx.createBuffer(1, len, this.sampleRate);
      buf.copyToChannel(this.samples.subarray(pos, end), 0);

      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.gain);
      // 用 max 兜底：若生成慢于播放，后续块接在当前时间，避免调度到过去导致丢音
      const start = Math.max(this.ctx.currentTime, this.nextStartTime);
      src.start(start);
      this.nextStartTime = start + buf.duration;
      this.sources.add(src);
      src.onended = () => {
        this.sources.delete(src);
      };
      pos = end;
    }
  }

  /** 开始流式播放（之后用 append 持续喂数据） */
  beginStream(sampleRate: number) {
    const ctx = this.ensureContext();
    this.reset(sampleRate);
    this.streaming = true;
    this.playing = true;
    this.paused = false;
    // 少量初始缓冲：既降低首字延迟，又留出容错空间避免爆音
    this.startedAt = ctx.currentTime + 0.25;
    this.nextStartTime = this.startedAt;
    this.startOffset = 0;
    this.startTimer();
  }

  /** 流式追加 PCM（Float32，单声道） */
  append(chunk: Float32Array) {
    if (chunk.length === 0) return;
    this.ensureCapacity(this.sampleCount + chunk.length);
    this.samples.set(chunk, this.sampleCount);
    const from = this.sampleCount;
    this.sampleCount += chunk.length;
    if (this.playing && !this.paused) {
      this.scheduleRange(from, this.sampleCount);
    }
  }

  /** 流式结束：补齐末尾调度，允许触发 onEnded */
  finishStream() {
    if (this.playing && !this.paused) {
      this.scheduleRange(0, 0);
    }
    this.streaming = false;
  }

  /** 播放一段完整音频，可从 offset 秒处开始 */
  play(samples: Float32Array, sampleRate: number, offset = 0) {
    const ctx = this.ensureContext();
    this.reset(sampleRate);
    this.ensureCapacity(samples.length);
    this.samples.set(samples, 0);
    this.sampleCount = samples.length;

    const startSample = Math.min(Math.max(0, Math.floor(offset * sampleRate)), Math.max(0, sampleCountGuard(samples.length)));
    this.playing = true;
    this.paused = false;
    this.streaming = false;
    this.startOffset = startSample / sampleRate;
    this.startedAt = ctx.currentTime;
    this.nextStartTime = ctx.currentTime;
    this.scheduleRange(startSample, this.sampleCount);
    this.startTimer();
  }

  async pause() {
    if (!this.ctx || !this.playing || this.paused) return;
    await this.ctx.suspend();
    this.paused = true;
  }

  async resume() {
    if (!this.ctx || !this.paused) return;
    await this.ctx.resume();
    this.paused = false;
  }

  stop() {
    this.stopSources();
    this.clearTimer();
    this.playing = false;
    this.paused = false;
    this.streaming = false;
    this.startOffset = 0;
  }

  /** 跳转到指定秒（流式进行中会钳制在已有数据范围内） */
  seek(seconds: number) {
    if (!this.ctx || this.sampleCount === 0) return;
    const target = Math.max(0, Math.min(seconds, this.duration));
    const wasPlaying = this.playing;

    this.stopSources();
    if (this.paused) {
      void this.ctx.resume();
      this.paused = false;
    }
    this.playing = true;
    this.streaming = false;
    this.startOffset = target;
    this.startedAt = this.ctx.currentTime;
    this.nextStartTime = this.ctx.currentTime;
    this.scheduleRange(Math.floor(target * this.sampleRate), this.sampleCount);
    if (!wasPlaying) {
      this.playing = true;
    }
    this.startTimer();
  }

  dispose() {
    this.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.gain = null;
    }
  }

  private stopSources() {
    for (const src of this.sources) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        // 已经停止或尚未开始，忽略
      }
    }
    this.sources.clear();
  }

  private startTimer() {
    this.clearTimer();
    this.timer = window.setInterval(() => {
      if (!this.ctx || !this.playing || this.paused) return;
      this.onTick?.();
      if (!this.streaming && this.ctx.currentTime >= this.nextStartTime - 0.05) {
        this.stop();
        this.onEnded?.();
      }
    }, 100);
  }

  private clearTimer() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function sampleCountGuard(len: number): number {
  return Math.max(0, len);
}
