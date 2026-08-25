use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::CoreError;

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

fn add_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    path: &Path,
    name: &str,
    opts: zip::write::FileOptions,
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
            add_to_zip(zip, &item.path(), &child_name, opts)?;
        }
    } else {
        zip.start_file(name, opts).map_err(zip_err)?;
        let mut f = fs::File::open(path)?;
        std::io::copy(&mut f, zip)?;
    }
    Ok(())
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
/// "zip", "tar", "tar.gz", "tar.bz2", "tar.xz".
pub fn compress_files(
    sources: &[String],
    dest: &str,
    format: &str,
    level: u32,
) -> Result<(), CoreError> {
    if sources.is_empty() {
        return Ok(());
    }
    let dest_path = Path::new(dest);
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = fs::File::create(dest_path)?;

    if format == "7z" {
        return crate::sevenz::compress_7z(sources, dest, level, None);
    }
    if format == "rar" {
        return crate::rar::compress_rar(sources, dest);
    }
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
            add_to_zip(&mut zip, path, &name, opts)?;
        }
        zip.finish().map_err(zip_err)?;
        return Ok(());
    }

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
        builder.append_dir_all(&name, path).map_err(tar_err)?;
    }
    builder.finish().map_err(tar_err)?;
    Ok(())
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
pub fn extract_archive(
    archive: &str,
    dest: &str,
    password: Option<&str>,
) -> Result<(), CoreError> {
    fs::create_dir_all(dest)?;
    let dest_path = Path::new(dest);
    let format = format_from_name(archive);

    if format == "7z" || format == "rar" {
        return crate::sevenz::extract_with_7z(archive, dest, password);
    }
    if format == "zip" {
        let file = fs::File::open(archive)?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| {
            CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
        })?;
        for i in 0..zip.len() {
            let name;
            let is_dir;
            let mut data: Vec<u8> = Vec::new();
            if let Some(pw) = password {
                let inner = zip.by_index_decrypt(i, pw.as_bytes()).map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
                let mut e = inner.map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
                name = e.name().to_string();
                is_dir = e.is_dir();
                e.read_to_end(&mut data).map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
            } else {
                let mut e = zip.by_index(i).map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
                name = e.name().to_string();
                is_dir = e.is_dir();
                e.read_to_end(&mut data).map_err(|e| {
                    CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
                })?;
            }
            let out = safe_join(dest_path, &name)?;
            if is_dir {
                fs::create_dir_all(&out)?;
            } else {
                if let Some(parent) = out.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&out, &data)?;
            }
        }
        return Ok(());
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
        } else {
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent)?;
            }
            entry.unpack(&out).map_err(|e| {
                CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
            })?;
        }
    }
    Ok(())
}

/// List the top-level entries of an archive (recursive paths flattened).
pub fn list_archive(
    archive: &str,
    password: Option<&str>,
) -> Result<Vec<ArchiveEntryInfo>, CoreError> {
    let format = format_from_name(archive);
    let mut out = Vec::new();
    if format == "7z" || format == "rar" {
        let names = crate::sevenz::list_with_7z(archive, password)?;
        for n in names {
            out.push(ArchiveEntryInfo {
                name: n.clone(),
                is_dir: n.ends_with('/'),
                size: 0,
                compressed_size: 0,
            });
        }
        return Ok(out);
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
}
