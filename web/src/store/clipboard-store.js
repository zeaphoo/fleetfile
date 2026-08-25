import { create } from "zustand";

export const useClipboardStore = create((set) => ({
  files: [],
  operation: null, // 'copy' | 'cut'

  copyFiles(files) {
    set({ files, operation: "copy" });
  },
  cutFiles(files) {
    set({ files, operation: "cut" });
  },
  clear() {
    set({ files: [], operation: null });
  },
}));
