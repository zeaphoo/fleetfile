import { create } from "zustand";
import { api, errMsg } from "@/lib/api";
import { syncWatches } from "@/lib/ws";
import { usePlacesStore } from "@/store/places-store";

const SESSION_KEY = "fleetfile:session";

let idSeq = 1;
const uid = (prefix) => `${prefix}${idSeq++}`;

const makeTab = () => {
  // Apply user defaults (from settings) to freshly created tabs.
  let defaults = { sortBy: "name", viewMode: "grid" };
  try {
    const raw = localStorage.getItem("fleetfile:settings");
    if (raw) {
      const s = JSON.parse(raw);
      defaults = {
        sortBy: s.defaultSort || "name",
        viewMode: s.defaultView || "grid",
      };
    }
  } catch {
    /* noop */
  }
  return {
    id: uid("t"),
    cwd: null,
    entries: [],
    loading: false,
    error: null,
    history: [],
    historyIndex: -1,
    selection: [],
    sortBy: defaults.sortBy,
    sortOrder: "asc",
    groupByDate: false,
    viewMode: defaults.viewMode, // 'grid' | 'list'
    filter: "",
    page: "explorer", // 'explorer' | 'trash'
  };
};

const makePane = () => {
  const tab = makeTab();
  return { id: uid("p"), tabs: [tab], activeTabId: tab.id };
};

function persistSession(panes, activePaneId) {
  try {
    const data = {
      version: 1,
      activePaneId,
      panes: panes.map((p) => ({
        id: p.id,
        activeTabId: p.activeTabId,
        tabs: p.tabs.map((t) => ({
          id: t.id,
          cwd: t.cwd,
          page: t.page,
          viewMode: t.viewMode,
          sortBy: t.sortBy,
          sortOrder: t.sortOrder,
          groupByDate: t.groupByDate,
        })),
      })),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable */
  }
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.panes) || data.panes.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

const parentOf = (path) => {
  const trimmed = String(path || "").replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx <= 0) return trimmed.startsWith("\\\\") ? "\\\\" : "/";
  return trimmed.slice(0, idx);
};

