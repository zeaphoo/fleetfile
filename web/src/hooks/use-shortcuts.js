import { useEffect } from "react";
import { useFileStore } from "@/store/file-store";
import { useDialogStore } from "@/store/dialog-store";
import { useUndoStore } from "@/store/undo-store";
import { useFileActions } from "@/hooks/use-file-actions";

/**
 * Global keyboard shortcuts. `setPaletteOpen` / `setQuickLook` are provided
 * by App to toggle the command palette and Quick Look overlay.
 */
export function useShortcuts({ paletteOpen, setPaletteOpen, setQuickLook, quickLookOpen } = {}) {
  const actions = useFileActions();

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) {
        // allow Ctrl+K / Escape to still work while typing in the palette
        if (!(e.key === "Escape") && !(e.ctrlKey && e.key.toLowerCase() === "k")) {
          return;
        }
      }
      const { modal, close } = useDialogStore.getState();
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      if (e.key === "Escape") {
        if (quickLookOpen) return; // Quick Look closes itself
        if (modal) close();
        else if (paletteOpen) setPaletteOpen?.(false);
        else useFileStore.getState().clearSelection();
        return;
      }

      if (ctrl && key === "k") {
        e.preventDefault();
        setPaletteOpen?.(!paletteOpen);
        return;
      }
      if (ctrl && key === "z") {
        e.preventDefault();
        useUndoStore.getState().undo();
        return;
      }
      if (ctrl && key === "y") {
        e.preventDefault();
        useUndoStore.getState().redo();
        return;
      }
      if (ctrl && key === "c") return actions.copy();
      if (ctrl && key === "x") return actions.cut();
      if (ctrl && key === "v") return actions.paste();
      if (ctrl && key === "a") {
        e.preventDefault();
        return useFileStore.getState().selectAll();
      }
      if (ctrl && key === "r") {
        e.preventDefault();
        return useFileStore.getState().refresh();
      }

      if (e.key === " " && !paletteOpen && !quickLookOpen) {
        // Quick Look: space opens the preview of the selected file
        const tab = useFileStore.getState().activeTab();
        const sel = tab?.selection || [];
        if (sel.length === 1 && setQuickLook && !modal) {
          e.preventDefault();
          setQuickLook(sel[0]);
        }
        return;
      }

      switch (e.key) {
        case "F2":
          return actions.rename();
        case "F5":
          e.preventDefault();
          return useFileStore.getState().refresh();
        case "Delete":
          return actions.remove(e.shiftKey ? false : true);
        case "Backspace":
          return useFileStore.getState().up();
        case "Alt":
          return;
      }

      if (e.altKey && e.key === "ArrowLeft") return useFileStore.getState().back();
      if (e.altKey && e.key === "ArrowRight") return useFileStore.getState().forward();
      if (e.key === "Enter") {
        const tab = useFileStore.getState().activeTab();
        const selection = tab?.selection || [];
        if (selection.length === 1) actions.preview(selection[0]);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, paletteOpen, setPaletteOpen, setQuickLook, quickLookOpen]);
}
