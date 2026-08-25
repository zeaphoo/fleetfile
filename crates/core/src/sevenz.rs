use std::path::Path;
use std::process::Command;

use crate::CoreError;

/// 7-Zip external bridge.
///
/// Provides 7z creation + extraction and RAR extraction by shelling out to a
/// system 7-Zip binary. The binary is located via:
///   1. `FLEETFILE_7Z_BIN` env var (lets a packaged app point at a bundled 7z),
///   2. `PATH` (7z / 7zz / 7za).
///
/// RAR *creation* is intentionally unsupported (no open implementation is
/// bundled; 7-Zip itself cannot write RAR).
const CANDIDATES: &[&str] = &["7z", "7zz", "7za"];

pub fn find_7z() -> Option<String> {
    if let Ok(p) = std::env::var("FLEETFILE_7Z_BIN") {
        if !p.is_empty() && probe(&p) {
            return Some(p);
        }
    }
    CANDIDATES
        .iter()
        .find(|bin| probe(bin))
        .map(|b| b.to_string())
}

pub fn sevenz_available() -> bool {
    find_7z().is_some()
}

fn probe(bin: &str) -> bool {
    Command::new(bin)
        .arg("i")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn not_found() -> CoreError {
    CoreError::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "未检测到 7-Zip，无法执行此操作",
    ))
}

fn run(cmd: &mut Command) -> Result<(), CoreError> {
    let out = cmd
        .output()
        .map_err(|e| CoreError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
    if !out.status.success() {
        let mut msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !stdout.is_empty() {
            msg = format!("{} | STDOUT: {}", msg, stdout);
        }
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            msg,
        )));
    }
    Ok(())
}

fn password_arg(password: Option<&str>) -> Option<String> {
    password
        .filter(|p| !p.is_empty())
        .map(|p| format!("-p{}", p))
}

/// Create a 7z archive from `sources` at `dest`.
pub fn compress_7z(
    sources: &[String],
    dest: &str,
    level: u32,
    password: Option<&str>,
) -> Result<(), CoreError> {
    let Some(bin) = find_7z() else {
        return Err(not_found());
    };
    if let Some(parent) = Path::new(dest).parent() {
        std::fs::create_dir_all(parent)?;
    }
    // 7-Zip fails with EPERM when the target archive already exists as an
    // (empty) file, because it tries to open it for append. Remove it for
    // overwrite semantics, matching the built-in zip writer.
    if let Ok(meta) = std::fs::symlink_metadata(dest) {
        if meta.is_file() {
            std::fs::remove_file(dest)?;
        }
    }
    // 7z syntax: `7z a [options] <archive> <files>` — options must precede the
    // archive name or they are treated as file names.
    let mut cmd = Command::new(&bin);
    cmd.arg("a").arg("-t7z").arg(format!("-mx={}", level.clamp(0, 9)));
    if let Some(pw) = password_arg(password) {
        cmd.arg(pw);
    }
    cmd.arg(dest);
    for src in sources {
        cmd.arg(src);
    }
    run(&mut cmd)
}

/// Extract 7z / rar archives (whatever the 7-Zip binary supports) into `dest`.
/// Zip entries are validated by 7-Zip itself (it rejects `..`/absolute names).
pub fn extract_with_7z(
    archive: &str,
    dest: &str,
    password: Option<&str>,
) -> Result<(), CoreError> {
    let Some(bin) = find_7z() else {
        return Err(not_found());
    };
    std::fs::create_dir_all(dest)?;
    let mut cmd = Command::new(&bin);
    cmd.arg("x")
        .arg(archive)
        .arg(format!("-o{}", dest))
        .arg("-y");
    if let Some(pw) = password_arg(password) {
        cmd.arg(pw);
    }
    run(&mut cmd)
}

/// List archive entries via `7z l -ba` (bare output). Returns entry names.
pub fn list_with_7z(archive: &str, password: Option<&str>) -> Result<Vec<String>, CoreError> {
    let Some(bin) = find_7z() else {
        return Err(not_found());
    };
    let mut cmd = Command::new(&bin);
    cmd.arg("l").arg("-ba").arg(archive);
    if let Some(pw) = password_arg(password) {
        cmd.arg(pw);
    }
    let out = cmd
        .output()
        .map_err(|e| CoreError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
    if !out.status.success() {
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        )));
    }
    // `-ba` bare listing: name is the last whitespace-separated field of each line.
    let text = String::from_utf8_lossy(&out.stdout);
    let mut names = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // skip header lines (date/time lines begin with digits; also skip "----")
        let field = trimmed.split_whitespace().last().unwrap_or("");
        if field.is_empty() || field.contains("----") || field.starts_with("202") {
            continue;
        }
        names.push(field.to_string());
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("fleetfile_7z_{}_{}", tag, std::process::id()))
    }

    #[test]
    fn detects_7z_if_installed() {
        // Not a hard assertion: just verify the probe runs without panicking
        // and returns a bool.
        let _ = sevenz_available();
    }

    #[test]
    fn sevenz_roundtrip_when_available() {
        if !sevenz_available() {
            eprintln!("skipping: no 7-Zip on this machine");
            return;
        }
        let d = tmpdir("rt");
        std::fs::create_dir_all(d.join("tree")).unwrap();
        std::fs::write(d.join("tree/a.txt"), "hello 7z").unwrap();
        let arc = d.join("out.7z");
        compress_7z(
            &[d.join("tree").to_string_lossy().into_owned()],
            arc.to_str().unwrap(),
            6,
            None,
        )
        .unwrap();
        assert!(arc.exists());
        let out = d.join("out");
        extract_with_7z(arc.to_str().unwrap(), out.to_str().unwrap(), None).unwrap();
        assert!(out.join("tree/a.txt").exists());
        let names = list_with_7z(arc.to_str().unwrap(), None).unwrap();
        assert!(!names.is_empty());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn rar_extraction_when_available() {
        if !sevenz_available() {
            return;
        }
        // Build a rar via 7-Zip? Not possible (7-Zip cannot create rar).
        // Instead just verify `extract_with_7z` returns a clean error for a
        // missing archive, i.e. the code path is exercised.
        let d = tmpdir("rar");
        std::fs::create_dir_all(&d).unwrap();
        let missing = d.join("nope.rar");
        let err = extract_with_7z(missing.to_str().unwrap(), d.to_str().unwrap(), None);
        assert!(err.is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }
}
