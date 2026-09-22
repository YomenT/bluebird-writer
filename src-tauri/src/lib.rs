use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(serde::Serialize)]
pub struct FileEntry {
    path: String,
    rel: String,
    modified_ms: u64,
}

const MAX_DEPTH: usize = 6;

fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("markdown")
    )
}

fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules" || name == "target"
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<FileEntry>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            let name = entry.file_name();
            if !should_skip_dir(&name.to_string_lossy()) {
                walk(root, &path, depth + 1, out);
            }
        } else if file_type.is_file() && is_markdown(&path) {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let modified_ms = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(FileEntry {
                path: path.to_string_lossy().into_owned(),
                rel,
                modified_ms,
            });
        }
    }
}

#[tauri::command]
fn list_markdown_files(dir: String) -> Result<Vec<FileEntry>, String> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(format!("Not a folder: {dir}"));
    }
    let mut out = Vec::new();
    walk(&root, &root, 0, &mut out);
    out.sort_by(|a, b| a.rel.to_lowercase().cmp(&b.rel.to_lowercase()));
    Ok(out)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Could not open the note: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    // Sync pulls write into subfolders (e.g. Bluebird/<Space>/) that may not
    // exist yet.
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not save the note: {e}"))?;
    }
    fs::write(&path, content).map_err(|e| format!("Could not save the note: {e}"))
}

#[tauri::command]
fn create_markdown_file(dir: String, name: String) -> Result<String, String> {
    let cleaned = name.trim().replace(['/', '\\'], "-");
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        return Err("Give the note a name first.".into());
    }
    let lower = cleaned.to_ascii_lowercase();
    let file_name = if lower.ends_with(".md") || lower.ends_with(".markdown") {
        cleaned
    } else {
        format!("{cleaned}.md")
    };
    let path = Path::new(&dir).join(&file_name);
    if path.exists() {
        return Err("A note with that name already exists.".into());
    }
    let title = file_name
        .trim_end_matches(".md")
        .trim_end_matches(".markdown");
    fs::write(&path, format!("# {title}\n\n"))
        .map_err(|e| format!("Could not create the note: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    // To the system trash, never a hard delete — recoverable by design.
    trash::delete(&path).map_err(|e| format!("Could not move the note to the trash: {e}"))
}

#[tauri::command]
fn rename_markdown_file(path: String, name: String) -> Result<String, String> {
    let cleaned = name.trim().replace(['/', '\\'], "-");
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        return Err("Give the note a name first.".into());
    }
    let lower = cleaned.to_ascii_lowercase();
    let file_name = if lower.ends_with(".md") || lower.ends_with(".markdown") {
        cleaned
    } else {
        format!("{cleaned}.md")
    };
    let src = PathBuf::from(&path);
    let parent = src
        .parent()
        .ok_or_else(|| "Could not work out the note's folder.".to_string())?;
    let dest = parent.join(&file_name);
    if dest == src {
        return Ok(path);
    }
    // On case-insensitive filesystems a pure case change resolves to the same
    // file — allow it; block only genuine collisions.
    if dest.exists() && src.canonicalize().ok() != dest.canonicalize().ok() {
        return Err("A note with that name already exists.".into());
    }
    fs::rename(&src, &dest).map_err(|e| format!("Could not rename the note: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

// Spell-check languages for WebKitGTK, from the user's locale (LANG=de_DE.UTF-8
// -> de_DE) with English as a fallback. Languages without an installed
// dictionary are ignored by enchant.
#[cfg(target_os = "linux")]
fn spell_languages() -> Vec<String> {
    let mut langs = Vec::new();
    for var in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(var) {
            let lang = value.split(['.', '@']).next().unwrap_or("").to_string();
            if !lang.is_empty() && lang != "C" && lang != "POSIX" {
                langs.push(lang);
                break;
            }
        }
    }
    if !langs.iter().any(|l| l == "en_US") {
        langs.push("en_US".into());
    }
    langs
}

// BBW-4: WebView2 (Windows) honours the editor's spellcheck attribute on its
// own, but WebKitGTK keeps spell checking disabled until the web context
// turns it on. Suggestions then appear in the native right-click menu.
#[cfg(target_os = "linux")]
fn enable_spell_check(app: &tauri::App) {
    use tauri::Manager;
    use webkit2gtk::{WebContextExt, WebViewExt};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(|webview| {
        if let Some(context) = webview.inner().context() {
            let langs = spell_languages();
            let refs: Vec<&str> = langs.iter().map(String::as_str).collect();
            context.set_spell_checking_languages(&refs);
            context.set_spell_checking_enabled(true);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(target_os = "linux")]
            enable_spell_check(_app);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_markdown_files,
            read_text_file,
            write_text_file,
            create_markdown_file,
            delete_file,
            rename_markdown_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running bluebird-writer");
}
