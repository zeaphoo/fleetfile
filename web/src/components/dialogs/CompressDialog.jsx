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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDialogStore } from "@/store/dialog-store";
import { useFileStore } from "@/store/file-store";
import { api, errMsg, basename, joinPath } from "@/lib/api";

export function CompressDialog({ files }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [format, setFormat] = useState("zip");
  const [name, setName] = useState(() => {
    const base = files.length === 1 ? basename(files[0].path) : "archive";
    return base.replace(/\.(zip|tar|gz|bz2|xz|7z)$/i, "");
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sevenz, setSevenz] = useState(true); // assume available until probed
  const [rars, setRars] = useState(false);

  useEffect(() => {
    api
      .sevenzStatus()
      .then((s) => {
        setSevenz(!!s.available);
        setRars(!!s.rars?.available);
      })
      .catch(() => setSevenz(false));
  }, []);

  const ext = format === "tar.gz" ? "tar.gz" : format;

  const submit = async () => {
    const tab = useFileStore.getState().activeTab();
    const cwd = tab?.cwd;
    if (!cwd || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const dest = joinPath(cwd, `${name.trim()}.${ext}`);
      await api.compress(
        files.map((f) => f.path),
        dest,
        format,
        6,
      );
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
                <SelectItem value="7z" disabled={!sevenz}>
                  7Z{sevenz ? "" : t("dialog.archiveHint", { tool: "7-Zip" })}
                </SelectItem>
                <SelectItem value="rar" disabled={!rars}>
                  RAR{rars ? "" : t("dialog.archiveHint", { tool: "rars-cli" })}
                </SelectItem>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-1">
          <Button variant="outline" size="sm" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={busy} onClick={submit}>
            {t("dialog.compress")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
