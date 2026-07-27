use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;
use walkdir::{DirEntry, WalkDir};

const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;
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
}

#[tauri::command]
fn read_document(path: &Path) -> Result<FileDocument, AppError> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(AppError::NotAFile);
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::FileTooLarge);
    }

    let content = fs::read_to_string(path)?;
    Ok(FileDocument {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md")
            .to_owned(),
        path: path.to_string_lossy().into_owned(),
        content,
        fingerprint: fingerprint(path, &metadata)?,
    })
}

#[tauri::command]
fn open_document(path: PathBuf) -> Result<FileDocument, AppError> {
    read_document(&path)
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

#[tauri::command]
fn save_document(
    path: PathBuf,
    content: String,
    expected_fingerprint: Option<DocumentFingerprint>,
    force: bool,
) -> Result<DocumentFingerprint, AppError> {
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
    let metadata = fs::metadata(&path)?;
    fingerprint(&path, &metadata)
}

#[tauri::command]
fn probe_document(path: PathBuf) -> Result<FileDocument, AppError> {
    read_document(&path)
}

fn state_file(app: &AppHandle, key: &str) -> Result<PathBuf, AppError> {
    if !key
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
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
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
fn save_app_state(app: AppHandle, key: String, content: String) -> Result<(), AppError> {
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

fn write_replacement(path: &Path, content: &[u8]) -> Result<(), AppError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(
        ".{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));
    let mut file = fs::File::create(&temporary)?;
    file.write_all(content)?;
    file.sync_all()?;
    replace_file(&temporary, path)?;
    Ok(())
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

/// Collects Markdown files beneath `root`, honoring the shared ignore rules and the
/// workspace size ceiling. Shared by the scan, search, and reference commands.
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
        if files.len() >= MAX_WORKSPACE_FILES {
            return Err(AppError::WorkspaceTooLarge);
        }
        files.push(entry.path().to_path_buf());
    }
    Ok(files)
}

#[tauri::command]
fn scan_workspace(root: PathBuf) -> Result<Vec<WorkspaceEntry>, AppError> {
    // Canonicalized here so the paths handed to the UI match the ones the search,
    // reference, and mutation commands produce for the same files.
    let canonical_root = fs::canonicalize(&root)?;
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

#[tauri::command]
fn search_workspace(
    root: PathBuf,
    query: String,
    case_sensitive: bool,
) -> Result<SearchOutcome, AppError> {
    require_capability(EditionCapability::WorkspaceSearch)?;

    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(SearchOutcome {
            matches: Vec::new(),
            truncated: false,
            scanned_files: 0,
        });
    }
    let needle = if case_sensitive {
        trimmed.to_owned()
    } else {
        trimmed.to_lowercase()
    };

    let canonical_root = fs::canonicalize(&root)?;
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
            let haystack = if case_sensitive {
                line.to_owned()
            } else {
                line.to_lowercase()
            };
            if !haystack.contains(&needle) {
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
    let mut in_code_span = false;

    while index < chars.len() {
        let current = chars[index];

        if current == '`' {
            in_code_span = !in_code_span;
            index += 1;
            continue;
        }
        if in_code_span {
            index += 1;
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
fn collect_workspace_references(root: PathBuf) -> Result<Vec<DocumentReferences>, AppError> {
    // Any one of these Pro capabilities consumes this payload; the frontend gates each
    // surface separately, and this keeps a Community build from obtaining the data at all.
    require_any_capability(&[
        EditionCapability::Backlinks,
        EditionCapability::WikiLinks,
        EditionCapability::Tags,
        EditionCapability::WorkspaceIntelligence,
    ])?;

    let canonical_root = fs::canonicalize(&root)?;
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
        || trimmed == "."
        || trimmed == ".."
        || trimmed.starts_with('.')
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed.chars().any(|character| character.is_control())
    {
        return Err(AppError::InvalidFileName);
    }
    if !is_markdown(Path::new(trimmed)) {
        return Err(AppError::NotMarkdown);
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
    root: PathBuf,
    path: PathBuf,
    content: String,
) -> Result<WorkspaceEntry, AppError> {
    let target = resolve_inside_workspace(&root, &path)?;
    if target.exists() {
        return Err(AppError::AlreadyExists);
    }
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(AppError::FileTooLarge);
    }
    write_replacement(&target, content.as_bytes())?;
    let canonical_root = fs::canonicalize(&root)?;
    Ok(workspace_entry(&canonical_root, &target))
}

#[tauri::command]
fn rename_workspace_document(
    root: PathBuf,
    path: PathBuf,
    new_name: String,
) -> Result<WorkspaceEntry, AppError> {
    let source = resolve_inside_workspace(&root, &path)?;
    if !source.is_file() {
        return Err(AppError::NotAFile);
    }
    validate_file_name(&new_name)?;
    let destination = resolve_inside_workspace(
        &root,
        &source
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(new_name.trim()),
    )?;
    if destination == source {
        let canonical_root = fs::canonicalize(&root)?;
        return Ok(workspace_entry(&canonical_root, &source));
    }
    if destination.exists() {
        return Err(AppError::AlreadyExists);
    }
    fs::rename(&source, &destination)?;
    let canonical_root = fs::canonicalize(&root)?;
    Ok(workspace_entry(&canonical_root, &destination))
}

#[tauri::command]
fn delete_workspace_document(root: PathBuf, path: PathBuf) -> Result<(), AppError> {
    let target = resolve_inside_workspace(&root, &path)?;
    if !target.is_file() {
        return Err(AppError::NotAFile);
    }
    fs::remove_file(target)?;
    Ok(())
}

fn capabilities_for_edition(edition: Edition) -> Vec<EditionCapability> {
    match edition {
        Edition::Community => Vec::new(),
        Edition::Full => EditionCapability::ALL.to_vec(),
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
    }
}

fn markdown_paths(arguments: impl IntoIterator<Item = String>) -> Vec<String> {
    arguments
        .into_iter()
        .filter_map(|argument| {
            let path = PathBuf::from(argument);
            path.is_file().then_some(path)
        })
        .filter(|path| is_markdown(path))
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
fn take_pending_open_paths(state: tauri::State<PendingOpenPaths>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().expect("pending open path lock poisoned"))
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
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::quit(handle, None)?,
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
                &MenuItem::with_id(handle, "settings", "Settings", true, Some("CmdOrCtrl+,"))?,
            ],
        )?;
        app.set_menu(Menu::with_items(handle, &[&file, &edit, &view])?)?;
    }
    Ok(())
}

fn setup_window_chrome(app: &tauri::App) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    #[cfg(target_os = "windows")]
    {
        window.set_decorations(false)?;
    }

    #[cfg(target_os = "macos")]
    {
        use tauri::TitleBarStyle;
        window.set_title_bar_style(TitleBarStyle::Overlay)?;
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

        for suffix in &candidate_suffixes {
            let license_path = std::path::Path::new(suffix);
            attempted_paths.push(license_path.display().to_string());
            if let Ok(content) = fs::read_to_string(license_path) {
                let parsed: serde_json::Value = serde_json::from_str(&content)
                    .map_err(|e| format!("Failed to parse {}: {}", license_path.display(), e))?;
                let object = parsed
                    .as_object()
                    .ok_or_else(|| format!("{} must be a JSON object", license_path.display()))?;
                return Ok(Some(object.clone()));
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
        return Ok(());
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
    let mut builder = tauri::Builder::default().manage(PendingOpenPaths(Mutex::new(pending_paths)));
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, arguments, _| {
            let paths = markdown_paths(arguments);
            if !paths.is_empty() {
                let _ = app.emit("open-paths", paths);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .setup(|app| {
            setup_window_chrome(app)?;
            setup_native_menu(app)?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            scan_workspace,
            search_workspace,
            collect_workspace_references,
            create_workspace_document,
            rename_workspace_document,
            delete_workspace_document,
            probe_document,
            get_build_info,
            authorize_capability,
            load_app_state,
            save_app_state,
            delete_app_state,
            take_pending_open_paths,
            get_licenses,
            set_document_edited
        ])
        .on_menu_event(|app, event| {
            let _ = app.emit("native-menu-command", event.id().as_ref().to_string());
        })
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

    #[test]
    fn rejects_unsafe_or_non_markdown_file_names() {
        assert!(validate_file_name("notes.md").is_ok());
        assert!(validate_file_name("").is_err());
        assert!(validate_file_name("..").is_err());
        assert!(validate_file_name(".hidden.md").is_err());
        assert!(validate_file_name("nested/notes.md").is_err());
        assert!(validate_file_name("notes.txt").is_err());
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
            "```\n",
            "[fenced](fenced.md) #fencedtag\n",
            "```\n",
        );

        let (links, tags) = extract_references(content);
        assert_eq!(links, vec!["notes/alpha.md", "Beta Note", "notes/gamma.md"]);
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
            EditionCapability::ALL.len()
        );
    }

    #[test]
    fn search_and_reference_commands_refuse_unlicensed_builds() {
        if Edition::current() == Edition::Full {
            return;
        }
        let root = std::env::temp_dir();
        assert!(search_workspace(root.clone(), "anything".into(), false).is_err());
        assert!(collect_workspace_references(root).is_err());
    }
}
