import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDialogStore } from "@/store/dialog-store";
import { api, errMsg } from "@/lib/api";

const TEXT_TYPES = ["text", "code", "file"];

const EXT_LANG = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript",
  rs: "rust", py: "python", rb: "ruby", go: "go", java: "java",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp",
  php: "php", sh: "bash", bash: "bash", zsh: "bash",
  html: "xml", htm: "xml", xml: "xml", svg: "xml",
  css: "css", scss: "css", less: "css",
  json: "json", yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini",
  md: "markdown", markdown: "markdown", sql: "sql",
  vue: "xml", svelte: "xml",
};

function highlight(code, lang) {
  try {
    // dynamic import keeps the hljs bundle lazy
    return import("highlight.js/lib/common").then((hljs) => {
      if (lang && hljs.default.getLanguage(lang)) {
        return hljs.default.highlight(code, { language: lang }).value;
      }
      return hljs.default.highlightAuto(code).value;
    });
  } catch {
    return Promise.resolve(null);
  }
}

export function PreviewDialog({ entry }) {
  const { t } = useTranslation();
  const close = useDialogStore((s) => s.close);
  const [text, setText] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(null);
  const [html, setHtml] = useState(null);

  const isImage = entry.file_type === "image";
  const isVideo = entry.file_type === "video";
  const isAudio = entry.file_type === "audio";
  const isPdf = /\.pdf$/i.test(entry.name);
  const isOffice = /\.(docx|odt|xlsx|ods)$/i.test(entry.name);
  const isText = !isImage && !isVideo && !isAudio && !isPdf && !isOffice && TEXT_TYPES.includes(entry.file_type);
  const [office, setOffice] = useState(null);

  const lang = useMemo(() => {
    const dot = entry.name.lastIndexOf(".");
    const ext = dot >= 0 ? entry.name.slice(dot + 1).toLowerCase() : "";
    return EXT_LANG[ext];
  }, [entry.name]);

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;
    api
      .readTextFile(entry.path)
      .then(async (r) => {
        if (cancelled) return;
        setText(r.content);
        setTruncated(r.truncated);
        const h = await highlight(r.content, lang);
        if (!cancelled) setHtml(h);
      })
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [entry.path, isText, lang]);

  useEffect(() => {
    if (!isOffice) return;
    let cancelled = false;
    api
      .officeText(entry.path)
      .then((r) => !cancelled && setOffice(r))
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [entry.path, isOffice]);

  const asset = api.assetUrl(entry.path);

  return (
    <Dialog open onOpenChange={() => close()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate text-base">{entry.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto">
          {error && <p className="p-4 text-sm text-destructive">{error}</p>}
          {isImage && (
            <img src={asset} alt={entry.name} className="mx-auto max-h-[65vh] object-contain" />
          )}
          {isVideo && <video src={asset} controls className="mx-auto max-h-[65vh]" />}
          {isPdf && (
            <iframe
              src={asset}
              title={entry.name}
              className="h-[65vh] w-full rounded-md border bg-white"
            />
          )}
          {isOffice && office && (
            <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
              {office.content}
              {office.truncated && "\n\n…"}
            </pre>
          )}
          {isAudio && <audio src={asset} controls className="w-full" />}
          {isText && html != null && (
            <div
              className="hljs-code rounded-md bg-muted p-3 text-xs"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          {isText && html == null && text != null && (
            <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
              {text}
            </pre>
          )}
          {isText && truncated && (
            <p className="p-2 text-xs text-muted-foreground">{t("dialog.truncated")}</p>
          )}
          {!isImage && !isVideo && !isAudio && !isPdf && !isOffice && !isText && !error && (
            <p className="p-4 text-sm text-muted-foreground">{t("dialog.previewNotSupported")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
