import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDialogStore } from "@/store/dialog-store";
import { formatSize, formatDate } from "@/lib/file-utils";

export function ConflictDialog({ file, conflict, remaining, resolve }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [applyToAll, setApplyToAll] = useState(false);

  const answer = (resolution) => {
    resolve({ resolution, applyToAll });
    close();
  };

  const info = conflict?.destination;
  const src = conflict?.source;

  return (
    <Dialog open onOpenChange={() => answer("skip")}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialog.conflictTitle", { name: file.name })}</DialogTitle>
          <DialogDescription>
            {remaining > 0 ? t("dialog.conflictRemaining", { count: remaining }) : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          {src && (
            <p className="text-muted-foreground">
              {t("dialog.source", { size: formatSize(src.size), time: formatDate(src.modified) })}
            </p>
          )}
          {info && (
            <p className="text-muted-foreground">
              {t("dialog.target", { size: formatSize(info.size), time: formatDate(info.modified) })}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={applyToAll} onCheckedChange={setApplyToAll} />
          {t("dialog.applyToAll")}
        </label>
        <DialogFooter className="gap-1">
          <Button variant="outline" onClick={() => answer("skip")}>
            {t("dialog.skip")}
          </Button>
          <Button variant="outline" onClick={() => answer("keep-both")}>
            {t("dialog.keepBoth")}
          </Button>
          <Button onClick={() => answer("replace")}>{t("dialog.replace")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
