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

const GalleryItem = ({ entry, index, tab, actions, selected, isCut, colored }) => {
  const { Icon, color } = getFileIcon(entry);
  const isImage = entry.file_type === "image" && !entry.is_dir;
  const isVideo = entry.file_type === "video" && !entry.is_dir;

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
    <button
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
      className={`group flex w-48 flex-col overflow-hidden rounded-lg border bg-background transition-all hover:shadow-md ${
        selected ? "ring-2 ring-primary" : "hover:border-primary/50"
      } ${isCut ? "opacity-50" : ""}`}
      title={entry.path}
    >
      {/* Large preview area */}
      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-muted/30">
        {isImage ? (
          <img
            src={api.thumbnailUrl(entry.path, 256)}
            alt={entry.name}
            loading="lazy"
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : isVideo ? (
          <video
            src={api.assetUrl(entry.path)}
            className="h-full w-full object-cover"
            preload="metadata"
          />
        ) : (
          <span className="relative">
            <Icon className={`h-16 w-16 ${color}`} strokeWidth={1.2} />
            {colored && (
              <span
                className="absolute -right-1 -top-1 h-3 w-3 rounded-full ring-1 ring-background"
                style={{ backgroundColor: folderColorHex(colored) }}
              />
            )}
          </span>
        )}
        {entry.is_dir && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">
              打开
            </span>
          </div>
        )}
      </div>

      {/* Info area */}
      <div className="flex flex-col gap-1 p-2">
        <span className="line-clamp-2 text-xs font-medium">{entry.name}</span>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{entry.is_dir ? "文件夹" : formatSize(entry.size)}</span>
          <span>{formatDate(entry.modified)}</span>
        </div>
      </div>
    </button>
  );
};

export const GalleryView = ({ tab }) => {
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
          <div className="flex flex-wrap gap-4 p-4">
            {visible.map((entry, i) => (
              <GalleryItem
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
};
