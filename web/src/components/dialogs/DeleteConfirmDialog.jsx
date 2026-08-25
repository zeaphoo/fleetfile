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
import { useDialogStore } from "@/store/dialog-store";
import { useFileActions } from "@/hooks/use-file-actions";

export function DeleteConfirmDialog({ files }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const doDelete = useFileActions().doDelete;

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("dialog.permanentDeleteTitle")}</DialogTitle>
          <DialogDescription>
            {t("dialog.permanentDeleteDesc", { count: files.length })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              doDelete(files, false);
              close();
            }}
          >
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
