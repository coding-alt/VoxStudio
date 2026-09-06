import type { VoicesInfo } from "../lib/api";
import { voiceMeta } from "./ComposeView";
import { IconVoice, IconPlay, IconTrash, IconPlus, IconMic } from "./Icons";

interface Props {
  voices: VoicesInfo | null;
  selected: string;
  onSelect: (name: string) => void;
  onPreview: (name: string) => void;
  onDelete: (name: string) => void;
  onCreateFromFile: () => void;
  onCreateByRecord: () => void;
  previewing: string | null;
  busy: boolean;
}

function VoiceCard({
  name,
  custom,
  selected,
  previewing,
  onSelect,
  onPreview,
  onDelete,
}: {
  name: string;
  custom: boolean;
  selected: boolean;
  previewing: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onDelete?: () => void;
}) {
  const meta = voiceMeta(name);

  return (
    <div className={`voice-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      {custom && <span className="badge-custom">克隆</span>}
      <div className="voice-top">
        <div className="voice-avatar" style={{ background: meta.color }}>
          {meta.display.charAt(0).toUpperCase()}
        </div>
        <div className="voice-meta">
          <div className="voice-name">{meta.display}</div>
          <div className="voice-tag">{meta.label}</div>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            className="btn btn-icon voice-action"
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            title="试听"
            style={{ width: 26, height: 26 }}
          >
            {previewing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <IconPlay size={12} />}
          </button>
          {custom && onDelete && (
            <button
              className="btn btn-icon voice-action"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="删除音色"
              style={{ width: 26, height: 26 }}
            >
              <IconTrash size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="voice-wave" style={{ color: meta.color }}>
        {Array.from({ length: 22 }).map((_, i) => (
          <span
            key={i}
            style={{
              height: `${20 + Math.abs(Math.sin(i * 1.7 + name.length)) * 78}%`,
              opacity: selected ? 1 : 0.62,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function VoiceLibrary({
  voices,
  selected,
  onSelect,
  onPreview,
  onDelete,
  onCreateFromFile,
  onCreateByRecord,
  previewing,
  busy,
}: Props) {
  const custom = voices?.custom_voices ?? [];
  const system = voices?.system_voices ?? [];

  return (
    <div>
      <div className="section-head">
        <IconVoice size={16} />
        <span className="section-title">我的克隆音色</span>
        <span className="section-count">{custom.length}</span>
        <div style={{ display: "flex", gap: 7 }}>
          <button className="btn btn-secondary" onClick={onCreateByRecord} disabled={busy}>
            <IconMic size={14} />
            录制样本
          </button>
          <button className="btn btn-primary" onClick={onCreateFromFile} disabled={busy}>
            <IconPlus size={14} />
            从音频创建
          </button>
        </div>
      </div>

      {custom.length === 0 ? (
        <div className="card">
          <div className="empty" style={{ padding: "30px 20px" }}>
            <div className="empty-title">还没有克隆音色</div>
            <div className="empty-desc">
              提供一段 3–10 秒的清晰人声，即可创建一个专属音色。
              <br />
              建议：安静环境、单一说话人、无背景音乐。
            </div>
          </div>
        </div>
      ) : (
        <div className="voice-grid">
          {custom.map((v) => (
            <VoiceCard
              key={v}
              name={v}
              custom
              selected={selected === v}
              previewing={previewing === v}
              onSelect={() => onSelect(v)}
              onPreview={() => onPreview(v)}
              onDelete={() => onDelete(v)}
            />
          ))}
        </div>
      )}

      <div className="section-head">
        <span className="section-title">内置音色</span>
        <span className="section-count">{system.length}</span>
      </div>

      <div className="voice-grid">
        {system.map((v) => (
          <VoiceCard
            key={v}
            name={v}
            custom={false}
            selected={selected === v}
            previewing={previewing === v}
            onSelect={() => onSelect(v)}
            onPreview={() => onPreview(v)}
          />
        ))}
      </div>
    </div>
  );
}
