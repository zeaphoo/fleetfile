use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use sevenz_rust2::encoder_options::{AesEncoderOptions, Lzma2Options};
use sevenz_rust2::{ArchiveReader, ArchiveWriter, EncoderConfiguration, Password};

use crate::{ArchiveEntryInfo, CoreError, ProgressFn};

const CANCEL_MARKER: &str = "fleetfile-op-cancelled";

fn sz_err(e: sevenz_rust2::Error) -> CoreError {
    CoreError::Io(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        e.to_string(),
    ))
}

/// Wrap an io error into the 7z error type used inside extraction closures.
fn io_to_sz(e: std::io::Error) -> sevenz_rust2::Error {
    sevenz_rust2::Error::Io(e, "".into())
}

/// Reader wrapper reporting per-read progress to the tar-style `ProgressFn`
/// contract; aborts when the callback returns false. Lifetimes are independent
/// to accept the caller's elided `ProgressFn` lifetimes.
struct ChunkTracker<'d, 'b, 'c, R: Read> {
    inner: R,
    done: &'d mut u64,
    total: u64,
    cancelled: AtomicBool,
    cb: Option<&'b mut ProgressFn<'c>>,
}

impl<'d, 'b, 'c, R: Read> Read for ChunkTracker<'d, 'b, 'c, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        *self.done += n as u64;
        if n == 0 {
            return Ok(0);
        }
        let cont = match self.cb.as_deref_mut() {
            Some(cb) => cb(*self.done, self.total),
            None => true,
        };
        if !cont {
            self.cancelled.store(true, Ordering::Relaxed);
            return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, CANCEL_MARKER));
        }
        Ok(n)
    }
}

/// Safe path resolution inside the destination (path traversal guard).
fn safe_join(dest: &Path, name: &str) -> Result<PathBuf, CoreError> {
    let p = Path::new(name);
    if p.is_absolute()
        || p.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("unsafe 7z entry name: {}", name),
        )));
    }
    Ok(dest.join(p))
}

fn total_size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else { return 0 };
    if meta.file_type().is_symlink() {
        return 0;
    }
    if meta.is_dir() {
        let Ok(rd) = fs::read_dir(path) else { return 0 };
        rd.flatten().map(|i| total_size(&i.path())).sum()
    } else {
        meta.len()
    }
}

fn add_to_writer(
    writer: &mut ArchiveWriter<fs::File>,
    path: &Path,
    name: &str,
    done: &mut u64,
    total: u64,
    progress: &mut Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    let entry = sevenz_rust2::ArchiveEntry::from_path(path, name.to_string());
    if meta.is_dir() {
        writer
            .push_archive_entry(entry, None::<std::io::Cursor<Vec<u8>>>)
            .map_err(sz_err)?;
        for item in fs::read_dir(path)? {
            let item = item?;
            let child = format!("{}/{}", name.trim_end_matches('/'), item.file_name().to_string_lossy());
            add_to_writer(writer, &item.path(), &child, done, total, progress)?;
        }
        return Ok(());
    }
    let src = fs::File::open(path)?;
    let mut tracker = ChunkTracker {
        inner: src,
        done,
        total,
        cancelled: AtomicBool::new(false),
        cb: progress.take(),
    };
    let result = writer
        .push_archive_entry(entry, Some(&mut tracker))
        .map(|_| ())
        .map_err(sz_err);
    // Hand the progress callback back so subsequent entries keep reporting.
    std::mem::swap(progress, &mut tracker.cb);
    if tracker.cancelled.load(Ordering::Relaxed) {
        return Err(CoreError::Cancelled);
    }
    result
}

/// Create a 7z archive in-process (pure Rust, LZMA2), reporting byte progress
/// and honouring cancellation via `progress`.
pub fn compress_7z_with_progress(
    sources: &[String],
    dest: &str,
    level: u32,
    password: Option<&str>,
    progress: &mut Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    if sources.is_empty() {
        return Ok(());
    }
    if let Some(parent) = Path::new(dest).parent() {
        fs::create_dir_all(parent)?;
    }
    let total: u64 = sources.iter().map(|s| total_size(Path::new(s))).sum();
    let mut done = 0u64;
    if let Some(p) = progress.as_mut() {
        p(0, total);
    }

    let result = (|| -> Result<(), CoreError> {
        let mut writer: ArchiveWriter<fs::File> = ArchiveWriter::create(dest).map_err(sz_err)?;
        let mut methods: Vec<EncoderConfiguration> = vec![];
        if let Some(pw) = password.filter(|p| !p.is_empty()) {
            methods.push(AesEncoderOptions::new(pw.into()).into());
        }
        methods.push(Lzma2Options::from_level(level.clamp(1, 9)).into());
        writer.set_content_methods(methods);
        for src in sources {
            let path = Path::new(src);
            if !path.exists() {
                continue;
            }
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            add_to_writer(&mut writer, path, &name, &mut done, total, progress)?;
        }
        writer.finish()?;
        Ok(())
    })();

    match result {
        Err(CoreError::Cancelled) => {
            let _ = fs::remove_file(dest);
            Err(CoreError::Cancelled)
        }
        Err(e) => {
            let _ = fs::remove_file(dest);
            Err(e)
        }
        ok => ok,
    }
}

