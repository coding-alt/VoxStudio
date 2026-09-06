/** WAV 解析与编码。后端合成接口返回 audio/wav（48kHz / 16bit / 单声道）。 */

export interface DecodedAudio {
  sampleRate: number;
  channels: number;
  /** 混成单声道的 Float32 采样，范围 [-1, 1] */
  samples: Float32Array;
  duration: number;
}

function readAscii(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

export function parseWav(buffer: ArrayBuffer): DecodedAudio {
  const view = new DataView(buffer);
  if (buffer.byteLength < 44 || readAscii(view, 0, 4) !== "RIFF") {
    throw new Error("不是有效的 WAV 文件");
  }

  const declared = view.getUint32(4, true) + 8;
  const fileSize = Math.min(declared || buffer.byteLength, buffer.byteLength);

  let fmtOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;

  let pos = 12;
  while (pos + 8 <= fileSize) {
    const id = readAscii(view, pos, 4);
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") {
      fmtOffset = pos + 8;
    } else if (id === "data") {
      dataOffset = pos + 8;
      dataSize = Math.min(size, fileSize - (pos + 8));
    }
    // chunk 按偶数字节对齐
    pos += 8 + size + (size % 2);
  }

  if (fmtOffset < 0 || dataOffset < 0) {
    throw new Error("WAV 缺少 fmt 或 data 段");
  }

  const audioFormat = view.getUint16(fmtOffset, true);
  const channels = view.getUint16(fmtOffset + 2, true);
  const sampleRate = view.getUint32(fmtOffset + 4, true);
  const bitsPerSample = view.getUint16(fmtOffset + 14, true);

  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataSize / (bytesPerSample * Math.max(channels, 1)));
  const samples = new Float32Array(frames);

  if (audioFormat === 3 && bitsPerSample === 32) {
    // IEEE float
    for (let i = 0; i < frames; i++) {
      let acc = 0;
      for (let c = 0; c < channels; c++) {
        acc += view.getFloat32(dataOffset + (i * channels + c) * 4, true);
      }
      samples[i] = channels > 0 ? acc / channels : 0;
    }
  } else if (bitsPerSample === 16) {
    for (let i = 0; i < frames; i++) {
      let acc = 0;
      for (let c = 0; c < channels; c++) {
        acc += view.getInt16(dataOffset + (i * channels + c) * 2, true) / 32768;
      }
      samples[i] = channels > 0 ? acc / channels : 0;
    }
  } else if (bitsPerSample === 8) {
    for (let i = 0; i < frames; i++) {
      let acc = 0;
      for (let c = 0; c < channels; c++) {
        acc += (view.getUint8(dataOffset + (i * channels + c)) - 128) / 128;
      }
      samples[i] = channels > 0 ? acc / channels : 0;
    }
  } else if (bitsPerSample === 32) {
    for (let i = 0; i < frames; i++) {
      let acc = 0;
      for (let c = 0; c < channels; c++) {
        acc += view.getInt32(dataOffset + (i * channels + c) * 4, true) / 2147483648;
      }
      samples[i] = channels > 0 ? acc / channels : 0;
    }
  } else {
    throw new Error(`暂不支持的位深: ${bitsPerSample} bit`);
  }

  return {
    sampleRate,
    channels,
    samples,
    duration: sampleRate > 0 ? frames / sampleRate : 0,
  };
}

/** int16 LE 裸 PCM（流式接口产出）→ Float32 */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  // 字节流必须按偶数截断，否则最后一个字节会读出 NaN
  const len = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(len);
  const view = new DataView(bytes.buffer, bytes.byteOffset, len * 2);
  for (let i = 0; i < len; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export function float32ToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** 把 Float32 采样封装成标准 wav（16bit PCM），用于导出与历史保存 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const pcm = float32ToPcm16(samples);
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk 长度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  new Int16Array(buffer, 44).set(pcm);
  return buffer;
}

/** 给裸 PCM（流式结果）套一个 wav 头，便于保存 */
export function wrapPcmAsWav(pcmBytes: Uint8Array, sampleRate: number): ArrayBuffer {
  const aligned = pcmBytes.byteLength - (pcmBytes.byteLength % 2);
  const buffer = new ArrayBuffer(44 + aligned);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + aligned, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, aligned, true);

  new Uint8Array(buffer, 44).set(pcmBytes.subarray(0, aligned));
  return buffer;
}

/** 线性插值重采样。麦克风原始采样率多为 48k，统一到 16k 更符合参考音频的常规输入。 */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const ratio = from / to;
  const outLen = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/** 计算波形轮廓（峰值包络），供 Canvas 绘制 */
export function waveformPeaks(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  if (samples.length === 0) return out;
  const step = samples.length / buckets;
  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(samples.length, Math.floor((i + 1) * step));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}
