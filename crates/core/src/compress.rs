use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

use crate::{CoreError, ProgressFn};

#[derive(Debug, Clone, Serialize)]
pub struct ArchiveEntryInfo {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub compressed_size: u64,
}

/// Reject archive entries that would escape the destination (path traversal).
fn safe_join(dest: &Path, name: &str) -> Result<PathBuf, CoreError> {
    let p = Path::new(name);
    if p.is_absolute()
        || p.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("unsafe archive entry name: {}", name),
        )));
    }
    Ok(dest.join(p))
}

/// Marker error kind/message used to escape tar's internal copy loop when a
/// progress callback requests cancellation. Mapped to `CoreError::Cancelled`
/// at the call site.
const CANCEL_MARKER: &str = "fleetfile-op-cancelled";

/// Total bytes of a source path (recursive for directories, symlinks skipped).
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

/// Reader wrapper that reports (done, total) per read and aborts when the
/// progress callback returns false. Used by the tar builder's copy loop.
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

fn add_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    path: &Path,
    name: &str,
    opts: zip::write::FileOptions,
    done: &mut u64,
    total: u64,
    progress: &mut Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        zip.add_directory(name, opts).map_err(zip_err)?;
        for item in fs::read_dir(path)? {
            let item = item?;
            let child_name = format!("{}/{}", name.trim_end_matches('/'), item.file_name().to_string_lossy());
            add_to_zip(zip, &item.path(), &child_name, opts, done, total, progress)?;
        }
    } else {
        zip.start_file(name, opts).map_err(zip_err)?;
        let mut f = fs::File::open(path)?;
        let mut buf = vec![0u8; 1024 * 1024];
        loop {
            let n = f.read(&mut buf)?;
            if n == 0 {
                break;
            }
            zip.write_all(&buf[..n])?;
            *done += n as u64;
            if let Some(p) = progress.as_mut() {
                if !p(*done, total) {
                    return Err(CoreError::Cancelled);
                }
            }
        }
    }
    Ok(())
}

fn tar_add_path<'b, 'c>(
    builder: &mut tar::Builder<Box<dyn Write>>,
    path: &Path,
    name: &str,
    done: &mut u64,
    total: u64,
    progress: &mut Option<&'b mut ProgressFn<'c>>,
) -> Result<(), CoreError> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        builder.append_dir(name, path).map_err(tar_err)?;
        for item in fs::read_dir(path)? {
            let item = item?;
            let child_name = format!("{}/{}", name.trim_end_matches('/'), item.file_name().to_string_lossy());
            tar_add_path(builder, &item.path(), &child_name, done, total, progress)?;
        }
        return Ok(());
    }
    let mut header = tar::Header::new_gnu();
    header.set_metadata(&meta);
    header.set_size(meta.len());
    header.set_cksum();
    let src = fs::File::open(path)?;
    let mut tracker = ChunkTracker {
        inner: src,
        done,
        total,
        cancelled: AtomicBool::new(false),
        cb: progress.take(),
    };
    let result = builder.append_data(&mut header, name, &mut tracker).map_err(tar_err);
    // Hand the progress callback back so subsequent entries keep reporting.
    std::mem::swap(progress, &mut tracker.cb);
    if tracker.cancelled.load(Ordering::Relaxed) {
        return Err(CoreError::Cancelled);
    }
    result
}

fn make_tar_builder(format: &str, file: fs::File, level: u32) -> Result<tar::Builder<Box<dyn Write>>, CoreError> {
    let level = level.clamp(0, 9);
    let writer: Box<dyn Write> = match format {
        "tar" => Box::new(file),
        "tar.gz" | "tgz" => Box::new(flate2::write::GzEncoder::new(
            file,
            flate2::Compression::new(level),
        )),
        "tar.bz2" | "tbz2" => Box::new(bzip2::write::BzEncoder::new(
            file,
            bzip2::Compression::new(level),
        )),
        "tar.xz" | "txz" => {
            let stream = xz2::stream::Stream::new_easy_encoder(level, xz2::stream::Check::None)
                .map_err(|e| {
                    CoreError::Io(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        e.to_string(),
                    ))
                })?;
            Box::new(xz2::write::XzEncoder::new_stream(file, stream))
        }
        _ => {
            return Err(CoreError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "unsupported archive format",
            )))
        }
    };
    Ok(tar::Builder::new(writer))
}

