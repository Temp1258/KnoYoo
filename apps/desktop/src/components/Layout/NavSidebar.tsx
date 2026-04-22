import {
  Home,
  Library,
  Compass,
  Settings,
  Trash2,
  BookMarked,
  Headphones,
  FileText,
} from "lucide-react";
import { NavLink, useLocation } from "react-router";
import KnoYooLogo from "./KnoYooLogo";

// Nav order: 主页 / 智库 / 书籍 / 影音 / 文档 / 发现 / 乐色 / 设置.
// 文档 sits between 影音 and 发现 per Phase C decision #2 — keeps the
// four content containers (智库 / 书籍 / 影音 / 文档) clustered together
// and leaves the "explore / housekeeping" items at the tail.
const navItems = [
  { to: "/", icon: Home, label: "主页", exact: true },
  { to: "/clips", icon: Library, label: "智库", exact: false },
  { to: "/books", icon: BookMarked, label: "书籍", exact: false },
  { to: "/media", icon: Headphones, label: "影音", exact: false },
  { to: "/documents", icon: FileText, label: "文档", exact: false },
  { to: "/discover", icon: Compass, label: "发现", exact: false },
  { to: "/trash", icon: Trash2, label: "乐色", exact: false },
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
  return (
    <nav
      className="flex flex-col items-center w-14 shrink-0 py-4 border-r border-border bg-bg-secondary"
      role="navigation"
      aria-label="主导航"
    >
      {/* Logo — inline SVG; colors driven by theme CSS vars so the mark
          recolors naturally across every theme. */}
      <NavLink
        to="/"
        className="cursor-pointer mb-2 knoyoo-logo"
        title="回到主页"
        aria-label="KnoYoo 首页"
      >
        <KnoYooLogo size={40} className="rounded-xl" />
      </NavLink>

      {/* Nav Items */}
      <NavItems />
    </nav>
  );
}
