import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errMsg } from "@/lib/api";
import { useFileStore } from "@/store/file-store";
import { formatSize } from "@/lib/file-utils";

const TEXT_TYPES = ["text", "code", "file"];

/**
 * Quick Look (spacebar): full-bleed preview overlay of the selected file.
 * Arrow keys cycle the selection within the tab, Esc/Space closes.
 */
export function QuickLookOverlay({ file, onClose }) {
  const { t } = useTranslation();
  const [text, setText] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  const isImage = file?.file_type === "image";
  const isVideo = file?.file_type === "video";
  const isAudio = file?.file_type === "audio";
  const isText = !isImage && !isVideo && !isAudio && TEXT_TYPES.includes(file?.file_type);

  useEffect(() => {
    if (!file) return;
    setText(null);
    setError(null);
    if (!isText) return;
    let cancelled = false;
    setLoading(true);
    api
      .readTextFile(file.path)
      .then((r) => {
        if (!cancelled) {
          setText(r.content);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errMsg(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        cycle(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        cycle(-1);
      }
    };
    const cycle = (dir) => {
      const s = useFileStore.getState();
      const tab = s.activeTab();
      if (!tab?.entries?.length) return;
      const idx = tab.entries.findIndex((x) => x.path === file.path);
      const next = (idx + dir + tab.entries.length) % tab.entries.length;
      s.selectIndex(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file?.path, onClose]);

  if (!file) return null;

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-40 flex flex-col bg-black/80 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mb-2 flex items-center justify-between text-sm text-white/80">
        <span className="truncate">
          {file.name} · {file.is_dir ? "" : formatSize(file.size)}
        </span>
        <span className="shrink-0 pl-4">{t("quicklook.hint")}</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {loading && <p className="text-sm text-white/60">{t("common.loading")}</p>}
        {isImage && (
          <img
            src={api.assetUrl(file.path)}
            alt={file.name}
            className="max-h-full max-w-full rounded object-contain shadow-2xl"
          />
        )}
        {isVideo && <video src={api.assetUrl(file.path)} controls autoPlay className="max-h-full max-w-full rounded shadow-2xl" />}
        {isAudio && <audio src={api.assetUrl(file.path)} controls autoPlay className="w-full" />}
        {isText && text != null && (
          <pre className="max-h-full w-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-background p-4 font-mono text-xs text-foreground">
            {text}
          </pre>
        )}
        {!isImage && !isVideo && !isAudio && !isText && !error && (
          <p className="text-sm text-white/60">{t("quicklook.noPreview")}</p>
        )}
      </div>
    </div>
  );
}
