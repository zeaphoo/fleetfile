use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::filetype;
use crate::CoreError;

#[derive(Debug, Clone, Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConflictInfo {
    pub source: FileInfo,
    pub destination: FileInfo,
}

#[derive(Debug, Clone, Serialize)]
pub struct TextFile {
    pub content: String,
    pub truncated: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileProperties {
    pub name: String,
    pub path: String,
    pub parent: Option<String>,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub created: Option<u64>,
    pub accessed: Option<u64>,
    pub file_type: String,
    pub extension: Option<String>,
    /// Unix style "rwxr-xr-x"; empty when unavailable.
    pub permissions: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrashItemInfo {
    pub id: String,
    pub name: String,
    pub original_parent: Option<String>,
    pub time_deleted: Option<u64>,
}

/// Progress callback: receives (bytes_done, bytes_total). Return false to cancel.
pub type ProgressFn<'a> = dyn FnMut(u64, u64) -> bool + Send + 'a;

fn file_info(path: &Path) -> Result<FileInfo, CoreError> {
    let meta = fs::metadata(path)?;
    Ok(FileInfo {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        is_dir: meta.is_dir(),
        size: meta.len(),
        modified: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs()),
    })
}

fn ts(opt: Option<std::time::SystemTime>) -> Option<u64> {
    opt.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

// ── Properties ─────────────────────────────────────────────────────────────

#[cfg(unix)]
fn mode_string(mode: u32) -> String {
    let bits = [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ];
    let mut s = String::with_capacity(9);
    for (bit, ch) in bits {
        s.push(if mode & bit != 0 { ch } else { '-' });
    }
    s
}

#[cfg(not(unix))]
fn mode_string(_mode: u32) -> String {
    String::new()
}

pub fn get_properties(path: &str) -> Result<FileProperties, CoreError> {
    let p = Path::new(path);
    let sym_meta = fs::symlink_metadata(p)?;
    let is_symlink = sym_meta.file_type().is_symlink();
    // Prefer target metadata when the link resolves; fall back to the link itself.
    let meta = fs::metadata(p).unwrap_or_else(|_| sym_meta.clone());
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.to_string_lossy().into_owned());
    let name_for_type = name.clone();
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase());
    #[cfg(unix)]
    let perms = {
        use std::os::unix::fs::PermissionsExt;
        mode_string(meta.permissions().mode())
    };
    #[cfg(not(unix))]
    let perms = String::new();

    Ok(FileProperties {
        parent: p.parent().map(|x| x.to_string_lossy().into_owned()),
        is_symlink,
        created: ts(meta.created().ok()),
        accessed: ts(meta.accessed().ok()),
        permissions: perms,
        name,
        path: p.to_string_lossy().into_owned(),
        is_dir: meta.is_dir(),
        size: meta.len(),
        modified: ts(meta.modified().ok()),
        file_type: if meta.is_dir() {
            "directory".to_string()
        } else {
            filetype::get_file_type(&name_for_type).to_string()
        },
        extension: ext,
    })
}

// ── Copy / Move with progress ──────────────────────────────────────────────

const COPY_CHUNK: usize = 1024 * 1024;

fn copy_file_chunked(
    src: &Path,
    dst: &Path,
    done: &mut u64,
    total: u64,
    progress: &mut Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    let mut reader = fs::File::open(src)?;
    let mut writer = fs::File::create(dst)?;
    let mut buf = vec![0u8; COPY_CHUNK];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n])?;
        *done += n as u64;
        if let Some(p) = progress.as_mut() {
            if !p(*done, total) {
                let _ = fs::remove_file(dst);
                return Err(CoreError::Cancelled);
            }
        }
    }
    writer.flush()?;
    Ok(())
}

fn dir_total_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(rd) = fs::read_dir(path) else {
        return 0;
    };
    for item in rd.flatten() {
        let p = item.path();
        let Ok(m) = fs::symlink_metadata(&p) else { continue };
        if m.is_symlink() {
            continue;
        }
        if m.is_dir() {
            total += dir_total_size(&p);
        } else {
            total += m.len();
        }
    }
    total
}

fn copy_dir_recursive(
    src: &Path,
    dst: &Path,
    done: &mut u64,
    total: u64,
    progress: &mut Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for item in fs::read_dir(src)? {
        let item = item?;
        let src_path = item.path();
        // skip symlinks to avoid following them into unexpected locations
        if fs::symlink_metadata(&src_path)?
            .file_type()
            .is_symlink()
        {
            continue;
        }
        let dst_path = dst.join(item.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path, done, total, progress)?;
        } else {
            copy_file_chunked(&src_path, &dst_path, done, total, progress)?;
        }
    }
    Ok(())
}

