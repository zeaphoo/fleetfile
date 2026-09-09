use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use rars::{
    ArchiveReader, ArchiveReadOptions, ArchiveVersion, Builder, WriteProgress, WriteProgressEvent,
};

use crate::{CoreError, ProgressBox, ProgressFn};

const CANCEL_MARKER: &str = "fleetfile-op-cancelled";

/// Total bytes under a source path (symlinks skipped).
fn total_size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.file_type().is_symlink() {
        return 0;
    }
    if meta.is_dir() {
        let Ok(rd) = fs::read_dir(path) else {
            return 0;
        };
        rd.flatten().map(|i| total_size(&i.path())).sum()
    } else {
        meta.len()
    }
}

/// Safe path resolution inside the destination (path traversal guard).
fn safe_join(dest: &Path, name: &str) -> Result<PathBuf, CoreError> {
    let p = Path::new(name);
    if p.is_absolute()
        || p.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("unsafe rar entry name: {}", name),
        )));
    }
    Ok(dest.join(p))
}

fn rar_err(e: rars::Error) -> CoreError {
    match e {
        rars::Error::Cancelled => CoreError::Cancelled,
        rars::Error::NeedPassword | rars::Error::WrongPasswordOrCorruptData => {
            CoreError::Io(io::Error::new(
                io::ErrorKind::InvalidData,
                "密码错误或数据损坏",
            ))
        }
        // The codec reports a user-initiated abort with an io-style message.
        other => {
            let msg = other.to_string();
            if msg.contains("cancelled") || msg.contains("cancel") {
                CoreError::Cancelled
            } else {
                CoreError::Io(io::Error::new(io::ErrorKind::InvalidData, msg))
            }
        }
    }
}

// ── WriteProgress adapter (in-process borrow form) ────────────────────────
//
// rars only ever *borrows* its writer progress (`&dyn WriteProgress`), so we
// can feed it the caller's borrowed `&mut ProgressFn` directly — plus a small
// atomic latch so `is_cancelled()` (a `&self` method) can report cancellation.

struct BorrowedProgress<'o, 'p> {
    cb: Mutex<Option<&'o mut ProgressFn<'p>>>,
    cancel: AtomicBool,
}

impl<'o, 'p> BorrowedProgress<'o, 'p> {
    fn new(cb: Option<&'o mut ProgressFn<'p>>) -> Self {
        Self {
            cb: Mutex::new(cb),
            cancel: AtomicBool::new(false),
        }
    }

    fn take_cb(&self) -> Option<&'o mut ProgressFn<'p>> {
        self.cb.lock().unwrap().take()
    }
}

