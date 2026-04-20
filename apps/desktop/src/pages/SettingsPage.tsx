import { useState, useEffect, useCallback } from "react";
import { Database, Download, Upload, ShieldCheck } from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";
import SegmentedControl from "../components/ui/SegmentedControl";
import ApiConfigPanel from "../components/Settings/ApiConfigPanel";
import ResetApiKeysCard from "../components/Settings/ResetApiKeysCard";
import BookmarkImportDialog from "../components/Import/BookmarkImportDialog";
import ThemePicker from "../components/Settings/ThemePicker";
import ShortcutSettings from "../components/Settings/ShortcutSettings";
import Dialog from "../components/ui/Dialog";
import Button from "../components/ui/Button";
import { useTheme } from "../hooks/useTheme";
import { tauriInvoke } from "../hooks/useTauriInvoke";

type Tab = "ai" | "display" | "data" | "import" | "about";

const TABS = [
  { value: "ai" as Tab, label: "API 配置" },
  { value: "display" as Tab, label: "显示" },
  { value: "data" as Tab, label: "数据" },
  { value: "import" as Tab, label: "导入" },
  { value: "about" as Tab, label: "关于" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("ai");
  const { auto, setAuto } = useTheme();

  // Data tab state
  const [dbPath, setDbPath] = useState("");
  const [dbSize, setDbSize] = useState(0);
  const [clipCount, setClipCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [importConfirm, setImportConfirm] = useState(false);
  // Post-import restart modal. Blocks the UI so the user can't silently
  // continue on stale in-memory state (milestones / clip lists loaded from
  // the old DB). Without this, "请重启" was just a toast many users missed.
  const [restartPromptOpen, setRestartPromptOpen] = useState(false);

  const loadDataInfo = useCallback(async () => {
    setDataLoading(true);
    try {
      const [info, count] = await Promise.all([
        tauriInvoke<[string, number]>("get_database_info"),
        tauriInvoke<number>("count_web_clips"),
      ]);
      setDbPath(info[0]);
      setDbSize(info[1]);
      setClipCount(count);
    } catch (e) {
      console.error("Failed to load database info:", e);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "data") loadDataInfo();
  }, [tab, loadDataInfo]);

  const handleExportBackup = async () => {
    const path = await save({
      defaultPath: `knoyoo-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (!path) return;
    setBackupStatus(null);
    try {
      await tauriInvoke("export_full_database", { path });
      setBackupStatus("备份导出成功");
    } catch (e) {
      setBackupStatus(`导出失败: ${e}`);
    }
  };

  const handleImportBackup = async () => {
    const path = await open({
      title: "选择备份文件",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (!path) return;
    setBackupStatus(null);
    try {
      await tauriInvoke("import_full_database", { path });
      setImportConfirm(false);
      // Don't even try to refresh the panel — in-memory state is stale.
      // Block the UI with a modal that forces the user through a restart.
      setRestartPromptOpen(true);
    } catch (e) {
      setBackupStatus(`导入失败: ${e}`);
    }
  };

  const handleRestartNow = async () => {
    try {
      await tauriInvoke("restart_app");
    } catch (e) {
      // Very unusual — Tauri restart should not fail. Surface the reason so
      // the user can at least manually quit + reopen.
      setBackupStatus(`重启失败: ${e}。请手动退出并重新打开 KnoYoo。`);
      setRestartPromptOpen(false);
    }
  };

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight mb-4">设置</h1>

      <SegmentedControl options={TABS} value={tab} onChange={setTab} className="mb-6" />

      {tab === "ai" && (
        <div className="space-y-6">
          <ApiConfigPanel />
          <ResetApiKeysCard />
        </div>
      )}

      {tab === "display" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-bg-secondary border border-border">
            <div>
              <div className="text-[14px] font-medium text-text">跟随系统外观</div>
              <div className="text-[12px] text-text-tertiary mt-0.5">
                开启后根据系统的亮/暗模式自动切换
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={auto}
              onClick={() => setAuto(!auto)}
              className={`relative w-10 h-6 rounded-full transition-colors cursor-pointer ${
                auto ? "bg-accent" : "bg-bg-tertiary border border-border"
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${
                  auto ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
          </div>

          <div className="p-4 rounded-xl bg-bg-secondary border border-border">
            <div className="mb-3">
              <div className="text-[14px] font-medium text-text">主题风格</div>
              <div className="text-[12px] text-text-tertiary mt-0.5">
                {auto ? "已跟随系统，手动选择将关闭自动切换" : "选择你喜欢的视觉风格"}
              </div>
            </div>
            <ThemePicker />
          </div>

          <ShortcutSettings />
        </div>
      )}

      {tab === "data" && (
        <div className="space-y-4">
          {/* Database info */}
          <div className="p-4 rounded-xl bg-bg-secondary border border-border">
            <div className="flex items-center gap-2 mb-3">
              <Database size={16} className="text-accent" />
              <span className="text-[14px] font-medium text-text">数据库信息</span>
            </div>
            {dataLoading ? (
              <div className="text-[12px] text-text-tertiary">加载中…</div>
            ) : (
              <div className="space-y-2 text-[12px] text-text-secondary">
                <div className="flex justify-between">
                  <span>存储路径</span>
                  <span
                    className="text-text-tertiary max-w-[280px] truncate text-right"
                    title={dbPath}
                  >
                    {dbPath}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>数据库大小</span>
                  <span className="text-text-tertiary">{formatBytes(dbSize)}</span>
                </div>
                <div className="flex justify-between">
                  <span>剪藏总数</span>
                  <span className="text-text-tertiary">{clipCount.toLocaleString()} 条</span>
                </div>
              </div>
            )}
          </div>

          {/* Backup / Restore */}
          <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-3">
            <div className="text-[14px] font-medium text-text">备份与恢复</div>
            <p className="text-[12px] text-text-tertiary leading-relaxed m-0">
              备份文件仅包含笔记数据，
              <span className="text-text-secondary">不包含任何 API Key</span>
              （后者保存在系统钥匙串中）。在新机器上恢复后，请重新配置 AI 与视频转录的 Key。
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleExportBackup}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent/90 transition-colors cursor-pointer"
              >
                <Download size={14} />
                导出备份
              </button>
              {!importConfirm ? (
                <button
                  onClick={() => setImportConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:border-accent/30 transition-colors cursor-pointer"
                >
                  <Upload size={14} />
                  导入备份
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleImportBackup}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white text-[13px] font-medium hover:bg-red-600 transition-colors cursor-pointer"
                  >
                    确认导入
                  </button>
                  <button
                    onClick={() => setImportConfirm(false)}
                    className="px-3 py-2 rounded-lg text-[13px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
            {importConfirm && (
              <p className="text-[12px] text-red-500">
                导入备份将替换当前所有数据，此操作不可撤销。建议先导出当前数据作为备份。
              </p>
            )}
            {backupStatus && (
              <p
                className={`text-[12px] ${backupStatus.includes("失败") ? "text-red-500" : "text-green-600 dark:text-green-400"}`}
              >
                {backupStatus}
              </p>
            )}
          </div>

          {/* Privacy note */}
          <div className="flex items-start gap-2.5 p-4 rounded-xl bg-bg-secondary border border-border">
            <ShieldCheck size={16} className="text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
            <p className="text-[12px] text-text-secondary leading-relaxed">
              所有数据 100% 存储在本地设备，永远不会上传到云端
            </p>
          </div>
        </div>
      )}

      {tab === "import" && <BookmarkImportDialog />}

      {tab === "about" && (
        <div className="space-y-3">
          <div className="p-4 rounded-xl bg-bg-secondary border border-border">
            <div className="text-[14px] font-medium text-text mb-3">KnoYoo</div>
            <div className="space-y-2 text-[12px] text-text-secondary">
              <div className="flex justify-between">
                <span>版本</span>
                <span className="text-text-tertiary">2.0.4</span>
              </div>
              <div className="flex justify-between">
                <span>技术栈</span>
                <span className="text-text-tertiary">Tauri + React + SQLite</span>
              </div>
            </div>
          </div>

          {/* Privacy commitment */}
          <div className="p-4 rounded-xl bg-bg-secondary border border-border">
            <div className="text-[14px] font-medium text-text mb-3">🔒 隐私承诺</div>
            <div className="space-y-2 text-[12px] text-text-secondary leading-relaxed">
              <p>你的剪藏数据完全存储在本地 SQLite 数据库中</p>
              <p>AI 功能仅在你主动使用时，将必要内容发送给 AI 供应商处理</p>
              <p>KnoYoo 不收集任何用户数据或使用遥测</p>
            </div>
          </div>

          <p className="text-[11px] text-text-tertiary text-center">
            专注于将浏览内容转化为个人知识
          </p>
        </div>
      )}

      {/* Blocking post-restore modal. Keeps the user on a clean path: they
          either restart now and see the imported data, or postpone and are
          warned that the current view is stale. */}
      <Dialog
        open={restartPromptOpen}
        onClose={() => setRestartPromptOpen(false)}
        title="备份已恢复，需要重启 KnoYoo"
        actions={
          <>
            <Button variant="ghost" onClick={() => setRestartPromptOpen(false)}>
              稍后重启
            </Button>
            <Button variant="primary" onClick={handleRestartNow}>
              立即重启
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-[13px] text-text-secondary leading-relaxed">
          <p className="m-0">导入成功。现在屏幕上显示的数据来自旧数据库，需要重启让新数据生效。</p>
          <p className="m-0 text-[12px] text-text-tertiary">
            提醒：API Key 不随备份迁移，重启后请到「AI 配置」和「视频转录」重新填写。
          </p>
        </div>
      </Dialog>
    </div>
  );
}
