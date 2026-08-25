use std::io::Read;

use serde::Serialize;

use crate::CoreError;

#[derive(Debug, Clone, Serialize)]
pub struct OfficeText {
    pub content: String,
    pub truncated: bool,
}

const MAX_OFFICE_TEXT: usize = 2 * 1024 * 1024;

/// Extract readable text from Office documents.
/// - .docx: word/document.xml (paragraph boundaries -> newlines)
/// - .odt: content.xml
/// - .xlsx: shared strings + sheet1 cell values (tab separated rows)
/// - .ods: content.xml table cells (best effort)
/// Returns Err for unsupported formats (e.g. legacy binary .doc).
pub fn office_text(path: &str) -> Result<OfficeText, CoreError> {
    let lower = path.to_ascii_lowercase();
    let content = if lower.ends_with(".docx") {
        let xml = read_zip_xml(path, "word/document.xml")?;
        doc_like_to_text(&xml, "</w:p>")
    } else if lower.ends_with(".odt") {
        let xml = read_zip_xml(path, "content.xml")?;
        doc_like_to_text(&xml, "</text:p>")
    } else if lower.ends_with(".xlsx") {
        let sheet = read_zip_xml(path, "xl/worksheets/sheet1.xml")?;
        let strings = read_zip_xml_opt(path, "xl/sharedStrings.xml")?;
        xlsx_to_text(&sheet, strings.as_deref())
    } else if lower.ends_with(".ods") {
        let xml = read_zip_xml(path, "content.xml")?;
        doc_like_to_text(&xml, "</table:table-row>")
    } else {
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "unsupported office format",
        )));
    };

    let truncated = content.len() > MAX_OFFICE_TEXT;
    let mut content = content;
    content.truncate(MAX_OFFICE_TEXT);
    // collapse repeated blank lines
    let mut cleaned = String::new();
    let mut blank = 0;
    for l in content.lines() {
        let t = l.trim_end();
        if t.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        cleaned.push_str(t);
        cleaned.push('\n');
    }
    Ok(OfficeText {
        content: cleaned,
        truncated,
    })
}

fn read_zip_xml(path: &str, entry: &str) -> Result<String, CoreError> {
    match read_zip_xml_opt(path, entry)? {
        Some(s) => Ok(s),
        None => Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "document entry not found in archive",
        ))),
    }
}

fn read_zip_xml_opt(path: &str, entry: &str) -> Result<Option<String>, CoreError> {
    let file = std::fs::File::open(path).map_err(|e| {
        CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
    })?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| {
        CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
    })?;
    let mut found = None;
    for i in 0..zip.len() {
        let mut e = zip.by_index(i).map_err(|err| {
            CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, err.to_string()))
        })?;
        let name = e.name().to_string();
        if name == entry || name.ends_with(&format!("/{}", entry)) {
            let mut buf = Vec::new();
            e.read_to_end(&mut buf)?;
            found = Some(String::from_utf8_lossy(&buf).into_owned());
            break;
        }
    }
    Ok(found)
}

fn strip_tags(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len());
    let mut in_tag = false;
    for ch in xml.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

/// Word/ODT-like XML -> plain text (paragraph tag ends become newlines).
fn doc_like_to_text(xml: &str, para_close: &str) -> String {
    let with_nl = xml.replace(para_close, "\n");
    xml_unescape(&strip_tags(&with_nl))
}

/// Extract `<open ...>body</close>` occurrences (tags may carry attributes).
fn extract_elems(xml: &str, open: &str, close: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(s) = rest.find(open) {
        let after_open = &rest[s + open.len()..];
        let Some(gt) = after_open.find('>') else { break };
        let body = &after_open[gt + 1..];
        let Some(ce) = body.find(close) else { break };
        out.push(body[..ce].to_string());
        rest = &body[ce + close.len()..];
    }
    out
}

/// Convert xlsx sheet XML + shared strings into tab-separated rows.
fn xlsx_to_text(sheet_xml: &str, strings: Option<&str>) -> String {
    let shared: Vec<String> = strings
        .map(|s| {
            extract_elems(s, "<t", "</t>")
                .into_iter()
                .map(|t| xml_unescape(t.trim()))
                .collect()
        })
        .unwrap_or_default();

    let mut out = String::new();
    for row in extract_elems(sheet_xml, "<row", "</row>") {
        let mut cells = Vec::new();
        for cell in extract_elems(&row, "<c", "</c>") {
            let is_shared = cell.contains("t=\"s\"") || cell.contains("t='s'");
            let val = extract_elems(&cell, "<v", "</v>")
                .into_iter()
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            if is_shared && !val.is_empty() {
                if let Ok(idx) = val.parse::<usize>() {
                    if let Some(s) = shared.get(idx) {
                        cells.push(s.clone());
                        continue;
                    }
                }
            }
            cells.push(val);
        }
        out.push_str(&cells.join("\t"));
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("fleetfile_office_{}_{}", tag, std::process::id()))
    }

    fn make_docx(path: &std::path::Path, body: &str) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file(
            "word/document.xml",
            zip::write::FileOptions::default(),
        )
        .unwrap();
        zip.write_all(
            format!(
                "<?xml version=\"1.0\"?><w:document><w:body><w:p><w:r><w:t>{}</w:t></w:r></w:p><w:p><w:r><w:t>second line</w:t></w:r></w:p></w:body></w:document>",
                body
            )
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn extracts_docx_text() {
        let d = tmpdir("docx");
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("t.docx");
        make_docx(&p, "Hello &amp; FleetFile");
        let t = office_text(p.to_str().unwrap()).unwrap();
        assert!(t.content.contains("Hello & FleetFile"));
        assert!(t.content.contains("second line"));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn rejects_legacy_doc() {
        let d = tmpdir("doc");
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("t.doc");
        std::fs::write(&p, [0xD0, 0xCF, 0x11, 0xE0]).unwrap();
        assert!(office_text(p.to_str().unwrap()).is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }
}