export const useFileStore = create((set, get) => {
  const findPane = (s, paneId) =>
    s.panes?.find((p) => p.id === paneId) ||
    s.panes?.find((p) => p.id === s.activePaneId) ||
    s.panes?.[0];

  const findTab = (s, tabId) => {
    for (const p of s.panes || []) {
      const t = p.tabs.find((t) => t.id === tabId);
      if (t) return t;
    }
    return null;
  };

  const patchTab = (s, tabId, patch) => ({
    panes: (s.panes || []).map((p) => ({
      ...p,
      tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
    })),
  });

  let persistTimer = null;
  const persist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const s = get();
      if (s.panes?.length) persistSession(s.panes, s.activePaneId);
    }, 300);
  };

  const syncWatchesNow = () => {
    const s = get();
    const paths = [];
    for (const p of s.panes || []) {
      for (const t of p.tabs) {
        if (t.page === "explorer" && t.cwd) paths.push(t.cwd);
      }
    }
    syncWatches(paths);
  };

  const loadDir = async (path, tabId, { silent = false } = {}) => {
    set((s) => patchTab(s, tabId, { loading: true, error: null }));
    try {
      const entries = await api.readDir(path);
      set((s) =>
        patchTab(s, tabId, { cwd: path, entries, loading: false, selection: [] }),
      );
      if (!silent) syncWatchesNow();
    } catch (e) {
      set((s) => patchTab(s, tabId, { error: errMsg(e), loading: false }));
    }
  };

  /** Resolve a tab id, defaulting to the active tab. */
  const resolveTab = (tabId) => (tabId ? findTab(get(), tabId) : get().activeTab());

  return {
    panes: null,
    activePaneId: null,
    drives: [],
    userDirs: null,

    // ── Derived accessors ────────────────────────────────────────────────
    activePane: () => findPane(get()),
    activeTab: () => {
      const s = get();
      const pane = findPane(s);
      return pane?.tabs.find((t) => t.id === pane.activeTabId) || pane?.tabs[0] || null;
    },
    tabById: (tabId) => findTab(get(), tabId),

    // ── Boot ─────────────────────────────────────────────────────────────
    async init() {
      if (get().panes) return; // already booted
      try {
        const [drives, userDirs] = await Promise.all([api.listDrives(), api.userDirs()]);
        const saved = restoreSession();
        let restore = saved;
        try {
          const raw = localStorage.getItem("fleetfile:settings");
          if (raw) restore = restore && JSON.parse(raw).restoreSession !== false;
        } catch {
          /* noop */
        }
        let panes;
        let activePaneId;
        if (restore) {
          panes = saved.panes.map((p) => ({
            id: p.id,
            activeTabId: p.activeTabId,
            tabs: p.tabs.map((t) => ({ ...makeTab(), ...t })),
          }));
          activePaneId = saved.activePaneId;
          if (!panes.some((p) => p.id === activePaneId)) activePaneId = panes[0].id;
        } else {
          const p = makePane();
          panes = [p];
          activePaneId = p.id;
        }
        set({ panes, activePaneId, drives, userDirs });
        const home = userDirs.home;
        for (const pane of panes) {
          for (const tab of pane.tabs) {
            await loadDir(tab.cwd || home, tab.id, { silent: true });
          }
        }
        syncWatchesNow();
      } catch (e) {
        set({ error: errMsg(e) });
      }
    },

    // ── Navigation ───────────────────────────────────────────────────────
    async navigate(path, tabId) {
      const tab = resolveTab(tabId);
      if (!tab) return;
      const { history, historyIndex } = tab;
      set((s) => patchTab(s, tab.id, { loading: true, error: null }));
      try {
        const entries = await api.readDir(path);
        const newHistory = [...history.slice(0, historyIndex + 1), path];
        set((s) =>
          patchTab(s, tab.id, {
            cwd: path,
            entries,
            loading: false,
            page: "explorer",
            history: newHistory,
            historyIndex: newHistory.length - 1,
            selection: [],
            filter: "",
          }),
        );
        persist();
        syncWatchesNow();
        // record recent-folder visit
        usePlacesStore.getState().visit(path);
      } catch (e) {
        set((s) => patchTab(s, tab.id, { error: errMsg(e), loading: false }));
      }
    },

    loadDir(path, tabId, opts) {
      return loadDir(path, tabId, opts);
    },

    back(tabId) {
      const tab = resolveTab(tabId);
      if (!tab || tab.historyIndex <= 0) return;
      const idx = tab.historyIndex - 1;
      set((s) => patchTab(s, tab.id, { historyIndex: idx }));
      loadDir(tab.history[idx], tab.id);
    },

    forward(tabId) {
      const tab = resolveTab(tabId);
      if (!tab || tab.historyIndex >= tab.history.length - 1) return;
      const idx = tab.historyIndex + 1;
      set((s) => patchTab(s, tab.id, { historyIndex: idx }));
      loadDir(tab.history[idx], tab.id);
    },

    up(tabId) {
      const tab = resolveTab(tabId);
      if (!tab || !tab.cwd) return;
      const parent = parentOf(tab.cwd);
      if (parent !== tab.cwd) get().navigate(parent, tab.id);
    },

    refresh(tabId) {
      const tab = resolveTab(tabId);
      if (tab && tab.cwd) loadDir(tab.cwd, tab.id);
    },

    // ── Active-tab settings ──────────────────────────────────────────────
    setSort(sortBy, tabId) {
      const tab = resolveTab(tabId);
      if (!tab) return;
      const patch =
        tab.sortBy === sortBy
          ? { sortOrder: tab.sortOrder === "asc" ? "desc" : "asc" }
          : { sortBy, sortOrder: "asc" };
      set((s) => patchTab(s, tab.id, patch));
      persist();
    },

    toggleGroupByDate(tabId) {
      const tab = resolveTab(tabId);
      if (!tab) return;
      set((s) => patchTab(s, tab.id, { groupByDate: !tab.groupByDate }));
      persist();
    },

    setFilter(q, tabId) {
      const tab = resolveTab(tabId);
      if (!tab) return;
      set((s) => patchTab(s, tab.id, { filter: q }));
    },

    setViewMode(mode, tabId) {
      const tab = resolveTab(tabId);
      if (!tab) return;
      set((s) => patchTab(s, tab.id, { viewMode: mode }));
      persist();
    },

    setPage(page, tabId) {
      const tab = resolveTab(tabId);
      if (!tab) return;
      set((s) => patchTab(s, tab.id, { page }));
      persist();
    },

    openTrash(tabId) {
      const tab = resolveTab(tabId);
      if (!tab) return;
      set((s) => patchTab(s, tab.id, { page: "trash", selection: [] }));
    },

    // ── Selection ────────────────────────────────────────────────────────
    select(entry, { ctrl = false, shift = false } = {}, tabId) {
      const tab = resolveTab(tabId);
      if (!tab) return;
      const { selection, entries } = tab;
      if (ctrl) {
        const exists = selection.some((e) => e.path === entry.path);
        set((s) =>
          patchTab(s, tab.id, {
            selection: exists
              ? selection.filter((e) => e.path !== entry.path)
              : [...selection, entry],
          }),
        );
      } else if (shift && selection.length > 0) {
        const anchor = selection[selection.length - 1];
        const i1 = entries.findIndex((e) => e.path === anchor.path);
        const i2 = entries.findIndex((e) => e.path === entry.path);
        if (i1 >= 0 && i2 >= 0) {
          const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
          set((s) => patchTab(s, tab.id, { selection: entries.slice(lo, hi + 1) }));
        }
      } else {
        set((s) => patchTab(s, tab.id, { selection: [entry] }));
      }
    },

    selectIndex(index, tabId) {
      const tab = resolveTab(tabId);
      if (!tab || index < 0 || index >= tab.entries.length) return;
      set((s) => patchTab(s, tab.id, { selection: [tab.entries[index]] }));
    },

    selectAll(tabId) {
      const tab = resolveTab(tabId);
      if (!tab) return;
      set((s) => patchTab(s, tab.id, { selection: [...tab.entries] }));
    },

    clearSelection(tabId) {
      const tab = resolveTab(tabId);
      if (!tab) return;
      set((s) => patchTab(s, tab.id, { selection: [] }));
    },

    // ── Tabs ─────────────────────────────────────────────────────────────
    newTab(paneId, cwd) {
      const s = get();
      const pane = findPane(s, paneId);
      if (!pane) return;
      const tab = makeTab();
      const src = pane.tabs.find((t) => t.id === pane.activeTabId) || pane.tabs[0];
      tab.cwd = cwd ?? src?.cwd ?? null;
      tab.viewMode = src?.viewMode ?? "grid";
      set({
        panes: s.panes.map((p) =>
          p.id === pane.id ? { ...p, tabs: [...p.tabs, tab], activeTabId: tab.id } : p,
        ),
      });
      if (tab.cwd) loadDir(tab.cwd, tab.id);
      persist();
    },

    closeTab(paneId, tabId) {
      const s = get();
      const pane = findPane(s, paneId);
      if (!pane || pane.tabs.length <= 1) return;
      const idx = pane.tabs.findIndex((t) => t.id === tabId);
      const tabs = pane.tabs.filter((t) => t.id !== tabId);
      const activeTabId =
        pane.activeTabId === tabId
          ? (tabs[Math.max(0, idx - 1)] || tabs[0]).id
          : pane.activeTabId;
      set({
        panes: s.panes.map((p) =>
          p.id === pane.id ? { ...p, tabs, activeTabId } : p,
        ),
      });
      persist();
      syncWatchesNow();
    },

    setActiveTab(paneId, tabId) {
      const s = get();
      set({
        panes: s.panes.map((p) =>
          p.id === paneId ? { ...p, activeTabId: tabId } : p,
        ),
        activePaneId: paneId,
      });
      syncWatchesNow();
    },

    duplicateTab(paneId, tabId) {
      const s = get();
      const pane = findPane(s, paneId);
      if (!pane) return;
      const src = pane.tabs.find((t) => t.id === tabId) || pane.tabs[0];
      if (!src) return;
      const copy = { ...makeTab(), ...src, id: uid("t") };
      copy.selection = [];
      copy.history = [...(src.history || [])];
      copy.entries = [...(src.entries || [])];
      const idx = pane.tabs.findIndex((t) => t.id === src.id);
      const tabs = [...pane.tabs];
      tabs.splice(idx + 1, 0, copy);
      set({
        panes: s.panes.map((p) =>
          p.id === pane.id ? { ...p, tabs, activeTabId: copy.id } : p,
        ),
      });
      persist();
    },

    // ── Panes ────────────────────────────────────────────────────────────
    splitPane(paneId) {
      const s = get();
      const pane = findPane(s, paneId);
      if (!pane) return;
      const src = pane.tabs.find((t) => t.id === pane.activeTabId) || pane.tabs[0];
      const tab = makeTab();
      tab.cwd = src?.cwd ?? null;
      tab.viewMode = src?.viewMode ?? "grid";
      const newPane = { id: uid("p"), tabs: [tab], activeTabId: tab.id };
      set({ panes: [...s.panes, newPane], activePaneId: newPane.id });
      if (tab.cwd) loadDir(tab.cwd, tab.id);
      persist();
    },

    closePane(paneId) {
      const s = get();
      if (!s.panes || s.panes.length <= 1) return;
      const panes = s.panes.filter((p) => p.id !== paneId);
      const activePaneId =
        s.activePaneId === paneId ? panes[panes.length - 1].id : s.activePaneId;
      set({ panes, activePaneId });
      persist();
      syncWatchesNow();
    },

    setActivePane(paneId) {
      set({ activePaneId: paneId });
    },

    // ── Misc ─────────────────────────────────────────────────────────────
    persist,
    syncWatches: syncWatchesNow,
  };
});
