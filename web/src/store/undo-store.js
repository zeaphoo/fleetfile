import { create } from "zustand";

/**
 * Undo/redo stack. `push(label, run)` records an action whose `run` reverses
 * it. Ctrl+Z pops the latest undo entry and executes its reverse action;
 * Ctrl+Shift+Z replays.
 */
export const useUndoStore = create((set, get) => ({
  undoStack: [],
  redoStack: [],

  push(label, run) {
    set({ undoStack: [...get().undoStack, { label, run }], redoStack: [] });
  },

  clear() {
    set({ undoStack: [], redoStack: [] });
  },

  async undo() {
    const { undoStack, redoStack } = get();
    if (!undoStack.length) return false;
    const item = undoStack[undoStack.length - 1];
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, item] });
    try {
      await item.run();
    } catch {
      /* reversal failed — keep the stack as-is */
    }
    return true;
  },

  async redo() {
    const { undoStack, redoStack } = get();
    if (!redoStack.length) return false;
    const item = redoStack[redoStack.length - 1];
    set({ redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, item] });
    try {
      await item.run();
    } catch {
      /* noop */
    }
    return true;
  },
}));
