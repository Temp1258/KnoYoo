import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Command as CommandIcon } from "lucide-react";
import { tauriInvoke } from "../../hooks/useTauriInvoke";
import { useToast } from "../common/toast-context";

/**
 * Format a Tauri accelerator string (e.g. "CmdOrCtrl+Shift+K") into an array
 * of segments for rendering as individual <kbd> chips. Unknown modifiers
 * pass through so users see the raw name rather than silently dropping them.
 */
function splitAccelerator(acc: string): string[] {
  return acc
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Pretty-print a single modifier / key segment. Matches macOS conventions on
 * Darwin and keeps plain names on Windows/Linux.
 */
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

function prettySegment(seg: string): string {
  const lower = seg.toLowerCase();
  if (lower === "cmd" || lower === "super" || lower === "meta") {
    return isMac ? "⌘" : "Win";
  }
  if (lower === "cmdorctrl" || lower === "commandorcontrol") {
    return isMac ? "⌘" : "Ctrl";
  }
  if (lower === "ctrl" || lower === "control") return isMac ? "⌃" : "Ctrl";
  if (lower === "shift") return isMac ? "⇧" : "Shift";
  if (lower === "alt" || lower === "option") return isMac ? "⌥" : "Alt";
  // Single-letter keys: uppercase.
  if (seg.length === 1) return seg.toUpperCase();
  return seg;
}

/**
 * Serialize a DOM KeyboardEvent into a Tauri-accelerator string. Filters out
 * the case where only modifiers are held (no base key) so we don't prematurely
 * confirm a half-entered shortcut.
 */
function eventToAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.metaKey) mods.push(isMac ? "Cmd" : "Super");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push(isMac ? "Option" : "Alt");
  if (e.shiftKey) mods.push("Shift");

  const code = e.code;
  // Bare modifier press — user is still composing.
  if (
    [
      "MetaLeft",
      "MetaRight",
      "ControlLeft",
      "ControlRight",
      "AltLeft",
      "AltRight",
      "ShiftLeft",
      "ShiftRight",
    ].includes(code)
  ) {
    return null;
  }

  // Translate KeyboardEvent.code → Tauri accelerator key name.
  let key: string;
  if (code.startsWith("Key"))
    key = code.slice(3).toUpperCase(); // KeyK → K
  else if (code.startsWith("Digit"))
    key = code.slice(5); // Digit1 → 1
  else if (code.startsWith("F") && /^F\d+$/.test(code))
    key = code; // F1–F24
  else if (code === "Space") key = "Space";
  else if (code === "Enter") key = "Enter";
  else if (code === "Tab") key = "Tab";
  else if (code === "Escape")
    return null; // Esc cancels capture, never commits
  else if (code === "Backquote") key = "`";
  else if (code === "Minus") key = "-";
  else if (code === "Equal") key = "=";
  else if (code === "BracketLeft") key = "[";
  else if (code === "BracketRight") key = "]";
  else if (code === "Semicolon") key = ";";
  else if (code === "Quote") key = "'";
  else if (code === "Comma") key = ",";
  else if (code === "Period") key = ".";
  else if (code === "Slash") key = "/";
  else if (code === "Backslash") key = "\\";
  else if (code === "ArrowUp") key = "Up";
  else if (code === "ArrowDown") key = "Down";
  else if (code === "ArrowLeft") key = "Left";
  else if (code === "ArrowRight") key = "Right";
  else key = code;

  // At least one modifier required — bare letters would conflict with typing.
  if (mods.length === 0) return null;

  return [...mods, key].join("+");
}

export default function ShortcutSettings() {
  const [current, setCurrent] = useState<string>("");
  const [capturing, setCapturing] = useState(false);
  const [pending, setPending] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const captureBoxRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  const loadCurrent = useCallback(async () => {
    try {
      const acc = await tauriInvoke<string>("get_quick_search_shortcut");
      setCurrent(acc);
    } catch (e) {
      console.error("get_quick_search_shortcut failed:", e);
    }
  }, []);

  useEffect(() => {
    loadCurrent();
  }, [loadCurrent]);

  // While capturing, intercept keydowns at the window level so the user can
  // press Cmd/Shift without the combo escaping to the app (triggering the
  // current shortcut itself).
  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(false);
        setPending("");
        return;
      }
      const acc = eventToAccelerator(e);
      if (acc) setPending(acc);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [capturing]);

  const startCapture = () => {
    setPending("");
    setCapturing(true);
    // Focus the capture box so screen readers announce the mode switch.
    setTimeout(() => captureBoxRef.current?.focus(), 10);
  };

  const cancelCapture = () => {
    setCapturing(false);
    setPending("");
  };

  const save = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await tauriInvoke("set_quick_search_shortcut", { accelerator: pending });
      setCurrent(pending);
      setCapturing(false);
      setPending("");
      showToast("快捷键已更新", "success");
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const segments = splitAccelerator(capturing && pending ? pending : current);

  return (
    <div className="p-4 rounded-xl bg-bg-secondary border border-border">
      <div className="flex items-center gap-2 mb-1">
        <Keyboard size={14} className="text-accent" />
        <span className="text-[14px] font-medium text-text">快速搜索快捷键</span>
      </div>
      <p className="text-[12px] text-text-tertiary m-0 mb-3 leading-relaxed">
        在任意位置唤出 KnoYoo 快速搜索浮窗的全局快捷键。建议组合至少包含一个修饰键（⌘ / Ctrl / Alt /
        Shift）。
      </p>

      <div className="flex items-center gap-3">
        {/* Current / captured shortcut display */}
        <div
          ref={captureBoxRef}
          tabIndex={capturing ? 0 : -1}
          className={`flex-1 flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-colors min-h-[40px] ${
            capturing ? "border-accent bg-accent/5 ring-2 ring-accent/20" : "border-border bg-bg"
          }`}
          role={capturing ? "status" : undefined}
          aria-live={capturing ? "polite" : undefined}
        >
          {segments.length === 0 ? (
            <span className="text-[12px] text-text-tertiary italic">
              {capturing ? "请按下新的组合键…" : "未设置"}
            </span>
          ) : (
            segments.map((seg, i) => (
              <kbd
                key={`${seg}-${i}`}
                className={`inline-flex items-center justify-center min-w-[28px] h-[26px] px-2 rounded-md text-[12px] font-medium font-mono shadow-xs ${
                  capturing
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "bg-bg-tertiary text-text border border-border"
                }`}
              >
                {prettySegment(seg)}
              </kbd>
            ))
          )}
          {capturing && <span className="ml-auto text-[10px] text-text-tertiary">按 ESC 取消</span>}
        </div>

        {/* Action buttons */}
        {!capturing ? (
          <button
            onClick={startCapture}
            className="px-3 py-2 rounded-lg bg-bg border border-border text-[12px] font-medium text-text hover:border-accent/30 hover:bg-accent/5 transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <CommandIcon size={12} />
            修改
          </button>
        ) : (
          <>
            <button
              onClick={save}
              disabled={!pending || saving}
              className="px-3 py-2 rounded-lg bg-accent text-white text-[12px] font-medium hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "保存中…" : "保存"}
            </button>
            <button
              onClick={cancelCapture}
              disabled={saving}
              className="px-3 py-2 rounded-lg bg-bg border border-border text-[12px] font-medium text-text hover:bg-bg-tertiary transition-colors cursor-pointer"
            >
              取消
            </button>
          </>
        )}
      </div>
    </div>
  );
}
