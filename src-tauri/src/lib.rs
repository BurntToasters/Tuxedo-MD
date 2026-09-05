use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, Url};
use thiserror::Error;
use walkdir::{DirEntry, WalkDir};

const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;
/// Session/draft JSON can hold multiple tabs; keep a hard ceiling above one document.
const MAX_APP_STATE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_WORKSPACE_FILES: usize = 20_000;
const MAX_SEARCH_RESULTS: usize = 500;
/// Files above this size are skipped while scanning so a stray large file cannot
/// stall an interactive workspace search.
const MAX_SCAN_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PREVIEW_CHARS: usize = 160;

struct PendingOpenPaths(Mutex<Vec<String>>);

#[derive(Debug, Error)]
enum AppError {
    #[error("The selected file is larger than 16 MB")]
    FileTooLarge,
    #[error("Saved application state exceeds the 64 MB limit")]
    AppStateTooLarge,
    #[error("The selected path is not a regular file")]
    NotAFile,
    #[error("The selected workspace path is not a folder")]
    NotADirectory,
    #[error("The workspace contains more than 20,000 Markdown files")]
    WorkspaceTooLarge,
    #[error("The file changed on disk before it could be saved")]
    Conflict,
    #[error("Invalid application state key")]
    InvalidStateKey,
    #[error("The target path is outside the open workspace folder")]
    OutsideWorkspace,
    #[error("Open a workspace folder before scanning or searching")]
    WorkspaceNotAdopted,
    #[error("That document path is not available")]
    PathNotConsented,
    #[error("Only Markdown documents can be created, renamed, or deleted here")]
    NotMarkdown,
    #[error("A file with that name already exists")]
    AlreadyExists,
    #[error("That name is not a valid file name")]
    InvalidFileName,
    #[error("{0} requires Tuxedo MD Pro")]
    CapabilityUnavailable(&'static str),
    #[error("Application state path error: {0}")]
    StatePath(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Walk(#[from] walkdir::Error),
}

struct AdoptedWorkspace(Mutex<Option<PathBuf>>);
struct ConsentedPaths(Mutex<HashSet<PathBuf>>);

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
    fingerprint: DocumentFingerprint,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentFingerprint {
    modified_ms: u128,
    size: u64,
    hash: String,
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
struct SearchMatch {
    path: String,
    relative_path: String,
    name: String,
    /// 1-based line number, used to place the cursor when opening the result.
    line: usize,
    preview: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchOutcome {
    matches: Vec<SearchMatch>,
    truncated: bool,
    scanned_files: usize,
}

/// Raw link and tag references extracted from one document. Resolving these into a
/// graph happens in the frontend, where the path rules are unit tested.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentReferences {
    path: String,
    relative_path: String,
    name: String,
    links: Vec<String>,
    tags: Vec<String>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Edition {
    Community,
    Full,
}

impl Edition {
    fn current() -> Self {
        match option_env!("TUXEDO_EDITION") {
            Some("full") => Self::Full,
            _ => Self::Community,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum EditionCapability {
    WorkspaceSearch,
    Backlinks,
    WikiLinks,
    Tags,
    Mermaid,
    Math,
    ExportProfiles,
    ThemeStudio,
    DocumentRecipes,
    WorkspaceIntelligence,
    FocusSessionPresets,
}

impl EditionCapability {
    /// Full capability registry including Phase 3 placeholders (not exposed until shipped).
    #[allow(dead_code)]
    const ALL: [Self; 11] = [
        Self::WorkspaceSearch,
        Self::Backlinks,
        Self::WikiLinks,
        Self::Tags,
        Self::Mermaid,
        Self::Math,
        Self::ExportProfiles,
        Self::ThemeStudio,
        Self::DocumentRecipes,
        Self::WorkspaceIntelligence,
        Self::FocusSessionPresets,
    ];

    /// Capabilities that are implemented and enforced today (not Phase 3 placeholders).
    const SHIPPED: [Self; 5] = [
        Self::WorkspaceSearch,
        Self::Backlinks,
        Self::WikiLinks,
        Self::Tags,
        Self::WorkspaceIntelligence,
    ];

    fn label(self) -> &'static str {
        match self {
            Self::WorkspaceSearch => "Indexed workspace search",
            Self::Backlinks => "Backlinks",
            Self::WikiLinks => "Wiki links",
            Self::Tags => "Workspace tags",
            Self::Mermaid => "Mermaid diagrams",
            Self::Math => "Math rendering",
            Self::ExportProfiles => "Export profiles",
            Self::ThemeStudio => "Theme Studio",
            Self::DocumentRecipes => "Document Recipes",
            Self::WorkspaceIntelligence => "Workspace Intelligence",
            Self::FocusSessionPresets => "Focus session presets",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    edition: Edition,
    version: &'static str,
    capabilities: Vec<EditionCapability>,
    /// True for Mac App Store / opaque-window builds that must not clear the window.
    opaque_window: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentProbe {
    path: String,
    name: String,
    fingerprint: DocumentFingerprint,
}

fn require_markdown_document(path: &Path) -> Result<(), AppError> {
    if !is_markdown(path) {
        return Err(AppError::NotMarkdown);
    }
    Ok(())
}

/// Canonicalize an existing path, or parent + filename when the file does not exist yet.
fn canonicalize_document_path(path: &Path) -> Result<PathBuf, AppError> {
    if path.exists() {
        return Ok(fs::canonicalize(path)?);
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing file name")
    })?;
    Ok(fs::canonicalize(parent)?.join(file_name))
}

/// True when `path` appears under the adopted workspace via a junction/symlink, but
/// its canonical target lies outside — consent must not follow that escape.
fn consent_escapes_adopted(adopted: Option<&Path>, path: &Path, canonical: &Path) -> bool {
    let Some(adopted) = adopted else {
        return false;
    };
    if canonical.starts_with(adopted) {
        return false;
    }
    let mut current = path.to_path_buf();
    while current.pop() {
        if let Ok(ancestor) = fs::canonicalize(&current) {
            if ancestor.starts_with(adopted) {
                return true;
            }
        }
    }
    false
}

fn consent_path(app: &AppHandle, path: &Path) -> Result<PathBuf, AppError> {
    let canonical = canonicalize_document_path(path)?;
    let adopted = {
        let state = app.state::<AdoptedWorkspace>();
        let guard = state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.clone()
    };
    if consent_escapes_adopted(adopted.as_deref(), path, &canonical) {
        return Err(AppError::OutsideWorkspace);
    }
    let state = app.state::<ConsentedPaths>();
    let mut guard = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.insert(canonical.clone());
    Ok(canonical)
}

fn is_under_adopted(app: &AppHandle, canonical: &Path) -> bool {
    let state = app.state::<AdoptedWorkspace>();
    let guard = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match guard.as_ref() {
        Some(adopted) => canonical.starts_with(adopted),
        None => false,
    }
}

fn allow_document_access(app: &AppHandle, path: &Path) -> Result<PathBuf, AppError> {
    require_markdown_document(path)?;
    let canonical = canonicalize_document_path(path)?;
    let consented = {
        let state = app.state::<ConsentedPaths>();
        let guard = state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.contains(&canonical)
    };
    if consented || is_under_adopted(app, &canonical) {
        Ok(canonical)
    } else {
        Err(AppError::PathNotConsented)
    }
}

fn read_document(path: &Path) -> Result<FileDocument, AppError> {
    require_markdown_document(path)?;
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(AppError::NotAFile);
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::FileTooLarge);
    }

    // Canonicalize so Open dialog paths match workspace-scan paths (one tab per file).
    let canonical = fs::canonicalize(path)?;
    let content = fs::read_to_string(&canonical)?;
    let fingerprint = fingerprint_from_bytes(&metadata, content.as_bytes())?;
    Ok(FileDocument {
        name: canonical
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md")
            .to_owned(),
        path: canonical.to_string_lossy().into_owned(),
        content,
        fingerprint,
    })
}

#[tauri::command]
fn open_document(app: AppHandle, path: PathBuf) -> Result<FileDocument, AppError> {
    let canonical = allow_document_access(&app, &path)?;
    read_document(&canonical)
}

fn fingerprint(path: &Path, metadata: &fs::Metadata) -> Result<DocumentFingerprint, AppError> {
    let modified_ms = metadata
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    Ok(DocumentFingerprint {
        modified_ms,
        size: metadata.len(),
        hash: blake3::hash(&fs::read(path)?).to_hex().to_string(),
    })
}

fn fingerprint_from_bytes(
    metadata: &fs::Metadata,
    bytes: &[u8],
) -> Result<DocumentFingerprint, AppError> {
    let modified_ms = metadata
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    Ok(DocumentFingerprint {
        modified_ms,
        size: metadata.len(),
        hash: blake3::hash(bytes).to_hex().to_string(),
    })
}

fn fingerprint_light(metadata: &fs::Metadata) -> Result<DocumentFingerprint, AppError> {
    let modified_ms = metadata
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    Ok(DocumentFingerprint {
        modified_ms,
        size: metadata.len(),
        hash: String::new(),
    })
}

#[tauri::command]
fn save_document(
    app: AppHandle,
    path: PathBuf,
    content: String,
    expected_fingerprint: Option<DocumentFingerprint>,
    force: bool,
) -> Result<DocumentFingerprint, AppError> {
    // Parent must already exist so new Save As targets can be canonicalized.
    let path = allow_document_access(&app, &path)?;
    if u64::try_from(content.len()).unwrap_or(u64::MAX) > MAX_DOCUMENT_BYTES {
        return Err(AppError::FileTooLarge);
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.md");
    let temporary = parent.join(format!(".{file_name}.tuxedo-tmp"));

    if !force {
        if let (Some(expected), Ok(metadata)) = (&expected_fingerprint, fs::metadata(&path)) {
            let actual = fingerprint(&path, &metadata)?;
            if actual != *expected {
                return Err(AppError::Conflict);
            }
        }
    }

    let result = (|| -> Result<(), std::io::Error> {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        replace_file(&temporary, &path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(AppError::from)?;
    consent_path(&app, &path)?;
    let metadata = fs::metadata(&path)?;
    fingerprint_from_bytes(&metadata, content.as_bytes())
}

#[tauri::command]
fn probe_document(app: AppHandle, path: PathBuf) -> Result<FileDocument, AppError> {
    let canonical = allow_document_access(&app, &path)?;
    read_document(&canonical)
}

/// Lightweight external-change check: metadata only, no content read or hash.
#[tauri::command]
fn probe_document_meta(app: AppHandle, path: PathBuf) -> Result<DocumentProbe, AppError> {
    let canonical = allow_document_access(&app, &path)?;
    let metadata = fs::metadata(&canonical)?;
    if !metadata.is_file() {
        return Err(AppError::NotAFile);
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::FileTooLarge);
    }
    Ok(DocumentProbe {
        name: canonical
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md")
            .to_owned(),
        path: canonical.to_string_lossy().into_owned(),
        fingerprint: fingerprint_light(&metadata)?,
    })
}

#[tauri::command]
fn register_consented_path(app: AppHandle, path: PathBuf) -> Result<(), AppError> {
    require_markdown_document(&path)?;
    consent_path(&app, &path)?;
    Ok(())
}

fn is_valid_state_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn state_file(app: &AppHandle, key: &str) -> Result<PathBuf, AppError> {
    if !is_valid_state_key(key) {
        return Err(AppError::InvalidStateKey);
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::StatePath(error.to_string()))?;
    Ok(directory.join("state").join(format!("{key}.json")))
}

#[tauri::command]
fn load_app_state(app: AppHandle, key: String) -> Result<Option<String>, AppError> {
    let path = state_file(&app, &key)?;
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if metadata.len() > MAX_APP_STATE_BYTES {
        return Err(AppError::AppStateTooLarge);
    }
    match fs::read_to_string(path) {
        Ok(contents) => {
            if contents.len() as u64 > MAX_APP_STATE_BYTES {
                return Err(AppError::AppStateTooLarge);
            }
            Ok(Some(contents))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
fn save_app_state(app: AppHandle, key: String, content: String) -> Result<(), AppError> {
    if content.len() as u64 > MAX_APP_STATE_BYTES {
        return Err(AppError::AppStateTooLarge);
    }
    let path = state_file(&app, &key)?;
    write_replacement(&path, content.as_bytes())
}

#[tauri::command]
fn delete_app_state(app: AppHandle, key: String) -> Result<(), AppError> {
    let path = state_file(&app, &key)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

static TMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn write_replacement(path: &Path, content: &[u8]) -> Result<(), AppError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let count = TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{}.{}-{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id(),
        count
    ));
    let result = (|| -> Result<(), std::io::Error> {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(content)?;
        file.sync_all()?;
        replace_file(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(AppError::from)
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temporary, destination)
}

#[cfg(windows)]
fn replace_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt, ptr::null};
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    if !destination.exists() {
        return fs::rename(temporary, destination);
    }
    let wide = |path: &Path| {
        OsStr::new(path.as_os_str())
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<u16>>()
    };
    let destination = wide(destination);
    let temporary = wide(temporary);
    let replaced = unsafe {
        ReplaceFileW(
            destination.as_ptr(),
            temporary.as_ptr(),
            null(),
            REPLACEFILE_WRITE_THROUGH,
            null(),
            null(),
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// `root` must already be canonical. Returns true when `path` canonicalizes under it.
#[cfg(test)]
fn path_confined_to_root(root: &Path, path: &Path) -> bool {
    match fs::canonicalize(path) {
        Ok(canonical) => canonical.starts_with(root),
        Err(_) => false,
    }
}

/// Collects Markdown files beneath `root`, honoring the shared ignore rules and the
/// workspace size ceiling. Shared by the scan, search, and reference commands.
/// `root` must already be canonical; each file is re-canonicalized and dropped if it
/// escapes the root (e.g. via a directory junction that WalkDir did not follow as a link).
fn walk_markdown_files(root: &Path) -> Result<Vec<PathBuf>, AppError> {
    if !root.is_dir() {
        return Err(AppError::NotADirectory);
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(should_visit)
    {
        let entry = entry?;
        if !entry.file_type().is_file() || !is_markdown(entry.path()) {
            continue;
        }
        let Ok(canonical) = fs::canonicalize(entry.path()) else {
            continue;
        };
        if !canonical.starts_with(root) {
            continue;
        }
        if files.len() >= MAX_WORKSPACE_FILES {
            return Err(AppError::WorkspaceTooLarge);
        }
        files.push(canonical);
    }
    Ok(files)
}

fn adopt_workspace(app: &AppHandle, root: &Path) -> Result<PathBuf, AppError> {
    let canonical = fs::canonicalize(root)?;
    if !canonical.is_dir() {
        return Err(AppError::NotADirectory);
    }
    {
        let state = app.state::<AdoptedWorkspace>();
        let mut guard = state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = Some(canonical.clone());
    }
    // Drop consents that no longer sit under the newly adopted root.
    {
        let state = app.state::<ConsentedPaths>();
        let mut guard = state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.retain(|path| path.starts_with(&canonical));
    }
    Ok(canonical)
}

fn require_adopted_workspace(app: &AppHandle, root: &Path) -> Result<PathBuf, AppError> {
    let canonical = fs::canonicalize(root)?;
    let state = app.state::<AdoptedWorkspace>();
    let guard = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match guard.as_ref() {
        Some(adopted) if *adopted == canonical => Ok(canonical),
        _ => Err(AppError::WorkspaceNotAdopted),
    }
}

/// Force-adopt a workspace root (folder dialog / intentional switch). Returns the canonical path.
#[tauri::command]
fn adopt_workspace_folder(app: AppHandle, root: PathBuf) -> Result<String, AppError> {
    let canonical = adopt_workspace(&app, &root)?;
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
async fn scan_workspace(app: AppHandle, root: PathBuf) -> Result<Vec<WorkspaceEntry>, AppError> {
    let canonical_root = require_adopted_workspace(&app, &root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let paths = walk_markdown_files(&canonical_root)?;
        let mut files: Vec<WorkspaceEntry> = paths
            .iter()
            .map(|path| workspace_entry(&canonical_root, path))
            .collect();
        files.sort_by(|a, b| {
            a.relative_path
                .to_lowercase()
                .cmp(&b.relative_path.to_lowercase())
        });
        Ok(files)
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
}

fn preview_line(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= MAX_PREVIEW_CHARS {
        return trimmed.to_owned();
    }
    let mut preview: String = trimmed.chars().take(MAX_PREVIEW_CHARS - 1).collect();
    preview.push('…');
    preview
}

fn line_contains_query(line: &str, needle: &str, case_sensitive: bool) -> bool {
    if case_sensitive {
        line.contains(needle)
    } else if line.is_ascii() && needle.is_ascii() {
        let n_bytes = needle.as_bytes();
        let l_bytes = line.as_bytes();
        if n_bytes.len() > l_bytes.len() {
            false
        } else {
            l_bytes
                .windows(n_bytes.len())
                .any(|window| window.eq_ignore_ascii_case(n_bytes))
        }
    } else {
        line.to_lowercase().contains(needle)
    }
}

#[tauri::command]
async fn search_workspace(
    app: AppHandle,
    root: PathBuf,
    query: String,
    case_sensitive: bool,
) -> Result<SearchOutcome, AppError> {
    require_capability(EditionCapability::WorkspaceSearch)?;
    let canonical_root = require_adopted_workspace(&app, &root)?;

    let trimmed = query.trim().to_owned();
    if trimmed.is_empty() {
        return Ok(SearchOutcome {
            matches: Vec::new(),
            truncated: false,
            scanned_files: 0,
        });
    }

    tauri::async_runtime::spawn_blocking(move || {
        let needle = if case_sensitive {
            trimmed
        } else {
            trimmed.to_lowercase()
        };

        let mut matches = Vec::new();
        let mut truncated = false;
        let mut scanned_files = 0usize;

        for path in walk_markdown_files(&canonical_root)? {
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            if metadata.len() > MAX_SCAN_FILE_BYTES {
                continue;
            }
            // Unreadable or non-UTF-8 files are skipped rather than failing the whole search.
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            scanned_files += 1;
            let entry = workspace_entry(&canonical_root, &path);

            for (index, line) in content.lines().enumerate() {
                if !line_contains_query(line, &needle, case_sensitive) {
                    continue;
                }
                if matches.len() >= MAX_SEARCH_RESULTS {
                    truncated = true;
                    break;
                }
                matches.push(SearchMatch {
                    path: entry.path.clone(),
                    relative_path: entry.relative_path.clone(),
                    name: entry.name.clone(),
                    line: index + 1,
                    preview: preview_line(line),
                });
            }
            if truncated {
                break;
            }
        }

        Ok(SearchOutcome {
            matches,
            truncated,
            scanned_files,
        })
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
}

fn find_char(chars: &[char], start: usize, needle: char) -> Option<usize> {
    (start..chars.len()).find(|&index| chars[index] == needle)
}

fn find_double(chars: &[char], start: usize, needle: char) -> Option<usize> {
    (start..chars.len().saturating_sub(1))
        .find(|&index| chars[index] == needle && chars[index + 1] == needle)
}

/// Keeps workspace-local link targets and discards anchors and external schemes,
/// since only local targets participate in the workspace link graph.
fn normalize_link_target(raw: &str) -> Option<String> {
    let mut value = raw.trim();
    if let Some(stripped) = value.strip_prefix('<') {
        value = stripped.split('>').next().unwrap_or("");
    }
    let value = value.split_whitespace().next().unwrap_or("");
    if value.is_empty() || value.starts_with('#') {
        return None;
    }
    let lowered = value.to_ascii_lowercase();
    const EXTERNAL_PREFIXES: [&str; 6] = ["http://", "https://", "mailto:", "tel:", "data:", "//"];
    if EXTERNAL_PREFIXES
        .iter()
        .any(|prefix| lowered.starts_with(prefix))
    {
        return None;
    }
    Some(value.to_owned())
}

fn collect_line_references(line: &str, links: &mut Vec<String>, tags: &mut Vec<String>) {
    let chars: Vec<char> = line.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        let current = chars[index];

        if current == '`' {
            let start = index;
            while index < chars.len() && chars[index] == '`' {
                index += 1;
            }
            let run_len = index - start;
            let mut search = index;
            let mut found_close = false;
            while search < chars.len() {
                if chars[search] == '`' {
                    let close_start = search;
                    while search < chars.len() && chars[search] == '`' {
                        search += 1;
                    }
                    if search - close_start == run_len {
                        index = search;
                        found_close = true;
                        break;
                    }
                } else {
                    search += 1;
                }
            }
            if found_close {
                continue;
            }
            index = start + 1;
            continue;
        }

        // Image embed: ![alt](target). Skipped whole, because an embedded asset is not
        // a document edge and would otherwise show up as a broken link.
        if current == '!' && chars.get(index + 1) == Some(&'[') {
            if let Some(close) = find_char(&chars, index + 2, ']') {
                if chars.get(close + 1) == Some(&'(') {
                    if let Some(end) = find_char(&chars, close + 2, ')') {
                        index = end + 1;
                        continue;
                    }
                }
            }
        }

        // Wiki link: [[Target]] or [[Target|Alias]]
        if current == '[' && chars.get(index + 1) == Some(&'[') {
            if let Some(end) = find_double(&chars, index + 2, ']') {
                let raw: String = chars[index + 2..end].iter().collect();
                let target = raw.split('|').next().unwrap_or("").trim();
                if !target.is_empty() {
                    links.push(target.to_owned());
                }
                index = end + 2;
                continue;
            }
        }

        // Inline link or image: ](target)
        if current == ']' && chars.get(index + 1) == Some(&'(') {
            if let Some(end) = find_char(&chars, index + 2, ')') {
                let raw: String = chars[index + 2..end].iter().collect();
                if let Some(target) = normalize_link_target(&raw) {
                    links.push(target);
                }
                index = end + 1;
                continue;
            }
        }

        // Tag: #name preceded by start-of-line or whitespace. Heading markers are
        // skipped because '#' there is followed by a space or another '#'.
        if current == '#' && (index == 0 || chars[index - 1].is_whitespace()) {
            let mut end = index + 1;
            while end < chars.len()
                && (chars[end].is_alphanumeric() || matches!(chars[end], '-' | '_' | '/'))
            {
                end += 1;
            }
            if end > index + 1 && chars[index + 1].is_alphabetic() {
                tags.push(chars[index + 1..end].iter().collect());
            }
            index = end;
            continue;
        }

        index += 1;
    }
}

fn dedupe_preserving_order(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

/// Extracts the target from a reference definition line such as `[label]: notes/a.md`.
fn reference_definition_target(line: &str) -> Option<String> {
    let (_, after) = line.strip_prefix('[')?.split_once("]:")?;
    let target = after.trim();
    (!target.is_empty()).then(|| target.to_owned())
}

fn extract_references(content: &str) -> (Vec<String>, Vec<String>) {
    let mut links = Vec::new();
    let mut tags = Vec::new();
    let mut in_fence = false;

    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        // Reference definitions carry real edges but no inline `](target)` syntax.
        if let Some(target) = reference_definition_target(trimmed) {
            if let Some(normalized) = normalize_link_target(&target) {
                links.push(normalized);
            }
        }
        collect_line_references(line, &mut links, &mut tags);
    }

    (
        dedupe_preserving_order(links),
        dedupe_preserving_order(tags),
    )
}

#[tauri::command]
async fn collect_workspace_references(
    app: AppHandle,
    root: PathBuf,
) -> Result<Vec<DocumentReferences>, AppError> {
    // Any one of these Pro capabilities consumes this payload; the frontend gates each
    // surface separately, and this keeps a Community build from obtaining the data at all.
    require_any_capability(&[
        EditionCapability::Backlinks,
        EditionCapability::WikiLinks,
        EditionCapability::Tags,
        EditionCapability::WorkspaceIntelligence,
    ])?;
    let canonical_root = require_adopted_workspace(&app, &root)?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut documents = Vec::new();

        for path in walk_markdown_files(&canonical_root)? {
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            if metadata.len() > MAX_SCAN_FILE_BYTES {
                continue;
            }
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            let (links, tags) = extract_references(&content);
            let entry = workspace_entry(&canonical_root, &path);
            documents.push(DocumentReferences {
                path: entry.path,
                relative_path: entry.relative_path,
                name: entry.name,
                links,
                tags,
            });
        }

        documents.sort_by(|a, b| {
            a.relative_path
                .to_lowercase()
                .cmp(&b.relative_path.to_lowercase())
        });
        Ok(documents)
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
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

/// Rejects names that could escape the intended directory or are not usable file names.
fn validate_file_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.len() > 255
        || trimmed == "."
        || trimmed == ".."
        || trimmed.starts_with('.')
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed.contains(':')
        || trimmed.contains('<')
        || trimmed.contains('>')
        || trimmed.contains('"')
        || trimmed.contains('|')
        || trimmed.contains('?')
        || trimmed.contains('*')
        || trimmed.ends_with('.')
        || trimmed.ends_with(' ')
        || trimmed.chars().any(|character| character.is_control())
    {
        return Err(AppError::InvalidFileName);
    }
    if !is_markdown(Path::new(trimmed)) {
        return Err(AppError::NotMarkdown);
    }
    // Windows reserved device names (CON, PRN, AUX, NUL, COM0-9, LPT0-9, CONIN$, CONOUT$).
    let stem = Path::new(trimmed)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(trimmed);
    let upper = stem.to_ascii_uppercase();
    let reserved = matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "CONIN$"
            | "CONOUT$"
            | "COM0"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT0"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if reserved {
        return Err(AppError::InvalidFileName);
    }
    Ok(())
}

/// Resolves `path` and confirms it stays inside the canonicalized workspace `root`.
/// The parent directory must already exist, which prevents implicit directory creation
/// and blocks traversal or symlink escapes before any filesystem mutation happens.
fn resolve_inside_workspace(root: &Path, path: &Path) -> Result<PathBuf, AppError> {
    let canonical_root = fs::canonicalize(root)?;
    if !canonical_root.is_dir() {
        return Err(AppError::NotADirectory);
    }

    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        canonical_root.join(path)
    };

    let parent = candidate.parent().ok_or(AppError::OutsideWorkspace)?;
    let canonical_parent = fs::canonicalize(parent)?;
    if !canonical_parent.is_dir() {
        return Err(AppError::NotADirectory);
    }
    if !canonical_parent.starts_with(&canonical_root) {
        return Err(AppError::OutsideWorkspace);
    }

    let file_name = candidate
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(AppError::InvalidFileName)?;
    validate_file_name(file_name)?;

    Ok(canonical_parent.join(file_name))
}

fn workspace_entry(root: &Path, path: &Path) -> WorkspaceEntry {
    let relative = path.strip_prefix(root).unwrap_or(path);
    WorkspaceEntry {
        path: path.to_string_lossy().into_owned(),
        // Relative paths are always '/'-separated so tree ids, search results, and the
        // link graph use one comparable form on every platform.
        relative_path: relative.to_string_lossy().replace('\\', "/"),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}

#[tauri::command]
fn create_workspace_document(
    app: AppHandle,
    root: PathBuf,
    path: PathBuf,
    content: String,
) -> Result<WorkspaceEntry, AppError> {
    let canonical_root = require_adopted_workspace(&app, &root)?;
    let target = resolve_inside_workspace(&canonical_root, &path)?;
    // symlink_metadata catches broken symlinks that exists() would miss (write-through escape).
    match fs::symlink_metadata(&target) {
        Ok(_) => return Err(AppError::AlreadyExists),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(AppError::FileTooLarge);
    }
    write_replacement(&target, content.as_bytes())?;
    let canonical_target = fs::canonicalize(&target)?;
    Ok(workspace_entry(&canonical_root, &canonical_target))
}

/// Regular markdown files, or markdown-named symlinks (including dangling ones).
fn is_markdown_file_entry(path: &Path) -> Result<bool, AppError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            let file_type = metadata.file_type();
            if file_type.is_symlink() {
                Ok(is_markdown(path))
            } else {
                Ok(file_type.is_file())
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn rename_workspace_document_inner(
    adopted_root: &Path,
    path: PathBuf,
    new_name: String,
) -> Result<WorkspaceEntry, AppError> {
    let source = resolve_inside_workspace(adopted_root, &path)?;
    if !is_markdown_file_entry(&source)? {
        return Err(AppError::NotAFile);
    }
    validate_file_name(&new_name)?;
    let destination = resolve_inside_workspace(
        adopted_root,
        &source
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(new_name.trim()),
    )?;
    if destination == source {
        let reported = fs::canonicalize(&source).unwrap_or(source);
        return Ok(workspace_entry(adopted_root, &reported));
    }
    match fs::symlink_metadata(&destination) {
        Ok(_) => return Err(AppError::AlreadyExists),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    fs::rename(&source, &destination)?;
    // Dangling markdown symlinks cannot be canonicalized; the resolved path stays in-root.
    let reported = fs::canonicalize(&destination).unwrap_or(destination);
    Ok(workspace_entry(adopted_root, &reported))
}

#[tauri::command]
fn rename_workspace_document(
    app: AppHandle,
    root: PathBuf,
    path: PathBuf,
    new_name: String,
) -> Result<WorkspaceEntry, AppError> {
    let canonical_root = require_adopted_workspace(&app, &root)?;
    rename_workspace_document_inner(&canonical_root, path, new_name)
}

fn delete_workspace_document_inner(adopted_root: &Path, path: PathBuf) -> Result<(), AppError> {
    let target = resolve_inside_workspace(adopted_root, &path)?;
    if !is_markdown_file_entry(&target)? {
        return Err(AppError::NotAFile);
    }
    fs::remove_file(target)?;
    Ok(())
}

#[tauri::command]
fn delete_workspace_document(app: AppHandle, root: PathBuf, path: PathBuf) -> Result<(), AppError> {
    let canonical_root = require_adopted_workspace(&app, &root)?;
    let target = resolve_inside_workspace(&canonical_root, &path)?;
    let canonical = fs::canonicalize(&target).unwrap_or_else(|_| target.clone());
    delete_workspace_document_inner(&canonical_root, path)?;
    if let Ok(mut guard) = app.state::<ConsentedPaths>().0.lock() {
        guard.remove(&canonical);
    }
    Ok(())
}

fn capabilities_for_edition(edition: Edition) -> Vec<EditionCapability> {
    match edition {
        Edition::Community => Vec::new(),
        Edition::Full => EditionCapability::SHIPPED.to_vec(),
    }
}

/// Native commands that implement edition-gated behavior must call this helper themselves.
/// The public authorization command exists for early UI feedback, not as a substitute for
/// enforcement inside the operation that accesses the gated capability.
fn require_capability(capability: EditionCapability) -> Result<(), AppError> {
    if capabilities_for_edition(Edition::current()).contains(&capability) {
        Ok(())
    } else {
        Err(AppError::CapabilityUnavailable(capability.label()))
    }
}

/// Allows an operation when the build holds at least one of the listed capabilities.
fn require_any_capability(candidates: &[EditionCapability]) -> Result<(), AppError> {
    let enabled = capabilities_for_edition(Edition::current());
    if candidates
        .iter()
        .any(|capability| enabled.contains(capability))
    {
        Ok(())
    } else {
        let label = candidates
            .first()
            .map(|capability| capability.label())
            .unwrap_or("This feature");
        Err(AppError::CapabilityUnavailable(label))
    }
}

#[tauri::command]
fn authorize_capability(capability: EditionCapability) -> Result<(), AppError> {
    require_capability(capability)
}

#[tauri::command]
fn get_build_info() -> BuildInfo {
    let edition = Edition::current();
    BuildInfo {
        edition,
        version: env!("CARGO_PKG_VERSION"),
        capabilities: capabilities_for_edition(edition),
        opaque_window: cfg!(feature = "mas"),
    }
}

/// GitHub direct builds (CE Win/Mac + Full Linux) support in-app updates.
/// Mac App Store / Microsoft Store overlays use the `.pro` identifier and do not.
fn identifier_supports_updates(identifier: &str) -> bool {
    !identifier.ends_with(".pro")
}

#[tauri::command]
fn updates_supported(app: AppHandle) -> bool {
    identifier_supports_updates(&app.config().identifier)
}

#[tauri::command]
fn get_beta_updater_target() -> String {
    use tauri::utils::config::BundleType;

    let os = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86" => "i686",
        "arm64" => "aarch64",
        other => other,
    };
    let installer = match tauri::utils::platform::bundle_type() {
        Some(BundleType::Deb) => Some("deb"),
        Some(BundleType::Rpm) => Some("rpm"),
        Some(BundleType::AppImage) => Some("appimage"),
        Some(BundleType::Msi) => Some("msi"),
        Some(BundleType::Nsis) => Some("nsis"),
        Some(BundleType::App | BundleType::Dmg) => Some("app"),
        None => None,
    };
    match installer {
        Some(installer) => format!("{os}-beta-{arch}-{installer}"),
        None => format!("{os}-beta-{arch}"),
    }
}

fn markdown_paths(arguments: impl IntoIterator<Item = String>) -> Vec<String> {
    arguments
        .into_iter()
        .filter_map(|argument| {
            let path = PathBuf::from(argument);
            let canonical = fs::canonicalize(&path).unwrap_or(path);
            (canonical.is_file() && is_markdown(&canonical))
                .then(|| canonical.to_string_lossy().into_owned())
        })
        .collect()
}

#[tauri::command]
fn take_pending_open_paths(app: AppHandle) -> Vec<String> {
    let paths = {
        let state = app.state::<PendingOpenPaths>();
        let mut guard = state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::take(&mut *guard)
    };
    for path_str in &paths {
        let path = PathBuf::from(path_str);
        if path.is_file() && is_markdown(&path) {
            let _ = consent_path(&app, &path);
        }
    }
    paths
}

fn setup_native_menu(app: &tauri::App) -> tauri::Result<()> {
    #[cfg(target_os = "windows")]
    let _ = app;

    #[cfg(not(target_os = "windows"))]
    {
        use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
        let handle = app.handle();
        let file = Submenu::with_items(
            handle,
            "File",
            true,
            &[
                &MenuItem::with_id(
                    handle,
                    "new-document",
                    "New Document",
                    true,
                    Some("CmdOrCtrl+N"),
                )?,
                &MenuItem::with_id(handle, "open-document", "Open…", true, Some("CmdOrCtrl+O"))?,
                &MenuItem::with_id(handle, "save-document", "Save", true, Some("CmdOrCtrl+S"))?,
                &MenuItem::with_id(
                    handle,
                    "save-document-as",
                    "Save As…",
                    true,
                    Some("CmdOrCtrl+Shift+S"),
                )?,
                &MenuItem::with_id(handle, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?,
                &PredefinedMenuItem::separator(handle)?,
                // Custom quit so the frontend can confirm unsaved changes first.
                &MenuItem::with_id(handle, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?,
            ],
        )?;
        let edit = Submenu::with_items(
            handle,
            "Edit",
            true,
            &[
                &MenuItem::with_id(handle, "find", "Find", true, Some("CmdOrCtrl+F"))?,
                &MenuItem::with_id(
                    handle,
                    "command-palette",
                    "Command Palette",
                    true,
                    Some("CmdOrCtrl+Shift+P"),
                )?,
                &PredefinedMenuItem::separator(handle)?,
                &MenuItem::with_id(handle, "next-tab", "Next Tab", true, Some("Ctrl+Tab"))?,
                &MenuItem::with_id(
                    handle,
                    "previous-tab",
                    "Previous Tab",
                    true,
                    Some("Ctrl+Shift+Tab"),
                )?,
            ],
        )?;
        let view = Submenu::with_items(
            handle,
            "View",
            true,
            &[
                &MenuItem::with_id(
                    handle,
                    "toggle-sidebar",
                    "Toggle Tools",
                    true,
                    Some("CmdOrCtrl+Shift+B"),
                )?,
                &MenuItem::with_id(
                    handle,
                    "editor-view",
                    "Editor",
                    true,
                    Some("CmdOrCtrl+Shift+E"),
                )?,
                &MenuItem::with_id(
                    handle,
                    "split-view",
                    "Split",
                    true,
                    Some("CmdOrCtrl+Shift+D"),
                )?,
                &MenuItem::with_id(
                    handle,
                    "preview-view",
                    "Preview",
                    true,
                    Some("CmdOrCtrl+Shift+V"),
                )?,
                &MenuItem::with_id(
                    handle,
                    "toggle-focus-mode",
                    "Focus Mode",
                    true,
                    None::<&str>,
                )?,
                &MenuItem::with_id(handle, "settings", "Settings", true, Some("CmdOrCtrl+,"))?,
            ],
        )?;
        if updates_supported(handle.clone()) {
            let help = Submenu::with_items(
                handle,
                "Help",
                true,
                &[&MenuItem::with_id(
                    handle,
                    "check-updates",
                    "Check for Updates…",
                    true,
                    None::<&str>,
                )?],
            )?;
            app.set_menu(Menu::with_items(handle, &[&file, &edit, &view, &help])?)?;
        } else {
            app.set_menu(Menu::with_items(handle, &[&file, &edit, &view])?)?;
        }
    }
    Ok(())
}

fn allow_webview_navigation(url: &Url) -> bool {
    // Intentionally omit data:/blob: so a compromised renderer cannot navigate to active HTML.
    match url.scheme() {
        "tauri" | "asset" | "ipc" => true,
        "http" | "https" => {
            let host = url.host_str();
            matches!(host, Some("tauri.localhost") | Some("ipc.localhost"))
                || (cfg!(debug_assertions) && matches!(host, Some("localhost") | Some("127.0.0.1")))
        }
        _ => false,
    }
}

fn setup_window_chrome(app: &tauri::App) -> tauri::Result<()> {
    let Some(_window) = app.get_webview_window("main") else {
        return Ok(());
    };

    #[cfg(target_os = "windows")]
    {
        _window.set_decorations(false)?;
    }

    // Skip overlay chrome for MAS builds (`--features mas`).
    #[cfg(all(target_os = "macos", not(feature = "mas")))]
    {
        use tauri::TitleBarStyle;
        _window.set_title_bar_style(TitleBarStyle::Overlay)?;
    }

    Ok(())
}

#[tauri::command]
fn get_licenses(app: tauri::AppHandle) -> Result<String, String> {
    fn load_license_file(
        app: &tauri::AppHandle,
        file_name: &str,
        attempted_paths: &mut Vec<String>,
    ) -> Result<Option<serde_json::Map<String, serde_json::Value>>, String> {
        attempted_paths.push(format!("asset:{file_name}"));
        if let Some(asset) = app.asset_resolver().get(file_name.to_string()) {
            let content = String::from_utf8(asset.bytes)
                .map_err(|e| format!("Failed to decode bundled {file_name}: {e}"))?;
            let parsed: serde_json::Value = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse bundled {file_name}: {e}"))?;
            let object = parsed
                .as_object()
                .ok_or_else(|| format!("Bundled {file_name} must be a JSON object"))?;
            return Ok(Some(object.clone()));
        }

        let candidate_suffixes = [
            file_name.to_string(),
            format!("public/{file_name}"),
            format!("dist/{file_name}"),
        ];

        if let Ok(resource_path) = app.path().resource_dir() {
            for suffix in &candidate_suffixes {
                let license_path = resource_path.join(suffix);
                attempted_paths.push(license_path.display().to_string());
                if let Ok(content) = fs::read_to_string(&license_path) {
                    let parsed: serde_json::Value =
                        serde_json::from_str(&content).map_err(|e| {
                            format!("Failed to parse {}: {}", license_path.display(), e)
                        })?;
                    let object = parsed.as_object().ok_or_else(|| {
                        format!("{} must be a JSON object", license_path.display())
                    })?;
                    return Ok(Some(object.clone()));
                }
            }
        }

        // Dev-only CWD fallback so `cargo tauri dev` can load generated license JSON
        // without bundling; never search the process CWD in release builds.
        if cfg!(debug_assertions) {
            for suffix in &candidate_suffixes {
                let license_path = std::path::Path::new(suffix);
                attempted_paths.push(license_path.display().to_string());
                if let Ok(content) = fs::read_to_string(license_path) {
                    let parsed: serde_json::Value =
                        serde_json::from_str(&content).map_err(|e| {
                            format!("Failed to parse {}: {}", license_path.display(), e)
                        })?;
                    let object = parsed.as_object().ok_or_else(|| {
                        format!("{} must be a JSON object", license_path.display())
                    })?;
                    return Ok(Some(object.clone()));
                }
            }
        }

        Ok(None)
    }

    let mut attempted_paths: Vec<String> = Vec::new();
    let mut merged = serde_json::Map::new();
    let mut loaded_any = false;

    for file_name in ["licenses-npm.json", "licenses-cargo.json"] {
        if let Some(entries) = load_license_file(&app, file_name, &mut attempted_paths)? {
            loaded_any = true;
            for (key, value) in entries {
                merged.insert(key, value);
            }
        }
    }

    if !loaded_any {
        return Err(format!(
            "Failed to read licenses: no license files were found in bundled assets or known paths (tried: {})",
            attempted_paths.join(", ")
        ));
    }

    serde_json::to_string(&serde_json::Value::Object(merged))
        .map_err(|e| format!("Failed to encode merged licenses payload: {e}"))
}

#[tauri::command]
fn set_document_edited(window: tauri::WebviewWindow, edited: bool) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, edited);
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let ptr = window.ns_window().map_err(|e| e.to_string())?;
        if ptr.is_null() {
            return Err("NSWindow pointer is null".into());
        }
        unsafe {
            let ns_window = ptr.cast::<AnyObject>();
            let _: () = msg_send![ns_window, setDocumentEdited: edited];
        }
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending_paths = markdown_paths(std::env::args().skip(1));
    let mut builder = tauri::Builder::default()
        .manage(PendingOpenPaths(Mutex::new(pending_paths)))
        .manage(AdoptedWorkspace(Mutex::new(None)))
        .manage(ConsentedPaths(Mutex::new(HashSet::new())));
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, arguments, _| {
            let paths = markdown_paths(arguments);
            if !paths.is_empty() {
                // Queue before emit so opens survive if the frontend listener is not ready yet.
                if let Some(pending) = app.try_state::<PendingOpenPaths>() {
                    if let Ok(mut guard) = pending.0.lock() {
                        for path in &paths {
                            if !guard.iter().any(|existing| existing == path) {
                                guard.push(path.clone());
                            }
                        }
                    }
                }
                let _ = app.emit("open-paths", paths);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .setup(|app| {
            setup_window_chrome(app)?;
            setup_native_menu(app)?;
            Ok(())
        })
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("navigation-guard")
                .on_navigation(|_webview, url| allow_webview_navigation(url))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            scan_workspace,
            adopt_workspace_folder,
            search_workspace,
            collect_workspace_references,
            create_workspace_document,
            rename_workspace_document,
            delete_workspace_document,
            probe_document,
            probe_document_meta,
            register_consented_path,
            get_build_info,
            authorize_capability,
            load_app_state,
            save_app_state,
            delete_app_state,
            take_pending_open_paths,
            get_licenses,
            set_document_edited,
            updates_supported,
            get_beta_updater_target
        ])
        .on_menu_event(|app, event| {
            let _ = app.emit("native-menu-command", event.id().as_ref().to_string());
        })
        .build(tauri::generate_context!())
        .expect("error while building Tuxedo MD")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            {
                if let tauri::RunEvent::Opened { urls } = event {
                    let paths = urls
                        .into_iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .filter(|path| path.is_file() && is_markdown(path))
                        .map(|path| path.to_string_lossy().into_owned())
                        .collect::<Vec<_>>();
                    if paths.is_empty() {
                        return;
                    }
                    if let Some(pending) = app.try_state::<PendingOpenPaths>() {
                        if let Ok(mut guard) = pending.0.lock() {
                            for path in &paths {
                                if !guard.iter().any(|existing| existing == path) {
                                    guard.push(path.clone());
                                }
                            }
                        }
                    }
                    let _ = app.emit("open-paths", paths);
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        });
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

    #[test]
    fn rejects_unsafe_or_non_markdown_file_names() {
        assert!(validate_file_name("notes.md").is_ok());
        assert!(validate_file_name("").is_err());
        assert!(validate_file_name("..").is_err());
        assert!(validate_file_name(".hidden.md").is_err());
        assert!(validate_file_name("nested/notes.md").is_err());
        assert!(validate_file_name("notes.txt").is_err());
        assert!(validate_file_name("CON.md").is_err());
        assert!(validate_file_name("nul.md").is_err());
        assert!(validate_file_name("com1.md").is_err());
        assert!(validate_file_name("com0.md").is_err());
        assert!(validate_file_name("lpt0.md").is_err());
        assert!(validate_file_name("conin$.md").is_err());
        assert!(validate_file_name("conout$.md").is_err());
        assert!(validate_file_name(&format!("{}.md", "a".repeat(300))).is_err());
    }

    #[test]
    fn confines_resolved_paths_to_the_workspace_root() {
        let root = std::env::temp_dir().join(format!("tuxedo-root-{}", std::process::id()));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("workspace fixture");

        let inside = resolve_inside_workspace(&root, Path::new("nested/notes.md"))
            .expect("paths inside the root resolve");
        assert!(inside.ends_with("nested/notes.md"));

        assert!(resolve_inside_workspace(&root, Path::new("../escape.md")).is_err());
        assert!(resolve_inside_workspace(&root, Path::new("notes.txt")).is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn extracts_local_links_and_tags_while_ignoring_code_and_external_targets() {
        let content = concat!(
            "# Heading is not a tag\n",
            "See [Alpha](notes/alpha.md) and [[Beta Note|beta]].\n",
            "External [site](https://example.com) is ignored.\n",
            "Anchor [top](#intro) is ignored.\n",
            "An ![image](diagram.png) is not an edge.\n",
            "[definition]: notes/gamma.md\n",
            "Tagged #project and #deep/nested here.\n",
            "Inline `#notatag` and `[x](y.md)` stay out.\n",
            "Multi-backtick `` `[y](z.md)` `` stays out.\n",
            "Unclosed ` backtick should not swallow [Delta](notes/delta.md) here.\n",
            "```\n",
            "[fenced](fenced.md) #fencedtag\n",
            "```\n",
        );

        let (links, tags) = extract_references(content);
        assert_eq!(
            links,
            vec![
                "notes/alpha.md",
                "Beta Note",
                "notes/gamma.md",
                "notes/delta.md"
            ]
        );
        assert_eq!(tags, vec!["project", "deep/nested"]);
    }

    #[test]
    fn truncates_long_search_previews_on_character_boundaries() {
        let short = preview_line("   hello world   ");
        assert_eq!(short, "hello world");

        let long = preview_line(&"é".repeat(400));
        assert_eq!(long.chars().count(), MAX_PREVIEW_CHARS);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn capability_gates_follow_the_compiled_edition() {
        // TUXEDO_EDITION is compile-time, so assert against whichever edition built this test.
        let expects_access = Edition::current() == Edition::Full;
        assert_eq!(
            require_capability(EditionCapability::WorkspaceSearch).is_ok(),
            expects_access
        );
        assert_eq!(
            require_any_capability(&[EditionCapability::Backlinks, EditionCapability::Tags])
                .is_ok(),
            expects_access
        );
        assert!(require_any_capability(&[]).is_err());
    }

    #[test]
    fn community_builds_expose_no_gated_capabilities() {
        assert!(capabilities_for_edition(Edition::Community).is_empty());
        assert_eq!(
            capabilities_for_edition(Edition::Full).len(),
            EditionCapability::SHIPPED.len()
        );
        assert!(EditionCapability::SHIPPED.len() < EditionCapability::ALL.len());
    }

    #[test]
    fn search_and_reference_commands_refuse_unlicensed_builds() {
        if Edition::current() == Edition::Full {
            return;
        }
        assert!(require_capability(EditionCapability::WorkspaceSearch).is_err());
        assert!(require_any_capability(&[
            EditionCapability::Backlinks,
            EditionCapability::WikiLinks,
            EditionCapability::Tags,
            EditionCapability::WorkspaceIntelligence,
        ])
        .is_err());
    }

    #[test]
    fn full_builds_authorize_gated_capabilities() {
        if Edition::current() != Edition::Full {
            return;
        }
        assert_eq!(
            capabilities_for_edition(Edition::current()).len(),
            EditionCapability::SHIPPED.len()
        );
        for capability in EditionCapability::SHIPPED {
            assert!(
                require_capability(capability).is_ok(),
                "{} should be authorized in Full builds",
                capability.label()
            );
        }
        assert!(authorize_capability(EditionCapability::WorkspaceSearch).is_ok());
        assert!(require_capability(EditionCapability::Mermaid).is_err());
    }

    #[test]
    fn store_identifiers_disable_in_app_updates() {
        assert!(identifier_supports_updates("run.rosie.tuxedomd"));
        assert!(!identifier_supports_updates("run.rosie.tuxedomd.pro"));
    }

    #[test]
    fn opaque_window_matches_mas_feature() {
        assert_eq!(cfg!(feature = "mas"), get_build_info().opaque_window);
    }

    #[test]
    fn path_confined_to_root_rejects_paths_outside_workspace() {
        let root = std::env::temp_dir().join(format!("tuxedo-confine-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("tuxedo-outside-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(root.join("nested")).expect("workspace fixture");
        fs::create_dir_all(&outside).expect("outside fixture");
        fs::write(root.join("nested/inside.md"), "in").expect("write inside");
        fs::write(outside.join("escape.md"), "out").expect("write outside");

        let canonical_root = fs::canonicalize(&root).expect("canonicalize root");
        assert!(path_confined_to_root(
            &canonical_root,
            &root.join("nested/inside.md")
        ));
        assert!(!path_confined_to_root(
            &canonical_root,
            &outside.join("escape.md")
        ));

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn consent_escapes_adopted_detects_junction_escape() {
        let adopted = std::env::temp_dir().join(format!("tuxedo-adopted-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("tuxedo-escape-{}", std::process::id()));
        let _ = fs::remove_dir_all(&adopted);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&adopted).expect("adopted fixture");
        fs::create_dir_all(&outside).expect("outside fixture");
        let outside_file = outside.join("secret.md");
        fs::write(&outside_file, "secret").expect("write outside file");

        let canonical_adopted = fs::canonicalize(&adopted).expect("canonicalize adopted");
        let canonical_outside = fs::canonicalize(&outside_file).expect("canonicalize outside");

        // No adopted workspace → never an escape.
        assert!(!consent_escapes_adopted(
            None,
            &outside_file,
            &canonical_outside
        ));
        // Canonical target already under adopted → not an escape.
        let inside = adopted.join("note.md");
        fs::write(&inside, "ok").expect("write inside");
        let canonical_inside = fs::canonicalize(&inside).expect("canonicalize inside");
        assert!(!consent_escapes_adopted(
            Some(&canonical_adopted),
            &inside,
            &canonical_inside
        ));

        #[cfg(unix)]
        {
            let link = adopted.join("linked.md");
            std::os::unix::fs::symlink(&outside_file, &link).expect("create escape symlink");
            let canonical_via_link = fs::canonicalize(&link).expect("canonicalize symlink");
            assert!(!canonical_via_link.starts_with(&canonical_adopted));
            assert!(consent_escapes_adopted(
                Some(&canonical_adopted),
                &link,
                &canonical_via_link
            ));
            let _ = fs::remove_file(&link);
        }

        #[cfg(not(unix))]
        {
            // Simulate the escape shape without requiring junction creation privileges:
            // path sits under adopted, canonical target does not.
            let faux_path = adopted.join("linked.md");
            assert!(consent_escapes_adopted(
                Some(&canonical_adopted),
                &faux_path,
                &canonical_outside
            ));
        }

        let _ = fs::remove_dir_all(&adopted);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn confined_walk_skips_paths_outside_root() {
        let root = std::env::temp_dir().join(format!("tuxedo-walk-root-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("tuxedo-walk-out-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&root).expect("workspace fixture");
        fs::create_dir_all(&outside).expect("outside fixture");
        fs::write(root.join("keep.md"), "keep").expect("write keep");
        fs::write(outside.join("leak.md"), "leak").expect("write leak");
        std::os::unix::fs::symlink(outside.join("leak.md"), root.join("leak.md"))
            .expect("symlink escape into walk root");

        let canonical_root = fs::canonicalize(&root).expect("canonicalize root");
        let walked = walk_markdown_files(&canonical_root).expect("walk workspace");
        assert_eq!(walked.len(), 1);
        assert!(walked[0].ends_with("keep.md"));
        assert!(path_confined_to_root(&canonical_root, &walked[0]));

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn state_keys_reject_empty_and_oversized_values() {
        assert!(!is_valid_state_key(""));
        assert!(!is_valid_state_key(&"a".repeat(129)));
        assert!(is_valid_state_key("session"));
        assert!(is_valid_state_key("draft-abc_123"));
        assert!(!is_valid_state_key("../escape"));
    }

    #[test]
    fn navigation_guard_blocks_active_markup_schemes() {
        assert!(allow_webview_navigation(
            &Url::parse("tauri://localhost/index.html").expect("url")
        ));
        assert!(!allow_webview_navigation(
            &Url::parse("data:text/html,alert(1)").expect("url")
        ));
        assert!(!allow_webview_navigation(
            &Url::parse("blob:https://example.com/uuid").expect("url")
        ));
        assert!(!allow_webview_navigation(
            &Url::parse("https://example.com/").expect("url")
        ));
    }

    #[cfg(unix)]
    #[test]
    fn delete_and_rename_accept_dangling_markdown_symlinks() {
        let root = std::env::temp_dir().join(format!("tuxedo-symlink-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("workspace fixture");
        let dangling = root.join("ghost.md");
        std::os::unix::fs::symlink(root.join("missing-target.md"), &dangling)
            .expect("create dangling symlink");

        let canonical_root = fs::canonicalize(&root).expect("canonicalize workspace root");
        assert!(is_markdown_file_entry(&dangling).expect("symlink metadata"));
        rename_workspace_document_inner(&canonical_root, dangling.clone(), "renamed.md".into())
            .expect("rename dangling markdown symlink");
        let renamed = root.join("renamed.md");
        assert!(renamed
            .symlink_metadata()
            .expect("renamed link")
            .file_type()
            .is_symlink());
        delete_workspace_document_inner(&canonical_root, renamed)
            .expect("delete dangling markdown symlink");
        assert!(!root.join("renamed.md").exists());

        let _ = fs::remove_dir_all(&root);
    }
}
