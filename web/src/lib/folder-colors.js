/**
 * Folder color palette — ids MUST match server-side color ids
 * (see crates/server/src/main.rs PUT /api/preferences/folder-color).
 */
export const FOLDER_COLORS = [
  { id: "red", hex: "#ef4444", labelKey: "folderColors.red" },
  { id: "orange", hex: "#f97316", labelKey: "folderColors.orange" },
  { id: "yellow", hex: "#eab308", labelKey: "folderColors.yellow" },
  { id: "green", hex: "#22c55e", labelKey: "folderColors.green" },
  { id: "blue", hex: "#3b82f6", labelKey: "folderColors.blue" },
  { id: "purple", hex: "#a855f7", labelKey: "folderColors.purple" },
  { id: "pink", hex: "#ec4899", labelKey: "folderColors.pink" },
  { id: "gray", hex: "#6b7280", labelKey: "folderColors.gray" },
];

const HEX_BY_ID = new Map(FOLDER_COLORS.map((c) => [c.id, c.hex]));

/** Resolve a color id to a hex string (falls back to the id itself for custom values). */
export const folderColorHex = (colorId) => HEX_BY_ID.get(colorId) || colorId || null;