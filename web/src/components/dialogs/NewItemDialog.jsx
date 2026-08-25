import { useEffect, useState } from "react";
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
import { useFileActions } from "@/hooks/use-file-actions";
import { api, errMsg } from "@/lib/api";

export function NewItemDialog({ kind }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const createItem = useFileActions().createItem;
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [template, setTemplate] = useState("");
  const isDir = kind === "dir";

  useEffect(() => {
    if (isDir) return;
    api
      .templates()
      .then((list) => {
        setTemplates(list || []);
        if (list?.length) setTemplate(list[0].name);
      })
      .catch(() => {});
  }, [isDir]);

  const submit = async () => {
    if (!name.trim()) return;
    try {
      const trimmed = name.trim();
      if (isDir) {
        await createItem("dir", trimmed);
      } else {
        const tpl = templates.find((x) => x.name === template);
        const { activeTab, refresh } = useFileStore.getState();
        const cwd = activeTab()?.cwd;
        if (!cwd) return;
        const sep = cwd.includes("\\") ? "\\" : "/";
        const base = trimmed.includes(".")
          ? trimmed
          : trimmed + (tpl?.extension ? "." + tpl.extension : "");
        const path = cwd.endsWith(sep) ? cwd + base : cwd + sep + base;
        if (tpl?.content) {
          await api.writeText(path, tpl.content);
        } else {
          await api.createFile(path);
        }
        refresh();
      }
      close();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isDir ? t("dialog.newFolderTitle") : t("dialog.newFileTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder={isDir ? t("dialog.folderNamePlaceholder") : t("dialog.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {!isDir && templates.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.template")}</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tp) => (
                  <SelectItem key={tp.name} value={tp.name}>
                    {tp.name}
                    {tp.extension ? ` (.${tp.extension})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit}>{t("dialog.create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
