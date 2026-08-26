-- 0001_init (up) — initial preferences schema
-- Per-folder view settings + folder colors, keyed by directory path.

CREATE TABLE IF NOT EXISTS folder_views (
    path          TEXT PRIMARY KEY,
    view_mode     TEXT,
    sort_by       TEXT,
    sort_order    TEXT,
    group_by_date INTEGER,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folder_colors (
    path       TEXT PRIMARY KEY,
    color_id   TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);