import { create } from "zustand";

/**
 * Modal manager. `modal` is { type, payload } or null.
 * Conflict modal carries a `resolve` fn so paste can await the user's choice.
 */
export const useDialogStore = create((set, get) => ({
  modal: null,

  open(type, payload = {}) {
    set({ modal: { type, payload } });
  },

  close() {
    const { modal } = get();
    if (modal?.type === "conflict") {
      modal.payload.resolve?.({ resolution: "skip", applyToAll: false });
    }
    set({ modal: null });
  },

  askConflict(payload) {
    return new Promise((resolvePromise) => {
      set({ modal: { type: "conflict", payload: { ...payload, resolve: resolvePromise } } });
    });
  },
}));
