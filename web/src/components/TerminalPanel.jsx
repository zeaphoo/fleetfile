import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useFileStore } from "@/store/file-store";
import { Terminal } from "@/components/Terminal";

/**
 * Bottom terminal panel bound to the active tab's cwd.
 */
export function TerminalPanel({ onClose }) {
  const { t } = useTranslation();
  const cwd = useFileStore((s) => s.activeTab()?.cwd) || "/";
  const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/pty`;

  return (
    <div className="flex h-64 shrink-0 flex-col border-t">
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        <span>{t("terminal.title")} — {cwd}</span>
        <button
          className="rounded p-0.5 hover:bg-accent"
          onClick={onClose}
          title={t("common.close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Terminal wsUrl={wsUrl} cwd={cwd} />
      </div>
    </div>
  );
}
