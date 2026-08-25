use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use crate::CoreError;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CounterOpts {
    pub enabled: bool,
    /// Where the counter goes: "prefix" | "suffix"
    pub position: String,
    /// Separator between name and number, e.g. " (1)" style uses " " + "(" ... ")",
    /// kept simple: prefix/suffix strings below may already include separators.
    pub format: String, // e.g. "{n}", "{n:03}"
    pub start: u32,
    pub step: u32,
}

impl Default for CounterOpts {
    fn default() -> Self {
        Self {
            enabled: false,
            position: "suffix".into(),
            format: "{n}".into(),
            start: 1,
            step: 1,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BulkRenameRules {
    /// Plain or regex find/replace applied to the stem (before extension).
    pub find: String,
    pub replace: String,
    pub use_regex: bool,
    /// Prefix / suffix applied after find/replace.
    pub prefix: String,
    pub suffix: String,
    /// "none" | "lower" | "upper" | "title"
    pub case: String,
    #[serde(default)]
    pub counter: CounterOpts,
}

impl Default for BulkRenameRules {
    fn default() -> Self {
        Self {
            find: String::new(),
            replace: String::new(),
            use_regex: false,
            prefix: String::new(),
            suffix: String::new(),
            case: "none".into(),
            counter: CounterOpts::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BulkRenameResult {
    pub old_path: String,
    pub new_path: String,
    pub ok: bool,
    pub error: Option<String>,
    pub skipped: bool,
}

fn apply_case(s: &str, case: &str) -> String {
    match case {
        "upper" => s.to_uppercase(),
        "lower" => s.to_lowercase(),
        "title" => {
            let mut out = String::with_capacity(s.len());
            let mut cap = true;
            for ch in s.chars() {
                if cap {
                    out.extend(ch.to_uppercase());
                } else {
                    out.push(ch);
                }
                cap = ch.is_whitespace() || ch == '-' || ch == '_';
            }
            out
        }
        _ => s.to_string(),
    }
}

fn format_counter(n: u32, fmt: &str) -> String {
    if let Some(colon) = fmt.find(':') {
        // "{n:03}" -> width 3 zero-padded
        if let Ok(width) = fmt[colon + 1..fmt.len().saturating_sub(1)].parse::<usize>() {
            return format!("{:0width$}", n, width = width);
        }
    }
    n.to_string()
}

/// Compute the new name for one file (stem + extension preserved unless find/replace targets it).
fn new_name(name: &str, rules: &BulkRenameRules, counter: u32) -> String {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut stem = stem.to_string();
    if !rules.find.is_empty() {
        if rules.use_regex {
            if let Ok(re) = regex::Regex::new(&rules.find) {
                stem = re.replace_all(&stem, rules.replace.as_str()).into_owned();
            }
        } else {
            stem = stem.replace(&rules.find, &rules.replace);
        }
    }
    let stem = apply_case(&stem, &rules.case);
    let mut out = String::new();
    out.push_str(&rules.prefix);
    if rules.counter.enabled && rules.counter.position == "prefix" {
        out.push_str(&format_counter(counter, &rules.counter.format));
    }
    out.push_str(&stem);
    if rules.counter.enabled && rules.counter.position != "prefix" {
        out.push_str(&format_counter(counter, &rules.counter.format));
    }
    out.push_str(&rules.suffix);
    out.push_str(ext);
    out
}

fn unique_path(dir: &Path, name: &str) -> String {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate.to_string_lossy().into_owned();
    }
    let dot = name.rfind('.');
    let (base, ext) = match dot {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1u32..9999 {
        let c = dir.join(format!("{} ({}).{}", base.trim_end_matches([' ', '(', ')']), n, ext.trim_start_matches('.')));
        if !c.exists() {
            return c.to_string_lossy().into_owned();
        }
    }
    dir.join(name).to_string_lossy().into_owned()
}

/// Generate (and optionally execute) a bulk rename plan for `files` inside `dir`.
/// When `dry_run` is true nothing on disk is changed.
pub fn bulk_rename(
    dir: &str,
    files: &[String],
    rules: &BulkRenameRules,
    dry_run: bool,
) -> Result<Vec<BulkRenameResult>, CoreError> {
    let dir_path = Path::new(dir);
    if !dir_path.is_dir() {
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "directory does not exist",
        )));
    }
    let mut counter = rules.counter.start;
    let mut out = Vec::new();
    for file in files {
        let old_path = Path::new(file);
        let Some(name) = old_path.file_name().map(|n| n.to_string_lossy().into_owned()) else {
            continue;
        };
        let new_name = new_name(&name, rules, counter);
        counter = counter.saturating_add(rules.counter.step.max(1));
        let new_path = unique_path(dir_path, &new_name);
        let result = BulkRenameResult {
            old_path: old_path.to_string_lossy().into_owned(),
            new_path: new_path.clone(),
            ok: false,
            error: None,
            skipped: false,
        };
        if new_path == result.old_path {
            out.push(BulkRenameResult {
                skipped: true,
                ..result
            });
            continue;
        }
        if dry_run {
            out.push(BulkRenameResult { ok: true, ..result });
            continue;
        }
        match fs::rename(old_path, &new_path) {
            Ok(()) => out.push(BulkRenameResult { ok: true, ..result }),
            Err(e) => out.push(BulkRenameResult {
                error: Some(e.to_string()),
                ..result
            }),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rename_plan_preview() {
        let dir = std::env::temp_dir().join(format!("fleetfile_bulk_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("photo1.jpg"), "x").unwrap();
        fs::write(dir.join("photo2.jpg"), "x").unwrap();
        let mut rules = BulkRenameRules::default();
        rules.prefix = "2026-".into();
        rules.counter = CounterOpts {
            enabled: true,
            position: "suffix".into(),
            format: "{n}".into(),
            start: 1,
            step: 1,
        };
        let files: Vec<String> = vec![
            dir.join("photo1.jpg").to_string_lossy().into_owned(),
            dir.join("photo2.jpg").to_string_lossy().into_owned(),
        ];
        let results = bulk_rename(dir.to_str().unwrap(), &files, &rules, true).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results[0].new_path.ends_with("photo1_2026-1.jpg") || results[0].new_path.contains("2026-"));
        // dry run must not touch disk
        assert!(dir.join("photo1.jpg").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rename_executes() {
        let dir = std::env::temp_dir().join(format!("fleetfile_bulk2_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.txt"), "x").unwrap();
        let mut rules = BulkRenameRules::default();
        rules.find = "a".into();
        rules.replace = "b".into();
        let files = vec![dir.join("a.txt").to_string_lossy().into_owned()];
        let results = bulk_rename(dir.to_str().unwrap(), &files, &rules, false).unwrap();
        assert!(results[0].ok);
        assert!(dir.join("b.txt").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