pub fn copy_entry_with_progress(
    source: &str,
    destination: &str,
    mut progress: Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    let src = Path::new(source);
    let dst = Path::new(destination);
    if !src.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "source does not exist",
        )
        .into());
    }
    if fs::symlink_metadata(src)?.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "copying symlinks is not supported",
        )
        .into());
    }
    let mut done = 0u64;
    if src.is_file() {
        let total = fs::metadata(src)?.len();
        if let Some(p) = progress.as_mut() {
            p(0, total);
        }
        copy_file_chunked(src, dst, &mut done, total, &mut progress)?;
    } else if src.is_dir() {
        let total = dir_total_size(src);
        if let Some(p) = progress.as_mut() {
            p(0, total);
        }
        copy_dir_recursive(src, dst, &mut done, total, &mut progress)?;
    }
    Ok(())
}

/// Rename first (fast path on same filesystem), fall back to copy + delete.
pub fn move_entry_with_progress(
    source: &str,
    destination: &str,
    progress: Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    let src = Path::new(source);
    let dst = Path::new(destination);
    if !src.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "source does not exist",
        )
        .into());
    }
    if dst.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "destination already exists",
        )
        .into());
    }
    if fs::rename(src, dst).is_err() {
        copy_entry_with_progress(source, destination, progress)?;
        if src.is_dir() {
            fs::remove_dir_all(src)?;
        } else {
            fs::remove_file(src)?;
        }
    }
    Ok(())
}

pub fn copy_entry(source: &str, destination: &str) -> Result<(), CoreError> {
    copy_entry_with_progress(source, destination, None)
}

pub fn move_entry(source: &str, destination: &str) -> Result<(), CoreError> {
    move_entry_with_progress(source, destination, None)
}

// ── Rename / Delete / Create ───────────────────────────────────────────────

pub fn rename_entry(old_path: &str, new_path: &str) -> Result<(), CoreError> {
    let old = Path::new(old_path);
    let new = Path::new(new_path);
    if !old.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "source does not exist",
        )
        .into());
    }
    if new.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "destination already exists",
        )
        .into());
    }
    fs::rename(old, new)?;
    Ok(())
}

pub fn delete_entry(path: &str, to_trash: bool) -> Result<(), CoreError> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "path does not exist",
        )
        .into());
    }
    if to_trash {
        trash::delete(p).map_err(|e| {
            CoreError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        })?;
        return Ok(());
    }
    if p.is_dir() {
        fs::remove_dir_all(p)?;
    } else {
        fs::remove_file(p)?;
    }
    Ok(())
}

pub fn create_file(path: &str) -> Result<(), CoreError> {
    let p = Path::new(path);
    if p.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "file already exists",
        )
        .into());
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::File::create(p)?;
    Ok(())
}

pub fn create_dir(path: &str) -> Result<(), CoreError> {
    let p = Path::new(path);
    if p.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "directory already exists",
        )
        .into());
    }
    fs::create_dir(p)?;
    Ok(())
}

pub fn write_text_file(path: &str, content: &str) -> Result<(), CoreError> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(p, content)?;
    Ok(())
}

// ── Conflict helpers ───────────────────────────────────────────────────────

pub fn check_conflicts(
    sources: &[String],
    destination_dir: &str,
) -> Result<Vec<ConflictInfo>, CoreError> {
    let dest_dir = Path::new(destination_dir);
    if !dest_dir.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "destination directory does not exist",
        )
        .into());
    }
    let mut conflicts = Vec::new();
    for src_str in sources {
        let src = Path::new(src_str);
        let Some(file_name) = src.file_name() else { continue };
        let dest_path = dest_dir.join(file_name);
        if dest_path.exists() {
            conflicts.push(ConflictInfo {
                source: file_info(src)?,
                destination: file_info(&dest_path)?,
            });
        }
    }
    Ok(conflicts)
}

/// Generate "name (1).ext" style unique destination, same as Windows Explorer.
pub fn generate_rename_destination(dir: &Path, name: &str) -> Result<String, CoreError> {
    let dot = name.rfind('.');
    let (base, ext) = match dot {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1u32..9999 {
        let candidate = dir.join(format!("{} ({}){}", base, n, ext));
        if !candidate.exists() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::Other,
        "could not generate unique filename",
    )
    .into())
}

// ── Text preview ───────────────────────────────────────────────────────────

const MAX_TEXT_PREVIEW: u64 = 5 * 1024 * 1024;

