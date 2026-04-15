import { useEffect, useState } from "react";
import { Video, AlertCircle, Youtube } from "lucide-react";
import Dialog from "../ui/Dialog";
import Input from "../ui/Input";
import Button from "../ui/Button";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { AsrFullConfig } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the new `clip_id` once the backend has queued the job.
   *  Parent typically opens the ClipDetail drawer so the user can watch
   *  the progress bar. */
  onStarted: (clipId: number) => void;
}

const SUPPORTED_HOSTS = [
  { label: "YouTube", match: /youtu\.be|youtube\.com/ },
  { label: "Bilibili", match: /bilibili\.com|b23\.tv/ },
];

function detectHost(url: string): string | null {
  for (const h of SUPPORTED_HOSTS) {
    if (h.match.test(url)) return h.label;
  }
  return null;
}

export default function VideoImportDialog({ open, onClose, onStarted }: Props) {
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [asrReady, setAsrReady] = useState<boolean | null>(null);

  // Probe ASR config lazily when the dialog opens. If unset, we still let
  // users submit (subtitle path doesn't need ASR) but surface a soft
  // warning so they know what to expect on no-subtitle videos.
  useEffect(() => {
    if (!open) return;
    setUrl("");
    setErr(null);
    setAsrReady(null);
    tauriInvoke<AsrFullConfig>("get_asr_config")
      .then((cfg) => {
        // Ready = an active provider is picked AND it has a stored key.
        // `asr_api_key` is a mask string; non-empty iff configured.
        const active = cfg?.asr_provider;
        const configured = !!active && !!cfg.providers?.[active]?.configured;
        setAsrReady(configured);
      })
      .catch(() => setAsrReady(false));
    // Focus after the Dialog animation so it doesn't get stolen mid-transition.
    const t = setTimeout(() => {
      document.getElementById("video-import-url")?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [open]);

  const host = detectHost(url);
  const canSubmit = !!url.trim() && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setErr("URL 必须以 http:// 或 https:// 开头");
      return;
    }
    setErr(null);
    setSubmitting(true);
    try {
      const clipId = await tauriInvoke<number>("import_video_clip", { url: trimmed });
      onStarted(clipId);
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title="导入视频"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "启动中…" : "开始导入"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Intro */}
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-accent/5 border border-accent/15">
          <Video size={14} className="text-accent mt-0.5 shrink-0" />
          <div className="text-[12px] text-text-secondary leading-relaxed">
            粘贴 YouTube 或 Bilibili 视频链接。有字幕的视频会免费走字幕路径；没有字幕才会走 ASR
            语音转文字。
          </div>
        </div>

        {/* URL input */}
        <div>
          <label className="text-[12px] text-text-tertiary mb-1 block">视频 URL</label>
          <Input
            id="video-import-url"
            placeholder="https://www.bilibili.com/video/… 或 https://youtu.be/…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) handleSubmit();
            }}
            disabled={submitting}
          />
          {host && (
            <div className="inline-flex items-center gap-1 mt-1.5 text-[11px] text-text-tertiary">
              <Youtube size={11} />
              识别为 {host}
            </div>
          )}
        </div>

        {/* Inline error */}
        {err && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-danger-light border border-danger/20 text-[12px] text-danger">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {/* ASR config hint */}
        {asrReady === false && (
          <div className="text-[11px] text-text-tertiary leading-relaxed px-3 py-2 rounded-lg bg-bg-tertiary border border-border">
            尚未配置 ASR 供应商。有字幕的视频仍可正常导入；如要处理无字幕视频，请先到 设置 →
            视频转录 配置 API Key。
          </div>
        )}
      </div>
    </Dialog>
  );
}