/// Create an archive from `sources` at `dest`. `format` is one of
/// "zip", "tar", "tar.gz", "tar.bz2", "tar.xz", "7z", "rar" — all
/// implemented in-process.
///
/// Progress is reported via `progress` and the operation is cancelled by
/// returning `false`; a partial archive is removed on cancel.
pub fn compress_files_with_progress(
    sources: &[String],
    dest: &str,
    format: &str,
    level: u32,
    progress: &mut Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    if sources.is_empty() {
        return Ok(());
    }
    if format == "7z" {
        return crate::sevenz::compress_7z_with_progress(sources, dest, level, None, progress);
    }
    if format == "rar" {
        return crate::rar::compress_rar_with_progress(sources, dest, level, progress);
    }
    let dest_path = Path::new(dest);
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = fs::File::create(dest_path)?;

    let total: u64 = sources.iter().map(|s| total_size(Path::new(s))).sum();
    let mut done = 0u64;
    if let Some(p) = progress.as_mut() {
        p(0, total);
    }

    let result = (|| -> Result<(), CoreError> {
        if format == "zip" {
            let mut zip = zip::ZipWriter::new(file);
            let opts = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .compression_level(Some(level.clamp(0, 9) as i32));
            for src in sources {
                let path = Path::new(src);
                if !path.exists() {
                    continue;
                }
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                add_to_zip(&mut zip, path, &name, opts, &mut done, total, progress)?;
            }
            zip.finish().map_err(zip_err)?;
        } else {
            let mut builder = make_tar_builder(format, file, level)?;
            for src in sources {
                let path = Path::new(src);
                if !path.exists() {
                    continue;
                }
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                tar_add_path(&mut builder, path, &name, &mut done, total, progress)?;
            }
            builder.finish().map_err(tar_err)?;
        }
        Ok(())
    })();

    match result {
        Ok(()) => Ok(()),
        Err(CoreError::Cancelled) => {
            let _ = fs::remove_file(dest_path);
            Err(CoreError::Cancelled)
        }
        Err(e) => {
            let _ = fs::remove_file(dest_path);
            Err(e)
        }
    }
}

/// Create an archive without progress reporting (legacy API).
pub fn compress_files(
    sources: &[String],
    dest: &str,
    format: &str,
    level: u32,
) -> Result<(), CoreError> {
    compress_files_with_progress(sources, dest, format, level, &mut None)
}

fn zip_err(e: zip::result::ZipError) -> CoreError {
    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
}

fn tar_err(e: std::io::Error) -> CoreError {
    CoreError::Io(e)
}

fn format_from_name(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        "tar.gz"
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") {
        "tar.bz2"
    } else if lower.ends_with(".tar.xz") || lower.ends_with(".txz") {
        "tar.xz"
    } else if lower.ends_with(".tar") {
        "tar"
    } else if lower.ends_with(".zip") {
        "zip"
    } else if lower.ends_with(".7z") {
        "7z"
    } else if lower.ends_with(".rar") {
        "rar"
    } else {
        "zip"
    }
}

