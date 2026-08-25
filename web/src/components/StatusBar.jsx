import { useFileStore } from "@/store/file-store";
import { useTranslation } from "react-i18next";
import { formatDate, formatSize } from "@/lib/file-utils";
import { normalizePath } from "@/lib/api";

export function StatusBar({ notice, onDismissNotice }) {
  const { t } = useTranslation();
  const store = useFileStore();
  const tab = store.activeTab();
  if (!tab) return null;

  const { entries, cwd, filter } = tab;
  const q = (filter || "").trim().toLowerCase();
  const shown = q
    ? entries.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.file_type || "").toLowerCase().includes(q),
      ).length
    : entries.length;
  const lastModified = entries
    .map((e) => e.modified)
    .filter(Boolean)
    .sort()
    .at(-1);
  const totalSize = entries.reduce((a, e) => a + (e.size || 0), 0);

  return (
    <footer className="flex items-center justify-between gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
      {notice && (
        <button
          onClick={() => {
            onDismissNotice?.();
            useFileStore.getState().refresh();
          }}
          className="shrink-0 rounded bg-amber-500/20 px-2 py-0.5 text-amber-700 hover:bg-amber-500/30 dark:text-amber-400"
        >
          {notice.text}
        </button>
      )}
      <span className="shrink-0">
        {t("status.total", {
          shown,
          extra: filter && shown !== entries.length ? t("status.ofTotal", { total: entries.length }) : "",
        })}
      </span>
      <span className="min-w-0 truncate font-mono">
        {tab.page === "trash" ? t("common.trash") : normalizePath(cwd || "")}
      </span>
      <span className="shrink-0">
        {t("common.recentModified", { time: formatDate(lastModified) })}
      </span>
      <span className="hidden shrink-0 md:inline">{formatSize(totalSize)}</span>
    </footer>
  );
}
