import { useEffect, useState, useRef } from "react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import type { SkillNote } from "../../types";

interface Props {
  nodeId: number;
  nodeName: string;
  x: number;
  y: number;
}

export default function NodePreviewTooltip({ nodeId, nodeName, x, y }: Props) {
  const [notes, setNotes] = useState<SkillNote[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    timerRef.current = setTimeout(async () => {
      try {
        const res = await tauriInvoke<SkillNote[]>("list_skill_notes_v1", {
          skill_id: nodeId,
          limit: 5,
        });
        setNotes(res || []);
      } catch {
        setNotes([]);
      }
      setReady(true);
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [nodeId]);

  if (!ready) return null;

  return (
    <div
      className="absolute z-50 bg-bg-secondary border border-border rounded-lg shadow-lg p-3 min-w-[200px] max-w-[280px] pointer-events-none"
      style={{ left: x, top: y }}
    >
      <div className="text-[13px] font-semibold text-text mb-1.5 truncate">{nodeName}</div>
      <div className="text-[11px] text-text-tertiary mb-2">关联笔记：{notes?.length ?? 0} 条</div>
      {notes && notes.length > 0 ? (
        <ul className="space-y-1.5">
          {notes.map((n) => (
            <li key={n.id} className="border-t border-border pt-1.5 first:border-t-0 first:pt-0">
              <div className="text-[12px] font-medium text-text truncate">{n.title}</div>
              {n.snippet && (
                <div className="text-[11px] text-text-secondary mt-0.5 line-clamp-2">
                  {n.snippet}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[11px] text-text-tertiary">暂无关联笔记</div>
      )}
    </div>
  );
}