/// Extract a 7z archive in-process (pure Rust), streaming entries with byte
/// progress and cancellation.
pub fn extract_7z_with_progress(
    archive: &str,
    dest: &str,
    password: Option<&str>,
    progress: &mut Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    fs::create_dir_all(dest)?;
    let dest_path = PathBuf::from(dest);
    let pw = Password::new(password.unwrap_or(""));

    let mut reader = ArchiveReader::open(archive, pw).map_err(sz_err)?;
    let mut total = 0u64;
    for f in &reader.archive().files {
        if !f.is_directory && f.has_stream {
            total += f.size;
        }
    }
    let mut done = 0u64;
    if let Some(p) = progress.as_mut() {
        p(0, total);
    }

    let mut cancelled = false;
    let r = reader
        .for_each_entries(|entry, reader| {
            let name = entry.name();
            let out = safe_join(&dest_path, &name).map_err(|e| {
                io_to_sz(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    e.to_string(),
                ))
            })?;
            if entry.is_directory() {
                fs::create_dir_all(&out).map_err(io_to_sz)?;
                return Ok(true);
            }
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(io_to_sz)?;
            }
            let mut w = fs::File::create(&out).map_err(io_to_sz)?;
            let mut buf = vec![0u8; 256 * 1024];
            loop {
                let n = reader.read(&mut buf).map_err(|e| io_to_sz(e))?;
                if n == 0 {
                    break;
                }
                w.write_all(&buf[..n]).map_err(io_to_sz)?;
                done += n as u64;
                if let Some(p) = progress.as_mut() {
                    if !p(done, total) {
                        cancelled = true;
                        return Ok(false);
                    }
                }
            }
            Ok(true)
        })
        .map_err(sz_err);

    match (r, cancelled) {
        (Ok(()), false) => Ok(()),
        (_, true) => Err(CoreError::Cancelled),
        (Err(e), _) => Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            e.to_string(),
        ))),
    }
}

/// List 7z archive entries in-process.
pub fn list_7z(
    archive: &str,
    password: Option<&str>,
) -> Result<Vec<ArchiveEntryInfo>, CoreError> {
    let pw = Password::new(password.unwrap_or(""));
    let reader = ArchiveReader::open(archive, pw).map_err(sz_err)?;
    let mut out = Vec::new();
    for f in &reader.archive().files {
        out.push(ArchiveEntryInfo {
            name: f.name().to_string(),
            is_dir: f.is_directory,
            size: f.size,
            compressed_size: f.compressed_size,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("fleetfile_7zr_{}_{}", tag, std::process::id()))
    }

    #[test]
    fn sevenz_roundtrip() {
        let d = tmpdir("rt");
        fs::create_dir_all(d.join("tree")).unwrap();
        fs::write(d.join("tree/a.txt"), "hello 7z rust").unwrap();
        let arc = d.join("out.7z");
        compress_7z_with_progress(
            &[d.join("tree").to_string_lossy().into_owned()],
            arc.to_str().unwrap(),
            6,
            None,
            &mut None,
        )
        .unwrap();
        assert!(arc.exists());
        let out = d.join("out");
        extract_7z_with_progress(arc.to_str().unwrap(), out.to_str().unwrap(), None, &mut None).unwrap();
        assert!(out.join("tree/a.txt").exists());
        let names = list_7z(arc.to_str().unwrap(), None).unwrap();
        assert!(!names.is_empty());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn sevenz_progress_and_cancel() {
        let d = tmpdir("prog");
        fs::create_dir_all(d.join("big")).unwrap();
        let payload = vec![5u8; 1024 * 1024];
        for i in 0..4 {
            fs::write(d.join("big").join(format!("f{i}.bin")), &payload).unwrap();
        }
        // cancel: callback bails after first chunk; partial archive removed
        let cancelled_out = d.join("cancelled.7z");
        let mut ticks = 0u32;
        let err = compress_7z_with_progress(
            &[d.join("big").to_string_lossy().into_owned()],
            cancelled_out.to_str().unwrap(),
            6,
            None,
            &mut Some(&mut |done, total| {
                ticks += 1;
                assert!(done <= total && total > 0);
                false
            }),
        );
        assert!(matches!(err, Err(CoreError::Cancelled)));
        assert!(!cancelled_out.exists(), "partial archive must be removed");
        assert!(ticks >= 2);

        // normal flow reaches total
        let ok_out = d.join("ok.7z");
        let mut last = 0u64;
        let mut completed = false;
        compress_7z_with_progress(
            &[d.join("big").to_string_lossy().into_owned()],
            ok_out.to_str().unwrap(),
            6,
            None,
            &mut Some(&mut |done, total| {
                last = done;
                if done >= total {
                    completed = true;
                }
                true
            }),
        )
        .unwrap();
        assert!(completed, "progress must reach total (last={})", last);

        // extraction cancel
        let out = d.join("out");
        let mut x_ticks = 0u32;
        let xerr = extract_7z_with_progress(
            ok_out.to_str().unwrap(),
            out.to_str().unwrap(),
            None,
            &mut Some(&mut |_, _| {
                x_ticks += 1;
                false
            }),
        );
        assert!(matches!(xerr, Err(CoreError::Cancelled)));
        assert!(x_ticks >= 1);
        fs::remove_dir_all(&d).unwrap();
    }
}