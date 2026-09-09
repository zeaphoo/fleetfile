mod bulk;
mod compare;
mod compress;
mod drives;
mod filetype;
mod hash;
mod office;
mod ops;
mod rar;
mod sevenz;
mod templates;
mod thumb;

pub use bulk::{bulk_rename, BulkRenameResult, BulkRenameRules, CounterOpts};
pub use compare::{find_duplicates, folder_compare, CompareEntry, DuplicateGroup};
pub use compress::{
    compress_files, compress_files_with_progress, extract_archive,
    extract_archive_with_progress, list_archive, ArchiveEntryInfo,
};
pub use drives::{list_drives, DriveInfo};
pub use hash::{hash_file, HashInfo};
pub use office::{office_text, OfficeText};
pub use ops::{
    check_conflicts, copy_entry, copy_entry_with_progress, create_dir, create_file, delete_entry,
    empty_trash, generate_rename_destination, get_properties, list_trash, move_entry,
    move_entry_with_progress, purge_trash_item, read_text_file, rename_entry, restore_trash_item,
    restore_trash_item_by_original, search_files, write_text_file, ConflictInfo, FileInfo,
    FileProperties, ProgressFn, TextFile, TrashItemInfo,
};
pub use rar::{compress_rar_with_progress, extract_rar_with_progress, list_rar};
pub use sevenz::{compress_7z_with_progress, extract_7z_with_progress, list_7z};
pub use templates::{list_templates, FileTemplate};
pub use thumb::make_thumbnail;

/// Owned progress callback: `false` aborts the running operation. Used where a
/// caller must hand the callback into `'static` storage (the RAR extraction
/// writer and the WebSocket relay bridge).
pub type ProgressBox = Box<dyn FnMut(u64, u64) -> bool + Send>;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub file_type: &'static str,
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("image error: {0}")]
    Image(#[from] image::ImageError),
    #[error("operation cancelled")]
    Cancelled,
}

/// Read a directory, returning entries sorted directories-first, then by name.
pub fn read_dir(path: &str) -> Result<Vec<Entry>, CoreError> {
    let expanded = expand_tilde(path);
    let mut entries = Vec::new();
    for item in std::fs::read_dir(&expanded)? {
        let item = item?;
        let meta = item.metadata()?;
        let name = item.file_name().to_string_lossy().into_owned();
        let is_dir = meta.is_dir();
        entries.push(Entry {
            name: name.clone(),
            path: item.path().to_string_lossy().into_owned(),
            is_dir,
            size: if is_dir { None } else { Some(meta.len()) },
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
            file_type: if is_dir {
                "directory"
            } else {
                filetype::get_file_type(&name)
            },
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn expand_tilde(path: &str) -> String {
    if path == "~" || path.starts_with("~/") || path.starts_with("~\\") {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            return format!("{}{}", home.to_string_lossy(), &path[1..]);
        }
    }
    path.to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct UserDirs {
    pub home: String,
    pub desktop: String,
    pub documents: String,
    pub downloads: String,
    pub pictures: String,
}

pub fn user_dirs() -> Result<UserDirs, CoreError> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::NotFound, "no home dir"))?;
    let xdg = |key: &str, fallback: &str| {
        std::env::var(key).unwrap_or_else(|_| format!("{}/{}", home, fallback))
    };
    Ok(UserDirs {
        home: home.clone(),
        desktop: xdg("XDG_DESKTOP_DIR", "Desktop"),
        documents: xdg("XDG_DOCUMENTS_DIR", "Documents"),
        downloads: xdg("XDG_DOWNLOAD_DIR", "Downloads"),
        pictures: xdg("XDG_PICTURES_DIR", "Pictures"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_current_dir() {
        let entries = read_dir(".").unwrap();
        assert!(!entries.is_empty());
    }

    #[test]
    fn detects_file_types() {
        assert_eq!(filetype::get_file_type("a.rs"), "code");
        assert_eq!(filetype::get_file_type("a.png"), "image");
        assert_eq!(filetype::get_file_type("noext"), "file");
    }
}
