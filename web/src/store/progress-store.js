import { create } from "zustand";
import i18n from "@/i18n";
import { cancelOp } from "@/lib/ws";

/**
 * File operation progress, fed by WebSocket `progress`/`op-done`/`op-error`
 * events. Tracks one "current" operation at a time for the overlay UI.
 */
export const useProgressStore = create((set, get) => ({
  op: null, // current op id
  doneBytes: 0,
  total: 0,
  errorMsg: null,
  finished: false,

  update(op, done, total) {
    const s = get();
    const isCurrent = !s.op || s.op === op;
    set({
      op: isCurrent ? op : s.op,
      doneBytes: isCurrent ? done : s.doneBytes,
      total: isCurrent ? total : s.total,
      errorMsg: null,
      finished: false,
    });
  },

  finish(op) {
    const s = get();
    if (s.op && s.op !== op) return;
    set({ finished: true, errorMsg: null });
    if (s.op === op) {
      // brief "100%" flash before disappearing
      set({ doneBytes: s.total || 1, total: s.total || 1 });
      setTimeout(() => {
        if (get().op === op) {
          set({ op: null, doneBytes: 0, total: 0, finished: false });
        }
      }, 600);
    }
  },

  fail(op, message, cancelled = false) {
    const s = get();
    if (s.op && s.op !== op) return;
    set({ errorMsg: cancelled ? i18n.t("progress.cancelled") : message || i18n.t("progress.failed"), finished: true });
    setTimeout(() => {
      if (get().op === op) {
        set({ op: null, doneBytes: 0, total: 0, errorMsg: null, finished: false });
      }
    }, 2500);
  },

  start(op) {
    set({ op, doneBytes: 0, total: 0, errorMsg: null, finished: false });
  },

  cancel() {
    const { op } = get();
    if (op) cancelOp(op);
  },

  clear() {
    set({ op: null, doneBytes: 0, total: 0, errorMsg: null, finished: false });
  },
}));
