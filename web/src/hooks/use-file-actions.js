import { useTranslation } from "react-i18next";
import { useFileStore } from "@/store/file-store";
import { useClipboardStore } from "@/store/clipboard-store";
import { useDialogStore } from "@/store/dialog-store";
import { useProgressStore } from "@/store/progress-store";
import { useUndoStore } from "@/store/undo-store";
import { usePlacesStore } from "@/store/places-store";
import { executePaste } from "@/lib/paste";
import { api, basename, joinPath, normalizePath } from "@/lib/api";
import { writeClipboardFiles, readClipboardFiles } from "@/lib/clipboard-os";

let batchSeq = 1;
const nextBatchOp = () => `op-b${Date.now()}-${batchSeq++}`;

/**
 * File actions for a specific tab (pass `tabId` from a pane component), or the
 * active tab when omitted (global shortcuts / toolbar).
 */
export function useFileActions(tabId) {
  const { t } = useTranslation();
  const fileStore = useFileStore();
  const clipboard = useClipboardStore();
  const dialogs = useDialogStore();

  const tabOf = () => {
    const s = useFileStore.getState();
    return tabId ? s.tabById(tabId) : s.activeTab();
  };

  const selected = () => tabOf()?.selection || [];

  const refreshTab = () => {
    const tab = tabOf();
    useFileStore.getState().refresh(tab?.id);
  };

  const copy = () => {
    const files = selected();
    if (!files.length) return;
    clipboard.copyFiles(files);
    writeClipboardFiles(
      files.map((f) => f.path),
      "copy",
    );
  };

  const cut = () => {
    const files = selected();
    if (!files.length) return;
    clipboard.cutFiles(files);
    writeClipboardFiles(
      files.map((f) => f.path),
      "cut",
    );
  };

  const paste = async () => {
    const { files, operation, clear } = useClipboardStore.getState();
    const tab = tabOf();
    const cwd = tab?.cwd;
    if (!cwd) return;

    let batchFiles = files;
    let batchOp = operation;
    if (!batchFiles.length) {
      const paths = await readClipboardFiles();
      if (paths && paths.length) {
        batchFiles = paths.map((p) => ({ name: basename(p), path: p }));
        batchOp = "copy";
      }
    }
    if (!batchFiles.length) return;

    const op = nextBatchOp();
    useProgressStore.getState().start(op);

    const result = await executePaste({
      files: batchFiles,
      operation: batchOp,
      targetPath: cwd,
      op,
      askConflict: (payload) => useDialogStore.getState().askConflict(payload),
    });
    if (result.isCut && result.errors.length === 0 && batchOp === operation) {
      clear();
      // undo = move the files back to their original parents
      const undoLabel = t("undo.move");
      useUndoStore.getState().push(undoLabel, async () => {
        for (const f of batchFiles) {
          try {
            await api.moveEntry(joinPath(cwd, f.name), f.path, nextBatchOp());
          } catch {
            /* best effort */
          }
        }
        refreshTab();
      });
    } else if (result.succeeded > 0 && !result.isCut) {
      // undo = remove the copies
      const undoLabel = t("undo.copy");
      useUndoStore.getState().push(undoLabel, async () => {
        for (const f of batchFiles) {
          try {
            await api.deleteEntry(joinPath(cwd, f.name), false);
          } catch {
            /* best effort */
          }
        }
        refreshTab();
      });
    }
    refreshTab();
    return result;
  };

  const rename = () => {
    const files = selected();
    if (files.length === 1) dialogs.open("rename", { entry: files[0] });
  };

  const remove = (toTrash) => {
    const files = selected();
    if (!files.length) return;
    if (toTrash) {
      doDelete(files, true);
    } else {
      dialogs.open("delete-confirm", { files });
    }
  };

  const doDelete = async (files, toTrash) => {
    for (const f of files) {
      try {
        await api.deleteEntry(f.path, toTrash);
      } catch {
        // continue with remaining files
      }
    }
    if (toTrash) {
      const undoLabel = t("undo.delete");
      useUndoStore.getState().push(undoLabel, async () => {
        for (const f of files) {
          try {
            await api.restoreTrashByPath(f.path);
          } catch {
            /* best effort */
          }
        }
        refreshTab();
      });
    }
    refreshTab();
    useFileStore.getState().clearSelection(tabId);
  };

  const newFile = () => dialogs.open("new", { kind: "file" });
  const newFolder = () => dialogs.open("new", { kind: "dir" });

  const createItem = async (kind, name) => {
    const tab = tabOf();
    const cwd = tab?.cwd;
    if (!cwd) return;
    const path = joinPath(cwd, name);
    if (kind === "dir") await api.createDir(path);
    else await api.createFile(path);
    refreshTab();
  };

  const renameTo = async (entry, newName) => {
    const dir = entry.path.replace(/[/\\][^/\\]+$/, "");
    const newPath = joinPath(dir, newName);
    await api.renameEntry(entry.path, newPath);
    useUndoStore.getState().push(t("undo.rename"), async () => {
      try {
        await api.renameEntry(newPath, entry.path);
      } catch {
        /* best effort */
      }
      refreshTab();
    });
    refreshTab();
  };

  const preview = (entry) => {
    const tab = tabOf();
    if (!tab) return;
    if (entry.is_dir) {
      useFileStore.getState().navigate(entry.path, tab.id);
    } else {
      dialogs.open("preview", { entry });
    }
  };

  const properties = () => {
    const files = selected();
    if (files.length === 1) dialogs.open("properties", { entry: files[0] });
  };

  const bulkRename = () => {
    const files = selected();
    if (files.length >= 2) dialogs.open("bulk-rename", { files });
  };

  const compress = () => {
    const files = selected();
    if (files.length) dialogs.open("compress", { files });
  };

  const extract = () => {
    const files = selected();
    if (files.length === 1) dialogs.open("extract", { file: files[0] });
  };

  const hash = () => {
    const files = selected();
    if (files.length === 1) dialogs.open("hash", { file: files[0] });
  };

  const folderCompare = () => {
    const files = selected();
    if (files.length === 2 && files.every((f) => f.is_dir)) {
      dialogs.open("folder-compare", { left: files[0].path, right: files[1].path });
    }
  };

  const duplicates = () => {
    const tab = tabOf();
    if (tab?.cwd) dialogs.open("duplicates", { dir: tab.cwd });
  };

  const advancedSelect = () => {
    const tab = tabOf();
    if (tab) dialogs.open("advanced-select", { tabId: tab.id });
  };

  const toggleFavorite = () => {
    const tab = tabOf();
    if (!tab?.cwd) return;
    const places = usePlacesStore.getState();
    if (places.isFavorite(tab.cwd)) places.removeFavorite(tab.cwd);
    else places.addFavorite(tab.cwd);
  };

  return {
    copy,
    cut,
    paste,
    rename,
    remove,
    doDelete,
    newFile,
    newFolder,
    createItem,
    renameTo,
    preview,
    properties,
    bulkRename,
    compress,
    extract,
    hash,
    folderCompare,
    duplicates,
    advancedSelect,
    toggleFavorite,
  };
}
