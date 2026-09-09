const BASE = "/api";

async function request(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

let opSeq = 1;
/** Unique operation id for progress-tracked ops (compress/extract/copy batches). */
export const nextOpId = (prefix = "op-u") => `${prefix}${Date.now()}-${opSeq++}`;

export const api = {
  readDir: (path) =>
    request(`${BASE}/read-dir?path=${encodeURIComponent(path)}`),

  listDrives: () =>
    request(`${BASE}/drives`),

  userDirs: () =>
    request(`${BASE}/user-dirs`),

  getProperties: (path) =>
    request(`${BASE}/properties?path=${encodeURIComponent(path)}`),

  search: (path, q, limit = 200) =>
    request(
      `${BASE}/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  listTrash: () =>
    request(`${BASE}/trash`),

  restoreTrash: (id) =>
    request(`${BASE}/trash/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),

  purgeTrash: (id) =>
    request(`${BASE}/trash/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),

  emptyTrash: () =>
    request(`${BASE}/trash/empty`, { method: "POST" }),

  copyEntry: (source, destination, op) =>
    request(`${BASE}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, destination, op }),
    }),

  moveEntry: (source, destination, op) =>
    request(`${BASE}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, destination, op }),
    }),

  renameEntry: (oldPath, newPath) =>
    request(`${BASE}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
    }),

  deleteEntry: (path, toTrash) =>
    request(`${BASE}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, to_trash: toTrash }),
    }),

  createFile: (path) =>
    request(`${BASE}/create-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),

  createDir: (path) =>
    request(`${BASE}/create-dir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),

  checkConflicts: (sources, destinationDir) =>
    request(`${BASE}/check-conflicts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources, destination_dir: destinationDir }),
    }),

  getRenameDestination: (destinationDir, fileName) =>
    request(`${BASE}/rename-destination`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination_dir: destinationDir, file_name: fileName }),
    }),

  readTextFile: (path) =>
    request(`${BASE}/text-file?path=${encodeURIComponent(path)}`),

  thumbnailUrl: (path, size = 128) =>
    `${BASE}/thumbnail?path=${encodeURIComponent(path)}&size=${size}`,

  bulkRename: (dir, files, rules, dryRun = false) =>
    request(`${BASE}/bulk-rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, files, rules, dry_run: dryRun }),
    }),

  writeText: (path, content) =>
    request(`${BASE}/write-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }),

  templates: () =>
    request(`${BASE}/templates`),

  restoreTrashByPath: (path) =>
    request(`${BASE}/trash/restore-by-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),

  compress: (sources, destination, format, level = 6, op) =>
    request(`${BASE}/compress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources, destination, format, level, op }),
    }),

  extract: (archive, destination, password, op) =>
    request(`${BASE}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive, destination, password, op }),
    }),

  archiveInfo: (path) =>
    request(`${BASE}/archive-info?path=${encodeURIComponent(path)}`),

  hashFile: (path, algo = "sha256") =>
    request(`${BASE}/hash?path=${encodeURIComponent(path)}&algo=${algo}`),

  officeText: (path) =>
    request(`${BASE}/office-text?path=${encodeURIComponent(path)}`),

  folderCompare: (left, right) =>
    request(`${BASE}/folder-compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ left, right }),
    }),

  duplicates: (dir, minSize = 0) =>
    request(`${BASE}/duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, min_size: minSize }),
    }),

  sevenzStatus: () =>
    request(`${BASE}/7z-status`),

  // ── Preferences (persisted server-side in SQLite) ──────────────────────
  getPreferences: () =>
    request(`${BASE}/preferences`),

  putFolderView: (path, patch) =>
    request(`${BASE}/preferences/folder-view`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, ...patch }),
    }),

  deleteFolderView: (path) =>
    request(`${BASE}/preferences/folder-view?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),

  putFolderColor: (path, colorId) =>
    request(`${BASE}/preferences/folder-color`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, color_id: colorId }),
    }),

  deleteFolderColor: (path) =>
    request(`${BASE}/preferences/folder-color?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),

  assetUrl: (path) =>
    `${BASE}/asset?path=${encodeURIComponent(path)}`,
};

export function errMsg(e) {
  if (typeof e === "string") return e;
  return e?.message ?? String(e);
}

export function sep(path) {
  return path.includes("\\") ? "\\" : "/";
}

export function joinPath(dir, name) {
  const s = sep(dir);
  return dir.endsWith(s) ? dir + name : dir + s + name;
}

export function basename(path) {
  const trimmed = String(path || "").replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function parentPath(path) {
  const trimmed = String(path || "").replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx <= 0) return trimmed.startsWith("\\\\") ? "\\\\" : "/";
  return trimmed.slice(0, idx);
}

export function normalizePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/[\\/]+$/, "");
}
