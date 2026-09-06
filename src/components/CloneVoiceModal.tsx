import { useEffect, useRef, useState } from "react";
import { native, arrayBufferToBase64 } from "../lib/native";
import { encodeWav, resample } from "../lib/wav";
import { IconMic, IconStop, IconPlay, IconFolder, IconCheck, IconAlert } from "./Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: { name: string; referencePath: string; promptText: string }) => Promise<void>;
  existingNames: string[];
}

/** 参考音频统一到 16kHz —— 与主流 TTS 参考音频输入一致 */
const TARGET_RATE = 16000;

type SourceMode = "file" | "record";

export function CloneVoiceModal({ open, onClose, onCreate, existingNames }: Props) {
  const [mode, setMode] = useState<SourceMode>("file");
  const [name, setName] = useState("");
  const [promptText, setPromptText] = useState("");
  const [refPath, setRefPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedWav, setRecordedWav] = useState<ArrayBuffer | null>(null);

  const recRef = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    processor: ScriptProcessorNode;
    source: MediaStreamAudioSourceNode;
    chunks: Float32Array[];
    rate: number;
  } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) reset();
    return () => {
      if (recRef.current) stopRecorder();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function reset() {
    if (recRef.current) stopRecorder();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setName("");
    setPromptText("");
    setRefPath("");
    setError(null);
    setBusy(false);
    setRecording(false);
    setRecordSecs(0);
    setLevel(0);
    setRecordedUrl(null);
    setRecordedWav(null);
    setMode("file");
  }

  // ── 从文件导入 ──────────────────────────────────────────
  async function pickFile() {
    setError(null);
    setBusy(true);
    try {
      const src = await native.pickAudioFile();
      if (!src) return;
      const dest = await native.importReference(src);
      if (!dest) {
        setError("无法读取所选文件，请确认已授予访问权限。");
        return;
      }
      setRefPath(dest);
      if (!name) {
        const base = src.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
        setName(sanitizeName(base).slice(0, 24));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── 录音 ────────────────────────────────────────────────
  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      // 优先直接以 16kHz 打开，失败再降级后重采样
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ sampleRate: TARGET_RATE });
      } catch {
        ctx = new AudioContext();
      }
      await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      const chunks: Float32Array[] = [];

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
        let peak = 0;
        for (let i = 0; i < input.length; i++) {
          const v = Math.abs(input[i]);
          if (v > peak) peak = v;
        }
        setLevel(peak);
      };

      source.connect(processor);
      // ScriptProcessor 必须连到 destination 才会被驱动
      processor.connect(ctx.destination);

      recRef.current = { stream, ctx, processor, source, chunks, rate: ctx.sampleRate };
      setRecording(true);
      setRecordSecs(0);
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
      setRecordedWav(null);
    } catch (e) {
      setError(
        `无法访问麦克风：${e instanceof Error ? e.message : String(e)}。请到「系统设置 ▸ 隐私与安全性 ▸ 麦克风」中允许本应用。`,
      );
    }
  }

  function stopRecorder() {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.source.disconnect();
      rec.processor.disconnect();
      rec.stream.getTracks().forEach((t) => t.stop());
      void rec.ctx.close();
    } catch {
      // 忽略关闭时的异常
    }
    recRef.current = null;
  }

  function stopRecording() {
    const rec = recRef.current;
    if (!rec) return;

    const total = rec.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of rec.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const finalSamples = resample(merged, rec.rate, TARGET_RATE);
    const wav = encodeWav(finalSamples, TARGET_RATE);

    stopRecorder();
    setRecording(false);
    setLevel(0);
    setRecordedWav(wav);

    const blob = new Blob([wav], { type: "audio/wav" });
    setRecordedUrl(URL.createObjectURL(blob));
  }

  async function useRecording() {
    if (!recordedWav) return;
    setBusy(true);
    setError(null);
    try {
      const id = `ref-${Date.now().toString(36)}`;
      const dest = await native.saveReference(id, arrayBufferToBase64(recordedWav));
      if (!dest) {
        setError("保存录音失败。");
        return;
      }
      setRefPath(dest);
      if (!name) setName("my_voice");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // 录音计时
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setRecordSecs((s) => s + 0.1), 100);
    return () => window.clearInterval(id);
  }, [recording]);

  // ── 提交 ────────────────────────────────────────────────
  // 允许中英文与常见字符；仅禁止文件系统非法字符与控制字符（后端可能以 name 作目录名）。
  const ILLEGAL_NAME = /[/\\:*?"<>|\u0000-\u001f\u007f]/;
  const nameInvalid =
    name.length > 0 &&
    (ILLEGAL_NAME.test(name) || name.length > 40 || name !== name.trim());
  const nameTooLong = name.length > 40;
  const nameHasSpace = name.length > 0 && name !== name.trim();
  const nameTaken = existingNames.includes(name);
  const canSubmit = refPath !== "" && name.length > 0 && !nameInvalid && !nameTaken && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name, referencePath: refPath, promptText: promptText.trim() });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">创建克隆音色</div>
        <div className="modal-desc">
          用一段清晰的人声样本创建专属音色。样本建议 3–10 秒、单一说话人、无背景音乐。
        </div>

        <div className="segmented" style={{ marginBottom: 15 }}>
          <button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>
            选择音频文件
          </button>
          <button className={mode === "record" ? "active" : ""} onClick={() => setMode("record")}>
            麦克风录制
          </button>
        </div>

        {mode === "file" ? (
          <div className="form-row">
            <label className="field-label">参考音频</label>
            <div className="path-field">
              <input className="input" value={refPath} placeholder="未选择" readOnly />
              <button className="btn btn-secondary" onClick={pickFile} disabled={busy}>
                <IconFolder size={14} />
                选择
              </button>
            </div>
            <div className="param-hint">
              支持 wav / mp3 / m4a / flac。文件会被复制到应用数据目录，避免原文件移动后音色失效。
            </div>
          </div>
        ) : (
          <div className="form-row">
            <label className="field-label">录制样本</label>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className={recording ? "btn btn-secondary" : "btn btn-primary"}
                onClick={recording ? stopRecording : startRecording}
                disabled={busy}
              >
                {recording ? <IconStop size={13} /> : <IconMic size={14} />}
                {recording ? "停止录制" : recordedWav ? "重新录制" : "开始录制"}
              </button>

              <div
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: "var(--bg-inset)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, level * 140)}%`,
                    background: recording ? "var(--accent)" : "var(--text-tertiary)",
                    borderRadius: 3,
                    transition: "width 0.08s linear",
                  }}
                />
              </div>

              <span className="time" style={{ minWidth: 44 }}>
                {recordSecs.toFixed(1)}s
              </span>
            </div>

            {recordedUrl && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <audio ref={audioRef} src={recordedUrl} controls style={{ flex: 1, height: 30 }} />
                <button
                  className="btn btn-secondary"
                  onClick={useRecording}
                  disabled={busy || refPath !== ""}
                >
                  {refPath && recordedWav ? <IconCheck size={14} /> : <IconPlay size={13} />}
                  {refPath && recordedWav ? "已采用" : "采用这段"}
                </button>
              </div>
            )}

            <div className="param-hint">
              {refPath && mode === "record"
                ? "录音已保存到应用数据目录，可直接用于创建音色。"
                : "录制完成后需点击「采用这段」才会用于创建音色。"}
            </div>
          </div>
        )}

        <div className="form-row" style={{ marginTop: 14 }}>
          <label className="field-label">音色名称</label>
          <input
            className="input"
            value={name}
            placeholder="例如 我的声音"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="param-hint" style={{ color: nameInvalid || nameTaken ? "var(--danger)" : undefined }}>
            {nameInvalid ? (
              nameTooLong ? (
                "名称不能超过 40 个字符"
              ) : nameHasSpace ? (
                "首尾不能包含空格"
              ) : (
                "不能包含 / \\ : * ? \" < > | 等字符"
              )
            ) : nameTaken ? (
              "该名称已存在"
            ) : (
              "支持中英文，最长 40 字，将作为音色的唯一标识"
            )}
          </div>
        </div>

        <div className="form-row">
          <label className="field-label">参考文本（可选）</label>
          <input
            className="input"
            value={promptText}
            placeholder="样本里说的这句话，填写后克隆更准"
            onChange={(e) => setPromptText(e.target.value)}
          />
        </div>

        {error && (
          <div className="banner banner-error" style={{ marginTop: 12, marginBottom: 0 }}>
            <IconAlert size={15} />
            <span>{error}</span>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
            {busy ? <span className="spinner" /> : <IconCheck size={14} />}
            创建音色
          </button>
        </div>
      </div>
    </div>
  );
}

function sanitizeName(s: string): string {
  // 仅替换文件系统非法字符，保留中文等合法字符
  return s.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, "_").trim();
}
