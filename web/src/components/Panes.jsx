import { useState } from "react";
import { useFileStore } from "@/store/file-store";
import { TabBar } from "@/components/TabBar";
import { FileGrid } from "@/components/FileGrid";
import { ListView } from "@/components/ListView";
import { GalleryView } from "@/components/GalleryView";
import { ColumnView } from "@/components/ColumnView";
import { DetailsView } from "@/components/DetailsView";
import { TreeView } from "@/components/TreeView";
import { ContentView } from "@/components/ContentView";
import { TrashPage } from "@/components/TrashPage";

function PaneView({ pane }) {
  const store = useFileStore();
  const tab = pane.tabs.find((t) => t.id === pane.activeTabId) || pane.tabs[0];
  if (!tab) return null;

  const renderView = () => {
    if (tab.page === "trash") return <TrashPage tabId={tab.id} />;
    switch (tab.viewMode) {
      case "list":
        return <ListView tab={tab} />;
      case "gallery":
        return <GalleryView tab={tab} />;
      case "column":
        return <ColumnView tab={tab} />;
      case "details":
        return <DetailsView tab={tab} />;
      case "tree":
        return <TreeView tab={tab} />;
      case "content":
        return <ContentView tab={tab} />;
      default:
        return <FileGrid tab={tab} />;
    }
  };

  return (
    <div
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
      onClick={() => store.setActivePane(pane.id)}
    >
      <TabBar pane={pane} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {renderView()}
      </div>
    </div>
  );
}

function PaneDivider({ onMove }) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startPct = 50;
    const move = (ev) => {
      const width = document.documentElement.clientWidth;
      const deltaPct = ((ev.clientX - startX) / width) * 100;
      onMove?.(Math.min(80, Math.max(20, startPct + deltaPct)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      className={`w-1 shrink-0 cursor-col-resize border-x bg-border/60 hover:bg-accent ${
        dragging ? "bg-accent" : ""
      }`}
    />
  );
}

export function Panes() {
  const store = useFileStore();
  const panes = store.panes || [];
  const [leftPct, setLeftPct] = useState(50);

  if (panes.length === 0) {
    return <div className="flex-1" />;
  }

  if (panes.length === 1) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PaneView pane={panes[0]} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div
        className="min-w-0 overflow-hidden"
        style={{ width: `${leftPct}%` }}
      >
        <PaneView pane={panes[0]} />
      </div>
      <PaneDivider onMove={setLeftPct} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <PaneView pane={panes[1]} />
      </div>
    </div>
  );
}
