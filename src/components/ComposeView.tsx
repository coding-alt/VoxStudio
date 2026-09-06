import type { Settings } from "../lib/store";
import type { VoicePlayer } from "../lib/audio";
import { Player } from "./Player";
import { IconWave, IconPlus, IconStop } from "./Icons";

export interface VoiceMetaInfo {
  label: string;
  display: string;
  color: string;
}

/** 把后端的音色标识本地化：af_bella → Bella（美音·女声） */
export function voiceMeta(name: string): VoiceMetaInfo {
  const prefix = name.slice(0, 3).toLowerCase();
  const table: Record<string, { label: string; color: string }> = {
    af_: { label: "美音 · 女声", color: "#af52de" },
    am_: { label: "美音 · 男声", color: "#007aff" },
    bf_: { label: "英音 · 女声", color: "#32ade6" },
    bm_: { label: "英音 · 男声", color: "#34c759" },
  };
  const hit = table[prefix];
  if (hit) {
    const raw = name.slice(3);
    return {
      label: hit.label,
      display: raw.charAt(0).toUpperCase() + raw.slice(1),
      color: hit.color,
    };
  }
  return { label: "自定义克隆", display: name, color: "#ff9500" };
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
}

export function ParamSlider({ label, value, min, max, step, onChange, format, hint }: SliderProps) {
  return (
    <div className="param-row">
      <div className="param-head">
        <span className="param-name">{label}</span>
        <span className="param-value">{format ? format(value) : value}</span>
      </div>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="param-hint">{hint}</div>}
    </div>
  );
}

interface Props {
  text: string;
  onTextChange: (t: string) => void;
  voice: string;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  generating: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  player: VoicePlayer;
  samples: Float32Array | null;
  duration: number;
  volume: number;
  onVolumeChange: (v: number) => void;
  onSeek: (sec: number) => void;
  onServerPlay: () => void;
  onOpenVoices: () => void;
}

const SOFT_LIMIT = 500;

export function ComposeView({
  text,
  onTextChange,
  voice,
  settings,
  onSettingsChange,
  generating,
  onGenerate,
  onCancel,
  player,
  samples,
  duration,
  volume,
  onVolumeChange,
  onSeek,
  onServerPlay,
  onOpenVoices,
}: Props) {
  const chars = [...text].length;
  const over = chars > SOFT_LIMIT;
  const meta = voiceMeta(voice);

  return (
    <div className="compose-grid">
      <div>
        <div className="card">
          <div className="card-title">
            <IconWave size={15} />
            合成文本
          </div>
          <textarea
            className="textarea"
            value={text}
            placeholder="输入想要朗读的文本……&#10;&#10;可以配合「语气控制」使用，例如让数字、英文读得更自然。"
            onChange={(e) => onTextChange(e.target.value)}
            spellCheck={false}
          />
          <div className="text-toolbar">
            <button className="btn btn-secondary" onClick={() => onTextChange("")} disabled={!text}>
              清空
            </button>
            <span className={`char-count ${over ? "over" : chars > SOFT_LIMIT * 0.8 ? "warn" : ""}`}>
              {chars} 字{over ? " · 较长，生成会变慢" : ""}
            </span>
          </div>
        </div>

        <Player
          player={player}
          samples={samples}
          duration={duration}
          live={generating}
          volume={volume}
          onVolumeChange={onVolumeChange}
          onSeek={onSeek}
          onServerPlay={onServerPlay}
        />

        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          {generating ? (
            <button className="btn btn-secondary btn-large" onClick={onCancel}>
              <IconStop size={13} />
              停止生成
            </button>
          ) : (
            <button className="btn btn-primary btn-large" onClick={onGenerate} disabled={!text.trim()}>
              生成语音
            </button>
          )}
          {generating && (
            <span className="text-sm" style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span className="spinner" />
              正在合成，{settings.streamingMode ? "边生成边播放" : "请稍候"}…
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="card">
          <div className="card-title">当前音色</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              className="voice-avatar"
              style={{ background: meta.color, width: 36, height: 36, fontSize: 14 }}
            >
              {meta.display.charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="voice-name">{meta.display}</div>
              <div className="voice-tag">{meta.label}</div>
            </div>
          </div>
          <button
            className="btn btn-secondary"
            style={{ width: "100%", marginTop: 12 }}
            onClick={onOpenVoices}
          >
            切换音色
          </button>
        </div>

        <div className="card">
          <div className="card-title">语气控制</div>
          <input
            className="input"
            value={settings.controlInstruction}
            placeholder="例如：用开心兴奋的语气说 / 语速慢一点，语气温柔"
            onChange={(e) => onSettingsChange({ controlInstruction: e.target.value })}
          />
          <div className="param-hint">
            自然语言描述希望的表达方式，留空则由模型自行判断。
          </div>
        </div>

        <div className="card">
          <div className="card-title">生成参数</div>

          <ParamSlider
            label="CFG 引导强度"
            value={settings.cfgValue}
            min={1}
            max={4}
            step={0.1}
            onChange={(v) => onSettingsChange({ cfgValue: v })}
            format={(v) => v.toFixed(1)}
            hint="值越高越贴近参考音色的特质，过高可能导致发音不稳。默认 2.0。"
          />

          <ParamSlider
            label="推理步数"
            value={settings.inferenceTimesteps}
            min={4}
            max={30}
            step={1}
            onChange={(v) => onSettingsChange({ inferenceTimesteps: v })}
            format={(v) => `${v} 步`}
            hint="步数越多音质越细腻，但耗时更长。默认 10。"
          />

          <div className="param-row">
            <div className="param-head">
              <span className="param-name">随机种子</span>
              <span className="param-value">{settings.seed === null ? "随机" : settings.seed}</span>
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <input
                className="input"
                type="number"
                placeholder="留空则每次随机"
                value={settings.seed ?? ""}
                onChange={(e) =>
                  onSettingsChange({ seed: e.target.value === "" ? null : Number(e.target.value) })
                }
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-secondary"
                onClick={() => onSettingsChange({ seed: Math.floor(Math.random() * 1000000) })}
                title="随机一个种子"
              >
                <IconPlus size={14} />
              </button>
            </div>
            <div className="param-hint">固定种子可复现同一段语音，便于对比参数效果。</div>
          </div>

          <div className="divider" />

          <div className="toggle-row">
            <div>
              <div className="param-name">文本归一化</div>
              <div className="param-hint" style={{ marginTop: 2 }}>
                开启后数字、符号会先转写成读法
              </div>
            </div>
            <button
              className={`switch ${settings.normalize ? "on" : ""}`}
              onClick={() => onSettingsChange({ normalize: !settings.normalize })}
              aria-label="文本归一化"
            />
          </div>

          <div className="toggle-row">
            <div>
              <div className="param-name">流式生成</div>
              <div className="param-hint" style={{ marginTop: 2 }}>
                边生成边播放，无需等待整段完成
              </div>
            </div>
            <button
              className={`switch ${settings.streamingMode ? "on" : ""}`}
              onClick={() => onSettingsChange({ streamingMode: !settings.streamingMode })}
              aria-label="流式生成"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