pub fn read_text_file(path: &str) -> Result<TextFile, CoreError> {
    let p = Path::new(path);
    let meta = fs::metadata(p)?;
    let size = meta.len();
    let bytes = fs::read(p)?;
    let truncated = size > MAX_TEXT_PREVIEW;
    let slice = if truncated {
        // back off to a UTF-8 char boundary
        let mut end = MAX_TEXT_PREVIEW as usize;
        while end > 0 && (bytes[end] & 0b1100_0000) == 0b1000_0000 {
            end -= 1;
        }
        &bytes[..end]
    } else {
        &bytes[..]
    };
    let content = String::from_utf8_lossy(slice).into_owned();
    Ok(TextFile {
        content,
        truncated,
        size,
    })
}

// ── Trash ──────────────────────────────────────────────────────────────────

fn trash_err(e: trash::Error) -> CoreError {
    CoreError::Io(std::io::Error::new(
        std::io::ErrorKind::Other,
        e.to_string(),
    ))
}

pub fn list_trash() -> Result<Vec<TrashItemInfo>, CoreError> {
    #[cfg(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    ))]
    {
        let items = trash::os_limited::list().map_err(trash_err)?;
        Ok(items
            .into_iter()
            .map(|i| TrashItemInfo {
                id: i.id.to_string_lossy().into_owned(),
                name: i.name.to_string_lossy().into_owned(),
                original_parent: Some(i.original_parent.to_string_lossy().into_owned()),
                time_deleted: if i.time_deleted >= 0 {
                    Some(i.time_deleted as u64)
                } else {
                    None
                },
            })
            .collect())
    }
    #[cfg(not(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    )))]
    {
        // macOS: trash enumeration is not supported by the crate.
        Ok(Vec::new())
    }
}

fn find_trash_item(id: &str) -> Result<trash::TrashItem, CoreError> {
    #[cfg(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    ))]
    {
        trash::os_limited::list()
            .map_err(trash_err)?
            .into_iter()
            .find(|i| i.id.to_string_lossy() == id)
            .ok_or_else(|| {
                CoreError::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "trash item not found",
                ))
            })
    }
    #[cfg(not(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    )))]
    {
        let _ = id;
        Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "trash management is not supported on this platform",
        )))
    }
}

pub fn restore_trash_item(id: &str) -> Result<(), CoreError> {
    let item = find_trash_item(id)?;
    #[cfg(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    ))]
    {
        trash::os_limited::restore_all(vec![item]).map_err(trash_err)
    }
    #[cfg(not(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    )))]
    {
        let _ = item;
        Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "trash management is not supported on this platform",
        )))
    }
}

/// Restore a trash item whose original location matches `original_path`
/// (used for undo-delete).
pub fn restore_trash_item_by_original(original_path: &str) -> Result<(), CoreError> {
    #[cfg(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    ))]
    {
        let items = trash::os_limited::list().map_err(trash_err)?;
        let norm = |p: &std::path::Path| p.to_string_lossy().replace('\\', "/");
        let target = norm(Path::new(original_path));
        let item = items
            .into_iter()
            .find(|i| norm(&i.original_path()) == target)
            .ok_or_else(|| {
                CoreError::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "trash item not found",
                ))
            })?;
        trash::os_limited::restore_all(vec![item]).map_err(trash_err)
    }
    #[cfg(not(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    )))]
    {
        let _ = original_path;
        Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "trash management is not supported on this platform",
        )))
    }
}

/// Permanently delete a single trash item.
pub fn purge_trash_item(id: &str) -> Result<(), CoreError> {
    let item = find_trash_item(id)?;
    #[cfg(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    ))]
    {
        trash::os_limited::purge_all(vec![item]).map_err(trash_err)
    }
    #[cfg(not(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    )))]
    {
        let _ = item;
        Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "trash management is not supported on this platform",
        )))
    }
}

pub fn empty_trash() -> Result<(), CoreError> {
    #[cfg(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    ))]
    {
        let items = trash::os_limited::list().map_err(trash_err)?;
        trash::os_limited::purge_all(items).map_err(trash_err)
    }
    #[cfg(not(any(
        target_os = "windows",
        all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))
    )))]
    {
        Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "trash management is not supported on this platform",
        )))
    }
}

// ── Recursive filename search ──────────────────────────────────────────────

/// Directories that are almost always noise and expensive to walk.
const NOISE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "__pycache__",
    ".cache",
];

