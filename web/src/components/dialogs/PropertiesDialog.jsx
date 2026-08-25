import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDialogStore } from "@/store/dialog-store";
import { api, errMsg } from "@/lib/api";
import { formatSize, formatDate } from "@/lib/file-utils";

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  );
}

export function PropertiesDialog({ entry }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [props, setProps] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getProperties(entry.path)
      .then((p) => !cancelled && setProps(p))
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate text-base">{t("dialog.propertiesTitle", { name: entry.name })}</DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !props && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        {props && (
          <div className="space-y-0.5">
            <Row label={t("common.name")}>{props.name}</Row>
            <Row label={t("dialog.path")}>{props.path}</Row>
            <Row label={t("dialog.parent")}>{props.parent || "—"}</Row>
            <Row label={t("common.type")}>{props.file_type}</Row>
            {props.extension && <Row label={t("dialog.extension")}>{props.extension}</Row>}
            <Row label={t("common.size")}>{formatSize(props.size)}</Row>
            {props.is_dir ? null : (
              <Row label={t("dialog.bytes")}>{props.size.toLocaleString()}</Row>
            )}
            <Row label={t("common.modified")}>{formatDate(props.modified)}</Row>
            <Row label={t("dialog.created")}>{formatDate(props.created)}</Row>
            <Row label={t("dialog.accessed")}>{formatDate(props.accessed)}</Row>
            {props.permissions && <Row label={t("dialog.permissions")}>{props.permissions}</Row>}
            <Row label={t("dialog.symlink")}>{props.is_symlink ? t("dialog.yes") : t("dialog.no")}</Row>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
