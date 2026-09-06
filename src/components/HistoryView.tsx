import type { HistoryItem } from "../lib/store";
import { voiceMeta } from "./ComposeView";
import { IconClock, IconPlay, IconDownload, IconTrash } from "./Icons";

interface Props {
  items: HistoryItem[];
  onPlay: (item: HistoryItem) => void;
  onExport: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
  onClear: () => void;
  playingId: string | null;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  if (sameDay) return `今天 ${hm}`;
  const y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function HistoryView({ items, onPlay, onExport, onDelete, onClear, playingId }: Props) {
  return (
    <div>
      <div className="section-head">
        <IconClock size={16} />
        <span className="section-title">生成历史</span>
        <span className="section-count">{items.length} 条</span>
        {items.length > 0 && (
          <button className="btn btn-danger" onClick={onClear}>
            <IconTrash size={14} />
            清空
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="empty-icon">
              <IconClock size={34} />
            </div>
            <div className="empty-title">还没有生成记录</div>
            <div className="empty-desc">
              合成的语音会自动保存在这里，
              <br />
              可以随时回放或导出为 wav 文件。
            </div>
          </div>
        </div>
      ) : (
        items.map((item) => {
          const meta = voiceMeta(item.voice);
          const playing = playingId === item.id;
          return (
            <div className="history-item" key={item.id}>
              <div
                className="voice-avatar"
                style={{ background: meta.color, width: 32, height: 32, flexShrink: 0 }}
              >
                {meta.display.charAt(0).toUpperCase()}
              </div>

              <div className="history-main">
                <div className="history-text">{item.text}</div>
                <div className="history-sub">
                  <span>{meta.display}</span>
                  <span>·</span>
                  <span>{fmtDate(item.createdAt)}</span>
                  <span>·</span>
                  <span>{item.duration.toFixed(1)}s</span>
                  {item.streaming && (
                    <>
                      <span>·</span>
                      <span>流式</span>
                    </>
                  )}
                </div>
              </div>

              <div className="history-actions">
                <button className="btn btn-icon" onClick={() => onPlay(item)} title="播放">
                  {playing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <IconPlay size={13} />}
                </button>
                <button className="btn btn-icon" onClick={() => onExport(item)} title="导出为 wav">
                  <IconDownload size={14} />
                </button>
                <button className="btn btn-icon" onClick={() => onDelete(item)} title="删除">
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
