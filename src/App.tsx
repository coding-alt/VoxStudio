import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelSpeech,
  createSpeech,
  createVoice,
  deleteVoice,
  fetchVoices,
  playbackSpeech,
  streamSpeech,
  type SpeechParams,
  type VoicesInfo,
} from "./lib/api";
import { VoicePlayer } from "./lib/audio";
import { native, arrayBufferToBase64 } from "./lib/native";
import { pcm16ToFloat32, parseWav, encodeWav } from "./lib/wav";
import {
  DEFAULT_SETTINGS,
  clearAllAudio,
  loadHistory,
  loadSettings,
  newId,
  persistAudio,
  readPersistedAudio,
  removeAudio,
  saveHistory,
  saveSettings,
  type HistoryItem,
  type Settings,
} from "./lib/store";
import { ComposeView } from "./components/ComposeView";
import { VoiceLibrary } from "./components/VoiceLibrary";
import { HistoryView } from "./components/HistoryView";
import { SettingsView } from "./components/SettingsView";
import { CloneVoiceModal } from "./components/CloneVoiceModal";
import {
  IconWave,
  IconVoice,
  IconClock,
  IconGear,
  IconAlert,
  IconDownload,
  IconCheck,
} from "./components/Icons";

type View = "compose" | "voices" | "history" | "settings";

const PREVIEW_TEXT = "你好，这是我用这段声音为你朗读的示例。";
const DEFAULT_TEXT = "欢迎使用 VoxStudio。在 Apple Silicon 上，语音合成完全本地运行。";

const NAV: { key: View; label: string; Icon: typeof IconWave }[] = [
  { key: "compose", label: "语音合成", Icon: IconWave },
  { key: "voices", label: "音色库", Icon: IconVoice },
  { key: "history", label: "历史记录", Icon: IconClock },
  { key: "settings", label: "设置", Icon: IconGear },
];

interface ServerState {
  online: boolean;
  managed: boolean;
  message: string;
}

