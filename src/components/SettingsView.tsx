import { useState, useEffect } from "react";
import type { Settings } from "../lib/store";
import { native } from "../lib/native";
import { voiceMeta } from "./ComposeView";
import { IconGear, IconFolder, IconAlert, IconCheck } from "./Icons";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onTestConnection: () => void;
  onStartServer: () => void;
  onStopServer: () => void;
  serverState: { online: boolean; managed: boolean; message: string } | null;
  serverBusy: boolean;
  serverAction: "start" | "stop" | null;
}

export function SettingsView({
  settings,
  onChange,
  onTestConnection,
  onStartServer,
  onStopServer,
  serverState,
  serverBusy,
  serverAction,
}: Props) {
  const [storage, setStorage] = useState<string>("");
  const [binPath, setBinPath] = useState(settings.serverBin);

  useEffect(() => setBinPath(settings.serverBin), [settings.serverBin]);

  useEffect(() => {
    if (!native.storagePath) return;
    native.storagePath().then((p) => setStorage(p ?? ""));
  }, []);

  const commitBin = () => onChange({ serverBin: binPath.trim() });

  // 启停期间不要显示红色的「未连接」，否则容易让人以为卡死或出错
  const statusLabel = (() => {
    if (serverAction === "start") return "正在启动服务…";
    if (serverAction === "stop") return "正在停止服务…";
    return serverState?.online ? "服务已连接" : "服务未连接";
  })();

  return (
    <div style={{ maxWidth: 620 }}>
      <div className="section-head">
        <IconGear size={16} />
        <span className="section-title">后端服务</span>
      </div>

      <div className="card">
        <div className="card-title">连接状态</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span
            className={`dot ${serverBusy ? "busy" : serverState?.online ? "online" : "offline"}`}
          />
          <span style={{ fontSize: 13, fontWeight: 500 }}>{statusLabel}</span>
          <span className="text-sm">{serverBusy ? "请稍候" : serverState?.message}</span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-secondary" onClick={onTestConnection}>
            重新检测
          </button>

          {(() => {
            // 主操作按钮：同一位置根据状态切换文案与样式
            if (serverBusy) {
              const label = serverAction === "stop" ? "停止中…" : "启动中…";
              return (
                <button className="btn btn-primary" disabled>
                  <span className="spinner" />
                  {label}
                </button>
              );
            }
            if (serverState?.online) {
              // 只有由 VoxStudio 拉起的进程才能被这里停止；
              // 外部服务（managed=false）显示置灰，提示用户去原终端结束
              if (!serverState.managed) {
                return (
                  <button className="btn btn-secondary" disabled title="外部启动的服务，请在原终端中结束">
                    停止服务
                  </button>
                );
              }
              return (
                <button className="btn btn-danger" onClick={onStopServer}>
                  停止服务
                </button>
              );
            }
            return (
              <button className="btn btn-primary" onClick={onStartServer}>
                启动服务
              </button>
            );
          })()}
        </div>
        <div className="param-hint" style={{ marginTop: 9 }}>
          {serverAction === "start"
            ? "首次启动需要加载模型，可能要等几十秒到数分钟，期间请保持窗口打开。"
            : "只有在 VoxStudio 内启动的服务才能被这里停止；外部终端启动的服务需在其终端中结束。"}
        </div>
      </div>

      <div className="card">
        <label className="field-label">服务地址</label>
        <input
          className="input"
          value={settings.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value.trim() })}
          placeholder="http://localhost:8000"
        />

        <label className="field-label" style={{ marginTop: 14 }}>
          可执行文件位置
        </label>
        <div className="path-field">
          <input
            className="input"
            value={binPath}
            onChange={(e) => setBinPath(e.target.value)}
            onBlur={commitBin}
            placeholder="/Users/.../voxcpmane2-server"
          />
          <button className="btn btn-secondary" onClick={commitBin}>
            {binPath === settings.serverBin ? <IconCheck size={14} /> : "应用"}
          </button>
        </div>
        <div className="param-hint">
          用 <code style={{ fontFamily: "var(--font-mono)" }}>uv tool install voxcpmane2</code> 安装后，
          默认位于 ~/.local/bin/voxcpmane2-server。若安装在别处，请在此指定完整路径。
        </div>
      </div>

      <div className="section-head">
        <span className="section-title">默认参数</span>
      </div>

      <div className="card">
        <div className="row-2">
          <div>
            <label className="field-label">CFG 引导强度</label>
            <input
              className="input"
              type="number"
              step={0.1}
              min={1}
              max={4}
              value={settings.cfgValue}
              onChange={(e) => onChange({ cfgValue: clamp(Number(e.target.value), 1, 4) })}
            />
          </div>
          <div>
            <label className="field-label">推理步数</label>
            <input
              className="input"
              type="number"
              step={1}
              min={4}
              max={30}
              value={settings.inferenceTimesteps}
              onChange={(e) => onChange({ inferenceTimesteps: clamp(Math.round(Number(e.target.value)), 4, 30) })}
            />
          </div>
        </div>

        <div className="row-2" style={{ marginTop: 14 }}>
          <div>
            <label className="field-label">最大长度</label>
            <input
              className="input"
              type="number"
              step={128}
              min={256}
              max={8192}
              value={settings.maxLength}
              onChange={(e) => onChange({ maxLength: clamp(Math.round(Number(e.target.value)), 256, 8192) })}
            />
          </div>
          <div>
            <label className="field-label">默认音色</label>
            <div className="input" style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span
                className="voice-avatar"
                style={{ background: voiceMeta(settings.lastVoice).color, width: 20, height: 20, fontSize: 10 }}
              >
                {voiceMeta(settings.lastVoice).display.charAt(0).toUpperCase()}
              </span>
              {voiceMeta(settings.lastVoice).display}
            </div>
          </div>
        </div>

        <div className="param-hint" style={{ marginTop: 12 }}>
          最大长度限制单次生成的 token 上限，长文本建议分段合成。
        </div>
      </div>

      <div className="section-head">
        <span className="section-title">数据存储</span>
      </div>

      <div className="card">
        <label className="field-label">应用数据目录</label>
        <div className="path-field">
          <input className="input" value={storage || "（仅 Tauri 环境可用）"} readOnly />
          <button
            className="btn btn-secondary"
            onClick={() => storage && native.revealInFinder(storage)}
            disabled={!storage}
          >
            <IconFolder size={14} />
            访达
          </button>
        </div>
        <div className="param-hint">
          历史音频、克隆样本与应用设置都保存在这里。
        </div>
      </div>

      <div className="banner banner-info">
        <IconAlert size={15} />
        <span>
          VoxStudio 是本地工具：所有文本与音频都只在本机与本地后端之间流转，不会上传到任何服务器。
        </span>
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}
