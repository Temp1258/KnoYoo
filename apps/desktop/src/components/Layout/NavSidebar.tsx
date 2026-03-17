import { NavLink } from "react-router";
import { CalendarCheck, Network, Sparkles, Sun, Moon } from "lucide-react";
import { useState, useEffect } from "react";

const navItems = [
  { to: "/", icon: CalendarCheck, label: "计划" },
  { to: "/mindmap", icon: Network, label: "技能树" },
  { to: "/growth", icon: Sparkles, label: "教练" },
];

export default function NavSidebar() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("knoyoo-theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("knoyoo-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <nav className="flex flex-col items-center w-14 shrink-0 py-4 border-r border-border bg-bg-secondary">
      {/* Logo */}
      <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-[14px] mb-6">
        K
      </div>

      {/* Nav Items */}
      <div className="flex flex-col gap-1 flex-1">
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

      {/* Theme Toggle */}
      <button
        onClick={() => setDark((d) => !d)}
        className="flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors duration-200 cursor-pointer"
        title={dark ? "切换亮色模式" : "切换暗色模式"}
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </nav>
  );
}
