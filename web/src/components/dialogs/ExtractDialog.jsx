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
import { api, errMsg, parentPath } from "@/lib/api";

export function ExtractDialog({ file }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [dest, setDest] = useState(() => parentPath(file.path));
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const canPassword = /\.(zip|7z|rar)$/i.test(file.name);

  const submit = async () => {
    if (!dest.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.extract(file.path, dest.trim(), password || undefined);
      useFileStore.getState().refresh();
      close();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-1">
          <Button variant="outline" size="sm" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={busy} onClick={submit}>
            {t("dialog.extract")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
