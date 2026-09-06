/** 历史记录与设置的持久化。Tauri 下落在应用数据目录，浏览器中降级到 localStorage。 */
import { native, inTauri, base64ToUint8Array, arrayBufferToBase64 } from "./native";
import { DEFAULT_BASE_URL } from "./api";

export interface HistoryItem {
  id: string;
  text: string;
  voice: string;
  createdAt: number;
  duration: number;
  sampleRate: number;
  streaming: boolean;
  controlInstruction?: string;
  cfgValue?: number;
  inferenceTimesteps?: number;
  seed?: number | null;
}

export interface Settings {
  baseUrl: string;
  serverBin: string;
  cfgValue: number;
  inferenceTimesteps: number;
  maxLength: number;
  seed: number | null;
  normalize: boolean;
  controlInstruction: string;
  volume: number;
  streamingMode: boolean;
  lastVoice: string;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: DEFAULT_BASE_URL,
  serverBin: "/Users/kavin/.local/bin/voxcpmane2-server",
  cfgValue: 2.0,
  inferenceTimesteps: 10,
  maxLength: 2048,
  seed: null,
  normalize: false,
  controlInstruction: "",
  volume: 0.9,
  streamingMode: true,
  lastVoice: "af_bella",
};

const HISTORY_LIMIT = 100;

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {
    // 隐私模式或配额已满，忽略
  }
}

export async function loadSettings(): Promise<Settings> {
  if (inTauri()) {
    const raw = await native.readJson("settings.json");
    if (raw) {
      try {
        return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
      } catch {
        // 文件损坏则回退默认值
      }
    }
    // 首次运行：把探测到的默认可执行文件路径写进去
    const bin = await native.defaultServerBin();
    if (bin) return { ...DEFAULT_SETTINGS, serverBin: bin };
    return { ...DEFAULT_SETTINGS };
  }
  const raw = lsGet("voxstudio.settings");
  return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(s: Settings): Promise<void> {
  if (inTauri()) {
    await native.writeJson("settings.json", JSON.stringify(s));
    return;
  }
  lsSet("voxstudio.settings", JSON.stringify(s));
}

export async function loadHistory(): Promise<HistoryItem[]> {
  let raw: string | null = null;
  if (inTauri()) raw = await native.readJson("history.json");
  else raw = lsGet("voxstudio.history");
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as HistoryItem[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveHistory(list: HistoryItem[]): Promise<void> {
  const trimmed = list.slice(0, HISTORY_LIMIT);
  if (inTauri()) await native.writeJson("history.json", JSON.stringify(trimmed));
  else lsSet("voxstudio.history", JSON.stringify(trimmed));
}

/** 保存音频数据。Tauri 下存为真实 wav 文件，浏览器下转 base64 存内存。 */
export async function persistAudio(id: string, wav: ArrayBuffer): Promise<void> {
  if (inTauri()) {
    await native.saveAudio(id, arrayBufferToBase64(wav));
    return;
  }
  lsSet(`voxstudio.audio.${id}`, arrayBufferToBase64(wav));
}

export async function readPersistedAudio(id: string): Promise<ArrayBuffer | null> {
  if (inTauri()) {
    const b64 = await native.readAudio(id);
    if (!b64) return null;
    const bytes = base64ToUint8Array(b64);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  const b64 = lsGet(`voxstudio.audio.${id}`);
  if (!b64) return null;
  const bytes = base64ToUint8Array(b64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function removeAudio(id: string): Promise<void> {
  if (inTauri()) {
    await native.deleteAudio(id);
    return;
  }
  try {
    localStorage.removeItem(`voxstudio.audio.${id}`);
  } catch {
    // 忽略
  }
}

export async function clearAllAudio(): Promise<void> {
  if (inTauri()) {
    await native.clearAudioDir();
    return;
  }
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("voxstudio.audio."));
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // 忽略
  }
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
