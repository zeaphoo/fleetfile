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


/**
 * Advanced selection: filter the current tab's entries by extension / size /
 * date / name pattern, then select, append, or invert the selection.
 */
export function AdvancedSelectDialog({ tabId }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [exts, setExts] = useState("");
  const [minSize, setMinSize] = useState("");
  const [maxSize, setMaxSize] = useState("");
  const [namePattern, setNamePattern] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [mode, setMode] = useState("select"); // select | add | invert
  const [count, setCount] = useState(null);

  const entries = useFileStore((s) => s.tabById(tabId)?.entries || []);

  const computeMatches = () => {
    const extSet = exts
      .split(/[,，\s]+/)
      .map((e) => e.replace(/^\./, "").toLowerCase())
      .filter(Boolean);
    const min = minSize ? Number(minSize) : null;
    const max = maxSize ? Number(maxSize) : null;
    let re = null;
    if (namePattern) {
      try {
        re = useRegex
          ? new RegExp(namePattern, "i")
          : new RegExp(namePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      } catch {
        re = null;
      }
    }
    return entries.filter((e) => {
      if (extSet.length) {
        const dot = e.name.lastIndexOf(".");
        const ext = dot >= 0 ? e.name.slice(dot + 1).toLowerCase() : "";
        if (!extSet.includes(ext)) return false;
      }
      if (min != null && (e.size ?? 0) < min) return false;
      if (max != null && (e.size ?? 0) > max) return false;
      if (re && !re.test(e.name)) return false;
      return true;
    });
  };

  const preview = () => setCount(computeMatches().length);

  const apply = () => {
    const matches = computeMatches();
    const store = useFileStore.getState();
    const tab = store.tabById(tabId);
    if (!tab) return;
    const current = new Set(tab.selection.map((x) => x.path));
    let next;
    if (mode === "invert") {
      const matched = new Set(matches.map((x) => x.path));
      next = tab.entries.filter((e) =>
        matched.has(e.path) ? !current.has(e.path) : current.has(e.path),
      );
    } else if (mode === "add") {
      next = [...tab.selection, ...matches.filter((m) => !current.has(m.path))];
    } else {
      next = matches;
    }
    useFileStore.setState((s) => ({
      panes: (s.panes || []).map((p) => ({
        ...p,
        tabs: p.tabs.map((t2) =>
          t2.id === tabId ? { ...t2, selection: next } : t2,
        ),
      })),
    }));
    close();
  };

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("dialog.advancedSelectTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.extFilter")}</Label>
            <Input
              className="h-8 text-xs"
              value={exts}
              onChange={(e) => setExts(e.target.value)}
              placeholder="png, jpg, md"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("dialog.minSize")} (B)</Label>
              <Input
                className="h-8 text-xs"
                type="number"
                value={minSize}
                onChange={(e) => setMinSize(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("dialog.maxSize")} (B)</Label>
              <Input
                className="h-8 text-xs"
                type="number"
                value={maxSize}
                onChange={(e) => setMaxSize(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.namePattern")}</Label>
            <Input
              className="h-8 text-xs"
              value={namePattern}
              onChange={(e) => setNamePattern(e.target.value)}
              placeholder="report*"
            />
            <label className="flex items-center gap-2 pt-1 text-xs">
              <Checkbox
                checked={useRegex}
                onCheckedChange={(v) => setUseRegex(!!v)}
              />
              {t("dialog.useRegex")}
            </label>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("dialog.mode")}</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="select">{t("dialog.modeSelect")}</SelectItem>
                <SelectItem value="add">{t("dialog.modeAdd")}</SelectItem>
                <SelectItem value="invert">{t("dialog.modeInvert")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {count != null && (
            <p className="text-xs text-muted-foreground">
              {t("dialog.matchedCount", { count })}
            </p>
          )}
        </div>
        <DialogFooter className="gap-1">
          <Button variant="outline" size="sm" onClick={preview}>
            {t("dialog.preview")}
          </Button>
          <Button size="sm" onClick={apply}>
            {t("dialog.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
