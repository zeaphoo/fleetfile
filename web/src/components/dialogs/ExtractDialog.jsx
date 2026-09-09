import { useState } from "react";
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
import { useProgressStore } from "@/store/progress-store";
import { api, parentPath, nextOpId } from "@/lib/api";

export function ExtractDialog({ file }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [dest, setDest] = useState(() => parentPath(file.path));
  const [password, setPassword] = useState("");

  const canPassword = /\.(zip|7z|rar)$/i.test(file.name);

  // zip/tar/7z/rar all extract in-process (progress + cancel): hand off to the
  // global progress overlay and close the modal immediately.
  const submit = async () => {
    if (!dest.trim()) return;

    const op = nextOpId("op-x");
    useProgressStore.getState().start(op);
    close();
    try {
      await api.extract(file.path, dest.trim(), password || undefined, op);
      useFileStore.getState().refresh();
    } catch {
      // failure is surfaced via the `op-error` WebSocket event → overlay
    }
  };

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("dialog.extractTitle")} — {file.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.destDir")}</Label>
            <Input
              className="h-8 font-mono text-xs"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
            />
          </div>
          {canPassword && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("dialog.password")}（7z/rar/zip）</Label>
              <Input
                className="h-8 text-xs"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("dialog.passwordOptional")}
              />
            </div>
          )}
        </div>
        <DialogFooter className="gap-1">
          <Button variant="outline" size="sm" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={submit}>
            {t("dialog.extract")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
