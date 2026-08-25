use sha2::Digest;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::CoreError;

#[derive(Debug, Clone, Serialize)]
pub struct CompareEntry {
    pub rel_path: String,
    /// "only_left" | "only_right" | "modified" | "same"
    pub status: &'static str,
    pub left_size: Option<u64>,
    pub right_size: Option<u64>,
    pub left_modified: Option<u64>,
    pub right_modified: Option<u64>,
}

fn ts(opt: Option<std::time::SystemTime>) -> Option<u64> {
    opt.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

fn collect_tree(root: &Path) -> HashMap<String, (u64, Option<u64>)> {
    // rel_path -> (size, modified)
    let mut map = HashMap::new();
    fn walk(
        dir: &Path,
        base: &str,
        map: &mut HashMap<String, (u64, Option<u64>)>,
    ) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for item in rd.flatten() {
            let p = item.path();
            let name = item.file_name().to_string_lossy().into_owned();
            let rel = if base.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", base, name)
            };
            let Ok(meta) = fs::symlink_metadata(&p) else { continue };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                map.insert(rel.clone(), (0, None));
                walk(&p, &rel, map);
            } else {
                map.insert(rel, (meta.len(), ts(meta.modified().ok())));
            }
        }
    }
    walk(root, "", &mut map);
    map
}

/// Compare two directory trees recursively.
pub fn folder_compare(left: &str, right: &str) -> Result<Vec<CompareEntry>, CoreError> {
    let l = Path::new(left);
    let r = Path::new(right);
    if !l.is_dir() || !r.is_dir() {
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "both paths must be directories",
        )));
    }
    let ltree = collect_tree(l);
    let rtree = collect_tree(r);
    let mut keys: Vec<&String> = ltree.keys().chain(rtree.keys()).collect();
    keys.sort();
    keys.dedup();

    let mut out = Vec::new();
    for k in keys {
        match (ltree.get(k), rtree.get(k)) {
            (Some((ls, lm)), Some((rs, rm))) => {
                let same = ls == rs && lm == rm;
                out.push(CompareEntry {
                    rel_path: k.clone(),
                    status: if same { "same" } else { "modified" },
                    left_size: Some(*ls),
                    right_size: Some(*rs),
                    left_modified: *lm,
                    right_modified: *rm,
                });
            }
            (Some((ls, lm)), None) => out.push(CompareEntry {
                rel_path: k.clone(),
                status: "only_left",
                left_size: Some(*ls),
                right_size: None,
                left_modified: *lm,
                right_modified: None,
            }),
            (None, Some((rs, rm))) => out.push(CompareEntry {
                rel_path: k.clone(),
                status: "only_right",
                left_size: None,
                right_size: Some(*rs),
                left_modified: None,
                right_modified: *rm,
            }),
            (None, None) => {}
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateGroup {
    pub size: u64,
    pub hash: String,
    pub files: Vec<String>,
}

const NOISE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "__pycache__",
    ".cache",
];

fn sha256_of(path: &Path) -> Result<String, CoreError> {
    let mut f = fs::File::open(path)?;
    let mut h = sha2::Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// Find duplicate files (same size + sha256) under `dir`.
pub fn find_duplicates(dir: &str, min_size: u64) -> Result<Vec<DuplicateGroup>, CoreError> {
    let root = PathBuf::from(crate::expand_tilde(dir));
    if !root.is_dir() {
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "directory does not exist",
        )));
    }
    // 1) group by size
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut stack = vec![(root.clone(), 0u32)];
    let max_depth = 12u32;
    let mut scanned = 0usize;
    while let Some((dir, depth)) = stack.pop() {
        if depth > max_depth || scanned > 200_000 {
            continue;
        }
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        let mut items = Vec::new();
        for item in rd.flatten() {
            let p = item.path();
            let name = item.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            items.push((p, name));
        }
        for (p, name) in items {
            scanned += 1;
            let Ok(meta) = fs::metadata(&p) else { continue };
            if meta.is_dir() {
                if depth < max_depth && !NOISE_DIRS.contains(&name.as_str()) {
                    stack.push((p, depth + 1));
                }
            } else if meta.len() >= min_size {
                by_size.entry(meta.len()).or_default().push(p);
            }
        }
    }
    // 2) hash candidate groups
    let mut groups = Vec::new();
    for (size, paths) in by_size {
        if paths.len() < 2 {
            continue;
        }
        let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
        for p in paths {
            if let Ok(h) = sha256_of(&p) {
                by_hash.entry(h).or_default().push(p.to_string_lossy().into_owned());
            }
        }
        for (hash, files) in by_hash {
            if files.len() >= 2 {
                groups.push(DuplicateGroup {
                    size,
                    hash,
                    files,
                });
            }
        }
    }
    groups.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(groups)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compare_finds_differences() {
        let d = std::env::temp_dir().join(format!("fleetfile_cmp_{}", std::process::id()));
        let (l, r) = (d.join("l"), d.join("r"));
        fs::create_dir_all(l.join("sub")).unwrap();
        fs::create_dir_all(r.join("sub")).unwrap();
        fs::write(l.join("same.txt"), "x").unwrap();
        fs::write(r.join("same.txt"), "x").unwrap();
        fs::write(l.join("only_l.txt"), "x").unwrap();
        fs::write(r.join("only_r.txt"), "x").unwrap();
        fs::write(l.join("sub/mod.txt"), "v1").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(r.join("sub/mod.txt"), "v2").unwrap();

        let res = folder_compare(l.to_str().unwrap(), r.to_str().unwrap()).unwrap();
        let by_path: HashMap<_, _> = res.iter().map(|e| (e.rel_path.as_str(), e.status)).collect();
        assert_eq!(by_path.get("same.txt"), Some(&"same"));
        assert_eq!(by_path.get("only_l.txt"), Some(&"only_left"));
        assert_eq!(by_path.get("only_r.txt"), Some(&"only_right"));
        assert_eq!(by_path.get("sub/mod.txt"), Some(&"modified"));
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn duplicate_detection() {
        let d = std::env::temp_dir().join(format!("fleetfile_dup_{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("a.txt"), "identical-content").unwrap();
        fs::write(d.join("b.txt"), "identical-content").unwrap();
        fs::write(d.join("c.txt"), "different-content").unwrap();
        let groups = find_duplicates(d.to_str().unwrap(), 1).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        fs::remove_dir_all(&d).unwrap();
    }
}
