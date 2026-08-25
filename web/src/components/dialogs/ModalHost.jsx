import { useDialogStore } from "@/store/dialog-store";
import { RenameDialog } from "@/components/dialogs/RenameDialog";
import { NewItemDialog } from "@/components/dialogs/NewItemDialog";
import { DeleteConfirmDialog } from "@/components/dialogs/DeleteConfirmDialog";
import { ConflictDialog } from "@/components/dialogs/ConflictDialog";
import { PreviewDialog } from "@/components/dialogs/PreviewDialog";
import { PropertiesDialog } from "@/components/dialogs/PropertiesDialog";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { SettingsDialog } from "@/components/dialogs/SettingsDialog";
import { BulkRenameDialog } from "@/components/dialogs/BulkRenameDialog";
import { CompressDialog } from "@/components/dialogs/CompressDialog";
import { ExtractDialog } from "@/components/dialogs/ExtractDialog";
import { HashDialog } from "@/components/dialogs/HashDialog";
import { FolderCompareDialog } from "@/components/dialogs/FolderCompareDialog";
import { DuplicatesDialog } from "@/components/dialogs/DuplicatesDialog";
import { AdvancedSelectDialog } from "@/components/dialogs/AdvancedSelectDialog";

export function ModalHost() {
  const modal = useDialogStore((s) => s.modal);
  if (!modal) return null;

  switch (modal.type) {
    case "rename":
      return <RenameDialog {...modal.payload} />;
    case "new":
      return <NewItemDialog {...modal.payload} />;
    case "delete-confirm":
      return <DeleteConfirmDialog {...modal.payload} />;
    case "conflict":
      return <ConflictDialog {...modal.payload} />;
    case "preview":
      return <PreviewDialog {...modal.payload} />;
    case "properties":
      return <PropertiesDialog {...modal.payload} />;
    case "settings":
      return <SettingsDialog />;
    case "bulk-rename":
      return <BulkRenameDialog {...modal.payload} />;
    case "compress":
      return <CompressDialog {...modal.payload} />;
    case "extract":
      return <ExtractDialog {...modal.payload} />;
    case "hash":
      return <HashDialog {...modal.payload} />;
    case "folder-compare":
      return <FolderCompareDialog {...modal.payload} />;
    case "duplicates":
      return <DuplicatesDialog {...modal.payload} />;
    case "advanced-select":
      return <AdvancedSelectDialog {...modal.payload} />;
    case "confirm":
      return <ConfirmDialog {...modal.payload} />;
    default:
      return null;
  }
}
