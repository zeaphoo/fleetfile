import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDialogStore } from "@/store/dialog-store";
import { api, errMsg, basename } from "@/lib/api";
import { formatSize, formatDate } from "@/lib/file-utils";

const STATUS_LABEL = {
  only_left: "←",
  only_right: "→",
  modified: "≠",
  same: "=",
};

export function FolderCompareDialog({ left, right }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .folderCompare(left, right)
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [left, right]);

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("dialog.folderCompareTitle")}</DialogTitle>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="truncate font-mono">← {basename(left)}</span>
            <span className="truncate font-mono">→ {basename(right)}</span>
          </div>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!rows && !error && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        <div className="max-h-80 overflow-auto rounded-md border text-xs">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-muted-foreground">
                <th className="w-8 px-2 py-1.5 font-medium">{t("dialog.status")}</th>
                <th className="px-2 py-1.5 font-medium">{t("common.name")}</th>
                <th className="w-20 px-2 py-1.5 font-medium">{t("common.size")}</th>
                <th className="w-36 px-2 py-1.5 font-medium">{t("common.modified")}</th>
              </tr>
            </thead>
            <tbody>
              {rows &&
                rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-accent/40">
                    <td className={`px-2 py-1 text-center ${r.status === "same" ? "text-muted-foreground" : "font-bold"}`}>
                      {STATUS_LABEL[r.status] || "?"}
                    </td>
                    <td className="max-w-[280px] truncate px-2 py-1">{r.rel_path}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {r.left_size != null ? formatSize(r.left_size) : "—"}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {formatDate(r.left_modified) || "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={close}>
            {t("common.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