pub fn search_files(root: &str, query: &str, limit: usize) -> Result<Vec<crate::Entry>, CoreError> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let root = PathBuf::from(crate::expand_tilde(root));
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let mut stack: Vec<(PathBuf, u32)> = vec![(root.clone(), 0)];
    let max_depth: u32 = 12;
    let limit = limit.max(1).min(500);

    while let Some((dir, depth)) = stack.pop() {
        if depth > max_depth || out.len() >= limit {
            continue;
        }
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        let mut items: Vec<PathBuf> = Vec::new();
        for item in rd.flatten() {
            let p = item.path();
            let name = item.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            items.push(p);
        }
        // directories first for stable ordering
        items.sort_by(|a, b| {
            let ad = a.is_dir();
            let bd = b.is_dir();
            bd.cmp(&ad).then_with(|| a.file_name().cmp(&b.file_name()))
        });
        for p in items {
            if out.len() >= limit {
                break;
            }
            let is_dir = p.is_dir();
            if !is_dir
                && fs::symlink_metadata(&p)
                    .map(|m| m.file_type().is_symlink())
                    .unwrap_or(false)
            {
                continue;
            }
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name.to_lowercase().contains(&q) {
                let meta =
                    fs::metadata(&p).unwrap_or_else(|_| fs::symlink_metadata(&p).unwrap());
                out.push(crate::Entry {
                    name: name.clone(),
                    path: p.to_string_lossy().into_owned(),
                    is_dir,
                    size: if is_dir { None } else { Some(meta.len()) },
                    modified: ts(meta.modified().ok()),
                    file_type: if is_dir {
                        "directory"
                    } else {
                        filetype::get_file_type(&name)
                    },
                });
            }
            if is_dir && depth < max_depth {
                let base = p
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if !NOISE_DIRS.contains(&base.as_str()) {
                    stack.push((p, depth + 1));
                }
            }
        }
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out.truncate(limit);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rename_destination_inserts_counter() {
        let dir = std::env::temp_dir();
        let name = format!("fleetfile_test_{}.txt", std::process::id());
        let first = format!("{}/{}", dir.display(), name);
        fs::write(&first, "x").unwrap();
        let result = generate_rename_destination(&dir, &name).unwrap();
        assert!(result.contains("(1)"));
        fs::remove_file(&first).unwrap();
    }

    #[test]
    fn copy_and_move_file() {
        let dir = std::env::temp_dir().join(format!("fleetfile_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("a.txt");
        fs::write(&src, "hello").unwrap();

        let copied = dir.join("b.txt");
        copy_entry(src.to_str().unwrap(), copied.to_str().unwrap()).unwrap();
        assert!(copied.exists() && src.exists());

        let moved = dir.join("c.txt");
        move_entry(copied.to_str().unwrap(), moved.to_str().unwrap()).unwrap();
        assert!(moved.exists() && !copied.exists());

        delete_entry(moved.to_str().unwrap(), false).unwrap();
        assert!(!moved.exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn copy_reports_progress() {
        let dir = std::env::temp_dir().join(format!("fleetfile_prog_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("big.bin");
        fs::write(&src, vec![7u8; 300_000]).unwrap();
        let dst = dir.join("big2.bin");
        let mut last = (0u64, 0u64);
        {
            let mut cb = |done: u64, total: u64| {
                last = (done, total);
                done <= total
            };
            copy_entry_with_progress(src.to_str().unwrap(), dst.to_str().unwrap(), Some(&mut cb))
                .unwrap();
        }
        assert_eq!(last.0, last.1);
        assert!(last.1 >= 300_000);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn search_finds_by_name() {
        let dir = std::env::temp_dir().join(format!("fleetfile_search_{}", std::process::id()));
        fs::create_dir_all(dir.join("sub/deep")).unwrap();
        fs::write(dir.join("unique_token_x.txt"), "x").unwrap();
        fs::write(dir.join("sub/unique_token_y.log"), "y").unwrap();
        fs::write(dir.join("sub/deep/other.txt"), "z").unwrap();
        let results = search_files(dir.to_str().unwrap(), "unique_token", 50).unwrap();
        assert_eq!(results.len(), 2);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn properties_include_metadata() {
        let dir = std::env::temp_dir().join(format!("fleetfile_prop_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("p.txt");
        fs::write(&f, "abc").unwrap();
        let props = get_properties(f.to_str().unwrap()).unwrap();
        assert_eq!(props.size, 3);
        assert!(!props.is_dir);
        assert_eq!(props.extension.as_deref(), Some("txt"));
        assert!(props.created.is_some());
        fs::remove_dir_all(&dir).unwrap();
    }
}
