use std::path::Path;
use std::process::Command;

use crate::CoreError;

/// RAR creation bridge via the `rars` CLI (crates.io `rars-cli`, `cargo install
/// rars-cli`). RAR *extraction* stays on the 7-Zip bridge (more mature); this
/// module only creates .rar archives.
///
/// The binary is located via:
///   1. `FLEETFILE_RARS_BIN` env var (packaged app can point at a bundled one),
///   2. `PATH` (binary name is `rars`).
const CANDIDATES: &[&str] = &["rars"];

pub fn find_rars() -> Option<String> {
    if let Ok(p) = std::env::var("FLEETFILE_RARS_BIN") {
        if !p.is_empty() && probe(&p) {
            return Some(p);
        }
    }
    CANDIDATES
        .iter()
        .find(|bin| probe(bin))
        .map(|b| b.to_string())
}

pub fn rars_available() -> bool {
    find_rars().is_some()
}

fn probe(bin: &str) -> bool {
    Command::new(bin)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn not_found() -> CoreError {
    CoreError::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "未检测到 rars-cli（cargo install rars-cli），无法创建 RAR",
    ))
}

fn run(cmd: &mut Command) -> Result<(), CoreError> {
    let out = cmd.output().map_err(|e| {
        CoreError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;
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

/// Create a RAR archive from `sources` at `dest` using the `rars` CLI.
/// RAR generation rar50 is used for broad WinRAR compatibility.
pub fn compress_rar(sources: &[String], dest: &str) -> Result<(), CoreError> {
    let Some(bin) = find_rars() else {
        return Err(not_found());
    };
    if let Some(parent) = Path::new(dest).parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Overwrite semantics: remove a stale target first (like the 7z bridge).
    if let Ok(meta) = std::fs::symlink_metadata(dest) {
        if meta.is_file() {
            std::fs::remove_file(dest)?;
        }
    }
    let mut cmd = Command::new(&bin);
    cmd.arg("a").arg("--format").arg("rar50").arg(dest);
    for src in sources {
        cmd.arg(src);
    }
    run(&mut cmd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_rars_if_installed() {
        let _ = rars_available();
    }

    #[test]
    fn missing_rars_errors_cleanly() {
        // Force the probe to fail by pointing at a bogus binary.
        std::env::set_var("FLEETFILE_RARS_BIN", "/nonexistent/rars");
        let err = compress_rar(&[], "x.rar");
        assert!(err.is_err());
        std::env::remove_var("FLEETFILE_RARS_BIN");
    }
}
