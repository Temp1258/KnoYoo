import { Library, Compass, Settings, Sun, Moon, FolderOpen, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router";

const navItems = [
  { to: "/", icon: Library, label: "知识库", exact: true },
  { to: "/collections", icon: FolderOpen, label: "集合", exact: false },
  { to: "/discover", icon: Compass, label: "发现", exact: false },
  { to: "/trash", icon: Trash2, label: "回收站", exact: false },
  { to: "/settings", icon: Settings, label: "设置", exact: false },
];

function NavItems() {
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <div className="flex flex-col gap-1">
      {navItems.map(({ to, icon: Icon, label, exact }) => {
        const isActive = exact ? currentPath === "/" : currentPath.startsWith(to) && to !== "/";

        return (
          <NavLink
            key={to}
            to={to}
            className={`flex flex-col items-center gap-0.5 px-1.5 py-2 rounded-lg transition-colors duration-200 cursor-pointer ${
              isActive
                ? "bg-accent-light text-accent"
                : "text-text-secondary hover:bg-bg-tertiary hover:text-text"
            }`}
            title={label}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
            <span className="text-[11px] font-medium leading-tight">{label}</span>
          </NavLink>
        );
      })}
    </div>
  );
}

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
    <nav
      className="flex flex-col items-center w-14 shrink-0 py-4 border-r border-border bg-bg-secondary"
      role="navigation"
      aria-label="主导航"
    >
      {/* Logo */}
      <NavLink to="/" className="cursor-pointer mb-2" title="回到主页" aria-label="KnoYoo 首页">
        <img src="/logo.png" alt="KnoYoo" className="w-10 h-10 rounded-xl" />
      </NavLink>

      {/* Nav Items */}
      <NavItems />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Theme Toggle */}
      <button
        onClick={() => setDark((d) => !d)}
        className="flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors duration-200 cursor-pointer"
        title={dark ? "切换亮色模式" : "切换暗色模式"}
        aria-label={dark ? "切换亮色模式" : "切换暗色模式"}
      >
        {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      </button>
    </nav>
  );
}
