import { useSyncExternalStore } from "react";

export type ThemeId =
  | "light"
  | "dark"
  | "sepia"
  | "midnight"
  | "forest"
  | "sunset"
  | "void"
  | "mint"
  | "mocha";

export type ThemeMeta = {
  id: ThemeId;
  label: string;
  description: string;
  isDark: boolean;
  preview: {
    bg: string;
    surface: string;
    border: string;
    text: string;
    textSecondary: string;
    accent: string;
  };
};

export const THEMES: ThemeMeta[] = [
  {
    id: "light",
    label: "极简亮",
    description: "纯白克制，日常首选",
    isDark: false,
    preview: {
      bg: "#f9fafb",
      surface: "#ffffff",
      border: "#e5e7eb",
      text: "#111827",
      textSecondary: "#6b7280",
      accent: "#0071e3",
    },
  },
  {
    id: "dark",
    label: "深夜灰",
    description: "低眩光深灰，OLED 友好",
    isDark: true,
    preview: {
      bg: "#111113",
      surface: "#1e1e22",
      border: "#38383a",
      text: "#f5f5f7",
      textSecondary: "#98989d",
      accent: "#3b8df0",
    },
  },
  {
    id: "sepia",
    label: "羊皮纸",
    description: "暖米纸感，长时阅读",
    isDark: false,
    preview: {
      bg: "#f4ecd8",
      surface: "#fbf5e5",
      border: "#e3d5b5",
      text: "#433422",
      textSecondary: "#7a6a4f",
      accent: "#a0642c",
    },
  },
  {
    id: "midnight",
    label: "深海蓝",
    description: "冷调低饱和，深夜专注",
    isDark: true,
    preview: {
      bg: "#0f1b2d",
      surface: "#172a41",
      border: "#2a3d5a",
      text: "#e6ecf5",
      textSecondary: "#93a8c2",
      accent: "#7cb2ff",
    },
  },
  {
    id: "forest",
    label: "森岭绿",
    description: "鼠尾草薄雾，静谧苔原",
    isDark: false,
    preview: {
      bg: "#e9efe7",
      surface: "#f4f8f2",
      border: "#c5d3be",
      text: "#13301f",
      textSecondary: "#4b6858",
      accent: "#2d7a4e",
    },
  },
  {
    id: "sunset",
    label: "黄昏紫",
    description: "雾紫暖粉，个性表达",
    isDark: true,
    preview: {
      bg: "#1c1626",
      surface: "#2a2038",
      border: "#443556",
      text: "#f3e8ff",
      textSecondary: "#c0a6d9",
      accent: "#e879a8",
    },
  },
  {
    id: "void",
    label: "极夜黑",
    description: "纯黑 AMOLED，极简高对比",
    isDark: true,
    preview: {
      bg: "#000000",
      surface: "#0a0a0a",
      border: "#262626",
      text: "#ffffff",
      textSecondary: "#a3a3a3",
      accent: "#4fa8ff",
    },
  },
  {
    id: "mint",
    label: "薄荷青",
    description: "清冽薄荷，白日清爽",
    isDark: false,
    preview: {
      bg: "#e6f5f1",
      surface: "#f4fbf8",
      border: "#b8d9cf",
      text: "#0f3d36",
      textSecondary: "#3d6b63",
      accent: "#0b9488",
    },
  },
  {
    id: "mocha",
    label: "摩卡棕",
    description: "咖啡暖褐，深夜书写",
    isDark: true,
    preview: {
      bg: "#1e1612",
      surface: "#2a1f18",
      border: "#4a352a",
      text: "#f0e4d8",
      textSecondary: "#c4a996",
      accent: "#d4925c",
    },
  },
];

const STORAGE_THEME = "knoyoo-theme";
const STORAGE_AUTO = "knoyoo-theme-auto";

type ThemeState = {
  theme: ThemeId;
  auto: boolean;
};

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readInitialState(): ThemeState {
  const autoRaw = localStorage.getItem(STORAGE_AUTO);
  const savedTheme = localStorage.getItem(STORAGE_THEME) as ThemeId | null;
  const known = THEMES.some((t) => t.id === savedTheme);

  if (autoRaw === null && !known) {
    return { theme: systemPrefersDark() ? "dark" : "light", auto: true };
  }

  const auto = autoRaw === "true";
  if (auto) {
    return { theme: systemPrefersDark() ? "dark" : "light", auto: true };
  }
  return { theme: known ? (savedTheme as ThemeId) : "light", auto: false };
}

let state: ThemeState = readInitialState();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function applyToDOM(theme: ThemeId) {
  const meta = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const root = document.documentElement;
  root.setAttribute("data-theme", meta.id);
  root.classList.toggle("dark", meta.isDark);
}

function setState(next: Partial<ThemeState>) {
  state = { ...state, ...next };
  applyToDOM(state.theme);
  emit();
}

export function setTheme(id: ThemeId) {
  localStorage.setItem(STORAGE_THEME, id);
  localStorage.setItem(STORAGE_AUTO, "false");
  setState({ theme: id, auto: false });
}

export function setAuto(enabled: boolean) {
  localStorage.setItem(STORAGE_AUTO, String(enabled));
  if (enabled) {
    const id: ThemeId = systemPrefersDark() ? "dark" : "light";
    localStorage.setItem(STORAGE_THEME, id);
    setState({ theme: id, auto: true });
  } else {
    setState({ auto: false });
  }
}

// System appearance listener — only drives state when auto mode is on.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!state.auto) return;
  const id: ThemeId = e.matches ? "dark" : "light";
  localStorage.setItem(STORAGE_THEME, id);
  setState({ theme: id });
});

// Apply once at module load so the DOM reflects persisted state before first paint of consumers.
applyToDOM(state.theme);

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ThemeState {
  return state;
}

export function useTheme() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { theme: s.theme, auto: s.auto, setTheme, setAuto, themes: THEMES };
}
