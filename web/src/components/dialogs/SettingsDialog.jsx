import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDialogStore } from "@/store/dialog-store";
import { useSettingsStore } from "@/store/settings-store";

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[90px_1fr] items-center gap-3 py-1.5 text-sm">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function SettingsDialog() {
  const close = useDialogStore((s) => s.close);
  const { t } = useTranslation();
  const settings = useSettingsStore();

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
        </DialogHeader>
        <div className="py-1">
          <div className="mb-1 px-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("settings.appearance")}
          </div>
          <Field label={t("settings.theme")}>
            <Select value={settings.theme} onValueChange={settings.setTheme}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t("settings.light")}</SelectItem>
                <SelectItem value="dark">{t("settings.dark")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("settings.language")}>
            <Select value={settings.language} onValueChange={settings.setLanguage}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">{t("settings.chinese")}</SelectItem>
                <SelectItem value="en">{t("settings.english")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <div className="mb-1 mt-3 px-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("settings.explorer")}
          </div>
          <Field label={t("settings.defaultView")}>
            <Select value={settings.defaultView} onValueChange={settings.setDefaultView}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grid">{t("settings.grid")}</SelectItem>
                <SelectItem value="list">{t("settings.list")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("settings.defaultSort")}>
            <Select value={settings.defaultSort} onValueChange={settings.setDefaultSort}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">{t("nav.byName")}</SelectItem>
                <SelectItem value="size">{t("nav.bySize")}</SelectItem>
                <SelectItem value="dateModified">{t("nav.byDate")}</SelectItem>
                <SelectItem value="type">{t("nav.byType")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <label className="mt-1 flex items-center gap-2 px-0.5 py-1.5 text-sm">
            <Checkbox
              checked={settings.restoreSession}
              onCheckedChange={(v) => settings.setRestoreSession(!!v)}
            />
            {t("settings.restoreSession")}
          </label>
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
