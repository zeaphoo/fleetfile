import { create } from "zustand";

const KEY = "fleetfile:places";

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* noop */
  }
  return { favorites: [], recent: [] };
}

function persist(favorites, recent) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ favorites, recent }));
  } catch {
    /* noop */
  }
}

/** Favorites (pinned folders) + recently visited folders. */
export const usePlacesStore = create((set, get) => ({
  ...load(),

  addFavorite(path) {
    const { favorites } = get();
    if (favorites.some((f) => f.path === path)) return;
    const name = path.replace(/[\\/]+$/, "").split(/[/\\]/).pop() || path;
    const next = [...favorites, { name, path }];
    set({ favorites: next });
    persist(next, get().recent);
  },

  removeFavorite(path) {
    const { favorites, recent } = get();
    const next = favorites.filter((f) => f.path !== path);
    set({ favorites: next });
    persist(next, recent);
  },

  isFavorite(path) {
    return get().favorites.some((f) => f.path === path);
  },

  /** Record a folder visit (dedup, cap 12). */
  visit(path) {
    if (!path) return;
    const { recent } = get();
    const next = [{ path, ts: Date.now() }, ...recent.filter((r) => r.path !== path)].slice(0, 12);
    set({ recent: next });
    persist(get().favorites, next);
  },
}));
