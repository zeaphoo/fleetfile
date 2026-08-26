import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Folder } from "lucide-react";
import { useFileStore } from "@/store/file-store";
import { useDialogStore } from "@/store/dialog-store";
import { useFileActions } from "@/hooks/use-file-actions";
import { ExplorerContextMenu } from "@/components/ExplorerContextMenu";
import { getFileIcon, formatSize, formatDate } from "@/lib/file-utils";
import { sortFiles } from "@/lib/sort-files";
import { folderColorHex } from "@/lib/folder-colors";
import { api } from "@/lib/api";

/**
 * Column View — macOS Finder style
 * Each selected directory expands a new column to the right.
 * Columns are horizontally scrollable.
 */

const ColumnRow = ({ entry, isSelected, colored, onClick, onNavigate }) => {
  const { Icon, color } = getFileIcon(entry);

  return (
    <button
      onClick={() => onClick(entry)}
      onDoubleClick={() => entry.is_dir && onNavigate(entry)}
      className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <span className="relative shrink-0">
        <Icon className={`h-4 w-4 ${color}`} strokeWidth={1.5} />
        {colored && (
          <span
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full ring-1 ring-background"
            style={{ backgroundColor: folderColorHex(colored) }}
          />
        )}
      </span>
      <span className="flex-1 truncate">{entry.name}</span>
      {entry.is_dir && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
    </button>
  );
};

const Column = ({ path, entries, selectedEntry, onSelect, onNavigate, loading, error, folderColors }) => {
  const { t } = useTranslation();
  const listRef = useRef(null);

  // Scroll selected into view
  useEffect(() => {
    if (!selectedEntry || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-path="${CSS.escape(selectedEntry.path)}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedEntry]);

  if (loading) {
    return (
      <div className="flex h-32 w-56 items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-32 w-56 items-center justify-center text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="flex w-56 shrink-0 flex-col overflow-y-auto border-r bg-background"
    >
      {entries.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
          {t("common.empty")}
        </div>
      ) : (
        entries.map((entry) => (
          <div key={entry.path} data-path={entry.path}>
            <ColumnRow
              entry={entry}
              isSelected={selectedEntry?.path === entry.path}
              colored={entry.is_dir ? folderColors[entry.path] || null : null}
              onClick={onSelect}
              onNavigate={onNavigate}
            />
          </div>
        ))
      )}
    </div>
  );
};

export const ColumnView = ({ tab }) => {
  const { t } = useTranslation();
  const actions = useFileActions(tab.id);
  const folderColors = useFileStore((s) => s.folderColors);

  // Each column represents a directory level. Start with the current directory.
  const [columns, setColumns] = useState([
    { path: tab.cwd, entries: tab.entries, selected: null, loading: false, error: null },
  ]);

  // Sync with tab changes (navigation)
  useEffect(() => {
    setColumns([
      { path: tab.cwd, entries: tab.entries, selected: null, loading: false, error: null },
    ]);
  }, [tab.cwd, tab.entries]);

  const handleSelect = useCallback(async (entry, columnIndex) => {
    // Update selected in this column
    setColumns((prev) =>
      prev.map((col, i) =>
        i === columnIndex ? { ...col, selected: entry } : col,
      ),
    );

    // If it's a directory, load its contents in the next column
    if (entry.is_dir) {
      // Remove any columns after this one
      setColumns((prev) => {
        const next = prev.slice(0, columnIndex + 1);
        // Add a new empty column for the selected directory
        next.push({
          path: entry.path,
          entries: [],
          selected: null,
          loading: true,
          error: null,
        });
        return next;
      });

      // Load the directory contents
      try {
        const entries = await api.readDir(entry.path);
        setColumns((prev) =>
          prev.map((col, i) =>
            i === columnIndex + 1
              ? { ...col, entries: sortFiles(entries, tab.sortBy, tab.sortOrder), loading: false }
              : col,
          ),
        );
      } catch (e) {
        setColumns((prev) =>
          prev.map((col, i) =>
            i === columnIndex + 1 ? { ...col, error: e.message, loading: false } : col,
          ),
        );
      }
    }
  }, [tab.sortBy, tab.sortOrder]);

  const handleNavigate = useCallback((entry) => {
    if (entry.is_dir) {
      useFileStore.getState().navigate(entry.path, tab.id);
    } else {
      actions.preview(entry);
    }
  }, [tab.id, actions]);

  return (
    <ExplorerContextMenu
      actions={actions}
      selection={tab.selection}
      onSelectAll={() => useFileStore.getState().selectAll(tab.id)}
    >
      <div className="flex flex-1 overflow-x-auto overflow-y-hidden">
        {columns.map((col, i) => (
          <Column
            key={col.path}
            path={col.path}
            entries={col.entries}
            selectedEntry={col.selected}
            onSelect={(entry) => handleSelect(entry, i)}
            onNavigate={handleNavigate}
            loading={col.loading}
            error={col.error}
            folderColors={folderColors}
          />
        ))}
        {/* Fill remaining space */}
        <div className="flex-1 bg-muted/10" />
      </div>
    </ExplorerContextMenu>
  );
};
