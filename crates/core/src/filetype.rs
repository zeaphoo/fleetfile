pub fn get_file_type(name: &str) -> &'static str {
    let ext = match name.rsplit_once('.') {
        Some((prefix, ext)) if !prefix.is_empty() => ext.to_ascii_lowercase(),
        _ => return "file",
    };
    match ext.as_str() {
        "txt" | "md" | "log" | "rst" => "text",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "heic" => "image",
        "mp4" | "mkv" | "avi" | "mov" | "webm" | "flv" | "wmv" => "video",
        "mp3" | "flac" | "wav" | "ogg" | "m4a" | "aac" => "audio",
        "pdf" => "pdf",
        "doc" | "docx" | "odt" | "rtf" => "document",
        "xls" | "xlsx" | "csv" | "ods" => "spreadsheet",
        "ppt" | "pptx" | "odp" => "presentation",
        "zip" | "tar" | "gz" | "bz2" | "xz" | "7z" | "rar" | "zst" => "archive",
        "rs" | "js" | "jsx" | "ts" | "tsx" | "py" | "c" | "h" | "cpp" | "hpp" | "go"
        | "java" | "rb" | "php" | "sh" | "css" | "html" | "json" | "toml" | "yaml"
        | "yml" | "sql" | "vue" | "svelte" => "code",
        "exe" | "msi" | "appimage" | "deb" | "rpm" | "apk" | "dmg" => "executable",
        _ => "file",
    }
}
