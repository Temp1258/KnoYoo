import { Library, Star, Compass, Settings, Sun, Moon, FolderOpen } from "lucide-react";
import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router";

const navItems = [
  { to: "/", icon: Library, label: "全部", exact: true },
  {
    to: "/?starred=true",
    icon: Star,
    label: "星标",
    matchFn: (path: string, search: string) => path === "/" && search.includes("starred=true"),
  },
  { to: "/collections", icon: FolderOpen, label: "集合", exact: false },
  { to: "/discover", icon: Compass, label: "发现", exact: false },
  { to: "/settings", icon: Settings, label: "设置", exact: false },
];

function NavItems() {
  const location = useLocation();
  const currentPath = location.pathname;
  const currentSearch = location.search;

  return (
    <div className="flex flex-col gap-1">
      {navItems.map(({ to, icon: Icon, label, exact, matchFn }) => {
        const isActive = matchFn
          ? matchFn(currentPath, currentSearch)
          : exact
            ? currentPath === "/" && !currentSearch.includes("starred=true")
            : currentPath.startsWith(to.split("?")[0]) && to !== "/";

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
          >
            <Icon size={20} strokeWidth={1.8} />
            <span className="text-[10px] font-medium leading-tight">{label}</span>
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
    <nav className="flex flex-col items-center w-14 shrink-0 py-4 border-r border-border bg-bg-secondary">
      {/* Logo */}
      <NavLink to="/" className="cursor-pointer mb-2" title="回到主页">
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
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </nav>
  );
}
