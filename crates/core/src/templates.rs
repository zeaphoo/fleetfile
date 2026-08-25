use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FileTemplate {
    pub name: String,
    pub extension: String,
    pub content: String,
}

/// Built-in "new file" templates (name shown in the UI, extension to append,
/// content written on creation).
pub fn list_templates() -> Vec<FileTemplate> {
    vec![
        FileTemplate {
            name: "空文件".into(),
            extension: String::new(),
            content: String::new(),
        },
        FileTemplate {
            name: "纯文本".into(),
            extension: "txt".into(),
            content: String::new(),
        },
        FileTemplate {
            name: "Markdown".into(),
            extension: "md".into(),
            content: "# 标题\n\n正文\n".into(),
        },
        FileTemplate {
            name: "HTML".into(),
            extension: "html".into(),
            content: "<!DOCTYPE html>\n<html lang=\"zh\">\n<head>\n  <meta charset=\"UTF-8\">\n  <title>页面</title>\n</head>\n<body>\n  \n</body>\n</html>\n".into(),
        },
        FileTemplate {
            name: "CSS".into(),
            extension: "css".into(),
            content: "/* style */\n".into(),
        },
        FileTemplate {
            name: "JavaScript".into(),
            extension: "js".into(),
            content: "\"use strict\";\n\n".into(),
        },
        FileTemplate {
            name: "JSON".into(),
            extension: "json".into(),
            content: "{\n  \n}\n".into(),
        },
        FileTemplate {
            name: "Python".into(),
            extension: "py".into(),
            content: "#!/usr/bin/env python3\n\n\ndef main():\n    pass\n\n\nif __name__ == \"__main__\":\n    main()\n".into(),
        },
        FileTemplate {
            name: "Rust".into(),
            extension: "rs".into(),
            content: "fn main() {\n    println!(\"hello\");\n}\n".into(),
        },
        FileTemplate {
            name: "Shell 脚本".into(),
            extension: "sh".into(),
            content: "#!/usr/bin/env bash\nset -euo pipefail\n\n".into(),
        },
    ]
}
