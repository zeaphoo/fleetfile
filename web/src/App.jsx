import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { NavBar } from "@/components/NavBar";
import { Panes } from "@/components/Panes";
import { RightPanel } from "@/components/RightPanel";
import { StatusBar } from "@/components/StatusBar";
import { ProgressOverlay } from "@/components/ProgressOverlay";
import { TerminalPanel } from "@/components/TerminalPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickLookOverlay } from "@/components/QuickLookOverlay";
import { ModalHost } from "@/components/dialogs/ModalHost";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { connectWS, setWsHandlers } from "@/lib/ws";
import { api, normalizePath } from "@/lib/api";
import { useFileStore } from "@/store/file-store";
import { useProgressStore } from "@/store/progress-store";
import { useSettingsStore } from "@/store/settings-store";
import { usePlacesStore } from "@/store/places-store";

export default function App() {
  const { t } = useTranslation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickLook, setQuickLook] = useState(null);
  const [notice, setNotice] = useState(null); // { text, ts }
  const [terminalOpen, setTerminalOpen] = useState(false);

  useShortcuts({ paletteOpen, setPaletteOpen, setQuickLook, quickLookOpen: !!quickLook });

  // settings init (theme + language)
  useEffect(() => {
    useSettingsStore.getState().init();
  }, []);

  // WebSocket + auto-refresh
  useEffect(() => {
    connectWS();
    setWsHandlers({
      dirChanged: (path) => {
        const s = useFileStore.getState();
        const key = normalizePath(path);
        const tab = s.activeTab();
        if (tab && tab.page === "explorer" && tab.cwd && normalizePath(tab.cwd) === key) {
          s.refresh(tab.id);
        }
      },
      progress: (m) => useProgressStore.getState().update(m.op, m.done, m.total),
      opDone: (op) => useProgressStore.getState().finish(op),
      opError: (m) => useProgressStore.getState().fail(m.op, m.error, m.cancelled),
    });
  }, []);

  // focus-change reminder: snapshot entries on blur, diff on focus
  useEffect(() => {
    let snapshot = null;
    const snapshotKey = (e) => `${e.name}|${e.size ?? ""}|${e.modified ?? ""}`;
    const onBlur = () => {
      const tab = useFileStore.getState().activeTab();
      if (tab?.page === "explorer" && tab.entries?.length) {
        snapshot = new Set(tab.entries.map(snapshotKey));
      } else {
        snapshot = null;
      }
    };
    const onFocus = async () => {
      if (!snapshot) return;
      const s = useFileStore.getState();
      const tab = s.activeTab();
      if (!tab || tab.page !== "explorer" || !tab.cwd) return;
      try {
        const entries = await api.readDir(tab.cwd);
        const now = new Set(entries.map(snapshotKey));
        const changed =
          snapshot.size !== now.size ||
          [...snapshot].some((k) => !now.has(k)) ||
          [...now].some((k) => !snapshot.has(k));
        if (changed) {
          setNotice({ text: t("notice.dirChanged"), ts: Date.now() });
        }
      } catch {
        /* dir may be gone */
      }
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [t]);

  // auto-dismiss notice
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col">
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <NavBar onToggleTerminal={() => setTerminalOpen((v) => !v)} />
            <Panes />
            {terminalOpen && <TerminalPanel onClose={() => setTerminalOpen(false)} />}
            <StatusBar notice={notice} onDismissNotice={() => setNotice(null)} />
          </main>
          <RightPanel />
        </div>
      </div>
      <ProgressOverlay />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <QuickLookOverlay file={quickLook} onClose={() => setQuickLook(null)} />
      <ModalHost />
    </TooltipProvider>
  );
}
