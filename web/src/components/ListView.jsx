import { Fragment, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useFileStore } from "@/store/file-store";
import { useDialogStore } from "@/store/dialog-store";
import { useClipboardStore } from "@/store/clipboard-store";
import { useFileActions } from "@/hooks/use-file-actions";
import { useGridKeyboardNav } from "@/hooks/use-grid-nav";
import { ExplorerContextMenu } from "@/components/ExplorerContextMenu";
import { getFileIcon, formatSize, formatDate } from "@/lib/file-utils";
import { sortFiles, groupFilesByDate } from "@/lib/sort-files";
import { folderColorHex } from "@/lib/folder-colors";
import { setDrag, getDrag, clearDrag } from "@/lib/drag-state";
import { executePaste } from "@/lib/paste";

const COLUMNS = [
  { key: "name", labelKey: "common.name", className: "" },
  { key: "size", labelKey: "common.size", className: "w-24 text-right" },
  { key: "type", labelKey: "common.type", className: "w-28" },
  { key: "dateModified", labelKey: "common.modified", className: "w-40" },
];

const filterEntries = (entries, q) => {
  const query = (q || "").trim().toLowerCase();
  if (!query) return entries;
  return entries.filter(
    (e) =>
      e.name.toLowerCase().includes(query) ||
      (e.file_type || "").toLowerCase().includes(query),
  );
};

const SortIcon = ({ columnKey, tab }) => {
  if (tab.sortBy !== columnKey) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return tab.sortOrder === "asc" ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  );
};

const ListRow = ({ entry, index, tab, actions, selected, isCut, colored }) => {
  const { Icon, color } = getFileIcon(entry);
  const select = (e, opts) => {
    e.stopPropagation();
    useFileStore.getState().select(entry, opts, tab.id);
  };

  return (
    <tr
      data-file-index={index}
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
      onClick={(e) => select(e, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
      onDoubleClick={() => actions.preview(entry)}
      onContextMenu={() => {
        if (!selected) useFileStore.getState().select(entry, {}, tab.id);
      }}
      className={`cursor-default border-b text-sm ${
        selected ? "bg-accent" : "hover:bg-accent/50"
      } ${isCut ? "opacity-50" : ""}`}
    >
      <td className="px-2 py-1.5">
        <span className="flex items-center gap-2">
          <span className="relative shrink-0">
            <Icon className={`h-4 w-4 ${color}`} strokeWidth={1.5} />
            {colored && (
              <span
                className="absolute -right-1 -top-1 h-2 w-2 rounded-full ring-1 ring-background"
                style={{ backgroundColor: folderColorHex(colored) }}
              />
            )}
          </span>
          <span className="truncate">{entry.name}</span>
        </span>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
        {entry.is_dir ? "" : formatSize(entry.size)}
      </td>
      <td className="px-2 py-1.5 text-muted-foreground">{entry.file_type}</td>
      <td className="px-2 py-1.5 text-muted-foreground">{formatDate(entry.modified)}</td>
    </tr>
  );
};

const TableHeader = ({ tab }) => {
  const { t } = useTranslation();
  return (
    <thead className="sticky top-0 z-10 bg-background">
      <tr className="border-b text-left text-xs text-muted-foreground">
        {COLUMNS.map((c) => (
          <th
            key={c.key}
            className={`cursor-pointer select-none px-2 py-1.5 font-medium hover:text-foreground ${c.className}`}
            onClick={() => useFileStore.getState().setSort(c.key, tab.id)}
          >
            <span className="inline-flex items-center gap-1">
              {t(c.labelKey)}
              <SortIcon columnKey={c.key} tab={tab} />
            </span>
          </th>
        ))}
      </tr>
    </thead>
  );
};

export const ListView = ({ tab }) => {
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
    itemWidth: 800,
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

  const renderRows = (files, startIndex = 0) =>
    files.map((entry, i) => (
      <ListRow
        key={entry.path}
        entry={entry}
        index={startIndex + i}
        tab={tab}
        actions={actions}
        selected={isSelected(entry)}
        isCut={isCut(entry)}
        colored={entry.is_dir ? folderColors[entry.path] || null : null}
      />
    ));

  // Grouped view — split visible entries into date groups with section headers
  const renderGrouped = () => {
    const groups = groupFilesByDate(visible);
    let cumulativeIndex = 0;
    return (
      <table className="w-full border-collapse">
        <TableHeader tab={tab} />
        <tbody>
          {groups.map((g) => {
            const startIndex = cumulativeIndex;
            cumulativeIndex += g.files.length;
            return (
              <Fragment key={g.group}>
                <tr className="bg-muted/50">
                  <td
                    colSpan={COLUMNS.length}
                    className="px-2 py-1.5 text-xs font-semibold text-muted-foreground"
                  >
                    {t(`dateGroup.${g.group}`)}（{g.files.length}）
                  </td>
                </tr>
                {renderRows(g.files, startIndex)}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    );
  };

  // Flat view — single table, rows in sort order
  const renderFlat = () => (
    <table className="w-full border-collapse">
      <TableHeader tab={tab} />
      <tbody>{renderRows(visible)}</tbody>
    </table>
  );

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
        onDragOver={(e) => e.preventDefault()}
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
        ) : tab.groupByDate ? (
          renderGrouped()
        ) : (
          renderFlat()
        )}
      </div>
    </ExplorerContextMenu>
  );
};
