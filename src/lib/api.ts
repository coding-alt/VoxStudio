/**
 * VoxCPMANE2 后端 API 客户端
 *
 * 后端实测契约（依据本地 localhost:8000 的 OpenAPI 与真实请求验证）：
 *   GET  /health                    → JSON 健康状态
 *   GET  /voices                    → JSON 音色清单（区分系统音色与自定义音色）
 *   POST /v1/audio/speech           → 直接返回 audio/wav 二进制
 *   POST /v1/audio/speech/stream    → chunked 裸 PCM int16 LE，采样率在 X-Sample-Rate 响应头
 *   POST /v1/audio/speech/playback  → 在服务端直接播放
 *   POST /v1/audio/speech/cancel    → 取消当前生成任务
 *   POST /v1/voices                 → 创建自定义音色（需要服务器可读的绝对路径）
 *   DELETE /v1/voices/{name}        → 删除自定义音色
 */

export const DEFAULT_BASE_URL = "http://localhost:8000";

export type ResponseFormat = "wav" | "pcm" | "mp3";

export interface SpeechParams {
  input: string;
  /** 音色名：系统音色或自定义音色 */
  voice?: string | null;
  /** 参考音色模式，后端默认 reference */
  voice_mode?: string | null;
  response_format?: ResponseFormat | null;
  /** 语气/风格控制指令，例如「用开心的语气说」 */
  control_instruction?: string | null;
  /** 零样本克隆：参考音频在服务器上的绝对路径 */
  reference_wav_path?: string | null;
  prompt_wav_path?: string | null;
  prompt_text?: string | null;
  max_length?: number | null;
  cfg_value?: number | null;
  inference_timesteps?: number | null;
  seed?: number | null;
  normalize?: boolean | null;
  model?: string;
}

export interface HealthInfo {
  status: string;
  is_processing: boolean;
  current_job_id: string | null;
  model: string;
  lm_cache_length: number;
  included_voice_cache_directories: string[];
}

export interface VoicesInfo {
  voices: string[];
  count: number;
  system_voices: string[];
  custom_voices: string[];
  custom_cache_directory: string;
  included_voice_cache_directory: string;
}

export interface CreateVoiceParams {
  voice_name: string;
  reference_wav_path: string;
  prompt_text?: string | null;
  replace?: boolean;
}

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail || `请求失败 (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `请求失败 (${res.status})`;
    try {
      const json = JSON.parse(text);
      // FastAPI 422 校验错误的 detail 是数组
      if (Array.isArray(json.detail)) {
        return json.detail.map((d: any) => d.msg ?? JSON.stringify(d)).join("；");
      }
      return json.detail ?? text;
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return `请求失败 (${res.status})`;
  }
}

/** 后端是否可达（用于状态灯轮询） */
export async function fetchHealth(baseUrl: string, signal?: AbortSignal): Promise<HealthInfo> {
  const res = await fetch(endpoint(baseUrl, "/health"), { signal });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return res.json();
}

export async function fetchVoices(baseUrl: string, signal?: AbortSignal): Promise<VoicesInfo> {
  const res = await fetch(endpoint(baseUrl, "/voices"), { signal });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return res.json();
}

/** 一次性合成，返回完整的 wav 二进制 */
export async function createSpeech(
  baseUrl: string,
  params: SpeechParams,
  signal?: AbortSignal,
): Promise<{ data: ArrayBuffer; durationHint?: number }> {
  const res = await fetch(endpoint(baseUrl, "/v1/audio/speech"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, response_format: params.response_format ?? "wav" }),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return { data: await res.arrayBuffer() };
}

export interface StreamHandlers {
  /** 每个 chunk 都是裸 PCM int16 LE，单声道 */
  onChunk: (chunk: Uint8Array, sampleRate: number) => void;
  onMeta?: (sampleRate: number) => void;
}

/**
 * 流式合成：边生成边吐 PCM。
 * 采样率不在响应体里，而在 X-Sample-Rate 头（后端已通过
 * Access-Control-Expose-Headers 暴露，webview 内可以读到）。
 */
export async function streamSpeech(
  baseUrl: string,
  params: SpeechParams,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<{ sampleRate: number; bytes: number }> {
  const res = await fetch(endpoint(baseUrl, "/v1/audio/speech/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, response_format: params.response_format ?? "pcm" }),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));

  const sampleRate = Number(res.headers.get("X-Sample-Rate") || 48000);
  handlers.onMeta?.(sampleRate);

  if (!res.body) {
    // 极少数情况下没有流式响应体，直接整包返回
    const buf = await res.arrayBuffer();
    handlers.onChunk(new Uint8Array(buf), sampleRate);
    return { sampleRate, bytes: buf.byteLength };
  }

  const reader = res.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) {
      total += value.length;
      handlers.onChunk(value, sampleRate);
    }
  }
  return { sampleRate, bytes: total };
}

/** 在服务器（Mac 本机扬声器）上直接播放 */
export async function playbackSpeech(
  baseUrl: string,
  params: SpeechParams,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(endpoint(baseUrl, "/v1/audio/speech/playback"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
}

/** 让后端中止当前生成任务（前端 AbortController 只能断开连接，不能停推理） */
export async function cancelSpeech(baseUrl: string): Promise<void> {
  try {
    await fetch(endpoint(baseUrl, "/v1/audio/speech/cancel"), { method: "POST" });
  } catch {
    // 取消失败不影响前端状态，静默处理
  }
}

export async function createVoice(baseUrl: string, params: CreateVoiceParams): Promise<unknown> {
  const res = await fetch(endpoint(baseUrl, "/v1/voices"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return res.json().catch(() => ({}));
}

export async function deleteVoice(baseUrl: string, name: string): Promise<unknown> {
  const res = await fetch(endpoint(baseUrl, `/v1/voices/${encodeURIComponent(name)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return res.json().catch(() => ({}));
}
