import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Loader2 } from "lucide-react";
import { useFileStore } from "@/store/file-store";
import { useFileActions } from "@/hooks/use-file-actions";
import { ExplorerContextMenu } from "@/components/ExplorerContextMenu";
import { getFileIcon } from "@/lib/file-utils";
import { folderColorHex } from "@/lib/folder-colors";
import { setDrag, clearDrag } from "@/lib/drag-state";
import { api } from "@/lib/api";

/**
 * Tree view — recursive expandable directory tree.
 * Folders lazy-load their children on first expand (fetch per folder).
 */

function TreeRow({
  entry,
  depth,
  expanded,
  loading,
  selected,
  colored,
  tab,
  onToggle,
  onSelect,
  onOpen,
}) {
  const { Icon, color } = getFileIcon(entry);
  const hasChildren = entry.is_dir;

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      className={`group flex min-w-0 cursor-default items-center rounded px-2 py-1 text-sm ${
        selected ? "bg-accent" : "hover:bg-accent/50"
      }`}
      style={{ paddingLeft: `${depth * 18 + 6}px` }}
      onClick={(e) => onSelect(e)}
      onDoubleClick={() => (!hasChildren ? onOpen(entry) : null)}
      onContextMenu={() => {
        if (!selected) useFileStore.getState().select(entry, {}, tab.id);
      }}
      draggable
      onDragStart={(e) => {
        const op = e.ctrlKey || e.metaKey ? "copy" : "move";
        setDrag({ paths: [entry.path], operation: op });
        e.dataTransfer.effectAllowed = op === "copy" ? "copy" : "move";
        try {
          e.dataTransfer.setData("text/plain", entry.path);
        } catch {
          /* noop */
        }
      }}
      onDragEnd={() => clearDrag()}
    >
      {hasChildren ? (
        <button
          className="mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(entry);
          }}
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : (
            <ChevronRight
              className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            />
          )}
        </button>
      ) : (
        <span className="mr-0.5 h-5 w-5 shrink-0" />
      )}
      <span className="relative mr-1.5 flex shrink-0 items-center justify-center">
        <Icon className={`h-4 w-4 ${color}`} strokeWidth={1.5} />
        {colored && (
          <span
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full ring-1 ring-background"
            style={{ backgroundColor: folderColorHex(colored) }}
          />
        )}
      </span>
      <span className="truncate">{entry.name}</span>
    </div>
  );
}

export function TreeView({ tab }) {
  const { t } = useTranslation();
  const actions = useFileActions(tab.id);

  /** expandedFolders: Set<path>; folderContents: Map<path, Entry[]> */
  const [expanded, setExpanded] = useState(() => new Set());
  const [contents, setContents] = useState(() => new Map());
  const [loadingMap, setLoadingMap] = useState(() => new Map());

  const colorOf = (path) => useFileStore.getState().folderColorOf(path);

  const loadChildren = useCallback(async (entry) => {
    setLoadingMap((m) => new Map(m).set(entry.path, true));
    try {
      const entries = await api.readDir(entry.path);
      setContents((m) => new Map(m).set(entry.path, entries));
    } catch {
      setContents((m) => new Map(m).set(entry.path, []));
    } finally {
      setLoadingMap((m) => {
        const next = new Map(m);
        next.delete(entry.path);
        return next;
      });
    }
  }, []);

  const toggle = useCallback(
    (entry) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
          if (!contents.has(entry.path)) loadChildren(entry);
        }
        return next;
      });
    },
    [contents, loadChildren],
  );

  const select = useCallback(
    (e, entry) => {
      e.stopPropagation();
      useFileStore
        .getState()
        .select(entry, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, tab.id);
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (entry.is_dir) toggle(entry);
    },
    [tab.id, toggle],
  );

  const sorted = useMemo(() => {
    const list = [...tab.entries];
    const dirsFirst = (a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    };
    list.sort(dirsFirst);
    if (tab.filter) {
      const q = tab.filter.trim().toLowerCase();
      return list.filter(
        (e) => e.name.toLowerCase().includes(q) || (e.file_type || "").includes(q),
      );
    }
    return list;
  }, [tab.entries, tab.filter]);

  const renderChildren = (list, depth) =>
    [...list]
      .sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      })
      .map((entry) => {
        const isExpanded = entry.is_dir && expanded.has(entry.path);
        const childList = isExpanded ? contents.get(entry.path) : null;
        const selected = tab.selection.some((x) => x.path === entry.path);
        return (
          <div key={entry.path}>
            <TreeRow
              entry={entry}
              depth={depth}
              expanded={isExpanded}
              loading={!!loadingMap.get(entry.path)}
              selected={selected}
              colored={colorOf(entry.path)}
              tab={tab}
              onToggle={toggle}
              onSelect={(e) => select(e, entry)}
              onOpen={(e) => actions.preview(e)}
            />
            {isExpanded &&
              (childList ? (
                <div role="group">{renderChildren(childList, depth + 1)}</div>
              ) : (
                <div
                  className="flex items-center gap-1 py-0.5 text-xs text-muted-foreground"
                  style={{ paddingLeft: `${(depth + 1) * 18 + 6}px` }}
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("common.loading")}
                </div>
              ))}
          </div>
        );
      });

  return (
    <ExplorerContextMenu
      actions={actions}
      selection={tab.selection}
      onSelectAll={() => useFileStore.getState().selectAll(tab.id)}
    >
      <div
        role="tree"
        aria-label="File tree"
        className="flex-1 overflow-auto px-2 py-2 outline-none"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            useFileStore.getState().clearSelection(tab.id);
          }
        }}
      >
        {tab.error ? (
          <div className="flex h-32 items-center justify-center text-sm text-destructive">
            {tab.error}
          </div>
        ) : tab.loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : sorted.length === 0 ? (
          <div className="w-full py-16 text-center text-sm text-muted-foreground">
            {tab.filter ? t("common.noMatch") : t("common.empty")}
          </div>
        ) : (
          renderChildren(sorted, 0)
        )}
      </div>
    </ExplorerContextMenu>
  );
}