import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDialogStore } from "@/store/dialog-store";
import { useFileActions } from "@/hooks/use-file-actions";
import { errMsg } from "@/lib/api";

export function RenameDialog({ entry }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const renameTo = useFileActions().renameTo;
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!name || name === entry.name) return close();
    try {
      await renameTo(entry, name);
      close();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("dialog.renameTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          onFocus={(e) => {
            const dot = name.lastIndexOf(".");
            e.target.setSelectionRange(0, dot > 0 ? dot : name.length);
          }}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit}>{t("common.ok")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
