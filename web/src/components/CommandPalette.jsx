import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Undo2,
} from "lucide-react";
import { useFileStore } from "@/store/file-store";
import { useDialogStore } from "@/store/dialog-store";
import { useSettingsStore } from "@/store/settings-store";
import { useUndoStore } from "@/store/undo-store";
import { usePlacesStore } from "@/store/places-store";
import { useFileActions } from "@/hooks/use-file-actions";
import { basename } from "@/lib/api";
import { Input } from "@/components/ui/input";

/**
 * Command palette (Ctrl+K): fuzzy-search commands and recent folders,
 * Enter to run, arrows to navigate.
 */
export function CommandPalette({ open, onClose }) {
  const { t } = useTranslation();
  const store = useFileStore();
  const actions = useFileActions();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);

  const recent = usePlacesStore((s) => s.recent);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const tab = store.activeTab();

  const commands = useMemo(() => {
    if (!open) return [];
    const items = [
      { id: "new-file", label: t("contextMenu.newFile"), icon: Plus, run: actions.newFile },
      { id: "new-folder", label: t("contextMenu.newFolder"), icon: Plus, run: actions.newFolder },
      { id: "refresh", label: t("common.refresh"), icon: RefreshCw, run: () => store.refresh() },
      { id: "undo", label: t("undo.delete"), icon: Undo2, run: () => useUndoStore.getState().undo() },
      { id: "trash", label: t("common.trash"), icon: Trash2, run: () => store.openTrash() },
      { id: "settings", label: t("common.settings"), icon: Settings, run: () => useDialogStore.getState().open("settings", {}) },
    ];
    if (tab?.page === "explorer") {
      items.unshift(
        { id: "view-grid", label: t("nav.gridView"), icon: LayoutGrid, run: () => store.setViewMode("grid") },
        { id: "view-list", label: t("nav.listView"), icon: List, run: () => store.setViewMode("list") },
        { id: "sort-name", label: t("nav.byName"), icon: LayoutGrid, run: () => store.setSort("name") },
        { id: "sort-size", label: t("nav.bySize"), icon: LayoutGrid, run: () => store.setSort("size") },
        { id: "sort-date", label: t("nav.byDate"), icon: LayoutGrid, run: () => store.setSort("dateModified") },
        { id: "sort-type", label: t("nav.byType"), icon: LayoutGrid, run: () => store.setSort("type") },
      );
    }
    // recent folders as navigation targets
    for (const r of recent.slice(0, 6)) {
      items.push({
        id: `recent-${r.path}`,
        label: `${basename(r.path)} — ${r.path}`,
        icon: FolderOpen,
        run: () => store.navigate(r.path),
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab?.page, recent, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q),
    );
  }, [commands, query]);

  if (!open) return null;

  const runSelected = (item) => {
    onClose();
    item.run();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[selected];
      if (item) runSelected(item);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border bg-background shadow-2xl">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("palette.placeholder")}
          className="rounded-none border-0 border-b px-4 py-3 text-sm focus-visible:ring-0"
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              {t("palette.empty")}
            </div>
          )}
          {filtered.map((c, i) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                  i === selected ? "bg-accent" : ""
                }`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => runSelected(c)}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
