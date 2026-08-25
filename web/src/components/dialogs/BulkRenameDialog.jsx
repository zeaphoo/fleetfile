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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDialogStore } from "@/store/dialog-store";
import { useFileStore } from "@/store/file-store";
import { api, basename, errMsg, parentPath } from "@/lib/api";

const DEFAULT_RULES = {
  find: "",
  replace: "",
  use_regex: false,
  prefix: "",
  suffix: "",
  case: "none",
  counter: { enabled: false, position: "suffix", format: "{n}", start: 1, step: 1 },
};

export function BulkRenameDialog({ files }) {
  const close = useDialogStore((s) => s.close);
  const { t } = useTranslation();
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [results, setResults] = useState(null); // preview
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const dir = files[0] ? parentPath(files[0].path) : null;

  const patch = (p) => setRules((r) => ({ ...r, ...p }));
  const patchCounter = (p) =>
    setRules((r) => ({ ...r, counter: { ...r.counter, ...p } }));

  const runPreview = async (dryRun) => {
    if (!dir) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.bulkRename(
        dir,
        files.map((f) => f.path),
        rules,
        dryRun,
      );
      if (dryRun) setResults(res);
      return res;
    } catch (e) {
      setError(errMsg(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    runPreview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules]);

  const apply = async () => {
    const res = await runPreview(false);
    if (!res) return;
    const okCount = res.filter((r) => r.ok).length;
    if (okCount > 0) {
      useFileStore.getState().refresh();
    }
    close();
  };

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("dialog.bulkRenameTitle")}（{files.length}）
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.find")}</Label>
            <Input
              className="h-8 text-xs"
              placeholder={t("dialog.find")}
              value={rules.find}
              onChange={(e) => patch({ find: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.replace")}</Label>
            <Input
              className="h-8 text-xs"
              placeholder={t("dialog.replace")}
              value={rules.replace}
              onChange={(e) => patch({ replace: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={rules.use_regex}
                onCheckedChange={(v) => patch({ use_regex: !!v })}
              />
              {t("dialog.useRegex")}
            </label>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.prefix")}</Label>
            <Input
              className="h-8 text-xs"
              placeholder={t("dialog.prefix")}
              value={rules.prefix}
              onChange={(e) => patch({ prefix: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.suffix")}</Label>
            <Input
              className="h-8 text-xs"
              placeholder={t("dialog.suffix")}
              value={rules.suffix}
              onChange={(e) => patch({ suffix: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.case")}</Label>
            <Select value={rules.case} onValueChange={(v) => patch({ case: v })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("dialog.caseNone")}</SelectItem>
                <SelectItem value="upper">{t("dialog.caseUpper")}</SelectItem>
                <SelectItem value="lower">{t("dialog.caseLower")}</SelectItem>
                <SelectItem value="title">{t("dialog.caseTitle")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 pb-2 text-xs">
              <Checkbox
                checked={rules.counter.enabled}
                onCheckedChange={(v) => patchCounter({ enabled: !!v })}
              />
              {t("dialog.counter")}
            </label>
            {rules.counter.enabled && (
              <>
                <Input
                  className="h-8 w-16 text-xs"
                  type="number"
                  title={t("dialog.counterStart")}
                  value={rules.counter.start}
                  onChange={(e) => patchCounter({ start: Number(e.target.value) || 1 })}
                />
                <Input
                  className="h-8 w-16 text-xs"
                  type="number"
                  title={t("dialog.counterStep")}
                  value={rules.counter.step}
                  onChange={(e) => patchCounter({ step: Number(e.target.value) || 1 })}
                />
                <Input
                  className="h-8 w-20 text-xs"
                  title={t("dialog.counterFormat")}
                  value={rules.counter.format}
                  onChange={(e) => patchCounter({ format: e.target.value })}
                />
              </>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-48 overflow-auto rounded-md border text-xs">
          {!results && busy && (
            <p className="p-3 text-muted-foreground">{t("common.loading")}</p>
          )}
          {results &&
            results.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 border-b px-2 py-1 last:border-0"
              >
                <span className="min-w-0 truncate">{basename(r.old_path)}</span>
                <span className="shrink-0 text-muted-foreground">→</span>
                {r.skipped ? (
                  <span className="shrink-0 text-muted-foreground">
                    {basename(r.old_path)}（{t("dialog.skip")}）
                  </span>
                ) : r.ok ? (
                  <span className="min-w-0 truncate text-emerald-600">
                    {basename(r.new_path)}
                  </span>
                ) : (
                  <span className="shrink-0 truncate text-destructive">
                    {r.error || "?"}
                  </span>
                )}
              </div>
            ))}
        </div>

        <DialogFooter className="gap-1">
          <Button variant="outline" size="sm" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={busy} onClick={apply}>
            {t("dialog.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
