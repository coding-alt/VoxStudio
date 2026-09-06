/**
 * 原生能力封装。
 * 在 `npm run dev`（纯浏览器）下 invoke 不可用，这里统一降级为 localStorage，
 * 保证 UI 仍可预览；打包进 Tauri 后走真正的原生实现。
 */
import { invoke } from "@tauri-apps/api/core";

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 安全地调用原生命令，非 Tauri 环境返回 null 而不抛错 */
export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!inTauri()) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[native] ${cmd} 调用失败`, err);
    throw err;
  }
}

export const native = {
  /** 应用数据目录（~/Library/Application Support/com.voxstudio.app） */
  storagePath: () => safeInvoke<string>("storage_path"),
  defaultServerBin: () => safeInvoke<string>("default_server_bin"),

  readJson: (name: string) => safeInvoke<string | null>("read_json", { name }),
  writeJson: (name: string, content: string) => safeInvoke<void>("write_json", { name, content }),

  saveAudio: (id: string, base64: string) => safeInvoke<string>("save_audio", { id, data: base64 }),
  readAudio: (id: string) => safeInvoke<string>("read_audio", { id }),
  deleteAudio: (id: string) => safeInvoke<void>("delete_audio", { id }),
  clearAudioDir: () => safeInvoke<void>("clear_audio_dir"),

  /** 原生文件面板选音频，返回真实绝对路径 */
  pickAudioFile: () => safeInvoke<string | null>("pick_audio_file"),
  /** 复制参考音频到应用数据目录，返回可被后端读取的路径 */
  importReference: (src: string) => safeInvoke<string>("import_reference", { src }),
  /** 把内存中的 wav（麦克风录制产物）写入参考目录 */
  saveReference: (id: string, base64: string) =>
    safeInvoke<string>("save_reference", { id, data: base64 }),

  exportAudio: (defaultName: string, base64: string) =>
    safeInvoke<string | null>("export_audio", { defaultName, data: base64 }),
  revealInFinder: (path: string) => safeInvoke<void>("reveal_in_finder", { path }),

  backendStatus: (baseUrl: string) =>
    safeInvoke<{ online: boolean; managed: boolean; message: string }>("backend_status", { baseUrl }),
  startBackend: (baseUrl: string, bin: string) =>
    safeInvoke<{ online: boolean; managed: boolean; message: string }>("start_backend", { baseUrl, bin }),
  stopBackend: () => safeInvoke<string>("stop_backend"),
};

// ── base64 工具 ──────────────────────────────────────────────

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000; // 分块避免 apply 参数过多导致栈溢出
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
