import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  LayoutGrid,
  List,
  Moon,
  RefreshCw,
  TerminalSquare,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useFileStore } from "@/store/file-store";
import { useSettingsStore } from "@/store/settings-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Content-area toolbar: navigation (back/forward/up + editable breadcrumb)
 * plus view / sort / group-by-date / filter / refresh / theme controls.
 */
function Breadcrumb({ tab }) {
  const { t } = useTranslation();
  const navigate = useFileStore((s) => s.navigate);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!tab?.cwd) return <div className="min-w-0 flex-1" />;

  const segments = [];
  let acc = "";
  for (const part of tab.cwd.split("/").filter(Boolean)) {
    acc += `/${part}`;
    segments.push({ name: part, path: acc });
  }

  const commit = () => {
    const path = draft.trim();
    setEditing(false);
    if (path) navigate(path);
  };

  return (
    <div
      className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-background px-2 py-1 font-mono text-sm"
      onDoubleClick={() => {
        setDraft(tab.cwd);
        setEditing(true);
      }}
      title={t("nav.editPath")}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={commit}
          className="w-full bg-transparent outline-none"
        />
      ) : (
        <>
          <button
            onClick={() => navigate("/")}
            className="shrink-0 px-1 text-muted-foreground hover:text-foreground"
          >
            /
          </button>
          {segments.map((seg) => (
            <span key={seg.path} className="flex shrink-0 items-center">
              <span className="px-0.5 text-muted-foreground">/</span>
              <button
                onClick={() => navigate(seg.path)}
                className={`rounded px-1 hover:bg-accent ${
                  seg.path === tab.cwd ? "font-medium" : ""
                }`}
              >
                {seg.name}
              </button>
            </span>
          ))}
        </>
      )}
    </div>
  );
}

export function NavBar({ onToggleTerminal }) {
  const { t } = useTranslation();
  const store = useFileStore();
  const settings = useSettingsStore();
  const tab = store.activeTab();
  if (!tab) return null;

  const canBack = (tab.historyIndex || 0) > 0;
  const canForward = (tab.historyIndex || 0) < (tab.history.length || 0) - 1;

  return (
    <div className="flex items-center gap-1.5 border-b px-3 py-1.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => store.back()}
        disabled={!canBack}
        title={t("nav.back")}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => store.forward()}
        disabled={!canForward}
        title={t("nav.forward")}
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => store.up()}
        title={t("nav.up")}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>

      <Breadcrumb tab={tab} />

      {tab.page === "explorer" && (
        <>
          <Button
            variant={tab.viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => store.setViewMode("grid")}
            title={t("nav.gridView")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={tab.viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => store.setViewMode("list")}
            title={t("nav.listView")}
          >
            <List className="h-4 w-4" />
          </Button>

          <Select value={tab.sortBy} onValueChange={(v) => store.setSort(v)}>
            <SelectTrigger className="h-7 w-28 shrink-0 text-xs">
              <ArrowDownWideNarrow className="mr-1 h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{t("nav.byName")}</SelectItem>
              <SelectItem value="size">{t("nav.bySize")}</SelectItem>
              <SelectItem value="dateModified">{t("nav.byDate")}</SelectItem>
              <SelectItem value="type">{t("nav.byType")}</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={tab.groupByDate ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7 shrink-0"
            title={t("nav.groupByDate")}
            onClick={() => store.toggleGroupByDate()}
          >
            <CalendarDays className="h-4 w-4" />
          </Button>

          <div className="relative w-40 shrink-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-7 pl-7 pr-6 text-xs"
              placeholder={t("nav.filter")}
              value={tab.filter}
              onChange={(e) => store.setFilter(e.target.value)}
            />
            {tab.filter && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => store.setFilter("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => store.refresh()}
            title={t("common.refresh")}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onToggleTerminal}
            title={t("nav.terminal")}
          >
            <TerminalSquare className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() =>
              settings.setTheme(settings.theme === "dark" ? "light" : "dark")
            }
            title={t("nav.theme")}
          >
            {settings.theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </>
      )}
    </div>
  );
}