/// Extract `archive` into `dest` (created if missing). Zip entries can be
/// decrypted with `password`; all entries are validated against path
/// traversal.
///
/// Handles zip/tar/7z in-process. RAR has its own entry point
/// ([`crate::rar::extract_rar_with_progress`]) because the caller feeds it a
/// shared progress bridge.
pub fn extract_archive_with_progress(
    archive: &str,
    dest: &str,
    password: Option<&str>,
    progress: &mut Option<&mut ProgressFn>,
) -> Result<(), CoreError> {
    fs::create_dir_all(dest)?;
    let dest_path = Path::new(dest);
    let format = format_from_name(archive);

    if format == "rar" {
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "rar extraction must go through extract_rar_with_progress",
        )));
    }
    if format == "7z" {
        return crate::sevenz::extract_7z_with_progress(archive, dest, password, progress);
    }
    if format == "zip" {
        let file = fs::File::open(archive)?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| {
            CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
        })?;
        // Pass 1: sum entry sizes for a total (central directory is cheap).
        let total: u64 = (0..zip.len())
            .filter_map(|i| {
                let e = if let Some(pw) = password {
                    zip.by_index_decrypt(i, pw.as_bytes())
                        .ok()
                        .and_then(|r| r.ok())
                } else {
                    zip.by_index(i).ok()
                }?;
                (!e.is_dir()).then_some(e.size())
            })
            .sum();
        let mut done = 0u64;
        if let Some(p) = progress.as_mut() {
            p(0, total);
        }
        for i in 0..zip.len() {
            let name;
            let is_dir;
            let mut entry;
            if let Some(pw) = password {
                let inner = zip.by_index_decrypt(i, pw.as_bytes()).map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
                entry = inner.map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
                name = entry.name().to_string();
                is_dir = entry.is_dir();
            } else {
                entry = zip.by_index(i).map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
                name = entry.name().to_string();
                is_dir = entry.is_dir();
            }
            let out = safe_join(dest_path, &name)?;
            if is_dir {
                fs::create_dir_all(&out)?;
                continue;
            }
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut w = fs::File::create(&out)?;
            let mut buf = vec![0u8; 256 * 1024];
            loop {
                let n = entry.read(&mut buf).map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
                if n == 0 {
                    break;
                }
                w.write_all(&buf[..n])?;
                done += n as u64;
                if let Some(p) = progress.as_mut() {
                    if !p(done, total) {
                        drop(w);
                        let _ = fs::remove_file(&out);
                        return Err(CoreError::Cancelled);
                    }
                }
            }
            w.flush()?;
        }
        return Ok(());
    }

    // ── tar family ──
    // Pass 1: sum entry sizes for a total. tar has no central directory, so
    // this decompresses the stream per entry-header; acceptable cost, and
    // lets the UI show real percentages.
    let total: u64 = {
        let file = fs::File::open(archive)?;
        let reader: Box<dyn Read> = match format {
            "tar" => Box::new(file),
            "tar.gz" => Box::new(flate2::read::GzDecoder::new(file)),
            "tar.bz2" => Box::new(bzip2::read::BzDecoder::new(file)),
            "tar.xz" => Box::new(xz2::read::XzDecoder::new(file)),
            _ => {
                return Err(CoreError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "unsupported archive format",
                )))
            }
        };
        let mut archive = tar::Archive::new(reader);
        let mut sum = 0u64;
        let entries = archive.entries().map_err(|e| {
            CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
        })?;
        for entry in entries {
            let entry = entry.map_err(|e| {
                CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
            })?;
            if !entry.header().entry_type().is_dir() {
                sum += entry.size();
            }
        }
        sum
    };
    let mut done = 0u64;
    if let Some(p) = progress.as_mut() {
        p(0, total);
    }

    let file = fs::File::open(archive)?;
    let reader: Box<dyn Read> = match format {
        "tar" => Box::new(file),
        "tar.gz" => Box::new(flate2::read::GzDecoder::new(file)),
        "tar.bz2" => Box::new(bzip2::read::BzDecoder::new(file)),
        "tar.xz" => Box::new(xz2::read::XzDecoder::new(file)),
        _ => {
            return Err(CoreError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "unsupported archive format",
            )))
        }
    };
    let mut archive = tar::Archive::new(reader);
    let mut entries = archive.entries().map_err(|e| {
        CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
    })?;
    while let Some(entry) = entries.next() {
        let mut entry = entry.map_err(|e| {
            CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
        })?;
        let name = entry
            .path()
            .map_err(|e| CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())))?
            .to_string_lossy()
            .into_owned();
        let out = safe_join(dest_path, &name)?;
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        if !kind.is_file() {
            // links / devices / pax metadata: let tar handle framing
            entry.unpack(&out).map_err(|e| {
                CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
            })?;
            continue;
        }
        let mut w = fs::File::create(&out)?;
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let n = entry.read(&mut buf).map_err(|e| {
                CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
            })?;
            if n == 0 {
                break;
            }
            w.write_all(&buf[..n])?;
            done += n as u64;
            if let Some(p) = progress.as_mut() {
                if !p(done, total) {
                    drop(w);
                    let _ = fs::remove_file(&out);
                    return Err(CoreError::Cancelled);
                }
            }
        }
        w.flush()?;
        // restore file mode (unpack() does this for us normally)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.header().mode().ok() {
                let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode));
            }
        }
    }
    Ok(())
}

