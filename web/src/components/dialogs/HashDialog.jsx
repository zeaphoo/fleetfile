import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDialogStore } from "@/store/dialog-store";
import { api, errMsg } from "@/lib/api";
import { formatSize } from "@/lib/file-utils";

export function HashDialog({ file }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = [];
      for (const algo of ["sha256", "sha1", "md5"]) {
        try {
          const r = await api.hashFile(file.path, algo);
          if (!cancelled) out.push(r);
        } catch (e) {
          if (!cancelled) setError(errMsg(e));
        }
      }
      if (!cancelled) setResults(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [file.path]);

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dialog.hashTitle")} — {file.name}</DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {results.length === 0 && !error && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        <div className="space-y-2">
          {results.map((r) => (
            <div key={r.algo} className="rounded-md border p-2">
              <div className="mb-0.5 flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono uppercase">{r.algo}</span>
                <span>{formatSize(r.size)}</span>
              </div>
              <div className="break-all font-mono text-[11px]">{r.hash}</div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
