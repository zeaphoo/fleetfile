import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useClipboardStore } from "@/store/clipboard-store";
import { usePlacesStore } from "@/store/places-store";
import { useFileStore } from "@/store/file-store";
import { Archive, FileSearch, FolderGit2, ScanSearch, Wand2 } from "lucide-react";

/**
 * Shared file/folder context menu used by both the grid and the list view.
 * `selection` drives which items appear; `actions` comes from useFileActions.
 */
export function ExplorerContextMenu({ children, actions, selection = [], onSelectAll }) {
  const { t } = useTranslation();
  const hasClipboard = useClipboardStore((s) => s.files.length > 0);
  const cwd = useFileStore((s) => s.activeTab()?.cwd);
  const isFavorite = usePlacesStore((s) => s.isFavorite(cwd));
  const count = selection.length;
  const single = count === 1 ? selection[0] : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-full w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {count > 0 ? (
          <>
            {single && (
              <ContextMenuItem onClick={() => actions.preview(single)}>
                {t("contextMenu.openPreview")}
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={actions.copy}>{t("contextMenu.copy")}</ContextMenuItem>
            <ContextMenuItem onClick={actions.cut}>{t("contextMenu.cut")}</ContextMenuItem>
            {single && (
              <ContextMenuItem onClick={actions.rename}>{t("contextMenu.rename")}</ContextMenuItem>
            )}
            {count >= 2 && (
              <ContextMenuItem onClick={actions.bulkRename}>
                {t("contextMenu.bulkRename")}
              </ContextMenuItem>
            )}
            {single && (
              <ContextMenuItem onClick={actions.properties}>
                {t("contextMenu.properties")}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={actions.compress}>
              <Archive className="mr-2 h-4 w-4" />
              {t("contextMenu.compress")}
            </ContextMenuItem>
            {single && /\.(zip|tar|gz|bz2|xz|7z|rar|tgz|tbz2|txz)$/i.test(single.name) && (
              <ContextMenuItem onClick={actions.extract}>
                {t("contextMenu.extract")}
              </ContextMenuItem>
            )}
            {single && !single.is_dir && (
              <ContextMenuItem onClick={actions.hash}>
                <FileSearch className="mr-2 h-4 w-4" />
                {t("contextMenu.hash")}
              </ContextMenuItem>
            )}
            {count === 2 && selection.every((x) => x.is_dir) && (
              <ContextMenuItem onClick={actions.folderCompare}>
                <FolderGit2 className="mr-2 h-4 w-4" />
                {t("contextMenu.compareFolders")}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => actions.remove(true)}>
              {t("contextMenu.moveToTrash")}
            </ContextMenuItem>
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => actions.remove(false)}
            >
              {t("contextMenu.permanentDelete")}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem disabled={!hasClipboard} onClick={actions.paste}>
              {t("contextMenu.paste")}
            </ContextMenuItem>
            <ContextMenuItem onClick={actions.newFile}>{t("contextMenu.newFile")}</ContextMenuItem>
            <ContextMenuItem onClick={actions.newFolder}>
              {t("contextMenu.newFolder")}
            </ContextMenuItem>
            <ContextMenuItem onClick={actions.duplicates}>
              <ScanSearch className="mr-2 h-4 w-4" />
              {t("contextMenu.duplicates")}
            </ContextMenuItem>
            <ContextMenuItem onClick={actions.advancedSelect}>
              <Wand2 className="mr-2 h-4 w-4" />
              {t("contextMenu.advancedSelect")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={actions.toggleFavorite}>
              {t(isFavorite ? "contextMenu.removeFavorite" : "contextMenu.addFavorite")}
            </ContextMenuItem>
            <ContextMenuItem onClick={onSelectAll}>{t("contextMenu.selectAll")}</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
