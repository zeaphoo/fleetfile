import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDialogStore } from "@/store/dialog-store";
import { useFileStore } from "@/store/file-store";
import { api, errMsg } from "@/lib/api";
import { formatSize } from "@/lib/file-utils";

export function DuplicatesDialog({ dir }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [minSize, setMinSize] = useState("0");
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      setGroups(await api.duplicates(dir, Number(minSize) || 0));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (files, toTrash) => {
    for (const f of files.slice(1)) {
      try {
        await api.deleteEntry(f, toTrash);
      } catch {
        /* skip */
      }
    }
    useFileStore.getState().refresh();
    scan();
  };

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("dialog.duplicatesTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.minSize")}</Label>
            <Input
              className="h-8 w-28 text-xs"
              type="number"
              value={minSize}
              onChange={(e) => setMinSize(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={scan}>
            {t("common.refresh")}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!groups && busy && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        <div className="max-h-72 overflow-auto rounded-md border">
          {groups && groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("dialog.noDuplicates")}</p>
          )}
          {groups &&
            groups.map((g, gi) => (
              <div key={gi} className="border-b p-2 last:border-0">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {t("dialog.duplicateGroup")} · {formatSize(g.size)} · {g.files.length} 个文件
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-5 text-[11px]"
                      disabled={busy}
                      onClick={() => remove(g.files, true)}
                    >
                      {t("contextMenu.moveToTrash")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-5 text-[11px]"
                      disabled={busy}
                      onClick={() => remove(g.files, false)}
                    >
                      {t("common.delete")}
                    </Button>
                  </div>
                </div>
                {g.files.map((f) => (
                  <div key={f} className="truncate px-1 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {f}
                  </div>
                ))}
              </div>
            ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
