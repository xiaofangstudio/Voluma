import { IconChevronLeft, IconChevronRight, IconClose, IconPause, IconPlay, IconStop } from "./Icons";
import type { TtsStatus } from "../lib/tts";

type Props = {
  open: boolean;
  status: TtsStatus;
  page: number;
  totalPages: number;
  segment: number;
  segmentCount: number;
  text: string;
  message: string;
  voices: SpeechSynthesisVoice[];
  voiceName: string;
  rate: number;
  onPlayPause: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onVoice: (name: string) => void;
  onRate: (rate: number) => void;
  onClose: () => void;
};

function statusLabel(status: TtsStatus): string {
  if (status === "speaking") return "正在朗读";
  if (status === "paused") return "已暂停";
  if (status === "loading") return "准备中";
  if (status === "done") return "已读完";
  if (status === "error") return "朗读失败";
  return "未开始";
}

function voiceLabel(voice: SpeechSynthesisVoice): string {
  return voice.name
    .replace(/^Microsoft /, "")
    .replace(/\s*-\s*Chinese.*$/i, "")
    .replace(/\s*-\s*English.*$/i, "");
}

export default function TtsBar({
  open,
  status,
  page,
  totalPages,
  segment,
  segmentCount,
  text,
  message,
  voices,
  voiceName,
  rate,
  onPlayPause,
  onStop,
  onPrev,
  onNext,
  onVoice,
  onRate,
  onClose,
}: Props) {
  if (!open) return null;

  const playing = status === "speaking";
  const paused = status === "paused";
  const idle = status === "idle" || status === "error" || status === "done";
  const canStep = status !== "loading" && status !== "done" && segmentCount > 0;
  const cardText =
    text || (voices.length === 0 ? "系统没有可用语音，请先在 Windows 安装中文语音包。" : "从当前页开始，按段落朗读。");

  return (
    <section className="tts-bar glass" role="region" aria-label="朗读">
      <button
        className="tts-play"
        type="button"
        onClick={onPlayPause}
        disabled={status === "loading" || voices.length === 0}
        aria-label={playing ? "暂停朗读" : paused ? "继续朗读" : "开始朗读"}
      >
        {status === "loading" ? (
          <span className="tts-spin" />
        ) : playing ? (
          <IconPause />
        ) : (
          <IconPlay />
        )}
      </button>

      <div className="tts-main">
        <div className="tts-head">
          <strong>朗读</strong>
          <span className={`tts-state ${status}`}>{statusLabel(status)}</span>
          {page > 0 && <span>第 {page} 页</span>}
          {segmentCount > 0 && <span>{segment + 1}/{segmentCount} 段</span>}
        </div>
        <div className={`tts-text${idle && !text ? " muted" : ""}`} title={text || message}>
          {message || cardText}
        </div>
      </div>

      <div className="tts-actions">
        <button type="button" onClick={onPrev} disabled={!canStep || (segment === 0 && page <= 1)} aria-label="上一段">
          <IconChevronLeft />
        </button>
        <button type="button" onClick={onNext} disabled={!canStep} aria-label="下一段">
          <IconChevronRight />
        </button>
        <button type="button" onClick={onStop} disabled={idle && !paused} aria-label="停止朗读">
          <IconStop />
        </button>
        <button type="button" onClick={onClose} aria-label="关闭朗读">
          <IconClose />
        </button>
      </div>

      <div className="tts-options">
        <label className="tts-voice">
          <span>语音</span>
          <select value={voiceName} onChange={(e) => onVoice(e.target.value)} disabled={voices.length === 0}>
            {voices.map((v) => (
              <option key={v.voiceURI || v.name} value={v.name}>
                {voiceLabel(v)} · {v.lang}
              </option>
            ))}
          </select>
        </label>
        <label className="tts-rate">
          <span>语速</span>
          <input
            type="range"
            min={0.7}
            max={1.6}
            step={0.05}
            value={rate}
            onChange={(e) => onRate(Number(e.target.value))}
            aria-label="朗读语速"
          />
          <b>{rate.toFixed(2)}×</b>
        </label>
        <span className="tts-end">全篇 {totalPages} 页 · 本地系统语音，不联网</span>
      </div>
    </section>
  );
}
