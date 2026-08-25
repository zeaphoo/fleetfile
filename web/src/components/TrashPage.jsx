import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useFileStore } from "@/store/file-store";
import { formatDate } from "@/lib/file-utils";
import { Button } from "@/components/ui/button";
import { useDialogStore } from "@/store/dialog-store";

export function TrashPage({ tabId }) {
  const { t } = useTranslation();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.listTrash());
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = (id) => run(() => api.restoreTrash(id));
  const purge = (id) => run(() => api.purgeTrash(id));
  const empty = () => {
    useDialogStore.getState().open("confirm", {
      title: t("dialog.clearTrashTitle"),
      description: t("dialog.clearTrashDesc"),
      confirmLabel: t("dialog.clearTrash"),
      onConfirm: () => run(() => api.emptyTrash()),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => useFileStore.getState().setPage("explorer", tabId)}
          title={t("nav.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="font-medium">{t("common.trash")}</span>
        <span className="text-xs text-muted-foreground">
          {items ? `${items.length} ${t("common.items")}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={load}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> {t("common.refresh")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={!items?.length || busy}
            onClick={empty}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> {t("dialog.emptyTrash")}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p className="p-4 text-sm text-destructive">{error}</p>}
        {!error && items === null && (
          <p className="p-4 text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        {!error && items && items.length === 0 && (
          <p className="w-full py-16 text-center text-sm text-muted-foreground">
            {t("dialog.trashEmpty")}
          </p>
        )}
        {!error && items && items.length > 0 && (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t("common.name")}</th>
                <th className="px-3 py-2 font-medium">{t("dialog.originalPath")}</th>
                <th className="w-44 px-3 py-2 font-medium">{t("dialog.deletedAt")}</th>
                <th className="w-32 px-3 py-2 font-medium">{t("dialog.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b text-sm hover:bg-accent/40">
                  <td className="max-w-[280px] truncate px-3 py-2">{it.name}</td>
                  <td className="max-w-[320px] truncate px-3 py-2 font-mono text-xs text-muted-foreground">
                    {it.original_parent || "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDate(it.time_deleted)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        disabled={busy}
                        onClick={() => restore(it.id)}
                      >
                        <Undo2 className="mr-1 h-3 w-3" /> {t("dialog.restore")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => purge(it.id)}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