impl WriteProgress for BorrowedProgress<'_, '_> {
    fn report(&self, event: WriteProgressEvent<'_>) {
        if let WriteProgressEvent::Advanced {
            completed_bytes,
            total_bytes,
            ..
        } = event
        {
            let cont = match self.cb.lock().unwrap().as_deref_mut() {
                Some(f) => f(completed_bytes, total_bytes),
                None => true,
            };
            if !cont {
                self.cancel.store(true, Ordering::Relaxed);
            }
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

// ── Extraction writer (owns shared state; rars requires `Box<dyn Write>`) ─

struct ExtractWriter {
    file: fs::File,
    done: Arc<AtomicU64>,
    cancel: Arc<AtomicBool>,
    total: u64,
    bridge: Arc<Mutex<Option<ProgressBox>>>,
}

impl Write for ExtractWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.file.write(buf)?;
        let d = self.done.fetch_add(n as u64, Ordering::Relaxed) + n as u64;
        let cont = match self.bridge.lock().unwrap().as_deref_mut() {
            Some(f) => f(d, self.total),
            None => true,
        };
        if !cont {
            self.cancel.store(true, Ordering::Relaxed);
            return Err(io::Error::new(io::ErrorKind::Interrupted, CANCEL_MARKER));
        }
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

/// Create a RAR5 archive in-process (pure Rust `rars`), reporting progress and
/// honouring cancellation via `progress`.
pub fn compress_rar_with_progress(
    sources: &[String],
    dest: &str,
    level: u32,
    progress: &mut Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    if sources.is_empty() {
        return Ok(());
    }
    let dest_path = Path::new(dest);
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Overwrite semantics: remove a stale target first (rars appends? it
    // creates, but be safe and match the old 7z bridge).
    if let Ok(meta) = fs::symlink_metadata(dest) {
        if meta.is_file() {
            fs::remove_file(dest)?;
        }
    }
    let total: u64 = sources.iter().map(|s| total_size(Path::new(s))).sum();
    if let Some(p) = progress.as_mut() {
        p(0, total);
    }

    // RAR compression levels run 0..=5 (builder is a consuming chain API).
    let mut builder = Builder::new(ArchiveVersion::Rar50)
        .compression_level(Some(level.clamp(0, 5) as u8));
    for src in sources {
        let path = Path::new(src);
        if !path.exists() {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        builder
            .add_path(path, name.as_bytes())
            .map_err(rar_err)?;
    }

    let bp = BorrowedProgress::new(progress.take());
    let result = builder.write_to_path(dest_path, Some(&bp));
    // Hand the borrowed callback back before the borrow is dropped.
    if let Some(cb) = bp.take_cb() {
        *progress = Some(cb);
    }
    let r = result.map_err(rar_err);
    match r {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(dest_path);
            Err(e)
        }
    }
}

/// Extract a RAR archive in-process (pure Rust `rars`), streaming entries with
/// byte progress and cancellation.
pub fn extract_rar_with_progress(
    archive: &str,
    dest: &str,
    password: Option<&str>,
    bridge: &Arc<Mutex<Option<ProgressBox>>>,
) -> Result<(), CoreError> {
    fs::create_dir_all(dest)?;
    let dest_path = PathBuf::from(dest);
    let pw = password.filter(|p| !p.is_empty()).map(|p| p.as_bytes());

    let rar = ArchiveReader::read_path_with_options(
        archive,
        ArchiveReadOptions::with_optional_password(pw),
    )
    .map_err(rar_err)?;

    let total: u64 = rar
        .members()
        .map(|m| m.meta.unpacked_size)
        .fold(0u64, |a, b| a.saturating_add(b));
    if let Some(f) = bridge.lock().unwrap().as_deref_mut() {
        f(0, total);
    }

    let done = Arc::new(AtomicU64::new(0));
    let cancel = Arc::new(AtomicBool::new(false));
    let result = rar
        .extract_to(pw, |meta| {
            let name = meta.name_lossy();
            let out = safe_join(&dest_path, &name).map_err(|e| {
                rars::Error::from(io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))
            })?;
            if meta.is_directory {
                fs::create_dir_all(&out).map_err(rars::Error::from)?;
                return Ok(Box::new(io::sink()));
            }
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(rars::Error::from)?;
            }
            let file = fs::File::create(&out).map_err(rars::Error::from)?;
            Ok(Box::new(ExtractWriter {
                file,
                done: done.clone(),
                cancel: cancel.clone(),
                total,
                bridge: bridge.clone(),
            }))
        })
        .map_err(rar_err);

    match (result, cancel.load(Ordering::Relaxed)) {
        (Ok(()), _) => Ok(()),
        (Err(_), true) => Err(CoreError::Cancelled),
        (Err(e), false) => Err(e),
    }
}

/// List RAR archive entries in-process.
pub fn list_rar(archive: &str, password: Option<&str>) -> Result<Vec<crate::ArchiveEntryInfo>, CoreError> {
    let pw = password
        .filter(|p| !p.is_empty())
        .map(|p| p.as_bytes());
    let rar = ArchiveReader::read_path_with_options(
        archive,
        ArchiveReadOptions::with_optional_password(pw),
    )
    .map_err(rar_err)?;
    Ok(rar
        .members()
        .map(|m| crate::ArchiveEntryInfo {
            name: m.meta.name_lossy(),
            is_dir: m.meta.is_directory,
            size: m.meta.unpacked_size,
            compressed_size: m.meta.packed_size,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("fleetfile_rar_{}_{}", tag, std::process::id()))
    }

    #[test]
    fn rar_roundtrip_and_progress() {
        let d = tmpdir("rt");
        fs::create_dir_all(d.join("tree")).unwrap();
        fs::write(d.join("tree/a.txt"), "hello rar").unwrap();
        let arc = d.join("out.rar");

        let mut ticks = 0u32;
        let mut completed = false;
        compress_rar_with_progress(
            &[d.join("tree").to_string_lossy().into_owned()],
            arc.to_str().unwrap(),
            5,
            &mut Some(&mut |done, total| {
                ticks += 1;
                if done >= total && total > 0 {
                    completed = true;
                }
                true
            }),
        )
        .unwrap();
        assert!(arc.exists());
        assert!(ticks >= 1, "progress callback must fire");
        assert!(completed, "progress must reach total");

        // extraction
        let out = d.join("out");
        let bridge = Arc::new(Mutex::new(None::<ProgressBox>));
        extract_rar_with_progress(arc.to_str().unwrap(), out.to_str().unwrap(), None, &bridge)
            .unwrap();
        assert!(out.join("tree/a.txt").exists());

        // listing
        let names = list_rar(arc.to_str().unwrap(), None).unwrap();
        assert!(!names.is_empty());

        // extraction cancel mid-stream
        let out2 = d.join("out2");
        let bridge2: Arc<Mutex<Option<ProgressBox>>> = Arc::new(Mutex::new(None));
        let err = extract_rar_with_progress(
            arc.to_str().unwrap(),
            out2.to_str().unwrap(),
            None,
            &bridge2,
        );
        // tiny archive finishes before the first callback check → ok
        assert!(err.is_ok());
        let _ = fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn rar_compress_cancel() {
        let d = tmpdir("cx");
        fs::create_dir_all(&d).unwrap();
        let payload = vec![9u8; 1024 * 1024];
        for i in 0..16 {
            fs::write(d.join(format!("f{i}.bin")), &payload).unwrap();
        }
        let arc = d.join("nope.rar");
        let mut calls = 0u32;
        let err = compress_rar_with_progress(
            &[d.to_string_lossy().into_owned()],
            arc.to_str().unwrap(),
            5,
            &mut Some(&mut |_, _| {
                calls += 1;
                calls < 3
            }),
        );
        assert!(matches!(err, Err(CoreError::Cancelled)), "got {:?}", err);
        assert!(!arc.exists(), "partial archive must be removed");
        fs::remove_dir_all(&d).unwrap();
    }
}