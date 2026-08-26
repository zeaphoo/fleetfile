import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFileStore } from "@/store/file-store";
import { useDialogStore } from "@/store/dialog-store";
import { useClipboardStore } from "@/store/clipboard-store";
import { useFileActions } from "@/hooks/use-file-actions";
import { useGridKeyboardNav } from "@/hooks/use-grid-nav";
import { ExplorerContextMenu } from "@/components/ExplorerContextMenu";
import { getFileIcon, formatSize, formatDate } from "@/lib/file-utils";
import { sortFiles } from "@/lib/sort-files";
import { folderColorHex } from "@/lib/folder-colors";
import { setDrag, getDrag, clearDrag } from "@/lib/drag-state";
import { executePaste } from "@/lib/paste";
import { api, normalizePath } from "@/lib/api";

const filterEntries = (entries, q) => {
  const query = (q || "").trim().toLowerCase();
  if (!query) return entries;
  return entries.filter(
    (e) =>
      e.name.toLowerCase().includes(query) ||
      (e.file_type || "").toLowerCase().includes(query),
  );
};

const isInsideOrSame = (path, dir) => {
  const p = normalizePath(path);
  const d = normalizePath(dir);
  return p === d || p.startsWith(d + "/");
};

function ContentItem({ entry, index, tab, actions, selected, isCut, colored }) {
  const { Icon, color } = getFileIcon(entry);
  const isImage = entry.file_type === "image" && !entry.is_dir;

  const select = (e, opts) => {
    e.stopPropagation();
    useFileStore.getState().select(entry, opts, tab.id);
  };

  const onDragStart = (e) => {
    const op = e.ctrlKey || e.metaKey ? "copy" : "move";
    setDrag({ paths: [entry.path], operation: op });
    e.dataTransfer.effectAllowed = op === "copy" ? "copy" : "move";
    try {
      e.dataTransfer.setData("text/plain", entry.path);
    } catch {
      /* noop */
    }
  };

  const onDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!entry.is_dir) return;
    const drag = getDrag();
    const op = e.ctrlKey || e.metaKey ? "copy" : drag?.operation || "move";
    const sources = drag?.paths || [];
    if (sources.some((p) => isInsideOrSame(p, entry.path))) {
      clearDrag();
      return;
    }
    const files = sources.map((p) => ({ name: p.split(/[/\\]/).pop(), path: p }));
    await executePaste({
      files,
      operation: op,
      targetPath: entry.path,
      askConflict: (payload) => useDialogStore.getState().askConflict(payload),
    });
    clearDrag();
    useFileStore.getState().refresh(tab.id);
  };

  return (
    <div
      data-file-index={index}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (entry.is_dir) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={entry.is_dir ? onDrop : undefined}
      onClick={(e) => select(e, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
      onDoubleClick={() => actions.preview(entry)}
      onContextMenu={() => {
        if (!selected) useFileStore.getState().select(entry, {}, tab.id);
      }}
      className={`group flex w-full cursor-default items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
        selected ? "border-primary/40 bg-accent" : "border-transparent hover:bg-accent/50"
      } ${isCut ? "opacity-50" : ""}`}
      title={entry.path}
    >
      {/* Large icon / thumbnail */}
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40">
        {isImage ? (
          <img
            src={api.thumbnailUrl(entry.path, 96)}
            alt={entry.name}
            loading="lazy"
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <span className="relative">
            <Icon className={`h-9 w-9 ${color}`} strokeWidth={1.4} />
            {colored && (
              <span
                className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-1 ring-background"
                style={{ backgroundColor: folderColorHex(colored) }}
              />
            )}
          </span>
        )}
      </div>

      {/* Name + stacked metadata */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`truncate text-sm font-medium ${
            entry.is_dir ? "text-foreground" : "text-foreground/90"
          }`}
        >
          {entry.name}
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {entry.is_dir ? "文件夹" : formatSize(entry.size)}
          </span>
          {!entry.is_dir && <span className="capitalize">{entry.file_type}</span>}
          <span>{formatDate(entry.modified)}</span>
        </div>
      </div>
    </div>
  );
}

export function ContentView({ tab }) {
  const { t } = useTranslation();
  const actions = useFileActions(tab.id);
  const containerRef = useRef(null);
  const clipFiles = useClipboardStore((s) => s.files);
  const clipOp = useClipboardStore((s) => s.operation);
  const folderColors = useFileStore((s) => s.folderColors);

  const visible = useMemo(
    () => sortFiles(filterEntries(tab.entries, tab.filter), tab.sortBy, tab.sortOrder),
    [tab.entries, tab.filter, tab.sortBy, tab.sortOrder],
  );

  useGridKeyboardNav({
    entries: visible,
    selection: tab.selection,
    selectIndex: (i) => useFileStore.getState().selectIndex(i, tab.id),
    select: (e, opts) => useFileStore.getState().select(e, opts, tab.id),
    onEnter: actions.preview,
    containerRef,
    enabled: tab.page === "explorer",
  });

  const onDropBackground = async (e) => {
    e.preventDefault();
    const drag = getDrag();
    let sources = drag?.paths || [];
    const op = e.ctrlKey || e.metaKey ? "copy" : drag?.operation || "move";
    if (!sources.length) {
      const dt = e.dataTransfer;
      if (dt?.files?.length) {
        sources = Array.from(dt.files).map((f) => f.path || f.name);
      } else {
        const raw = dt?.getData?.("text/uri-list") || dt?.getData?.("text/plain");
        sources = (raw || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("#") && !s.startsWith("http"));
      }
    }
    if (!sources.length) {
      clearDrag();
      return;
    }
    const files = sources.map((p) => ({ name: p.split(/[/\\]/).pop(), path: p }));
    await executePaste({
      files,
      operation: op,
      targetPath: tab.cwd,
      askConflict: (payload) => useDialogStore.getState().askConflict(payload),
    });
    clearDrag();
    useFileStore.getState().refresh(tab.id);
  };

  const isSelected = (e) => tab.selection.some((x) => x.path === e.path);
  const isCut = (e) => clipOp === "cut" && clipFiles.some((f) => f.path === e.path);

  return (
    <ExplorerContextMenu
      actions={actions}
      selection={tab.selection}
      onSelectAll={() => useFileStore.getState().selectAll(tab.id)}
    >
      <div
        ref={containerRef}
        tabIndex={0}
        className="flex-1 overflow-auto outline-none"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={onDropBackground}
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
        ) : visible.length === 0 ? (
          <div className="w-full py-16 text-center text-sm text-muted-foreground">
            {tab.filter ? t("common.noMatch") : t("common.empty")}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-3">
            {visible.map((entry, i) => (
              <ContentItem
                key={entry.path}
                entry={entry}
                index={i}
                tab={tab}
                actions={actions}
                selected={isSelected(entry)}
                isCut={isCut(entry)}
                colored={entry.is_dir ? folderColors[entry.path] || null : null}
              />
            ))}
          </div>
        )}
      </div>
    </ExplorerContextMenu>
  );
}