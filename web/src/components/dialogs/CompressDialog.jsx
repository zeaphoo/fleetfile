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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDialogStore } from "@/store/dialog-store";
import { useFileStore } from "@/store/file-store";
import { useProgressStore } from "@/store/progress-store";
import { api, basename, joinPath, nextOpId } from "@/lib/api";

export function CompressDialog({ files }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [format, setFormat] = useState("zip");
  const [name, setName] = useState(() => {
    const base = files.length === 1 ? basename(files[0].path) : "archive";
    return base.replace(/\.(zip|tar|gz|bz2|xz|7z)$/i, "");
  });

  const ext = format === "tar.gz" ? "tar.gz" : format;

  // All formats (zip/tar/7z/rar) run in-process with byte progress + cancel:
  // hand off to the global progress overlay and close the modal immediately.
  const submit = async () => {
    const tab = useFileStore.getState().activeTab();
    const cwd = tab?.cwd;
    if (!cwd || !name.trim()) return;
    const dest = joinPath(cwd, `${name.trim()}.${ext}`);
    const sources = files.map((f) => f.path);

    const op = nextOpId("op-c");
    useProgressStore.getState().start(op);
    close();
    try {
      await api.compress(sources, dest, format, 6, op);
      useFileStore.getState().refresh();
    } catch {
      // failure is surfaced via the `op-error` WebSocket event → overlay
    }
  };

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("dialog.compressTitle")}（{files.length}）</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.archiveFormat")}</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zip">ZIP</SelectItem>
                <SelectItem value="tar">TAR</SelectItem>
                <SelectItem value="tar.gz">TAR.GZ</SelectItem>
                <SelectItem value="tar.bz2">TAR.BZ2</SelectItem>
                <SelectItem value="tar.xz">TAR.XZ</SelectItem>
                <SelectItem value="7z">7Z</SelectItem>
                <SelectItem value="rar">RAR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.archiveName")}</Label>
            <Input
              className="h-8 text-xs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="archive"
            />
            <p className="text-[11px] text-muted-foreground">. {ext}</p>
          </div>
        </div>
        <DialogFooter className="gap-1">
          <Button variant="outline" size="sm" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={submit}>
            {t("dialog.compress")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
