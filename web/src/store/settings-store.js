import { create } from "zustand";
import { setLanguage } from "@/i18n";

const KEY = "fleetfile:settings";

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* noop */
  }
  return { ...DEFAULTS };
}

const DEFAULTS = {
  theme: "light", // 'light' | 'dark'
  language: "zh", // 'zh' | 'en'
  defaultView: "grid", // 'grid' | 'list'
  defaultSort: "name",
  restoreSession: true,
};

function applyTheme(theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export const useSettingsStore = create((set, get) => ({
  ...load(),

  init() {
    applyTheme(get().theme);
    setLanguage(get().language);
  },

  setTheme(theme) {
    applyTheme(theme);
    set({ theme });
    try {
      localStorage.setItem(KEY, JSON.stringify(get()));
    } catch {
      /* noop */
    }
  },

  setLanguage(lang) {
    setLanguage(lang);
    set({ language: lang });
    try {
      localStorage.setItem(KEY, JSON.stringify(get()));
    } catch {
      /* noop */
    }
  },

  setDefaultView(view) {
    set({ defaultView: view });
    try {
      localStorage.setItem(KEY, JSON.stringify(get()));
    } catch {
      /* noop */
    }
  },

  setDefaultSort(sort) {
    set({ defaultSort: sort });
    try {
      localStorage.setItem(KEY, JSON.stringify(get()));
    } catch {
      /* noop */
    }
  },

  setRestoreSession(v) {
    set({ restoreSession: v });
    try {
      localStorage.setItem(KEY, JSON.stringify(get()));
    } catch {
      /* noop */
    }
  },
}));
