//! Persistence for FleetFile preferences, backed by SQLite via sqlx (async).
//!
//! Default location: `~/.fleetfile/preferences.db` (overridable via
//! `FLEETFILE_DATA_DIR`). WAL mode is enabled; the pool serializes writers.
//!
//! Schema is managed by the sqlx migration system: up/down migration files
//! live in `crates/server/migrations/` (embedded at compile time via
//! `sqlx::migrate!`). On startup `Migrator::run()` applies pending migrations
//! in a transaction each, recording them in `_sqlx_migrations` with a checksum.

use sqlx::migrate::Migrator;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::path::Path;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Embedded migration files (compiled in from `migrations/` at build time).
static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FolderViewSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_by_date: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PreferenceData {
    #[serde(default)]
    pub folder_views: HashMap<String, FolderViewSettings>,
    #[serde(default)]
    pub folder_colors: HashMap<String, String>,
}

/// Default database file: `$FLEETFILE_DATA_DIR/preferences.db` or
/// `~/.fleetfile/preferences.db`.
pub fn default_preferences_path() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("FLEETFILE_DATA_DIR") {
        return std::path::PathBuf::from(dir).join("preferences.db");
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home)
        .join(".fleetfile")
        .join("preferences.db")
}

#[derive(Clone)]
pub struct SettingsStore {
    pool: SqlitePool,
}