export default function App() {
  const [view, setView] = useState<View>("compose");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);

  const [voices, setVoices] = useState<VoicesInfo | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [server, setServer] = useState<ServerState | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  // 区分「正在启动」和「正在停止」：两者耗时差异很大（启动可能要等模型加载）
  const [serverAction, setServerAction] = useState<"start" | "stop" | null>(null);

  const [text, setText] = useState(DEFAULT_TEXT);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [samples, setSamples] = useState<Float32Array | null>(null);
  const [duration, setDuration] = useState(0);

  const [cloneOpen, setCloneOpen] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const playerRef = useRef<VoicePlayer | null>(null);
  if (!playerRef.current) playerRef.current = new VoicePlayer();
  const player = playerRef.current;

  const abortRef = useRef<AbortController | null>(null);
  const lastWavRef = useRef<ArrayBuffer | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  // ── 初始化 ───────────────────────────────────────────────
  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setSettingsReady(true);
    });
    void loadHistory().then(setHistory);
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    const id = window.setTimeout(() => void saveSettings(settings), 400);
    return () => window.clearTimeout(id);
  }, [settings, settingsReady]);

  useEffect(() => {
    player.setVolume(settings.volume);
  }, [player, settings.volume]);

  useEffect(() => () => player.dispose(), [player]);

  // ── 后端状态与音色列表 ───────────────────────────────────
  const refreshServer = useCallback(async () => {
    const st = await native.backendStatus(settings.baseUrl);
    setServer(st);
    return st;
  }, [settings.baseUrl]);

  const refreshVoices = useCallback(async () => {
    try {
      const v = await fetchVoices(settings.baseUrl);
      setVoices(v);
    } catch {
      // 服务离线时保持上一次的列表
    }
  }, [settings.baseUrl]);

  useEffect(() => {
    if (!settingsReady) return;
    void refreshServer();
    const id = window.setInterval(() => void refreshServer(), 5000);
    return () => window.clearInterval(id);
  }, [settingsReady, refreshServer]);

  useEffect(() => {
    if (!server?.online) return;
    void refreshVoices();
    const id = window.setInterval(() => void refreshVoices(), 30000);
    return () => window.clearInterval(id);
  }, [server?.online, refreshVoices]);

  // 流式生成过程中持续把最新采样同步进波形
  useEffect(() => {
    if (!generating) return;
    const id = window.setInterval(() => {
      setSamples(player.getSamples());
      setDuration(player.duration);
    }, 120);
    return () => window.clearInterval(id);
  }, [generating, player]);

  // ── 服务启停 ─────────────────────────────────────────────
  async function handleStartServer() {
    setServerBusy(true);
    setServerAction("start");
    setError(null);
    try {
      const st = await native.startBackend(settings.baseUrl, settings.serverBin);
      if (st) {
        setServer(st);
        if (st.online) {
          showToast("服务已启动");
          await refreshVoices();
        } else {
          setError(st.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setServerBusy(false);
      setServerAction(null);
    }
  }

  async function handleStopServer() {
    setServerBusy(true);
    setServerAction("stop");
    try {
      const msg = await native.stopBackend();
      showToast(msg ?? "已停止");
      await refreshServer();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setServerBusy(false);
      setServerAction(null);
    }
  }

  // ── 生成 ─────────────────────────────────────────────────
  const buildParams = useCallback(
    (input: string, voice: string): SpeechParams => ({
      input,
      voice,
      cfg_value: settings.cfgValue,
      inference_timesteps: settings.inferenceTimesteps,
      max_length: settings.maxLength,
      seed: settings.seed,
      normalize: settings.normalize,
      control_instruction: settings.controlInstruction.trim() || null,
    }),
    [settings],
  );

  const runGenerate = useCallback(
    async (opts: { input: string; voice: string; saveHistoryEntry: boolean }) => {
      if (generating) return;
      if (!server?.online) {
        setError("后端服务未连接，请先到「设置」中启动服务。");
        setView("settings");
        return;
      }

      setGenerating(true);
      setError(null);
      const controller = new AbortController();
      abortRef.current = controller;

      const params = buildParams(opts.input, opts.voice);
      let wav: ArrayBuffer | null = null;
      let rate = 48000;

      try {
        if (settings.streamingMode) {
          // 边生成边播：先按响应头里的采样率开流，再逐块喂给播放器
          await streamSpeech(
            settings.baseUrl,
            params,
            {
              onMeta: (sr) => {
                rate = sr;
                player.beginStream(sr);
                setSamples(new Float32Array(0));
                setDuration(0);
              },
              onChunk: (chunk) => player.append(pcm16ToFloat32(chunk)),
            },
            controller.signal,
          );
          player.finishStream();
          const s = player.getSamples();
          wav = encodeWav(s, rate);
          setSamples(s);
          setDuration(player.duration);
        } else {
          const { data } = await createSpeech(settings.baseUrl, params, controller.signal);
          const decoded = parseWav(data);
          rate = decoded.sampleRate;
          wav = data;
          setSamples(decoded.samples);
          setDuration(decoded.duration);
          player.play(decoded.samples, decoded.sampleRate);
        }

        lastWavRef.current = wav;

        if (opts.saveHistoryEntry && wav) {
          const id = newId();
          await persistAudio(id, wav);
          const item: HistoryItem = {
            id,
            text: opts.input,
            voice: opts.voice,
            createdAt: Date.now(),
            duration: player.duration,
            sampleRate: rate,
            streaming: settings.streamingMode,
            controlInstruction: settings.controlInstruction.trim() || undefined,
            cfgValue: settings.cfgValue,
            inferenceTimesteps: settings.inferenceTimesteps,
            seed: settings.seed,
          };
          setHistory((prev) => {
            const next = [item, ...prev].slice(0, 100);
            void saveHistory(next);
            return next;
          });
        } else {
          // 不写入历史
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          player.stop();
          showToast("已停止生成");
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setGenerating(false);
        abortRef.current = null;
      }
    },
    [generating, server?.online, settings, buildParams, player, showToast],
  );

  async function handleCancel() {
    abortRef.current?.abort();
    // 前端断连不会停止后端推理，显式通知服务端取消
    await cancelSpeech(settings.baseUrl);
  }

  async function handleServerPlay() {
    if (!server?.online) return;
    try {
      await playbackSpeech(settings.baseUrl, buildParams(text, settings.lastVoice));
      showToast("已提交到服务端播放");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── 音色 ─────────────────────────────────────────────────
  async function handlePreview(voice: string) {
    setPreviewing(voice);
    try {
      await runGenerate({ input: PREVIEW_TEXT, voice, saveHistoryEntry: false });
    } finally {
      setPreviewing(null);
    }
  }

  async function handleCreateVoice(payload: { name: string; referencePath: string; promptText: string }) {
    await createVoice(settings.baseUrl, {
      voice_name: payload.name,
      reference_wav_path: payload.referencePath,
      prompt_text: payload.promptText || null,
      replace: false,
    });
    await refreshVoices();
    setSettings((s) => ({ ...s, lastVoice: payload.name }));
    showToast(`音色「${payload.name}」已创建`);
  }

  async function handleDeleteVoice(name: string) {
    try {
      await deleteVoice(settings.baseUrl, name);
      await refreshVoices();
      if (settings.lastVoice === name) {
        setSettings((s) => ({ ...s, lastVoice: voices?.system_voices[0] ?? "af_bella" }));
      }
      showToast(`已删除「${name}」`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── 历史 ─────────────────────────────────────────────────
  async function handlePlayHistory(item: HistoryItem) {
    const buf = await readPersistedAudio(item.id);
    if (!buf) {
      setError("这段音频的文件已丢失，可能已被清理。");
      return;
    }
    const decoded = parseWav(buf);
    player.play(decoded.samples, decoded.sampleRate);
    setSamples(decoded.samples);
    setDuration(decoded.duration);
    setPlayingId(item.id);
    window.setTimeout(() => setPlayingId(null), 1200);
  }

  async function handleExportHistory(item: HistoryItem) {
    const buf = await readPersistedAudio(item.id);
    if (!buf) {
      setError("这段音频的文件已丢失。");
      return;
    }
    const dest = await native.exportAudio(`${item.voice}-${item.id}.wav`, arrayBufferToBase64(buf));
    if (dest) showToast("已导出");
  }

  async function handleExportCurrent() {
    if (!lastWavRef.current) return;
    const dest = await native.exportAudio("voxstudio.wav", arrayBufferToBase64(lastWavRef.current));
    if (dest) showToast("已导出");
  }

  async function handleDeleteHistory(item: HistoryItem) {
    await removeAudio(item.id);
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== item.id);
      void saveHistory(next);
      return next;
    });
  }

  async function handleClearHistory() {
    await clearAllAudio();
    setHistory([]);
    await saveHistory([]);
    showToast("历史已清空");
  }

  // ── 渲染 ─────────────────────────────────────────────────
  const patchSettings = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-drag" data-tauri-drag-region />
        <div className="sidebar-body">
          <div className="nav-section">
            {NAV.slice(0, 2).map(({ key, label, Icon }) => (
              <div
                key={key}
                className={`nav-item ${view === key ? "active" : ""}`}
                onClick={() => setView(key)}
              >
                <Icon className="nav-icon" />
                {label}
              </div>
            ))}
          </div>

          <div className="nav-section">
            {NAV.slice(2).map(({ key, label, Icon }) => (
              <div
                key={key}
                className={`nav-item ${view === key ? "active" : ""}`}
                onClick={() => setView(key)}
              >
                <Icon className="nav-icon" />
                {label}
                {key === "history" && history.length > 0 && (
                  <span className="nav-badge">{history.length}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="status-card">
            <div className="status-row">
              <span className={`dot ${server?.online ? (generating ? "busy" : "online") : "offline"}`} />
              {server?.online ? (generating ? "正在合成…" : "服务已连接") : "服务未连接"}
            </div>
            <div className="status-detail">{server?.message ?? "正在检测…"}</div>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="titlebar" data-tauri-drag-region>
          <span className="titlebar-title">
            {NAV.find((n) => n.key === view)?.label ?? "VoxStudio"}
          </span>
          <div className="titlebar-actions">
            {lastWavRef.current && !generating && (
              <button className="btn btn-secondary" onClick={handleExportCurrent}>
                <IconDownload size={14} />
                导出当前
              </button>
            )}
          </div>
        </div>

        <div className="content">
          {error && (
            <div className="banner banner-error">
              <IconAlert size={15} />
              <span>{error}</span>
              <button className="btn btn-icon" style={{ marginLeft: "auto" }} onClick={() => setError(null)}>
                ✕
              </button>
            </div>
          )}

          {view === "compose" && (
            <ComposeView
              text={text}
              onTextChange={setText}
              voice={settings.lastVoice}
              settings={settings}
              onSettingsChange={patchSettings}
              generating={generating}
              onGenerate={() =>
                void runGenerate({ input: text, voice: settings.lastVoice, saveHistoryEntry: true })
              }
              onCancel={() => void handleCancel()}
              player={player}
              samples={samples}
              duration={duration}
              volume={settings.volume}
              onVolumeChange={(v) => patchSettings({ volume: v })}
              onSeek={(sec) => player.seek(sec)}
              onServerPlay={() => void handleServerPlay()}
              onOpenVoices={() => setView("voices")}
            />
          )}

          {view === "voices" && (
            <VoiceLibrary
              voices={voices}
              selected={settings.lastVoice}
              onSelect={(name) => {
                patchSettings({ lastVoice: name });
                showToast(`已切换到「${name}」`);
              }}
              onPreview={(name) => void handlePreview(name)}
              onDelete={(name) => void handleDeleteVoice(name)}
              onCreateFromFile={() => setCloneOpen(true)}
              onCreateByRecord={() => setCloneOpen(true)}
              previewing={previewing}
              busy={generating}
            />
          )}

          {view === "history" && (
            <HistoryView
              items={history}
              onPlay={(item) => void handlePlayHistory(item)}
              onExport={(item) => void handleExportHistory(item)}
              onDelete={(item) => void handleDeleteHistory(item)}
              onClear={() => void handleClearHistory()}
              playingId={playingId}
            />
          )}

          {view === "settings" && (
            <SettingsView
              settings={settings}
              onChange={patchSettings}
              onTestConnection={() => void refreshServer()}
              onStartServer={() => void handleStartServer()}
              onStopServer={() => void handleStopServer()}
              serverState={server}
              serverBusy={serverBusy}
              serverAction={serverAction}
            />
          )}
        </div>
      </main>

      <CloneVoiceModal
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        onCreate={handleCreateVoice}
        existingNames={voices?.custom_voices ?? []}
      />

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(28,28,30,0.92)",
            color: "#fff",
            padding: "9px 18px",
            borderRadius: 980,
            fontSize: 12.5,
            fontWeight: 500,
            boxShadow: "0 6px 24px rgba(0,0,0,0.28)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            gap: 7,
            backdropFilter: "blur(12px)",
          }}
        >
          <IconCheck size={13} />
          {toast}
        </div>
      )}
    </div>
  );
}
