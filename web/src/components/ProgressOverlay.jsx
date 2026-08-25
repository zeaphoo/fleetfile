import { useTranslation } from "react-i18next";
import { useProgressStore } from "@/store/progress-store";
import { formatSize } from "@/lib/file-utils";
import { Button } from "@/components/ui/button";

/**
 * Floating progress overlay fed by WebSocket `progress` events.
 * Shows while a copy/move batch is in flight, with a cancel button.
 */
export function ProgressOverlay() {
  const { t } = useTranslation();
  const { op, doneBytes, total, errorMsg, finished } = useProgressStore();
  if (!op && !errorMsg) return null;

  const pct = total > 0 ? Math.min(100, Math.round((doneBytes / total) * 100)) : 0;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-10 z-50 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-sm rounded-lg border bg-background p-3 shadow-lg">
        {errorMsg ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-destructive">{errorMsg}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 text-xs"
              onClick={() => useProgressStore.getState().clear()}
            >
              {t("common.close")}
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{finished ? t("progress.done") : `${t("progress.working")} ${pct}%`}</span>
              <span>
                {formatSize(doneBytes)} / {formatSize(total)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${
                  finished ? "bg-green-500" : "bg-sky-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {!finished && (
              <div className="mt-2 text-right">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => useProgressStore.getState().cancel()}
                >
                  {t("progress.cancel")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