impl SettingsStore {
    pub async fn new(path: &Path) -> Result<Self, sqlx::Error> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let options = SqliteConnectOptions::from_str(path.to_str().unwrap_or("preferences.db"))
            .expect("valid sqlite path")
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        // Apply pending migrations (up only; down scripts are kept in the
        // migration files for future revert tooling).
        MIGRATOR.run(&pool).await?;
        Ok(Self { pool })
    }

    /// Full snapshot for `GET /api/preferences`.
    pub async fn snapshot(&self) -> Result<PreferenceData, sqlx::Error> {
        let mut folder_views = HashMap::new();
        let rows = sqlx::query(
            "SELECT path, view_mode, sort_by, sort_order, group_by_date FROM folder_views",
        )
        .fetch_all(&self.pool)
        .await?;
        for row in rows {
            let settings = FolderViewSettings {
                view_mode: row.try_get::<Option<String>, _>("view_mode")?,
                sort_by: row.try_get::<Option<String>, _>("sort_by")?,
                sort_order: row.try_get::<Option<String>, _>("sort_order")?,
                group_by_date: row.try_get::<Option<bool>, _>("group_by_date")?,
            };
            folder_views.insert(row.try_get::<String, _>("path")?, settings);
        }

        let mut folder_colors = HashMap::new();
        let rows = sqlx::query("SELECT path, color_id FROM folder_colors")
            .fetch_all(&self.pool)
            .await?;
        for row in rows {
            folder_colors.insert(
                row.try_get::<String, _>("path")?,
                row.try_get::<String, _>("color_id")?,
            );
        }

        Ok(PreferenceData {
            folder_views,
            folder_colors,
        })
    }

    /// Merge (partial) settings for one folder; `None` fields keep their
    /// previous value. Returns the merged row.
    pub async fn update_folder_view(
        &self,
        path: &str,
        patch: &FolderViewSettings,
    ) -> Result<FolderViewSettings, sqlx::Error> {
        sqlx::query(
            "INSERT INTO folder_views (path, view_mode, sort_by, sort_order, group_by_date, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s','now'))
             ON CONFLICT(path) DO UPDATE SET
               view_mode     = COALESCE(excluded.view_mode,     folder_views.view_mode),
               sort_by       = COALESCE(excluded.sort_by,       folder_views.sort_by),
               sort_order    = COALESCE(excluded.sort_order,    folder_views.sort_order),
               group_by_date = COALESCE(excluded.group_by_date, folder_views.group_by_date),
               updated_at    = excluded.updated_at",
        )
        .bind(path)
        .bind(&patch.view_mode)
        .bind(&patch.sort_by)
        .bind(&patch.sort_order)
        .bind(patch.group_by_date)
        .execute(&self.pool)
        .await?;

        let row = sqlx::query(
            "SELECT view_mode, sort_by, sort_order, group_by_date FROM folder_views WHERE path = ?1",
        )
        .bind(path)
        .fetch_one(&self.pool)
        .await?;
        Ok(FolderViewSettings {
            view_mode: row.try_get::<Option<String>, _>("view_mode")?,
            sort_by: row.try_get::<Option<String>, _>("sort_by")?,
            sort_order: row.try_get::<Option<String>, _>("sort_order")?,
            group_by_date: row.try_get::<Option<bool>, _>("group_by_date")?,
        })
    }

    /// Remove saved settings for a folder (front-end falls back to smart defaults).
    pub async fn remove_folder_view(&self, path: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM folder_views WHERE path = ?1")
            .bind(path)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_folder_color(&self, path: &str, color_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO folder_colors (path, color_id, updated_at) VALUES (?1, ?2, strftime('%s','now'))
             ON CONFLICT(path) DO UPDATE SET color_id = excluded.color_id, updated_at = excluded.updated_at",
        )
        .bind(path)
        .bind(color_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn remove_folder_color(&self, path: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM folder_colors WHERE path = ?1")
            .bind(path)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fleetfile-settings-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let path = dir.join("preferences.db");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(dir.join("preferences.db-wal"));
        let _ = std::fs::remove_file(dir.join("preferences.db-shm"));
        path
    }

    #[tokio::test]
    async fn update_and_persist_roundtrip() {
        let path = temp_path();
        let store = SettingsStore::new(&path).await.expect("open db");
        store
            .update_folder_view(
                "/home/u/Pictures",
                &FolderViewSettings {
                    view_mode: Some("gallery".into()),
                    sort_by: Some("dateModified".into()),
                    sort_order: Some("desc".into()),
                    group_by_date: Some(true),
                },
            )
            .await
            .unwrap();
        store.set_folder_color("/home/u/work", "red").await.unwrap();

        // Reload from disk — data must survive.
        let reloaded = SettingsStore::new(&path).await.expect("reopen db");
        let snap = reloaded.snapshot().await.unwrap();
        let view = snap.folder_views.get("/home/u/Pictures").unwrap();
        assert_eq!(view.view_mode.as_deref(), Some("gallery"));
        assert_eq!(view.sort_order.as_deref(), Some("desc"));
        assert_eq!(view.group_by_date, Some(true));
        assert_eq!(
            snap.folder_colors.get("/home/u/work").map(String::as_str),
            Some("red")
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn partial_patch_keeps_other_fields() {
        let path = temp_path();
        let store = SettingsStore::new(&path).await.expect("open db");
        store
            .update_folder_view(
                "/a",
                &FolderViewSettings {
                    view_mode: Some("list".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        store
            .update_folder_view(
                "/a",
                &FolderViewSettings {
                    sort_by: Some("size".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let snap = store.snapshot().await.unwrap();
        let view = snap.folder_views.get("/a").unwrap();
        assert_eq!(view.view_mode.as_deref(), Some("list"));
        assert_eq!(view.sort_by.as_deref(), Some("size"));
        assert!(view.group_by_date.is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn remove_clears_entries() {
        let path = temp_path();
        let store = SettingsStore::new(&path).await.expect("open db");
        store.set_folder_color("/x", "blue").await.unwrap();
        store
            .update_folder_view(
                "/x",
                &FolderViewSettings {
                    view_mode: Some("grid".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        store.remove_folder_view("/x").await.unwrap();
        store.remove_folder_color("/x").await.unwrap();
        let snap = store.snapshot().await.unwrap();
        assert!(!snap.folder_views.contains_key("/x"));
        assert!(!snap.folder_colors.contains_key("/x"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn empty_db_is_default() {
        let path = temp_path();
        let store = SettingsStore::new(&path).await.expect("open db");
        let snap = store.snapshot().await.unwrap();
        assert!(snap.folder_views.is_empty());
        assert!(snap.folder_colors.is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}