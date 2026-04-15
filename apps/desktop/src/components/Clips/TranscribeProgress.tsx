import { useMemo } from "react";
import {
  Sparkles,
  Film,
  Captions,
  Download,
  Mic,
  Wand2,
  Tag,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TranscribeStage, TranscriptionStatus, WebClip } from "../../types";
import { useTranscribeProgress } from "../../hooks/useTranscribeProgress";
import { tauriInvoke } from "../../hooks/useTauriInvoke";

interface Props {
  clip: WebClip;
  /** Called when the user taps the "重试" button on a failed clip. */
  onRetryStarted?: () => void;
}

type StageMeta = {
  stage: TranscribeStage;
  label: string;
  icon: LucideIcon;
  /** Upper bound of overall percent for this stage. First stage to have
   *  `percent <= upperBound` is rendered as "active". */
  upperBound: number;
};

// Must mirror the Rust `Stage` enum's percent bands. Keep in sync.
const STAGES: StageMeta[] = [
  { stage: "metadata", label: "解析元数据", icon: Film, upperBound: 5 },
  { stage: "subtitle_probe", label: "检查字幕", icon: Captions, upperBound: 10 },
  { stage: "download", label: "下载", icon: Download, upperBound: 40 },
  { stage: "asr", label: "转录", icon: Mic, upperBound: 80 },
  { stage: "clean", label: "AI 清洗", icon: Wand2, upperBound: 95 },
  { stage: "summarize", label: "摘要与标签", icon: Tag, upperBound: 100 },
];

/** DB states that mean "the pipeline is still running". */
const ACTIVE_STATUSES: TranscriptionStatus[] = [
  "pending",
  "downloading",
  "transcribing",
  "cleaning",
];

function isActive(status: TranscriptionStatus | undefined): boolean {
  return !!status && ACTIVE_STATUSES.includes(status);
}

/**
 * Progress UI for a video clip's transcription pipeline.
 *
 * Returns `null` for non-video clips and for video clips whose pipeline is
 * neither in-flight nor failed (i.e. completed — ClipDetail renders the
 * normal content in that case).
 */
export default function TranscribeProgress({ clip, onRetryStarted }: Props) {
  const status = (clip.transcription_status as TranscriptionStatus) || "";
  const live = useTranscribeProgress(isActive(status) ? clip.id : null);

  const percent = useMemo(() => {
    if (live && live.clip_id === clip.id) return live.percent;
    // No live event yet (just opened drawer, or DB-reported state is stale).
    // Fall back to conservative values — avoids showing 0% for a clip that
    // is clearly past the metadata stage per the DB.
    if (status === "downloading") return 15;
    if (status === "transcribing") return 45;
    if (status === "cleaning") return 82;
    return 2;
  }, [live, clip.id, status]);

  const activeStage: TranscribeStage =
    live?.stage ?? STAGES.find((s) => percent <= s.upperBound)?.stage ?? "metadata";

  // Not a video or nothing interesting to show.
  if (!status) return null;

  if (status === "failed") {
    return <FailedCard clip={clip} onRetryStarted={onRetryStarted} />;
  }

  if (status === "completed") {
    // Normal ClipDetail content path handles display. Avoid rendering a
    // stale progress card after the user reopens the drawer.
    return null;
  }

  if (!isActive(status)) return null;

  return (
    <div className="mb-6 p-4 rounded-xl bg-accent/5 border border-accent/15">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={14} className="text-accent animate-pulse shrink-0" />
        <span className="text-[13px] font-medium text-accent">正在转录视频</span>
        <span className="text-[11px] text-text-tertiary ml-auto">{percent}%</span>
      </div>

      {/* Overall progress bar */}
      <div className="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-accent rounded-full transition-all duration-300"
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      </div>

      {/* Live detail line */}
      {live?.detail && (
        <div className="text-[12px] text-text-secondary mb-3 leading-relaxed">{live.detail}</div>
      )}

      {/* Stage breadcrumbs */}
      <div className="flex items-center gap-1 flex-wrap">
        {STAGES.map((s) => {
          const state =
            percent >= s.upperBound
              ? "done"
              : s.stage === activeStage
                ? "active"
                : percent >= prevBound(s.stage)
                  ? "active"
                  : "pending";
          const Icon = s.icon;
          return (
            <span
              key={s.stage}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border transition-colors ${
                state === "done"
                  ? "border-accent/30 text-accent bg-accent/5"
                  : state === "active"
                    ? "border-accent text-accent bg-accent/10 font-medium"
                    : "border-border text-text-tertiary"
              }`}
            >
              <Icon size={10} className={state === "active" ? "animate-pulse" : ""} />
              {s.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Lower bound of a stage's percent band (= upperBound of the previous). */
function prevBound(stage: TranscribeStage): number {
  const idx = STAGES.findIndex((s) => s.stage === stage);
  if (idx <= 0) return 0;
  return STAGES[idx - 1].upperBound;
}

function FailedCard({ clip, onRetryStarted }: Props) {
  const retry = async () => {
    try {
      await tauriInvoke("retry_transcription", { clipId: clip.id });
      onRetryStarted?.();
    } catch (e) {
      console.error("retry_transcription failed:", e);
    }
  };

  return (
    <div className="mb-6 p-4 rounded-xl bg-danger-light border border-danger/20">
      <div className="flex items-start gap-2">
        <AlertCircle size={14} className="text-danger mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-danger mb-1">视频转录失败</div>
          {clip.transcription_error && (
            <div className="text-[12px] text-text-secondary leading-relaxed break-words">
              {clip.transcription_error}
            </div>
          )}
          <button
            onClick={retry}
            className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] bg-bg-secondary text-danger border border-danger/30 hover:bg-danger/5 transition-colors cursor-pointer"
          >
            <RefreshCw size={11} />
            重试
          </button>
        </div>
      </div>
    </div>
  );
}
