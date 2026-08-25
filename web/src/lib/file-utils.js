import {
  FolderClosed,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode2,
  FileArchive,
  FileSpreadsheet,
  File,
  AppWindow,
  FileType2,
} from "lucide-react";

const ICON_MAP = {
  directory: { Icon: FolderClosed, color: "text-sky-500" },
  text: { Icon: FileText, color: "text-slate-500" },
  image: { Icon: FileImage, color: "text-emerald-500" },
  video: { Icon: FileVideo, color: "text-purple-500" },
  audio: { Icon: FileAudio, color: "text-pink-500" },
  pdf: { Icon: FileType2, color: "text-red-500" },
  document: { Icon: FileText, color: "text-blue-500" },
  spreadsheet: { Icon: FileSpreadsheet, color: "text-green-600" },
  presentation: { Icon: FileText, color: "text-orange-500" },
  archive: { Icon: FileArchive, color: "text-amber-500" },
  code: { Icon: FileCode2, color: "text-yellow-500" },
  executable: { Icon: AppWindow, color: "text-gray-600" },
  file: { Icon: File, color: "text-gray-400" },
};

export function getFileIcon(entry) {
  if (entry.is_dir) return ICON_MAP.directory;
  return ICON_MAP[entry.file_type] ?? ICON_MAP.file;
}

export function formatSize(bytes) {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
