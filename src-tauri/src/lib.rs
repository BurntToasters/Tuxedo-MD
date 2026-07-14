use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use thiserror::Error;
use walkdir::{DirEntry, WalkDir};

const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_WORKSPACE_FILES: usize = 20_000;

#[derive(Debug, Error)]
enum AppError {
    #[error("The selected file is larger than 16 MB")]
    FileTooLarge,
    #[error("The selected path is not a regular file")]
    NotAFile,
    #[error("The selected workspace path is not a folder")]
    NotADirectory,
    #[error("The workspace contains more than 20,000 Markdown files")]
    WorkspaceTooLarge,
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Walk(#[from] walkdir::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileDocument {
    path: String,
    name: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry {
    path: String,
    relative_path: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    edition: &'static str,
    version: &'static str,
}

#[tauri::command]
fn open_document(path: PathBuf) -> Result<FileDocument, AppError> {
    let metadata = fs::metadata(&path)?;
    if !metadata.is_file() {
        return Err(AppError::NotAFile);
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::FileTooLarge);
    }

    let content = fs::read_to_string(&path)?;
    Ok(FileDocument {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md")
            .to_owned(),
        path: path.to_string_lossy().into_owned(),
        content,
    })
}

#[tauri::command]
fn save_document(path: PathBuf, content: String) -> Result<(), AppError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.md");
    let temporary = parent.join(format!(".{file_name}.tuxedo-tmp"));

    let result = (|| -> Result<(), std::io::Error> {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        if path.exists() {
            #[cfg(windows)]
            fs::remove_file(&path)?;
        }
        fs::rename(&temporary, &path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(AppError::from)
}

#[tauri::command]
fn scan_workspace(root: PathBuf) -> Result<Vec<WorkspaceEntry>, AppError> {
    if !root.is_dir() {
        return Err(AppError::NotADirectory);
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(should_visit)
    {
        let entry = entry?;
        if !entry.file_type().is_file() || !is_markdown(entry.path()) {
            continue;
        }
        if files.len() >= MAX_WORKSPACE_FILES {
            return Err(AppError::WorkspaceTooLarge);
        }
        let relative = entry.path().strip_prefix(&root).unwrap_or(entry.path());
        files.push(WorkspaceEntry {
            path: entry.path().to_string_lossy().into_owned(),
            relative_path: relative.to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
        });
    }
    files.sort_by(|a, b| {
        a.relative_path
            .to_lowercase()
            .cmp(&b.relative_path.to_lowercase())
    });
    Ok(files)
}

fn should_visit(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !(entry.file_type().is_dir()
        && (name.starts_with('.')
            || matches!(name.as_ref(), "node_modules" | "target" | "dist" | "build")))
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd"
            )
        })
}

#[tauri::command]
fn get_build_info() -> BuildInfo {
    BuildInfo {
        edition: option_env!("TUXEDO_EDITION").unwrap_or("community"),
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            scan_workspace,
            get_build_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tuxedo MD");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_markdown_extensions_case_insensitively() {
        assert!(is_markdown(Path::new("notes/README.MD")));
        assert!(is_markdown(Path::new("notes/page.markdown")));
        assert!(!is_markdown(Path::new("notes/image.png")));
    }
}
