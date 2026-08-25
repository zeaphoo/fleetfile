import { useTranslation } from "react-i18next";
import { Columns2, PanelRightClose, Plus, Trash2, X } from "lucide-react";
import { useFileStore } from "@/store/file-store";
import { basename } from "@/lib/api";

function tabLabel(tab, tr) {
  if (tab.page === "trash") return tr("common.trash");
  if (tab.cwd) return basename(tab.cwd) || tab.cwd;
  return tr("common.home");
}

export function TabBar({ pane }) {
  const { t } = useTranslation();
  const store = useFileStore();
  const paneCount = store.panes?.length || 0;

  return (
    <div className="flex items-center gap-1 border-b bg-muted/20 px-1 py-0.5 text-xs">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {pane.tabs.map((tab) => {
          const active = tab.id === pane.activeTabId;
          return (
            <div
              key={tab.id}
              className={`group flex max-w-[160px] items-center gap-1 rounded-md px-2 py-1 ${
                active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1 truncate"
                onClick={() => store.setActiveTab(pane.id, tab.id)}
                title={tab.cwd || (tab.page === "trash" ? t("common.trash") : t("common.home"))}
              >
                {tab.page === "trash" ? (
                  <Trash2 className="h-3 w-3 shrink-0" />
                ) : null}
                <span className="truncate">{tabLabel(tab, t)}</span>
              </button>
              <button
                className="shrink-0 rounded p-0.5 opacity-0 hover:bg-foreground/10 group-hover:opacity-100"
                onClick={() => store.closeTab(pane.id, tab.id)}
                title={t("common.close")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          className="ml-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
          onClick={() => store.newTab(pane.id)}
          title={t("nav.newTab")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
        <button
          className="rounded p-1 hover:bg-accent"
          onClick={() => store.splitPane(pane.id)}
          title={t("nav.splitPane")}
        >
          <Columns2 className="h-3.5 w-3.5" />
        </button>
        {paneCount > 1 && (
          <button
            className="rounded p-1 hover:bg-accent"
            onClick={() => store.closePane(pane.id)}
            title={t("nav.closePane")}
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