/// Extract an archive without progress reporting (legacy API).
pub fn extract_archive(
    archive: &str,
    dest: &str,
    password: Option<&str>,
) -> Result<(), CoreError> {
    extract_archive_with_progress(archive, dest, password, &mut None)
}

/// List the top-level entries of an archive (recursive paths flattened).
pub fn list_archive(
    archive: &str,
    password: Option<&str>,
) -> Result<Vec<ArchiveEntryInfo>, CoreError> {
    let format = format_from_name(archive);
    let mut out = Vec::new();
    if format == "7z" {
        return crate::sevenz::list_7z(archive, password);
    }
    if format == "rar" {
        return crate::rar::list_rar(archive, password);
    }
    if format == "zip" {
        let file = fs::File::open(archive)?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| {
            CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
        })?;
        for i in 0..zip.len() {
            let (name, is_dir, size, compressed_size) = if let Some(pw) = password {
                let inner = zip.by_index_decrypt(i, pw.as_bytes()).map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
                let entry = inner.map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
                (entry.name().to_string(), entry.is_dir(), entry.size(), entry.compressed_size())
            } else {
                let entry = zip.by_index(i).map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
                (entry.name().to_string(), entry.is_dir(), entry.size(), entry.compressed_size())
            };
            out.push(ArchiveEntryInfo {
                name,
                is_dir,
                size,
                compressed_size,
            });
        }
    } else {
        let file = fs::File::open(archive)?;
        let reader: Box<dyn Read> = match format {
            "tar" => Box::new(file),
            "tar.gz" => Box::new(flate2::read::GzDecoder::new(file)),
            "tar.bz2" => Box::new(bzip2::read::BzDecoder::new(file)),
            "tar.xz" => Box::new(xz2::read::XzDecoder::new(file)),
            _ => Box::new(file),
        };
        let mut archive = tar::Archive::new(reader);
        for entry in archive.entries().map_err(|e| {
            CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
        })? {
            let entry = entry.map_err(|e| {
                CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
            })?;
            out.push(ArchiveEntryInfo {
                name: entry
                    .path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                is_dir: entry.header().entry_type().is_dir(),
                size: entry.size(),
                compressed_size: 0,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("fleetfile_cmp_{}_{}", tag, std::process::id()))
    }

    #[test]
    fn zip_roundtrip_and_traversal_guard() {
        let d = tmpdir("zip");
        fs::create_dir_all(d.join("sub")).unwrap();
        fs::write(d.join("a.txt"), "hello").unwrap();
        fs::write(d.join("sub/b.txt"), "world").unwrap();
        let zip_path = d.join("out.zip");
        compress_files(
            &[d.join("a.txt").to_string_lossy().into_owned()],
            zip_path.to_str().unwrap(),
            "zip",
            6,
        )
        .unwrap();
        assert!(zip_path.exists());

        // malicious entry name must be rejected
        let bad = d.join("bad.zip");
        {
            let file = fs::File::create(&bad).unwrap();
            let mut w = zip::ZipWriter::new(file);
            w.start_file("../evil.txt", zip::write::FileOptions::default())
                .unwrap();
            w.write_all(b"x").unwrap();
            w.finish().unwrap();
        }
        let out = d.join("outdir");
        let err = extract_archive(bad.to_str().unwrap(), out.to_str().unwrap(), None);
        assert!(err.is_err(), "traversal must be rejected");

        // normal extraction
        let out2 = d.join("outdir2");
        extract_archive(zip_path.to_str().unwrap(), out2.to_str().unwrap(), None).unwrap();
        assert!(out2.join("a.txt").exists());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn targz_roundtrip() {
        let d = tmpdir("tgz");
        fs::create_dir_all(d.join("tree")).unwrap();
        fs::write(d.join("tree/x.txt"), "x").unwrap();
        let arc = d.join("t.tar.gz");
        compress_files(
            &[d.join("tree").to_string_lossy().into_owned()],
            arc.to_str().unwrap(),
            "tar.gz",
            6,
        )
        .unwrap();
        let out = d.join("out");
        extract_archive(arc.to_str().unwrap(), out.to_str().unwrap(), None).unwrap();
        assert!(out.join("tree/x.txt").exists());
        let listing = list_archive(arc.to_str().unwrap(), None).unwrap();
        assert!(!listing.is_empty());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn zip_progress_reported_and_cancelled() {
        let d = tmpdir("zprog");
        fs::create_dir_all(d.join("big")).unwrap();
        // 4 MB of data → several 1 MB chunks
        let payload = vec![7u8; 1024 * 1024];
        for i in 0..4 {
            fs::write(d.join("big").join(format!("f{i}.bin")), &payload).unwrap();
        }
        // Cancelled: callback bails after the first chunk, partial archive removed.
        let cancelled_out = d.join("cancelled.zip");
        let mut callbacks = 0u32;
        let err = compress_files_with_progress(
            &[d.join("big").to_string_lossy().into_owned()],
            cancelled_out.to_str().unwrap(),
            "zip",
            6,
            &mut Some(&mut |done, total| {
                callbacks += 1;
                assert!(done <= total && total > 0);
                false
            }),
        );
        assert!(matches!(err, Err(CoreError::Cancelled)));
        assert!(!cancelled_out.exists(), "partial archive must be removed");
        assert!(callbacks >= 2, "expected initial tick + at least one chunk");

        // Normal: callback sees monotonic done and reaches total.
        let ok_out = d.join("ok.zip");
        let mut last = 0u64;
        let mut completed = false;
        compress_files_with_progress(
            &[d.join("big").to_string_lossy().into_owned()],
            ok_out.to_str().unwrap(),
            "zip",
            6,
            &mut Some(&mut |done, total| {
                assert!(done >= last);
                assert!(total >= done);
                last = done;
                if done >= total {
                    completed = true;
                }
                true
            }),
        )
        .unwrap();
        assert!(completed, "progress must reach total");
        assert!(last > 0);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn tar_progress_and_cancel() {
        let d = tmpdir("tprog");
        fs::create_dir_all(d.join("big")).unwrap();
        let payload = vec![3u8; 1024 * 1024];
        for i in 0..4 {
            fs::write(d.join("big").join(format!("f{i}.bin")), &payload).unwrap();
        }

        // Cancel mid-stream through the ChunkTracker path.
        let cancelled_out = d.join("cancelled.tar.gz");
        let mut ticks = 0u32;
        let err = compress_files_with_progress(
            &[d.join("big").to_string_lossy().into_owned()],
            cancelled_out.to_str().unwrap(),
            "tar.gz",
            6,
            &mut Some(&mut |done, total| {
                ticks += 1;
                assert!(done <= total && total > 0);
                false
            }),
        );
        assert!(matches!(err, Err(CoreError::Cancelled)));
        assert!(!cancelled_out.exists(), "partial archive must be removed");
        assert!(ticks >= 2);

        // Normal flow reaches total.
        let ok_out = d.join("ok.tar");
        let mut last = 0u64;
        let mut completed = false;
        compress_files_with_progress(
            &[d.join("big").to_string_lossy().into_owned()],
            ok_out.to_str().unwrap(),
            "tar",
            6,
            &mut Some(&mut |done, total| {
                assert!(done >= last);
                last = done;
                if done >= total {
                    completed = true;
                }
                true
            }),
        )
        .unwrap();
        assert!(completed);
        assert!(last > 0);

        // Round-trips: compressed earlier archive extracts fine.
        let tgz = d.join("x.tar.gz");
        compress_files(
            &[d.join("big").to_string_lossy().into_owned()],
            tgz.to_str().unwrap(),
            "tar.gz",
            6,
        )
        .unwrap();
        let out = d.join("out");
        extract_archive(tgz.to_str().unwrap(), out.to_str().unwrap(), None).unwrap();
        assert!(out.join("big/f0.bin").exists());

        // Extraction reports progress / cancels too.
        let big_tar = d.join("big.tar");
        compress_files(
            &[d.join("big").to_string_lossy().into_owned()],
            big_tar.to_str().unwrap(),
            "tar",
            6,
        )
        .unwrap();
        let out2 = d.join("out2");
        let mut x_ticks = 0u32;
        let xerr = extract_archive_with_progress(
            big_tar.to_str().unwrap(),
            out2.to_str().unwrap(),
            None,
            &mut Some(&mut |_, _| {
                x_ticks += 1;
                false
            }),
        );
        assert!(matches!(xerr, Err(CoreError::Cancelled)));
        assert!(x_ticks >= 1, "expected at least the initial tick");
        fs::remove_dir_all(&d).unwrap();
    }
}