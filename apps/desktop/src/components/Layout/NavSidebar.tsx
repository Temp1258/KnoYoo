import { Home, Star, Settings, Sun, Moon } from "lucide-react";
import { useState, useEffect } from "react";
import { NavLink } from "react-router";
import AISettingsPanel from "../AI/AISettingsPanel";

const navItems = [
  { to: "/", icon: Home, label: "主页" },
  { to: "/starred", icon: Star, label: "标记" },
];

export default function NavSidebar() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("knoyoo-theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("knoyoo-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <>
      <nav className="flex flex-col items-center w-14 shrink-0 py-4 border-r border-border bg-bg-secondary">
        {/* Logo */}
        <NavLink to="/" className="cursor-pointer mb-2" title="回到主页">
          <img src="/logo.png" alt="KnoYoo" className="w-10 h-10 rounded-xl" />
        </NavLink>

        {/* Nav Items */}
        <div className="flex flex-col gap-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-1.5 py-2 rounded-lg transition-colors duration-200 cursor-pointer ${
                  isActive
                    ? "bg-accent-light text-accent"
                    : "text-text-secondary hover:bg-bg-tertiary hover:text-text"
                }`
              }
            >
              <Icon size={20} strokeWidth={1.8} />
              <span className="text-[10px] font-medium leading-tight">{label}</span>
            </NavLink>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* AI Settings */}
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors duration-200 cursor-pointer mb-2"
          title="AI 设置"
        >
          <Settings size={18} />
        </button>

        {/* Theme Toggle */}
        <button
          onClick={() => setDark((d) => !d)}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors duration-200 cursor-pointer"
          title={dark ? "切换亮色模式" : "切换暗色模式"}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </nav>

      {/* Settings Modal */}
      {showSettings && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="bg-bg-secondary rounded-2xl shadow-lg border border-border max-w-md w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-semibold text-text">AI 设置</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="text-[13px] text-text-tertiary hover:text-text cursor-pointer"
              >
                关闭
              </button>
            </div>
            <AISettingsPanel />
          </div>
        </div>
      )}
    </>
  );
}
