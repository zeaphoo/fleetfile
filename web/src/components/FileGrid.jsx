import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFileStore } from "@/store/file-store";
import { useClipboardStore } from "@/store/clipboard-store";
import { useDialogStore } from "@/store/dialog-store";
import { useFileActions } from "@/hooks/use-file-actions";
import { useGridKeyboardNav } from "@/hooks/use-grid-nav";
import { ExplorerContextMenu } from "@/components/ExplorerContextMenu";
import { getFileIcon, formatSize } from "@/lib/file-utils";
import { sortFiles, groupFilesByDate } from "@/lib/sort-files";
import { setDrag, getDrag, clearDrag } from "@/lib/drag-state";
import { executePaste } from "@/lib/paste";
import { api, normalizePath } from "@/lib/api";

function filterEntries(entries, q) {
  const query = (q || "").trim().toLowerCase();
  if (!query) return entries;
  return entries.filter(
    (e) =>
      e.name.toLowerCase().includes(query) ||
      (e.file_type || "").toLowerCase().includes(query),
  );
}

function isInsideOrSame(path, dir) {
  const p = normalizePath(path);
  const d = normalizePath(dir);
  return p === d || p.startsWith(d + "/");
}

function FileGridItem({ entry, index, tab, actions, selected, isCut }) {
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
      className={`flex w-28 flex-col items-center gap-1 rounded-lg p-2 text-center focus:outline-none ${
        selected ? "bg-accent ring-1 ring-ring/30" : "hover:bg-accent/60"
      } ${isCut ? "opacity-50" : ""}`}
      title={entry.path}
    >
      {isImage ? (
        <img
          src={api.thumbnailUrl(entry.path, 128)}
          alt={entry.name}
          loading="lazy"
          className="h-12 w-12 rounded object-cover"
          draggable={false}
        />
      ) : (
        <Icon className={`h-10 w-10 ${color}`} strokeWidth={1.5} />
      )}
      <span className="line-clamp-2 w-full break-all text-xs">{entry.name}</span>
      <span className="text-[10px] text-muted-foreground">
        {entry.is_dir ? "" : formatSize(entry.size)}
      </span>
    </button>
  );
}

function GridContent({ tab, actions }) {
  const { t } = useTranslation();
  const { selection } = tab;
  const clipFiles = useClipboardStore((s) => s.files);
  const clipOp = useClipboardStore((s) => s.operation);

  const visible = useMemo(
    () => sortFiles(filterEntries(tab.entries, tab.filter), tab.sortBy, tab.sortOrder),
    [tab.entries, tab.filter, tab.sortBy, tab.sortOrder],
  );

  if (tab.error) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-destructive">
        {tab.error}
      </div>
    );
  }
  if (tab.loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  const isSelected = (e) => selection.some((x) => x.path === e.path);
  const isCut = (e) => clipOp === "cut" && clipFiles.some((f) => f.path === e.path);

  const renderItems = (files) => (
    <div className="flex flex-wrap content-start gap-1">
      {files.map((entry, i) => (
        <FileGridItem
          key={entry.path}
          entry={entry}
          index={i}
          tab={tab}
          actions={actions}
          selected={isSelected(entry)}
          isCut={isCut(entry)}
        />
      ))}
    </div>
  );

  if (visible.length === 0) {
    return (
      <div className="w-full py-16 text-center text-sm text-muted-foreground">
        {tab.filter ? t("common.noMatch") : t("common.empty")}
      </div>
    );
  }

  if (tab.groupByDate) {
    return (
      <div className="space-y-4 p-3">
        {groupFilesByDate(visible).map((g) => (
          <div key={g.group}>
            <div className="mb-1 border-b pb-1 text-xs font-semibold text-muted-foreground">
              {t(`dateGroup.${g.group}`)}（{g.files.length}）
            </div>
            {renderItems(g.files)}
          </div>
        ))}
      </div>
    );
  }

  return <div className="p-3">{renderItems(visible)}</div>;
}

export function FileGrid({ tab }) {
  const actions = useFileActions(tab.id);
  const gridRef = useRef(null);
  const { selection, entries: allEntries } = tab;

  const visible = useMemo(
    () => sortFiles(filterEntries(allEntries, tab.filter), tab.sortBy, tab.sortOrder),
    [allEntries, tab.filter, tab.sortBy, tab.sortOrder],
  );

  useGridKeyboardNav({
    entries: visible,
    selection,
    selectIndex: (i) => useFileStore.getState().selectIndex(i, tab.id),
    select: (e, opts) => useFileStore.getState().select(e, opts, tab.id),
    onEnter: actions.preview,
    containerRef: gridRef,
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

  return (
    <ExplorerContextMenu
      actions={actions}
      selection={selection}
      onSelectAll={() => useFileStore.getState().selectAll(tab.id)}
    >
      <div
        ref={gridRef}
        tabIndex={0}
        className="flex-1 overflow-hidden outline-none"
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
        <ScrollArea className="h-full">
          <GridContent tab={tab} actions={actions} />
        </ScrollArea>
      </div>
    </ExplorerContextMenu>
  );
}
