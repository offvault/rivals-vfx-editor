use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex as TokioMutex;
use base64::{Engine as _, engine::general_purpose};
use reqwest;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ============================================================================
// STATE & TYPES
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct FilterDictionary {
    pub include_keywords: Vec<String>,
    pub exclude_keywords: Vec<String>,
    pub color_property_names: Vec<String>,
}

impl Default for FilterDictionary {
    fn default() -> Self {
        Self {
            include_keywords: vec![
                "color".to_string(),
                "tint".to_string(),
                "Enemy".to_string(),
                "Emiss".to_string(),
                "Diff".to_string(),
                "XKTex3_Col".to_string(),
            ],
            exclude_keywords: vec![
                "Offset".to_string(),
                "uv".to_string(),
                "ColorMaskChannel".to_string(),
                "MaskColor_Enemy".to_string(),
                "MI_Master".to_string(),
            ],
            color_property_names: vec![
                "ColorAndOpacity".to_string(),
                "SpecifiedColor".to_string(),
                "BaseColor".to_string(),
                "HighlightColor".to_string(),
                "FontTopColor".to_string(),
                "FontButtomColor".to_string(),
                "VectorParameter".to_string(),
                "ShadowColor".to_string(),
                "ContentColor".to_string(),
                "OutlineColor".to_string(),
                "Color".to_string(),
                "TextColor".to_string(),
                "BackgroundColor".to_string(),
            ],
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub usmap_path: Option<String>,
    #[serde(default)]
    pub paks_path: Option<String>,
    pub show_detailed_errors: bool,
    #[serde(default)]
    pub auto_clear_cache: bool,
    #[serde(default = "default_ui_scale")]
    pub ui_scale: f64,
    #[serde(default)]
    pub filter_dictionary: FilterDictionary,
    #[serde(default)]
    pub is_header_minimized: bool,
    #[serde(default = "default_true")]
    pub pak_ready_structure: bool,
}

fn default_ui_scale() -> f64 {
    1.0
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            usmap_path: None,
            paks_path: None,
            show_detailed_errors: true,
            auto_clear_cache: false,
            ui_scale: default_ui_scale(),
            filter_dictionary: FilterDictionary::default(),
            is_header_minimized: false,
            pak_ready_structure: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CacheEntry {
    pub hash: String,
    pub json_path: String,
    pub uasset_path: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CacheIndex {
    pub entries: HashMap<String, CacheEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsmapMeta {
    pub file_name: String,
    pub file_path: String,
    pub fetched_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsmapStatus {
    pub installed: bool,
    pub file_name: Option<String>,
    pub file_path: Option<String>,
    pub needs_update: bool,
    pub latest_remote: Option<String>,
    pub auto_managed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CacheInfo {
    pub file_count: usize,
    pub total_size_bytes: u64,
    pub cache_dir: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversionResult {
    pub success: bool,
    pub json_path: Option<String>,
    pub cached: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchConversionResult {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub cached_count: usize,
    pub results: Vec<SingleConversionResult>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SingleConversionResult {
    pub success: bool,
    pub file_name: String,
    pub uasset_path: String,
    pub json_path: Option<String>,
    pub cached: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConversionProgress {
    #[serde(rename = "type", default)]
    pub progress_type: Option<String>,
    pub current: usize,
    pub total: usize,
    pub file_name: String,
    pub cached: bool,
    pub error: Option<String>,
}

pub struct UAssetToolProcess {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
}

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub cache_index: Mutex<CacheIndex>,
    pub tool_process: TokioMutex<Option<UAssetToolProcess>>,
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn get_cache_dir() -> PathBuf {
    let temp_dir = std::env::temp_dir();
    temp_dir.join("rvfxe-cache")
}

fn get_settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("rivals-vfx-editor")
        .join("settings.json")
}

fn get_cache_index_path() -> PathBuf {
    get_cache_dir().join("index.json")
}

fn get_usmap_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("rivals-vfx-editor")
        .join("mappings")
}

fn get_usmap_meta_path() -> PathBuf {
    get_usmap_dir().join("latest.json")
}

fn load_settings() -> AppSettings {
    let path = get_settings_path();
    eprintln!("[DEBUG] Loading settings from: {:?}", path);
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(s) => match serde_json::from_str::<AppSettings>(&s) {
                Ok(mut settings) => {
                    // Force detailed errors to true since toggle was removed
                    settings.show_detailed_errors = true;
                    settings
                }
                Err(e) => {
                    eprintln!("[DEBUG] Failed to parse settings: {}", e);
                    AppSettings::default()
                }
            },
            Err(e) => {
                eprintln!("[DEBUG] Failed to read settings file: {}", e);
                AppSettings::default()
            }
        }
    } else {
        eprintln!("[DEBUG] Settings file not found, creating new one with defaults");
        let settings = AppSettings::default();
        if let Err(e) = save_settings(&settings) {
            eprintln!("[DEBUG] Failed to save default settings: {}", e);
        }
        settings
    }
}

fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = get_settings_path();
    eprintln!("[DEBUG] Saving settings to: {:?}", path);
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            eprintln!("[DEBUG] Failed to create settings dir: {}", e);
            return Err(e.to_string());
        }
    }
    match serde_json::to_string_pretty(settings) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                eprintln!("[DEBUG] Failed to write settings file: {}", e);
                Err(e.to_string())
            } else {
                Ok(())
            }
        }
        Err(e) => {
            eprintln!("[DEBUG] Failed to serialize settings: {}", e);
            Err(e.to_string())
        }
    }
}

fn load_cache_index() -> CacheIndex {
    let path = get_cache_index_path();
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        CacheIndex::default()
    }
}

fn save_cache_index(index: &CacheIndex) -> Result<(), String> {
    let path = get_cache_index_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn compute_file_hash(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hex::encode(hasher.finalize()))
}

fn get_uasset_tool_path(app: &AppHandle) -> PathBuf {
    // In development, use UAssetTool from UAssetToolRivals submodule
    // In production, use the bundled resource
    let cwd = std::env::current_dir().unwrap_or_default();
    eprintln!("[DEBUG] Current working directory: {:?}", cwd);

    let dev_path = cwd
        .join("UAssetToolRivals")
        .join("src")
        .join("UAssetTool")
        .join("bin")
        .join("Debug")
        .join("net8.0")
        .join("win-x64")
        .join("UAssetTool.exe");

    eprintln!(
        "[DEBUG] Checking dev path: {:?} exists={}",
        dev_path,
        dev_path.exists()
    );

    if dev_path.exists() {
        return dev_path;
    }

    // Try release build
    let release_path = cwd
        .join("UAssetToolRivals")
        .join("src")
        .join("UAssetTool")
        .join("bin")
        .join("Release")
        .join("net8.0")
        .join("win-x64")
        .join("publish")
        .join("UAssetTool.exe");

    eprintln!(
        "[DEBUG] Checking release path: {:?} exists={}",
        release_path,
        release_path.exists()
    );

    if release_path.exists() {
        return release_path;
    }

    // Try tools folder next to executable (for organized distributions)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let dist_path = exe_dir.join("tools").join("UAssetTool.exe");
            eprintln!(
                "[DEBUG] Checking dist path (tools): {:?} exists={}",
                dist_path,
                dist_path.exists()
            );
            if dist_path.exists() {
                return dist_path;
            }

            // Also check directly next to exe (cargo-dist flattens includes)
            let flat_path = exe_dir.join("UAssetTool.exe");
            eprintln!(
                "[DEBUG] Checking dist path (flat): {:?} exists={}",
                flat_path,
                flat_path.exists()
            );
            if flat_path.exists() {
                return flat_path;
            }
        }
    }

    // Bundled resource path (in tools subfolder) - for Tauri builds
    let bundled_path = app
        .path()
        .resource_dir()
        .unwrap_or_default()
        .join("tools")
        .join("UAssetTool.exe");

    eprintln!("[DEBUG] Falling back to bundled path: {:?}", bundled_path);
    bundled_path
}

// ============================================================================
// UASSETTOOL INTERACTIVE PROCESS MANAGEMENT
// ============================================================================

async fn get_or_spawn_tool<'a>(
    process: &'a mut Option<UAssetToolProcess>,
    tool_path: &Path,
) -> Result<&'a mut UAssetToolProcess, String> {
    // Check if existing process is still alive
    let needs_spawn = match process.as_mut() {
        Some(proc) => match proc.child.try_wait() {
            Ok(None) => false, // Still running
            Ok(Some(status)) => {
                eprintln!("[DEBUG] UAssetTool process exited with: {}", status);
                true
            }
            Err(e) => {
                eprintln!("[DEBUG] UAssetTool process check failed: {}", e);
                true
            }
        },
        None => true,
    };

    if !needs_spawn {
        return Ok(process.as_mut().unwrap());
    }

    *process = None;

    *process = Some(spawn_tool_process(tool_path).await?);
    Ok(process.as_mut().unwrap())
}

async fn spawn_tool_process(tool_path: &Path) -> Result<UAssetToolProcess, String> {
    eprintln!(
        "[DEBUG] Spawning UAssetTool interactive process: {:?}",
        tool_path
    );
    let mut cmd = Command::new(tool_path);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn UAssetTool: {}", e))?;
    let stdin = child
        .stdin
        .take()
        .ok_or("Failed to capture UAssetTool stdin")?;
    let stdout = BufReader::new(
        child
            .stdout
            .take()
            .ok_or("Failed to capture UAssetTool stdout")?,
    );

    Ok(UAssetToolProcess {
        child,
        stdin,
        stdout,
    })
}

async fn send_tool_request(
    proc: &mut UAssetToolProcess,
    request: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let request_str = serde_json::to_string(request).map_err(|e| e.to_string())?;
    proc.stdin
        .write_all(request_str.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to UAssetTool stdin: {}", e))?;
    proc.stdin
        .write_all(b"\n")
        .await
        .map_err(|e| format!("Failed to write newline to UAssetTool stdin: {}", e))?;
    proc.stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush UAssetTool stdin: {}", e))?;

    // UAssetTool may print diagnostic messages (e.g. "PlatformData is null, attempting DataResources fallback...")
    // before the actual JSON response. Skip non-JSON lines until we find one starting with '{'.
    let mut response_line = String::new();
    loop {
        response_line.clear();
        let bytes = proc
            .stdout
            .read_line(&mut response_line)
            .await
            .map_err(|e| format!("Failed to read UAssetTool response: {}", e))?;
        if bytes == 0 {
            return Err("UAssetTool process closed unexpectedly".to_string());
        }
        let trimmed = response_line.trim();
        if trimmed.starts_with('{') {
            return serde_json::from_str(trimmed)
                .map_err(|e| format!("Failed to parse UAssetTool response: {} - raw: {}", e, response_line));
        }
        // Non-JSON diagnostic line — log and skip
        eprintln!("[DEBUG] UAssetTool diagnostic: {}", trimmed);
    }
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

#[tauri::command]
fn get_exe_dir() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or_else(|| "Could not get exe parent directory".to_string())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_usmap_path(path: String, state: State<AppState>) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    settings.usmap_path = Some(path);
    save_settings(&settings)
}

#[tauri::command]
fn set_detailed_errors(enabled: bool, state: State<AppState>) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    settings.show_detailed_errors = enabled;
    save_settings(&settings)
}

#[tauri::command]
fn set_auto_clear_cache(enabled: bool, state: State<AppState>) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    settings.auto_clear_cache = enabled;
    save_settings(&settings)
}

#[tauri::command]
fn set_ui_scale(scale: f64, state: State<AppState>) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    let clamped_scale = scale.clamp(0.5, 3.0);
    eprintln!("[DEBUG] Setting ui_scale: {} (requested: {})", clamped_scale, scale);
    settings.ui_scale = clamped_scale;
    save_settings(&settings)
}

#[tauri::command]
fn set_paks_path(path: String, state: State<AppState>) -> Result<(), String> {
    eprintln!("[DEBUG] Setting paks_path: {}", path);
    let mut settings = state.settings.lock().unwrap();
    settings.paks_path = Some(path);
    save_settings(&settings)
}

#[tauri::command]
fn set_filter_dictionary(
    dictionary: FilterDictionary,
    state: State<AppState>,
) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    settings.filter_dictionary = dictionary;
    save_settings(&settings)
}

#[tauri::command]
fn set_header_minimized(is_minimized: bool, state: State<AppState>) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    settings.is_header_minimized = is_minimized;
    save_settings(&settings)
}

#[tauri::command]
fn set_pak_ready_structure(enabled: bool, state: State<AppState>) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    settings.pak_ready_structure = enabled;
    save_settings(&settings)
}

#[tauri::command]
fn get_cache_info() -> CacheInfo {
    let cache_dir = get_cache_dir();
    let mut file_count: usize = 0;
    let mut total_size = 0u64;

    fn visit_dirs(dir: &Path, count: &mut usize, size: &mut u64) -> std::io::Result<()> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    visit_dirs(&path, count, size)?;
                } else {
                    *count += 1;
                    *size += entry.metadata()?.len();
                }
            }
        }
        Ok(())
    }

    if cache_dir.exists() {
        let _ = visit_dirs(&cache_dir, &mut file_count, &mut total_size);
    }

    CacheInfo {
        file_count,
        total_size_bytes: total_size,
        cache_dir: cache_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn clear_cache(state: State<AppState>) -> Result<(), String> {
    let cache_dir = get_cache_dir();
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }

    let mut cache_index = state.cache_index.lock().unwrap();
    cache_index.entries.clear();
    save_cache_index(&cache_index)
}

#[tauri::command]
fn get_hero_browser_cache_info() -> CacheInfo {
    let cache_dir = get_hero_cache_dir();
    let mut file_count: usize = 0;
    let mut total_size = 0u64;

    fn visit_dirs(dir: &Path, count: &mut usize, size: &mut u64) -> std::io::Result<()> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    visit_dirs(&path, count, size)?;
                } else {
                    *count += 1;
                    *size += entry.metadata()?.len();
                }
            }
        }
        Ok(())
    }

    if cache_dir.exists() {
        for entry_name in &["icons", "roster.json", "locres_cache.json", "hero_table_extract", "locres_extract"] {
            let path = cache_dir.join(entry_name);
            if path.exists() {
                if path.is_dir() {
                    let _ = visit_dirs(&path, &mut file_count, &mut total_size);
                } else {
                    file_count += 1;
                    total_size += path.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
    }

    CacheInfo {
        file_count,
        total_size_bytes: total_size,
        cache_dir: cache_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn get_vfx_cache_info() -> CacheInfo {
    let vfx_dir = get_hero_cache_dir().join("vfx");
    let mut file_count: usize = 0;
    let mut total_size = 0u64;

    fn visit_dirs(dir: &Path, count: &mut usize, size: &mut u64) -> std::io::Result<()> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    visit_dirs(&path, count, size)?;
                } else {
                    *count += 1;
                    *size += entry.metadata()?.len();
                }
            }
        }
        Ok(())
    }

    if vfx_dir.exists() {
        let _ = visit_dirs(&vfx_dir, &mut file_count, &mut total_size);
    }

    CacheInfo {
        file_count,
        total_size_bytes: total_size,
        cache_dir: vfx_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn clear_hero_browser_cache() -> Result<(), String> {
    let cache_dir = get_hero_cache_dir();
    for entry_name in &["icons", "roster.json", "locres_cache.json", "hero_table_extract", "locres_extract"] {
        let path = cache_dir.join(entry_name);
        if path.exists() {
            if path.is_dir() {
                fs::remove_dir_all(path).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn clear_vfx_cache() -> Result<(), String> {
    let vfx_dir = get_hero_cache_dir().join("vfx");
    if vfx_dir.exists() {
        fs::remove_dir_all(&vfx_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let folder_path = PathBuf::from(&path);
    if !folder_path.exists() {
        return Err(format!("Folder does not exist: {}", path));
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&folder_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&folder_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&folder_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_cache_folder() -> Result<(), String> {
    let cache_dir = get_cache_dir();
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    open_folder(cache_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn convert_uasset_to_json(
    app: AppHandle,
    uasset_path: String,
    state: State<'_, AppState>,
) -> Result<ConversionResult, String> {
    let uasset_path_buf = PathBuf::from(&uasset_path);

    if !uasset_path_buf.exists() {
        return Ok(ConversionResult {
            success: false,
            json_path: None,
            cached: false,
            error: Some(format!("File not found: {}", uasset_path)),
        });
    }

    // Check cache
    let file_hash = compute_file_hash(&uasset_path_buf)?;
    let cache_dir = get_cache_dir();
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    {
        let cache_index = state.cache_index.lock().unwrap();
        if let Some(entry) = cache_index.entries.get(&uasset_path) {
            if entry.hash == file_hash && Path::new(&entry.json_path).exists() {
                return Ok(ConversionResult {
                    success: true,
                    json_path: Some(entry.json_path.clone()),
                    cached: true,
                    error: None,
                });
            }
        }
    }

    let usmap_path = {
        let settings = state.settings.lock().unwrap();
        settings.usmap_path.clone()
    };

    let tool_path = get_uasset_tool_path(&app);
    let file_name = uasset_path_buf
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let json_path = cache_dir.join(format!("{}_{}.json", file_name, &file_hash[..8]));

    // Send request via UAssetTool interactive mode
    let mut process_guard = state.tool_process.lock().await;
    let proc = get_or_spawn_tool(&mut process_guard, &tool_path).await?;

    let request = serde_json::json!({
        "action": "to_json",
        "file_path": uasset_path,
        "output_path": json_path.to_string_lossy(),
        "usmap_path": usmap_path,
    });

    let response = send_tool_request(proc, &request).await?;
    let success = response
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if success {
        let mut cache_index = state.cache_index.lock().unwrap();
        cache_index.entries.insert(
            uasset_path.clone(),
            CacheEntry {
                hash: file_hash,
                json_path: json_path.to_string_lossy().to_string(),
                uasset_path: uasset_path.clone(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        );
        let _ = save_cache_index(&cache_index);

        Ok(ConversionResult {
            success: true,
            json_path: Some(json_path.to_string_lossy().to_string()),
            cached: false,
            error: None,
        })
    } else {
        let message = response
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        Ok(ConversionResult {
            success: false,
            json_path: None,
            cached: false,
            error: Some(message.to_string()),
        })
    }
}

#[tauri::command]
async fn convert_json_to_uasset(
    app: AppHandle,
    json_path: String,
    output_path: String,
    state: State<'_, AppState>,
) -> Result<ConversionResult, String> {
    let tool_path = get_uasset_tool_path(&app);

    let usmap_path = {
        let settings = state.settings.lock().unwrap();
        settings.usmap_path.clone()
    };

    // Ensure output directory exists
    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Send request via UAssetTool interactive mode
    let mut process_guard = state.tool_process.lock().await;
    let proc = get_or_spawn_tool(&mut process_guard, &tool_path).await?;

    let request = serde_json::json!({
        "action": "from_json",
        "file_path": json_path,
        "output_path": output_path,
        "usmap_path": usmap_path,
    });

    eprintln!("[DEBUG] Sending from_json request for: {}", json_path);
    let start = std::time::Instant::now();
    let response = send_tool_request(proc, &request).await?;
    eprintln!("[DEBUG] Response received in {:?}", start.elapsed());

    let success = response
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if success {
        Ok(ConversionResult {
            success: true,
            json_path: Some(output_path),
            cached: false,
            error: None,
        })
    } else {
        let message = response
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        Ok(ConversionResult {
            success: false,
            json_path: None,
            cached: false,
            error: Some(message.to_string()),
        })
    }
}

#[tauri::command]
async fn batch_convert_uassets_to_json(
    app: AppHandle,
    uasset_paths: Vec<String>,
    root_path: String,
    state: State<'_, AppState>,
) -> Result<BatchConversionResult, String> {
    let cache_dir = get_cache_dir();
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let usmap_path = {
        let settings = state.settings.lock().unwrap();
        settings.usmap_path.clone()
    };

    let tool_path = get_uasset_tool_path(&app);
    let total = uasset_paths.len();
    let mut results = Vec::new();
    let mut succeeded = 0;
    let mut failed = 0;
    let mut cached_count = 0;

    // Pending conversions: (uasset_path, output_relative_sub_path)
    let mut pending: Vec<(String, String)> = Vec::new();

    {
        let cache_index = state.cache_index.lock().unwrap();

        for uasset_path in &uasset_paths {
            let path_buf = PathBuf::from(uasset_path);
            let file_name = path_buf
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            if !path_buf.exists() {
                results.push(SingleConversionResult {
                    success: false,
                    file_name: file_name.clone(),
                    uasset_path: uasset_path.clone(),
                    json_path: None,
                    cached: false,
                    error: Some("File not found".to_string()),
                });
                failed += 1;
                continue;
            }

            // Determine relative path for structure preservation
            let path_components: Vec<_> = path_buf
                .components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect();

            let mut char_id_relative_path = None;
            for (i, part) in path_components.iter().enumerate() {
                if part.len() == 4 && part.starts_with("10") && part.chars().all(char::is_numeric) {
                    let mut rel_path = PathBuf::new();
                    for p in &path_components[i..] {
                        rel_path.push(p);
                    }
                    char_id_relative_path = Some(rel_path);
                    break;
                }
            }

            let relative_sub_path = if let Some(rel) = char_id_relative_path {
                rel.with_extension("json").to_string_lossy().to_string()
            } else if let Ok(rel) = path_buf.strip_prefix(&root_path) {
                let root_name = Path::new(&root_path).file_name().unwrap_or_default();
                Path::new(root_name)
                    .join(rel)
                    .with_extension("json")
                    .to_string_lossy()
                    .to_string()
            } else {
                let root_name = Path::new(&root_path).file_name().unwrap_or_default();
                Path::new(root_name)
                    .join(&file_name)
                    .with_extension("json")
                    .to_string_lossy()
                    .to_string()
            };

            let file_hash = compute_file_hash(&path_buf).ok();
            let output_relative_sub_path = if let Some(hash) = &file_hash {
                let rel_path = PathBuf::from(&relative_sub_path);
                let parent = rel_path.parent().map(Path::to_path_buf).unwrap_or_default();
                let stem = rel_path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy();
                let ext = rel_path
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy();

                parent
                    .join(format!("{}_{}.{}", stem, &hash[..8], ext))
                    .to_string_lossy()
                    .to_string()
            } else {
                relative_sub_path.clone()
            };

            // Check cache
            if let Some(hash) = file_hash.clone() {
                if let Some(entry) = cache_index.entries.get(uasset_path) {
                    if entry.hash == hash && Path::new(&entry.json_path).exists() {
                        results.push(SingleConversionResult {
                            success: true,
                            file_name: file_name.clone(),
                            uasset_path: uasset_path.clone(),
                            json_path: Some(entry.json_path.clone()),
                            cached: true,
                            error: None,
                        });
                        succeeded += 1;
                        cached_count += 1;

                        let _ = app.emit(
                            "conversion-progress",
                            ConversionProgress {
                                progress_type: Some("progress".to_string()),
                                current: results.len(),
                                total,
                                file_name: file_name.clone(),
                                cached: true,
                                error: None,
                            },
                        );
                        continue;
                    }
                }
            }

            eprintln!(
                "[DEBUG] Queue batch conversion: input={} -> output={}",
                uasset_path, output_relative_sub_path
            );

            pending.push((uasset_path.clone(), output_relative_sub_path));
        }
    }

    // If all cached, return early
    if pending.is_empty() {
        return Ok(BatchConversionResult {
            total,
            succeeded,
            failed,
            cached_count,
            results,
        });
    }

    // Process uncached files in parallel via worker pool
    let worker_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(pending.len())
        .min(8);

    eprintln!(
        "[DEBUG] Spawning {} UAssetTool workers for {} files",
        worker_count,
        pending.len()
    );

    // Pre-create output directories (cheap, avoids races between workers)
    for (_, relative_sub_path) in &pending {
        let json_path = cache_dir.join(relative_sub_path);
        if let Some(parent) = json_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
    }

    // Split work into chunks and spawn workers
    let chunk_size = (pending.len() + worker_count - 1) / worker_count;
    let progress_counter = Arc::new(AtomicUsize::new(results.len()));
    let mut handles = Vec::new();

    for chunk in pending.chunks(chunk_size) {
        let chunk = chunk.to_vec();
        let tool = tool_path.clone();
        let usmap = usmap_path.clone();
        let cache = cache_dir.clone();
        let app_clone = app.clone();
        let counter = progress_counter.clone();
        let total_for_progress = total;

        handles.push(tokio::spawn(async move {
            let mut proc = spawn_tool_process(&tool).await?;
            let mut chunk_results: Vec<SingleConversionResult> = Vec::new();
            let mut chunk_cache_updates: Vec<(String, CacheEntry)> = Vec::new();
            let mut chunk_succeeded = 0usize;
            let mut chunk_failed = 0usize;

            for (uasset_path, relative_sub_path) in &chunk {
                let path_buf = PathBuf::from(uasset_path);
                let file_name = path_buf
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                let json_path = cache.join(relative_sub_path);

                let request = serde_json::json!({
                    "action": "to_json",
                    "file_path": uasset_path,
                    "output_path": json_path.to_string_lossy(),
                    "usmap_path": usmap,
                });

                let response = send_tool_request(&mut proc, &request).await;
                let mut error_msg = None;

                match response {
                    Ok(resp) => {
                        let success = resp
                            .get("success")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);

                        if success {
                            chunk_succeeded += 1;
                            let json_path_str = json_path.to_string_lossy().to_string();

                            if let Ok(hash) = compute_file_hash(&path_buf) {
                                chunk_cache_updates.push((
                                    uasset_path.clone(),
                                    CacheEntry {
                                        hash,
                                        json_path: json_path_str.clone(),
                                        uasset_path: uasset_path.clone(),
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                    },
                                ));
                            }

                            chunk_results.push(SingleConversionResult {
                                success: true,
                                file_name: file_name.clone(),
                                uasset_path: uasset_path.clone(),
                                json_path: Some(json_path_str),
                                cached: false,
                                error: None,
                            });
                        } else {
                            chunk_failed += 1;
                            let err = resp
                                .get("message")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Unknown error")
                                .to_string();
                            error_msg = Some(err.clone());

                            chunk_results.push(SingleConversionResult {
                                success: false,
                                file_name: file_name.clone(),
                                uasset_path: uasset_path.clone(),
                                json_path: None,
                                cached: false,
                                error: Some(err),
                            });
                        }
                    }
                    Err(e) => {
                        chunk_failed += 1;
                        error_msg = Some(e.clone());
                        chunk_results.push(SingleConversionResult {
                            success: false,
                            file_name: file_name.clone(),
                            uasset_path: uasset_path.clone(),
                            json_path: None,
                            cached: false,
                            error: Some(e),
                        });
                    }
                }

                let current = counter.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = app_clone.emit(
                    "conversion-progress",
                    ConversionProgress {
                        progress_type: Some("progress".to_string()),
                        current,
                        total: total_for_progress,
                        file_name,
                        cached: false,
                        error: error_msg,
                    },
                );
            }

            let _ = proc.child.kill().await;
            Ok::<_, String>((chunk_results, chunk_cache_updates, chunk_succeeded, chunk_failed))
        }));
    }

    // Collect results from all workers
    for handle in handles {
        let (chunk_results, chunk_cache_updates, s, f) =
            handle.await.map_err(|e| e.to_string())??;
        results.extend(chunk_results);
        succeeded += s;
        failed += f;

        // Apply cache updates
        let mut cache_index = state.cache_index.lock().unwrap();
        for (key, entry) in chunk_cache_updates {
            cache_index.entries.insert(key, entry);
        }
        let _ = save_cache_index(&cache_index);
    }

    Ok(BatchConversionResult {
        total,
        succeeded,
        failed,
        cached_count,
        results,
    })
}

#[tauri::command]
async fn batch_convert_jsons_to_uassets(
    app: AppHandle,
    state: State<'_, AppState>,
    json_paths: Vec<String>,
    output_dir: String,
) -> Result<BatchConversionResult, String> {
    let tool_path = get_uasset_tool_path(&app);

    let usmap_path = {
        let settings = state.settings.lock().unwrap();
        settings.usmap_path.clone()
    };

    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let total = json_paths.len();
    let mut succeeded = 0;
    let mut failed = 0;
    let mut results = Vec::new();

    if total == 0 {
        eprintln!("[DEBUG] batch_convert_jsons_to_uassets: no input files");
        return Ok(BatchConversionResult {
            total,
            succeeded,
            failed,
            cached_count: 0,
            results,
        });
    }

    eprintln!(
        "[DEBUG] batch_convert_jsons_to_uassets: total={} files, output_dir={}",
        total, output_dir
    );

    // Parse entries into (json_path, output_name) pairs
    let parsed: Vec<(String, String)> = json_paths
        .iter()
        .map(|entry| {
            if let Some(comma_idx) = entry.find(',') {
                (
                    entry[..comma_idx].trim().to_string(),
                    entry[comma_idx + 1..].trim().to_string(),
                )
            } else {
                let p = Path::new(entry.trim());
                let name = p
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                (entry.trim().to_string(), format!("{}.uasset", name))
            }
        })
        .collect();

    struct EntryState {
        json_path: String,
        file_name: String,
        output_name: String,
        staged_json_path: Option<String>,
        pre_error: Option<String>,
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let stage_root = get_cache_dir()
        .join("batch_from_json_stage")
        .join(format!("{}_{}_{}", std::process::id(), now_ms, total));
    fs::create_dir_all(&stage_root).map_err(|e| e.to_string())?;

    eprintln!(
        "[DEBUG] batch_convert_jsons_to_uassets: staging jsons with base_path={} ",
        stage_root.to_string_lossy()
    );

    let mut entries: Vec<EntryState> = Vec::with_capacity(parsed.len());
    let mut staged_file_paths: Vec<String> = Vec::new();

    for (json_path, output_name) in &parsed {
        let file_name = Path::new(json_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let staged_rel_json = Path::new(output_name).with_extension("json");
        let staged_json_path = stage_root.join(&staged_rel_json);

        if let Some(parent) = staged_json_path.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                let err = format!(
                    "Failed to create staging directory {}: {}",
                    parent.to_string_lossy(),
                    e
                );
                eprintln!("[DEBUG] batch_convert_jsons_to_uassets: {}", err);
                entries.push(EntryState {
                    json_path: json_path.clone(),
                    file_name,
                    output_name: output_name.clone(),
                    staged_json_path: None,
                    pre_error: Some(err),
                });
                continue;
            }
        }

        match fs::copy(json_path, &staged_json_path) {
            Ok(_) => {
                let staged = staged_json_path.to_string_lossy().to_string();
                staged_file_paths.push(staged.clone());
                entries.push(EntryState {
                    json_path: json_path.clone(),
                    file_name,
                    output_name: output_name.clone(),
                    staged_json_path: Some(staged),
                    pre_error: None,
                });
            }
            Err(e) => {
                let err = format!("Failed to stage JSON {}: {}", json_path, e);
                eprintln!("[DEBUG] batch_convert_jsons_to_uassets: {}", err);
                entries.push(EntryState {
                    json_path: json_path.clone(),
                    file_name,
                    output_name: output_name.clone(),
                    staged_json_path: None,
                    pre_error: Some(err),
                });
            }
        }
    }

    eprintln!(
        "[DEBUG] batch_convert_jsons_to_uassets: staged {} / {} files for single batch_from_json",
        staged_file_paths.len(),
        total
    );

    let mut batch_error: Option<String> = None;
    if staged_file_paths.is_empty() {
        batch_error = Some("No JSON files could be staged for batch conversion".to_string());
    } else {
        let mut process_guard = state.tool_process.lock().await;
        let proc = get_or_spawn_tool(&mut process_guard, &tool_path).await?;

        let request = serde_json::json!({
            "action": "batch_from_json",
            "file_paths": staged_file_paths,
            "output_path": output_dir.clone(),
            "usmap_path": usmap_path.clone(),
            "base_path": stage_root.to_string_lossy().to_string(),
        });

        eprintln!(
            "[DEBUG] batch_convert_jsons_to_uassets: sending single batch_from_json request with base_path"
        );

        match send_tool_request(proc, &request).await {
            Ok(resp) => {
                let success = resp
                    .get("success")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let message = resp
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Batch from_json completed");
                if !success {
                    batch_error = Some(message.to_string());
                }
                eprintln!(
                    "[DEBUG] batch_convert_jsons_to_uassets: batch_from_json success={} message={}",
                    success,
                    message
                );
            }
            Err(e) => {
                eprintln!(
                    "[DEBUG] batch_convert_jsons_to_uassets: batch_from_json request failed: {}",
                    e
                );
                batch_error = Some(e);
            }
        }

        drop(process_guard);
    }

    for (idx, entry) in entries.iter().enumerate() {
        let final_output_path = Path::new(&output_dir).join(&entry.output_name);
        let output_exists = final_output_path.exists();

        let error_msg = if let Some(pre) = &entry.pre_error {
            Some(pre.clone())
        } else if entry.staged_json_path.is_some() && output_exists {
            None
        } else {
            Some(
                batch_error
                    .clone()
                    .unwrap_or_else(|| "UAsset not produced by batch_from_json".to_string()),
            )
        };

        match error_msg.clone() {
            Some(err) => {
                failed += 1;
                results.push(SingleConversionResult {
                    success: false,
                    file_name: entry.file_name.clone(),
                    uasset_path: final_output_path.to_string_lossy().to_string(),
                    json_path: Some(entry.json_path.clone()),
                    cached: false,
                    error: Some(err),
                });
            }
            None => {
                succeeded += 1;
                results.push(SingleConversionResult {
                    success: true,
                    file_name: entry.file_name.clone(),
                    uasset_path: final_output_path.to_string_lossy().to_string(),
                    json_path: Some(entry.json_path.clone()),
                    cached: false,
                    error: None,
                });
            }
        }

        let _ = app.emit(
            "conversion-progress",
            ConversionProgress {
                progress_type: Some("progress".to_string()),
                current: idx + 1,
                total,
                file_name: entry.file_name.clone(),
                cached: false,
                error: error_msg,
            },
        );
    }

    if let Err(e) = fs::remove_dir_all(&stage_root) {
        eprintln!(
            "[DEBUG] batch_convert_jsons_to_uassets: failed to clean staging dir {}: {}",
            stage_root.to_string_lossy(),
            e
        );
    }

    Ok(BatchConversionResult {
        total,
        succeeded,
        failed,
        cached_count: 0,
        results,
    })
}

// ============================================================================
// HERO VFX BROWSER - TYPES
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HeroEntry {
    pub hero_id: String,
    pub display_name: String,
    pub icon_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HeroRosterResult {
    pub heroes: Vec<HeroEntry>,
    pub cached: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HeroVfxResult {
    pub hero_id: String,
    pub uasset_paths: Vec<String>,
    pub json_paths: Vec<String>,
    pub cached: bool,
    pub error: Option<String>,
}

// ============================================================================
// HERO VFX BROWSER - HELPERS
// ============================================================================

fn get_hero_cache_dir() -> PathBuf {
    get_cache_dir().join("hero-browser")
}

fn get_hero_icons_dir() -> PathBuf {
    get_hero_cache_dir().join("icons")
}

fn get_hero_roster_cache_path() -> PathBuf {
    get_hero_cache_dir().join("roster.json")
}

fn get_locres_cache_path() -> PathBuf {
    get_hero_cache_dir().join("locres_cache.json")
}

/// Intermediate struct for hero data parsed from compact JSON before locres resolution.
#[derive(Debug)]
struct HeroRowData {
    hero_id: String,
    tname_key: Option<String>,
    tname_table_id: Option<String>,
    en_name: Option<String>,
}

/// Find Game.locres, always preferring the English localization
/// (the file under a `.../Localization/Game/en/Game.locres`-style path).
fn find_locres_recursive(dir: &Path) -> Option<PathBuf> {
    let mut english_match: Option<PathBuf> = None;
    let mut fallback_match: Option<PathBuf> = None;
    collect_locres_candidates(dir, &mut english_match, &mut fallback_match);
    if let Some(english) = english_match {
        eprintln!("[DEBUG] Using English Game.locres at: {:?}", english);
        return Some(english);
    }
    if let Some(fallback) = &fallback_match {
        eprintln!(
            "[DEBUG] No English Game.locres found; falling back to: {:?}",
            fallback
        );
    }
    fallback_match
}

/// Recursively walk `dir`, populating `english_match` as soon as a Game.locres
/// under an `en`/`en-*`/`en_*` folder is found, and `fallback_match` with the
/// first Game.locres of any locale otherwise. Stops descending once English is found.
fn collect_locres_candidates(
    dir: &Path,
    english_match: &mut Option<PathBuf>,
    fallback_match: &mut Option<PathBuf>,
) {
    if english_match.is_some() || !dir.exists() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        if english_match.is_some() {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_locres_candidates(&path, english_match, fallback_match);
        } else if path
            .file_name()
            .map(|name| name.eq_ignore_ascii_case("Game.locres"))
            .unwrap_or(false)
        {
            let is_english = path
                .parent()
                .and_then(|parent| parent.file_name())
                .map(|name| {
                    let name = name.to_string_lossy().to_ascii_lowercase();
                    name == "en" || name.starts_with("en-") || name.starts_with("en_")
                })
                .unwrap_or(false);
            if is_english {
                eprintln!("[DEBUG] Preferred English Game.locres found at: {:?}", path);
                *english_match = Some(path);
                return;
            } else if fallback_match.is_none() {
                eprintln!("[DEBUG] Non-English Game.locres candidate found at: {:?}", path);
                *fallback_match = Some(path);
            }
        }
    }
}

/// Spawn UAssetTool as a CLI process (not interactive mode) for extract_iostore_legacy.
/// Returns (stdout, stderr) output.
async fn run_uasset_tool_cli(
    tool_path: &Path,
    args: &[&str],
) -> Result<(String, String), String> {
    eprintln!("[DEBUG] Running UAssetTool CLI: {:?} {:?}", tool_path, args);

    let mut cmd = tokio::process::Command::new(tool_path);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run UAssetTool CLI: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    eprintln!(
        "[DEBUG] UAssetTool CLI exit={}, stdout_len={}, stderr_len={}",
        output.status,
        stdout.len(),
        stderr.len()
    );
    if !stderr.is_empty() {
        eprintln!("[DEBUG] UAssetTool CLI stderr: {}", &stderr[..stderr.len().min(500)]);
    }

    Ok((stdout, stderr))
}

/// Load locres data for hero display name resolution.
/// 1. Checks JSON cache
/// 2. Extracts Game.locres from pakchunkLocres-Windows.pak via CLI extract_pak
/// 3. Parses the extracted .locres via UAT's parse_locres JSON API
/// 4. Caches the result as JSON
async fn load_locres_data(
    _app: &AppHandle,
    state: &State<'_, AppState>,
    paks_path: &str,
    tool_path: &Path,
    _usmap_path: &Option<String>,
) -> Result<serde_json::Value, String> {
    let locres_cache_path = get_locres_cache_path();

    // Check cache
    if locres_cache_path.exists() {
        eprintln!("[DEBUG] Loading locres data from cache: {:?}", locres_cache_path);
        if let Ok(cached) = fs::read_to_string(&locres_cache_path) {
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&cached) {
                let namespace_count = data.as_object().map(|o| o.len()).unwrap_or(0);
                eprintln!("[DEBUG] Loaded locres cache with {} namespaces", namespace_count);
                if namespace_count > 0 {
                    return Ok(data);
                }
                eprintln!("[DEBUG] Ignoring empty locres cache and rebuilding it");
            }
        }
    }

    // Find pakchunkLocres-Windows.pak in the paks directory
    let paks_dir = Path::new(paks_path);
    if !paks_dir.exists() {
        return Err(format!("Paks directory not found: {:?}", paks_dir));
    }

    let locres_pak = find_file_recursive(paks_dir, "pakchunkLocres-Windows.pak")
        .ok_or_else(|| format!("pakchunkLocres-Windows.pak not found in {:?}", paks_dir))?;

    eprintln!("[DEBUG] Found locres pak at: {:?}", locres_pak);

    // Extract Game.locres from the pak via CLI extract_pak
    let locres_extract_dir = get_hero_cache_dir().join("locres_extract");
    if locres_extract_dir.exists() {
        eprintln!("[DEBUG] Clearing stale locres extract dir: {:?}", locres_extract_dir);
        fs::remove_dir_all(&locres_extract_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&locres_extract_dir).map_err(|e| e.to_string())?;

    // Extract all files from the locres pak (it only contains localization files, so no filter needed)
    let (stdout, stderr) = run_uasset_tool_cli(
        &tool_path,
        &[
            "extract_pak",
            &locres_pak.to_string_lossy(),
            &locres_extract_dir.to_string_lossy(),
        ],
    ).await?;

    eprintln!("[DEBUG] extract_pak stdout: {}", &stdout[..stdout.len().min(500)]);
    if !stderr.is_empty() {
        eprintln!("[DEBUG] extract_pak stderr: {}", &stderr[..stderr.len().min(500)]);
    }

    // Find the preferred Game.locres file, favoring English localizations.
    let locres_file = find_locres_recursive(&locres_extract_dir)
        .ok_or_else(|| "Game.locres not found after extraction from pakchunkLocres-Windows.pak".to_string())?;

    eprintln!("[DEBUG] Found extracted Game.locres at: {:?}", locres_file);

    // Parse locres via UAT interactive mode
    let mut process_guard = state.tool_process.lock().await;
    let proc = get_or_spawn_tool(&mut process_guard, tool_path).await?;

    let request = serde_json::json!({
        "action": "parse_locres",
        "file_path": locres_file.to_string_lossy(),
    });

    let response = send_tool_request(proc, &request).await?;
    drop(process_guard);

    let success = response.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    if !success {
        let msg = response.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error");
        return Err(format!("Failed to parse Game.locres: {}", msg));
    }

    let data = response.get("data").cloned().unwrap_or(serde_json::Value::Null);
    let namespace_count = data.as_object().map(|o| o.len()).unwrap_or(0);

    eprintln!("[DEBUG] Parsed locres: {} namespaces", namespace_count);
    if namespace_count == 0 {
        return Err("Parsed Game.locres successfully but it contained no namespaces".to_string());
    }

    // Cache the locres data
    let cache_dir = get_hero_cache_dir();
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let cache_json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&locres_cache_path, &cache_json).map_err(|e| e.to_string())?;
    eprintln!("[DEBUG] Cached locres data to {:?}", locres_cache_path);

    Ok(data)
}

/// Parse hero roster from UIHeroTable compact JSON.
/// Compact JSON format (from CompactJsonSerializer) is an array of exports:
/// [{ "Type": "DataTable", "Rows": { rowName: { props } } }]
/// Extracts HeroID, TName.Key/TableId (for locres lookup), and EnName (fallback).
fn parse_hero_roster_from_json(json_str: &str) -> Result<Vec<HeroRowData>, String> {
    eprintln!("[DEBUG] Parsing hero roster from compact JSON ({} bytes)", json_str.len());
    let json: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| format!("Failed to parse UIHeroTable JSON: {}", e))?;

    let mut heroes: Vec<HeroRowData> = Vec::new();

    // Compact JSON: top-level is an array of exports
    let exports = json.as_array();

    if let Some(exports) = exports {
        for export in exports {
            if let Some(rows) = export.get("Rows").and_then(|v| v.as_object()) {
                eprintln!("[DEBUG] Found Rows map with {} entries", rows.len());
                for (row_name, row_data) in rows {
                    if row_name.len() < 4 { continue; }
                    let hero_id_4 = &row_name[..4];
                    if !hero_id_4.chars().all(|c| c.is_ascii_digit()) { continue; }

                    let row_obj = match row_data.as_object() {
                        Some(obj) => obj,
                        None => continue,
                    };

                    // Extract HeroID from "HeroID_72_..." field
                    let hero_id = find_field_by_prefix(row_obj, "HeroID_")
                        .and_then(|v| v.as_i64())
                        .map(|id| id.to_string())
                        .unwrap_or_else(|| hero_id_4.to_string());

                    // Find HeroBasic_84_... struct
                    let hero_basic = find_field_by_prefix(row_obj, "HeroBasic_")
                        .and_then(|v| v.as_object());

                    // Extract TName from HeroBasic -> "TName_10_..." -> { TableId, Key }
                    let (tname_key, tname_table_id) = hero_basic.and_then(|hb| {
                        let tname_obj = find_field_by_prefix(hb, "TName_")?;
                        let key = tname_obj.get("Key")?.as_str()?.to_string();
                        let table_id = tname_obj.get("TableId")?.as_str()?.to_string();
                        Some((key, table_id))
                    }).unzip();

                    // Extract EnName from HeroBasic -> "EnName_45_..."
                    let en_name = hero_basic.and_then(|hb| {
                        find_field_by_prefix(hb, "EnName_").and_then(|v| v.as_str()).map(|s| s.to_string())
                    });

                    if !heroes.iter().any(|h| h.hero_id == hero_id) {
                        eprintln!("[DEBUG] Found hero: id={}, tname_key={:?}, en_name={:?}", hero_id, tname_key, en_name);
                        heroes.push(HeroRowData { hero_id, tname_key, tname_table_id, en_name });
                    }
                }
            }
        }
    }

    eprintln!("[DEBUG] Total heroes parsed: {}", heroes.len());
    Ok(heroes)
}

/// Find a field value in a JSON object by key prefix (e.g. "HeroID_" matches "HeroID_72_5B344F95...")
fn find_field_by_prefix<'a>(obj: &'a serde_json::Map<String, serde_json::Value>, prefix: &str) -> Option<&'a serde_json::Value> {
    for (key, value) in obj {
        if key.starts_with(prefix) {
            return Some(value);
        }
    }
    None
}

/// Resolve display names for heroes using locres data.
/// Locres data is { namespace: { key: localized_string } } from UAT's parse_locres.
/// The TableId maps to a namespace in the locres (asset name portion).
fn resolve_hero_display_names(rows: &[HeroRowData], locres_data: &serde_json::Value) -> Vec<HeroEntry> {
    rows.iter().map(|row| {
        let display_name = if let (Some(key), Some(table_id)) = (&row.tname_key, &row.tname_table_id) {
            // TableId is like "/Game/Marvel/Data/StringTable/Hero_ST/1011/601_HeroUIAsset_1011_ST.601_HeroUIAsset_1011_ST"
            // The namespace in locres is the asset name: "601_HeroUIAsset_1011_ST"
            let namespace = extract_namespace_from_table_id(table_id);
            eprintln!("[DEBUG] Looking up hero_id={} namespace={:?} key={:?}", row.hero_id, namespace, key);

            if let Some(name) = lookup_locres(locres_data, namespace.as_deref(), key) {
                eprintln!("[DEBUG] Resolved hero {} display name from locres: {}", row.hero_id, name);
                name
            } else {
                // Fallback: try searching all namespaces for the key
                if let Some(name) = lookup_locres_any_namespace(locres_data, key) {
                    eprintln!("[DEBUG] Resolved hero {} display name from locres (any namespace): {}", row.hero_id, name);
                    name
                } else if let Some(en) = &row.en_name {
                    eprintln!("[DEBUG] Hero {} locres lookup failed, using EnName: {}", row.hero_id, en);
                    en.clone()
                } else {
                    eprintln!("[DEBUG] Hero {} no locres match or EnName, using ID fallback", row.hero_id);
                    format!("Hero {}", row.hero_id)
                }
            }
        } else if let Some(en) = &row.en_name {
            eprintln!("[DEBUG] Hero {} no TName, using EnName: {}", row.hero_id, en);
            en.clone()
        } else {
            format!("Hero {}", row.hero_id)
        };

        HeroEntry {
            hero_id: row.hero_id.clone(),
            display_name,
            icon_path: None,
        }
    }).collect()
}

/// Extract the namespace (asset name) from a TableId path.
/// "/Game/Marvel/Data/StringTable/Hero_ST/1011/601_HeroUIAsset_1011_ST.601_HeroUIAsset_1011_ST"
/// -> "601_HeroUIAsset_1011_ST"
fn extract_namespace_from_table_id(table_id: &str) -> Option<String> {
    // TableId format: /Path/To/Asset.AssetName
    // The part after the last dot is the asset name, which is the locres namespace
    let after_dot = table_id.rsplit('.').next()?;
    // Also try the part after the last slash (before the dot)
    let after_slash = table_id.rsplit('/').next()?;
    let asset_name = after_slash.rsplit('.').next()?;
    // Return the more specific one (after dot, which is the object name)
    let namespace = if after_dot == asset_name {
        after_dot.to_string()
    } else {
        after_dot.to_string()
    };
    if namespace.is_empty() { None } else { Some(namespace) }
}

/// Look up a localized string in locres data by namespace and key.
fn lookup_locres(locres_data: &serde_json::Value, namespace: Option<&str>, key: &str) -> Option<String> {
    let ns_map = namespace.and_then(|ns| locres_data.get(ns))?;
    let value = ns_map.get(key)?.as_str()?;
    if value.is_empty() { return None; }
    Some(value.to_string())
}

/// Search all namespaces in locres data for a specific key.
fn lookup_locres_any_namespace(locres_data: &serde_json::Value, key: &str) -> Option<String> {
    let ns_map = locres_data.as_object()?;
    for (_ns_name, entries) in ns_map {
        if let Some(value) = entries.get(key).and_then(|v| v.as_str()) {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

// ============================================================================
// HERO VFX BROWSER - TAURI COMMANDS
// ============================================================================

#[tauri::command]
async fn get_hero_roster(
    app: AppHandle,
    state: State<'_, AppState>,
    force_refresh: bool,
) -> Result<HeroRosterResult, String> {
    eprintln!("[DEBUG] get_hero_roster called, force_refresh={}", force_refresh);

    let roster_cache_path = get_hero_roster_cache_path();

    // Check cache first
    if !force_refresh && roster_cache_path.exists() {
        eprintln!("[DEBUG] Loading hero roster from cache: {:?}", roster_cache_path);
        if let Ok(cached_json) = fs::read_to_string(&roster_cache_path) {
            if let Ok(heroes) = serde_json::from_str::<Vec<HeroEntry>>(&cached_json) {
                eprintln!("[DEBUG] Loaded {} heroes from cache", heroes.len());
                return Ok(HeroRosterResult {
                    heroes,
                    cached: true,
                    error: None,
                });
            }
        }
    }

    // Get paks path from settings
    let (paks_path, usmap_path) = {
        let settings = state.settings.lock().unwrap();
        (settings.paks_path.clone(), settings.usmap_path.clone())
    };

    let paks_path = paks_path.ok_or_else(|| "Game Paks path not set. Please set it in Settings.".to_string())?;

    if !Path::new(&paks_path).exists() {
        return Err(format!("Game Paks directory not found: {}", paks_path));
    }

    let tool_path = get_uasset_tool_path(&app);
    if !tool_path.exists() {
        return Err(format!("UAssetTool not found at: {:?}", tool_path));
    }

    // Step 1: Extract UIHeroTable via CLI extract_iostore_legacy
    let hero_table_dir = get_hero_cache_dir().join("hero_table_extract");
    fs::create_dir_all(&hero_table_dir).map_err(|e| e.to_string())?;

    eprintln!("[DEBUG] Extracting UIHeroTable from paks: {}", paks_path);
    let (stdout, stderr) = run_uasset_tool_cli(
        &tool_path,
        &[
            "extract_iostore_legacy",
            &paks_path,
            &hero_table_dir.to_string_lossy(),
            "--filter",
            "UIHeroTable",
        ],
    )
    .await?;
    eprintln!("[DEBUG] extract_iostore_legacy stdout: {}", &stdout[..stdout.len().min(500)]);

    // Find the extracted UIHeroTable.uasset (exact match, not e.g. "M2208UIHeroTable.uasset")
    let hero_table_uasset = find_file_recursive_exact(&hero_table_dir, "UIHeroTable.uasset");
    let hero_table_uasset = hero_table_uasset.ok_or_else(|| {
        format!(
            "UIHeroTable.uasset not found after extraction. stdout: {}... stderr: {}...",
            &stdout[..stdout.len().min(200)],
            &stderr[..stderr.len().min(200)]
        )
    })?;

    eprintln!("[DEBUG] Found UIHeroTable at: {:?}", hero_table_uasset);

    // Step 2: Convert UIHeroTable.uasset to JSON via interactive mode
    let json_output = hero_table_dir.join("UIHeroTable.json");

    let mut process_guard = state.tool_process.lock().await;
    let proc = get_or_spawn_tool(&mut process_guard, &tool_path).await?;

    let request = serde_json::json!({
        "action": "compact_json",
        "file_path": hero_table_uasset.to_string_lossy(),
        "output_path": json_output.to_string_lossy(),
        "usmap_path": usmap_path,
    });

    let response = send_tool_request(proc, &request).await?;
    let success = response.get("success").and_then(|v| v.as_bool()).unwrap_or(false);

    if !success {
        let msg = response.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error");
        return Err(format!("Failed to convert UIHeroTable to JSON: {}", msg));
    }

    drop(process_guard);

    // Step 3: Parse the JSON to extract hero data
    let json_str = fs::read_to_string(&json_output)
        .map_err(|e| format!("Failed to read UIHeroTable JSON: {}", e))?;

    // Strip UTF-8 BOM if present (UAssetAPI may emit one)
    let json_str = json_str.trim_start_matches('\u{feff}').trim();
    eprintln!(
        "[DEBUG] UIHeroTable JSON first 200 chars: {}",
        &json_str[..json_str.len().min(200)]
    );

    let hero_rows = parse_hero_roster_from_json(json_str)?;

    if hero_rows.is_empty() {
        return Err("No heroes found in UIHeroTable. The table format may have changed.".to_string());
    }

    // Step 4: Load/extract Game.locres for display name resolution
    let locres_data = load_locres_data(&app, &state, &paks_path, &tool_path, &usmap_path).await
        .unwrap_or_else(|e| {
            eprintln!("[DEBUG] Failed to load locres (names will use EnName fallback): {}", e);
            serde_json::Value::Null
        });

    // Step 5: Resolve display names from locres
    let heroes = resolve_hero_display_names(&hero_rows, &locres_data);

    // Filter out non-playable entries: IDs >= 4000 or 5+ digits
    let heroes: Vec<_> = heroes.into_iter().filter(|h| {
        let id_num = h.hero_id.parse::<u32>().unwrap_or(u32::MAX);
        id_num < 4000 && h.hero_id.len() < 5
    }).collect();
    eprintln!("[DEBUG] {} heroes remaining after filtering non-playable IDs", heroes.len());

    if heroes.is_empty() {
        return Err("No heroes resolved after locres lookup.".to_string());
    }

    // Cache the roster
    let cache_dir = get_hero_cache_dir();
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let cache_json = serde_json::to_string_pretty(&heroes).map_err(|e| e.to_string())?;
    fs::write(&roster_cache_path, &cache_json).map_err(|e| e.to_string())?;
    eprintln!("[DEBUG] Cached {} heroes to {:?}", heroes.len(), roster_cache_path);

    Ok(HeroRosterResult {
        heroes,
        cached: false,
        error: None,
    })
}

#[tauri::command]
async fn batch_extract_hero_icons(
    app: AppHandle,
    state: State<'_, AppState>,
    hero_ids: Vec<String>,
) -> Result<(), String> {
    eprintln!("[DEBUG] batch_extract_hero_icons called with {} heroes", hero_ids.len());
    
    let icons_dir = get_hero_icons_dir();
    let cache_dir = get_hero_cache_dir();
    let mut to_extract = Vec::new();

    for id in &hero_ids {
        let icon_png = icons_dir.join(format!("{}.png", id));
        if !icon_png.exists() {
            to_extract.push(id.clone());
        }
    }

    if to_extract.is_empty() {
        return Ok(());
    }

    let (paks_path, usmap_path) = {
        let settings = state.settings.lock().unwrap();
        (settings.paks_path.clone(), settings.usmap_path.clone())
    };
    let paks_path = paks_path.ok_or("Game Paks path not set")?;
    let tool_path = get_uasset_tool_path(&app);

    let batch_extract_dir = cache_dir.join("icon_extract_batch");
    fs::create_dir_all(&batch_extract_dir).map_err(|e| e.to_string())?;

    let filters_txt = cache_dir.join("icon_filters.txt");
    let mut f_content = String::new();
    for id in &to_extract {
        // user specified we only need squarehead (base, no 00 suffix)
        f_content.push_str(&format!("img_squarehead_{}\n", id));
    }
    fs::write(&filters_txt, &f_content).map_err(|e| e.to_string())?;

    eprintln!("[DEBUG] Extracting missing icons for {} heroes via text file...", to_extract.len());

    let (_stdout, _stderr) = run_uasset_tool_cli(
        &tool_path,
        &[
            "extract_iostore_legacy",
            &paks_path,
            &batch_extract_dir.to_string_lossy(),
            "--filter",
            &filters_txt.to_string_lossy(),
        ],
    )
    .await?;

    let uassets = find_files_recursive(&batch_extract_dir, ".uasset");
    eprintln!("[DEBUG] Found {} .uasset files in batch extract dir", uassets.len());
    if uassets.is_empty() {
        eprintln!("[DEBUG] No .uasset files found, batch extraction may have failed");
        return Ok(());
    }

    fs::create_dir_all(&icons_dir).map_err(|e| e.to_string())?;

    // Build file_paths list for batch extraction
    let file_paths: Vec<String> = uassets.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    eprintln!("[DEBUG] Sending batch_extract_texture_png for {} files (parallel=true)", file_paths.len());

    let mut process_guard = state.tool_process.lock().await;
    let proc = get_or_spawn_tool(&mut process_guard, &tool_path).await?;

    let request = serde_json::json!({
        "action": "batch_extract_texture_png",
        "file_paths": file_paths,
        "output_path": icons_dir.to_string_lossy(),
        "usmap_path": usmap_path,
        "parallel": true,
    });

    match send_tool_request(proc, &request).await {
        Ok(resp) => {
            let success = resp.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown");
            if success {
                eprintln!("[DEBUG] Batch texture extraction succeeded: {}", msg);
            } else {
                eprintln!("[DEBUG] Batch texture extraction failed: {}", msg);
            }
        }
        Err(e) => {
            eprintln!("[DEBUG] send_tool_request error for batch_extract_texture_png: {}", e);
        }
    }

    drop(process_guard);

    // Rename extracted PNGs from their stem names (e.g. img_squarehead_1011.png) to hero_id.png (e.g. 1011.png)
    for id in &to_extract {
        // Look for PNGs matching this hero_id in the icons dir
        let mut found = false;
        if let Ok(entries) = fs::read_dir(&icons_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e == "png").unwrap_or(false) {
                    let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                    if stem.contains(id) {
                        let target = icons_dir.join(format!("{}.png", id));
                        if target.exists() {
                            let _ = fs::remove_file(&target);
                        }
                        if let Err(e) = fs::rename(&path, &target) {
                            eprintln!("[DEBUG] Failed to rename {:?} -> {:?}: {}", path, target, e);
                        } else {
                            eprintln!("[DEBUG] Renamed {:?} -> {:?}", path.file_name().unwrap_or_default(), target.file_name().unwrap_or_default());
                        }
                        found = true;
                        break;
                    }
                }
            }
        }
        if !found {
            eprintln!("[DEBUG] No PNG found to rename for hero_id={}", id);
        }
    }

    Ok(())
}

#[tauri::command]
async fn get_hero_icon_data_url(
    hero_id: String,
) -> Result<String, String> {
    eprintln!("[DEBUG] get_hero_icon_data_url called for hero_id={}", hero_id);

    let icons_dir = get_hero_icons_dir();
    let icon_png = icons_dir.join(format!("{}.png", hero_id));

    // If icon doesn't exist, return empty (frontend will use placeholder)
    // Extraction is handled by batch_extract_hero_icons, not here
    if !icon_png.exists() {
        eprintln!("[DEBUG] Icon not found for hero_id={}, returning empty", hero_id);
        return Ok(String::new());
    }

    // Brief check: if file was just written, wait for size to stabilize.
    // For already-cached files this completes in one iteration with no sleep.
    if let Ok(meta) = std::fs::metadata(&icon_png) {
        let initial_size = meta.len();
        if initial_size == 0 {
            // File exists but is empty – wait for it to be written
            let mut last_size = 0u64;
            let mut stagnant_count = 0;
            for _ in 0..20 {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                if let Ok(m) = std::fs::metadata(&icon_png) {
                    let size = m.len();
                    if size > 0 && size == last_size {
                        stagnant_count += 1;
                        if stagnant_count >= 2 { break; }
                    } else {
                        last_size = size;
                        stagnant_count = 0;
                    }
                }
            }
        }
    }

    match std::fs::read(&icon_png) {
        Ok(image_data) => {
            if image_data.is_empty() {
                eprintln!("[DEBUG] Warning: Icon {} is 0 bytes after wait!", hero_id);
                return Ok(String::new());
            }
            
            // Convert to base64 data URL
            let base64_data = general_purpose::STANDARD.encode(&image_data);
            let data_url = format!("data:image/png;base64,{}", base64_data);
            eprintln!("[DEBUG] Serving icon as data URL for hero {} (size: {} bytes)", hero_id, image_data.len());
            Ok(data_url)
        }
        Err(e) => {
            eprintln!("[DEBUG] Failed to read icon file {:?}: {}", icon_png, e);
            Err(format!("Failed to read icon: {}", e))
        }
    }
}

#[tauri::command]
async fn extract_hero_vfx(
    app: AppHandle,
    state: State<'_, AppState>,
    hero_id: String,
    ko_mode: Option<bool>,
) -> Result<HeroVfxResult, String> {
    let is_ko = ko_mode.unwrap_or(false);
    eprintln!("[DEBUG] extract_hero_vfx called for hero_id={}, ko_mode={}", hero_id, is_ko);

    let sub_dir = if is_ko { "ko" } else { "vfx" };
    let extract_dir = get_hero_cache_dir().join(sub_dir).join("extracted").join(&hero_id);
    let json_dir = get_hero_cache_dir().join(sub_dir).join("json").join(&hero_id);

    // Check if already extracted
    let existing_uassets = if extract_dir.exists() { find_files_recursive(&extract_dir, ".uasset") } else { vec![] };
    let has_uassets = !existing_uassets.is_empty();

    if has_uassets {
        eprintln!("[DEBUG] Hero assets already extracted, skipping extraction but re-converting to JSON...");
    } else {
        // Step 1: Extract VFX materials via CLI
        fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;

        // Emit progress event
        let _ = app.emit(
            "conversion-progress",
            ConversionProgress {
                progress_type: Some("progress".to_string()),
                current: 0,
                total: 0,
                file_name: if is_ko {
                    format!("Extracting KO Prompt for hero {}...", hero_id)
                } else {
                    format!("Extracting VFX for hero {}...", hero_id)
                },
                cached: false,
                error: None,
            },
        );

        let (paks_path, _usmap_path) = {
            let settings = state.settings.lock().unwrap();
            (settings.paks_path.clone(), settings.usmap_path.clone())
        };
        let paks_path = paks_path.ok_or_else(|| "Game Paks path not set. Please set it in Settings.".to_string())?;
        let tool_path = get_uasset_tool_path(&app);

        let mut cli_args = vec![
            "extract_iostore_legacy".to_string(),
            paks_path.clone(),
            extract_dir.to_string_lossy().to_string(),
            "--filter".to_string(),
        ];
        if is_ko {
            cli_args.push(format!("Marvel/UI/Blueprints/Battle/Custom/{}", hero_id));
        } else {
            cli_args.push(format!("VFX/Materials/Characters/{}/", hero_id));
        }

        let cli_args_refs: Vec<&str> = cli_args.iter().map(|s| s.as_str()).collect();

        let (_stdout, _stderr) = run_uasset_tool_cli(
            &tool_path,
            &cli_args_refs,
        )
        .await?;
    }

    // Step 2: Convert all extracted .uasset to JSON (this ensures we always have the original colors)
    let uasset_files = find_files_recursive(&extract_dir, ".uasset");
    if uasset_files.is_empty() {
        return Err(format!("No assets found for hero {}", hero_id));
    }

    fs::create_dir_all(&json_dir).map_err(|e| e.to_string())?;
    
    // Clear the JSON directory to ensure we don't have stale/dirty files
    if let Ok(entries) = fs::read_dir(&json_dir) {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }

    let (usmap_path, tool_path) = {
        let settings = state.settings.lock().unwrap();
        (settings.usmap_path.clone(), get_uasset_tool_path(&app))
    };

    let total = uasset_files.len();

    // Emit progress event for the batch conversion phase
    let _ = app.emit(
        "conversion-progress",
        ConversionProgress {
            progress_type: Some("progress".to_string()),
            current: 0,
            total,
            file_name: format!("Converting {} assets...", total),
            cached: false,
            error: None,
        },
    );

    let file_paths: Vec<String> = uasset_files.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    eprintln!("[DEBUG] Sending batch_to_json for {} files", file_paths.len());

    let mut process_guard = state.tool_process.lock().await;
    let proc = get_or_spawn_tool(&mut process_guard, &tool_path).await?;

    let request = serde_json::json!({
        "action": "batch_to_json",
        "file_paths": file_paths,
        "output_path": json_dir.to_string_lossy(),
        "base_path": extract_dir.to_string_lossy(),
        "usmap_path": usmap_path,
    });

    let mut json_paths = Vec::new();
    match send_tool_request(proc, &request).await {
        Ok(resp) => {
            let success = resp.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown");
            if success {
                eprintln!("[DEBUG] Batch to_json succeeded: {}", msg);
            } else {
                eprintln!("[DEBUG] Batch to_json failed: {}", msg);
            }
            // Log any errors from the batch
            if let Some(errors) = resp.get("data").and_then(|d| d.get("errors")).and_then(|e| e.as_array()) {
                for err in errors {
                    eprintln!("[DEBUG] Batch to_json error: {:?}", err);
                }
            }
        }
        Err(e) => {
            eprintln!("[DEBUG] send_tool_request error for batch_to_json: {}", e);
        }
    }

    drop(process_guard);

    // Build json_paths by scanning the json output directory recursively
    json_paths = find_files_recursive(&json_dir, ".json")
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    let _ = app.emit(
        "conversion-progress",
        ConversionProgress {
            progress_type: Some("progress".to_string()),
            current: total,
            total,
            file_name: "Conversion complete!".to_string(),
            cached: false,
            error: None,
        },
    );

    eprintln!(
        "[DEBUG] Hero VFX conversion complete: {}/{} JSON files",
        json_paths.len(),
        total
    );

    Ok(HeroVfxResult {
        hero_id: hero_id.clone(),
        uasset_paths: uasset_files
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect(),
        json_paths,
        cached: false,
        error: None,
    })
}

/// Recursively find first file matching a name pattern in a directory.
fn find_file_recursive(dir: &Path, pattern: &str) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    for entry in fs::read_dir(dir).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, pattern) {
                return Some(found);
            }
        } else if path
            .file_name()
            .map(|n| n.to_string_lossy().contains(pattern))
            .unwrap_or(false)
        {
            return Some(path);
        }
    }
    None
}

/// Like `find_file_recursive`, but matches the file name exactly (case-insensitive)
/// instead of a substring, so e.g. "UIHeroTable.uasset" won't match "M2208UIHeroTable.uasset".
fn find_file_recursive_exact(dir: &Path, file_name: &str) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    for entry in fs::read_dir(dir).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_recursive_exact(&path, file_name) {
                return Some(found);
            }
        } else if path
            .file_name()
            .map(|n| n.eq_ignore_ascii_case(file_name))
            .unwrap_or(false)
        {
            return Some(path);
        }
    }
    None
}

/// Recursively find all files matching an extension in a directory.
fn find_files_recursive(dir: &Path, extension: &str) -> Vec<PathBuf> {
    let mut results = Vec::new();
    if !dir.exists() {
        return results;
    }
    fn visit(dir: &Path, ext: &str, results: &mut Vec<PathBuf>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    visit(&path, ext, results);
                } else if path
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy()) == ext)
                    .unwrap_or(false)
                {
                    results.push(path);
                }
            }
        }
    }
    visit(dir, extension, &mut results);
    results
}

#[tauri::command]
fn scan_directory_for_uassets(directory: String) -> Result<Vec<String>, String> {
    let dir = Path::new(&directory);
    if !dir.exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }
    let files = find_files_recursive(dir, ".uasset");
    Ok(files.iter().map(|p| p.to_string_lossy().to_string()).collect())
}

#[tauri::command]
async fn batch_convert_directory(
    app: AppHandle,
    state: State<'_, AppState>,
    directory: String,
) -> Result<HeroVfxResult, String> {
    let root_dir = PathBuf::from(&directory);
    if !root_dir.exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }

    let uasset_files = find_files_recursive(&root_dir, ".uasset");
    if uasset_files.is_empty() {
        return Err("No .uasset files found in directory.".to_string());
    }

    let total = uasset_files.len();
    eprintln!("[DEBUG] batch_convert_directory: found {} .uasset files in {}", total, directory);

    let (usmap_path, tool_path) = {
        let settings = state.settings.lock().unwrap();
        (settings.usmap_path.clone(), get_uasset_tool_path(&app))
    };

    let root_name = root_dir.file_name().and_then(|n| n.to_str()).unwrap_or("load");
    let json_dir = get_cache_dir().join("manual").join(root_name);
    fs::create_dir_all(&json_dir).map_err(|e| e.to_string())?;

    // Clear the json_dir to ensure fresh conversion
    if let Ok(entries) = fs::read_dir(&json_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let _ = fs::remove_dir_all(entry.path());
            } else {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    let _ = app.emit(
        "conversion-progress",
        ConversionProgress {
            progress_type: Some("progress".to_string()),
            current: 0,
            total,
            file_name: format!("Scanning and converting {} assets...", total),
            cached: false,
            error: None,
        },
    );

    let file_paths: Vec<String> = uasset_files.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    let mut process_guard = state.tool_process.lock().await;
    let proc = get_or_spawn_tool(&mut process_guard, &tool_path).await?;

    let request = serde_json::json!({
        "action": "batch_to_json",
        "file_paths": file_paths,
        "output_path": json_dir.to_string_lossy(),
        "base_path": root_dir.to_string_lossy(),
        "usmap_path": usmap_path,
    });

    match send_tool_request(proc, &request).await {
        Ok(resp) => {
            let success = resp.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown");
            if success {
                eprintln!("[DEBUG] batch_convert_directory: batch_to_json succeeded: {}", msg);
            } else {
                eprintln!("[DEBUG] batch_convert_directory: batch_to_json failed: {}", msg);
            }
            if let Some(errors) = resp.get("data").and_then(|d| d.get("errors")).and_then(|e| e.as_array()) {
                for err in errors {
                    eprintln!("[DEBUG] batch_convert_directory error: {:?}", err);
                }
            }
        }
        Err(e) => {
            eprintln!("[DEBUG] batch_convert_directory send_tool_request error: {}", e);
        }
    }

    drop(process_guard);

    // Only match JSON files that correspond to the input uasset files
    let expected_stems: std::collections::HashSet<String> = file_paths
        .iter()
        .filter_map(|p| {
            Path::new(p)
                .file_stem()
                .map(|s| s.to_string_lossy().to_lowercase())
        })
        .collect();

    let json_paths: Vec<String> = find_files_recursive(&json_dir, ".json")
        .iter()
        .filter(|p| {
            p.file_stem()
                .map(|s| expected_stems.contains(&s.to_string_lossy().to_lowercase()))
                .unwrap_or(false)
        })
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    let _ = app.emit(
        "conversion-progress",
        ConversionProgress {
            progress_type: Some("progress".to_string()),
            current: total,
            total,
            file_name: "Conversion complete!".to_string(),
            cached: false,
            error: None,
        },
    );

    eprintln!(
        "[DEBUG] batch_convert_directory complete: {}/{} JSON files",
        json_paths.len(),
        total
    );

    Ok(HeroVfxResult {
        hero_id: String::new(),
        uasset_paths: file_paths,
        json_paths,
        cached: false,
        error: None,
    })
}

#[tauri::command]
async fn batch_convert_files(
    app: AppHandle,
    state: State<'_, AppState>,
    uasset_paths: Vec<String>,
    base_path: String,
) -> Result<HeroVfxResult, String> {
    if uasset_paths.is_empty() {
        return Err("No files provided.".to_string());
    }

    let total = uasset_paths.len();
    eprintln!("[DEBUG] batch_convert_files: converting {} files", total);

    let (usmap_path, tool_path) = {
        let settings = state.settings.lock().unwrap();
        (settings.usmap_path.clone(), get_uasset_tool_path(&app))
    };

    let root_name = Path::new(&base_path).file_name().and_then(|n| n.to_str()).unwrap_or("files");
    let json_dir = get_cache_dir().join("manual").join(root_name);
    fs::create_dir_all(&json_dir).map_err(|e| e.to_string())?;

    // Clear the json_dir to ensure fresh conversion
    if let Ok(entries) = fs::read_dir(&json_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let _ = fs::remove_dir_all(entry.path());
            } else {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    let _ = app.emit(
        "conversion-progress",
        ConversionProgress {
            progress_type: Some("progress".to_string()),
            current: 0,
            total,
            file_name: format!("Converting {} assets...", total),
            cached: false,
            error: None,
        },
    );

    let mut process_guard = state.tool_process.lock().await;
    let proc = get_or_spawn_tool(&mut process_guard, &tool_path).await?;

    let request = serde_json::json!({
        "action": "batch_to_json",
        "file_paths": uasset_paths,
        "output_path": json_dir.to_string_lossy(),
        "base_path": base_path,
        "usmap_path": usmap_path,
    });

    match send_tool_request(proc, &request).await {
        Ok(resp) => {
            let success = resp.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown");
            if success {
                eprintln!("[DEBUG] batch_convert_files: succeeded: {}", msg);
            } else {
                eprintln!("[DEBUG] batch_convert_files: failed: {}", msg);
            }
            if let Some(errors) = resp.get("data").and_then(|d| d.get("errors")).and_then(|e| e.as_array()) {
                for err in errors {
                    eprintln!("[DEBUG] batch_convert_files error: {:?}", err);
                }
            }
        }
        Err(e) => {
            eprintln!("[DEBUG] batch_convert_files send_tool_request error: {}", e);
        }
    }

    drop(process_guard);

    // Only match JSON files that correspond to the input uasset files
    let expected_stems: std::collections::HashSet<String> = uasset_paths
        .iter()
        .filter_map(|p| {
            Path::new(p)
                .file_stem()
                .map(|s| s.to_string_lossy().to_lowercase())
        })
        .collect();

    let json_paths: Vec<String> = find_files_recursive(&json_dir, ".json")
        .iter()
        .filter(|p| {
            p.file_stem()
                .map(|s| expected_stems.contains(&s.to_string_lossy().to_lowercase()))
                .unwrap_or(false)
        })
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    let _ = app.emit(
        "conversion-progress",
        ConversionProgress {
            progress_type: Some("progress".to_string()),
            current: total,
            total,
            file_name: "Conversion complete!".to_string(),
            cached: false,
            error: None,
        },
    );

    Ok(HeroVfxResult {
        hero_id: String::new(),
        uasset_paths,
        json_paths,
        cached: false,
        error: None,
    })
}

async fn fetch_latest_usmap_filename() -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.github.com/repos/SpaceDepot/rivals-depot/contents/usmap")
        .header("User-Agent", "rivals-vfx-editor")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch usmap listing: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub API returned HTTP {}",
            response.status()
        ));
    }

    let entries: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub API response: {}", e))?;

    // Find the file with the highest build number
    // Files look like: 5.3.2-3312577+++depot_marvel+S7.5_release-Marvel.usmap
    // We extract the build number (e.g., 3312577) and pick the highest
    let mut best: Option<(u64, String)> = None;

    for entry in &entries {
        if let Some(name) = entry.get("name").and_then(|v| v.as_str()) {
            if !name.ends_with(".usmap") {
                continue;
            }
            // Skip PY_ prefixed files (PlayTest/Preview builds)
            if name.starts_with("PY_") {
                continue;
            }
            // Extract build number: "5.3.2-{number}+++"
            if let Some(after_dash) = name.strip_prefix("5.3.2-") {
                if let Some(plus_idx) = after_dash.find("+++") {
                    if let Ok(build_num) = after_dash[..plus_idx].parse::<u64>() {
                        if best.as_ref().map_or(true, |(b, _)| build_num > *b) {
                            best = Some((build_num, name.to_string()));
                        }
                    }
                }
            }
        }
    }

    best.map(|(_, name)| name)
        .ok_or_else(|| "No usmap files found in repository".to_string())
}

#[tauri::command]
async fn check_usmap_status(state: State<'_, AppState>) -> Result<UsmapStatus, String> {
    let settings_usmap = {
        let settings = state.settings.lock().unwrap();
        settings.usmap_path.clone()
    };

    let meta_path = get_usmap_meta_path();
    let meta: Option<UsmapMeta> = if meta_path.exists() {
        fs::read_to_string(&meta_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    } else {
        None
    };

    // Determine if current usmap is auto-managed (lives in our managed dir)
    let managed_dir = get_usmap_dir();
    let auto_managed = settings_usmap
        .as_ref()
        .map(|p| Path::new(p).starts_with(&managed_dir))
        .unwrap_or(false);

    // Check if usmap file actually exists
    let installed = settings_usmap
        .as_ref()
        .map(|p| Path::new(p).exists())
        .unwrap_or(false);

    // Try to fetch latest remote filename
    let latest_remote = fetch_latest_usmap_filename().await.ok();

    let needs_update = if let (Some(ref remote), Some(ref m)) = (&latest_remote, &meta) {
        *remote != m.file_name
    } else if latest_remote.is_some() && meta.is_none() {
        true
    } else {
        false
    };

    Ok(UsmapStatus {
        installed,
        file_name: meta.as_ref().map(|m| m.file_name.clone()).or_else(|| {
            settings_usmap.as_ref().and_then(|p| {
                Path::new(p).file_name().map(|f| f.to_string_lossy().to_string())
            })
        }),
        file_path: settings_usmap,
        needs_update,
        latest_remote,
        auto_managed,
    })
}

#[tauri::command]
async fn fetch_latest_usmap(state: State<'_, AppState>) -> Result<UsmapStatus, String> {
    let file_name = fetch_latest_usmap_filename().await?;
    let download_url = format!(
        "https://raw.githubusercontent.com/SpaceDepot/rivals-depot/main/usmap/{}",
        file_name
    );

    eprintln!("[DEBUG] Downloading usmap: {}", download_url);

    let response = reqwest::get(&download_url)
        .await
        .map_err(|e| format!("Failed to download usmap: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download usmap: HTTP {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read usmap data: {}", e))?;

    let usmap_dir = get_usmap_dir();
    fs::create_dir_all(&usmap_dir).map_err(|e| format!("Failed to create mappings dir: {}", e))?;

    let usmap_path = usmap_dir.join(&file_name);
    fs::write(&usmap_path, &bytes).map_err(|e| format!("Failed to write usmap file: {}", e))?;

    // Save metadata
    let meta = UsmapMeta {
        file_name: file_name.clone(),
        file_path: usmap_path.to_string_lossy().to_string(),
        fetched_at: chrono::Utc::now().to_rfc3339(),
    };
    let meta_json =
        serde_json::to_string_pretty(&meta).map_err(|e| format!("Failed to serialize meta: {}", e))?;
    fs::write(get_usmap_meta_path(), meta_json)
        .map_err(|e| format!("Failed to write meta file: {}", e))?;

    // Update app settings to point to the new usmap
    let usmap_path_str = usmap_path.to_string_lossy().to_string();
    {
        let mut settings = state.settings.lock().unwrap();
        settings.usmap_path = Some(usmap_path_str.clone());
        save_settings(&settings).map_err(|e| format!("Failed to save settings: {}", e))?;
    }

    eprintln!("[DEBUG] Usmap installed: {} -> {:?}", file_name, usmap_path);

    Ok(UsmapStatus {
        installed: true,
        file_name: Some(file_name),
        file_path: Some(usmap_path_str),
        needs_update: false,
        latest_remote: None,
        auto_managed: true,
    })
}

#[tauri::command]
fn log_unique_params(param_names: Vec<String>) {
    println!("\n=== Found {} Unique Parameters ===", param_names.len());
    for name in param_names {
        println!(" - {}", name);
    }
    println!("=====================================\n");
}

// ============================================================================
// MANUAL EXTRACTION - IOSTORE BROWSER
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct AssetIndexResult {
    pub assets: Vec<String>,
    pub cached: bool,
    pub container_count: usize,
    pub total_packages: usize,
    pub error: Option<String>,
}

/// Default Marvel Rivals AES key. The game's IoStore containers are obfuscated,
/// and unlike the CLI path the interactive `list_iostore_files` action does not
/// auto-detect that — without an explicit key every container lists 0 packages.
const MARVEL_AES_KEY: &str = "0C263D8C22DCB085894899C3A3796383E9BF9DE0CBFB08C9BF2DEF2E84F29D74";

fn get_manual_cache_dir() -> PathBuf {
    get_cache_dir().join("manual-extract")
}

fn get_asset_index_cache_path() -> PathBuf {
    // Named apart from the name-matched index this replaced, so a cache written
    // by that build is rebuilt rather than served back.
    get_manual_cache_dir().join("asset_index_typed.json")
}

/// Check that an IoStore chunk path carries a content root, and hand it back.
///
/// UAssetTool 1.5.8 resolves the mount point during listing, so a path arrives
/// whole - plugin content as `Marvel/Plugins/MarvelGAS/Content/...` rather than
/// with the mount repeated and unresolved `..` segments left in it. Keeping the
/// full root is what nests a plugin under its parent in the tree instead of
/// stranding it beside `Marvel`; only paths with no `/Content/` are dropped.
fn normalize_package_path(raw: &str) -> Option<String> {
    let (root, _) = raw.split_once("/Content/")?;
    if root.is_empty() {
        return None;
    }
    Some(raw.to_string())
}

/// Convert a normalized path into the package name understood by
/// `extract_iostore_legacy --filter`.
///
/// `Marvel/Content/X.uasset` becomes `/Game/X`, which the extractor resolves
/// through a direct package-id hash lookup. Anything else (plugin content such
/// as `Marvel/Plugins/MarvelGAS/Content/...`) has no `/Game/` equivalent, so it
/// falls back to a substring pattern the extractor matches by scanning packages.
fn package_filter_for(normalized: &str) -> String {
    let without_ext = normalized
        .strip_suffix(".uasset")
        .or_else(|| normalized.strip_suffix(".umap"))
        .unwrap_or(normalized);

    match without_ext.split_once("/Content/") {
        Some(("Marvel", rest)) => format!("/Game/{}", rest),
        Some((_root, rest)) => rest.to_string(),
        None => without_ext.to_string(),
    }
}

/// One container's contribution to the asset index, with the identity it was
/// read at. A game patch rewrites or adds `.utoc` files and leaves the rest
/// alone, so a container whose size and mtime still match does not need to be
/// read again - only what the patch touched is re-typed.
#[derive(Debug, Serialize, Deserialize)]
struct CachedContainer {
    name: String,
    size: u64,
    modified_ms: u64,
    assets: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AssetIndexCache {
    /// Bumped when the selection changes meaning, so entries written by an
    /// older rule are re-read rather than trusted.
    version: u32,
    containers: Vec<CachedContainer>,
}

/// Current meaning of a cache entry: material instances by resolved asset type,
/// keyed by full VFS path. Bumped for the path shape, which v2 stored flattened.
const ASSET_INDEX_CACHE_VERSION: u32 = 3;

/// Size and modification time of a container, used to tell whether the file on
/// disk is still the one the cache was built from.
fn container_identity(path: &Path) -> Option<(u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    let modified_ms = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some((meta.len(), modified_ms))
}

/// Content roots kept out of the browser. Engine content holds editor-only
/// materials and its plugins the glTF importer's, Niagara's and Paper2D's,
/// none of which ships as game content - together 49 assets that only add
/// noise to the tree and to search results.
const HIDDEN_CONTENT_ROOTS: [&str; 1] = ["Engine"];

/// True if a normalized path sits under a content root the browser hides.
///
/// Matched on the root's first segment so an engine plugin is covered by its
/// mount rather than by the leaf it happens to end in - `Engine/Plugins/FX/
/// Niagara` hides with `Engine`, and no per-plugin entry is needed.
fn is_hidden_root(normalized: &str) -> bool {
    normalized
        .split_once("/Content/")
        .map(|(root, _)| {
            let mount = root.split_once('/').map(|(head, _)| head).unwrap_or(root);
            HIDDEN_CONTENT_ROOTS.contains(&mount)
        })
        .unwrap_or(false)
}

/// The asset class the browser lists. UAssetTool resolves this from the zen
/// header and the script objects, so it is the class the cooker wrote rather
/// than a guess from the file name.
///
/// This replaced an `MI_` prefix match: measured against the shipped containers
/// that match pulled in 196 textures named `MI_*` and missed 410 instances with
/// no prefix. Typing costs an index build of ~33s against ~7s for names, down
/// from ~1m45s before 5c81ad7 and 018738a made it parallel.
///
/// Master materials (`Material`) are deliberately not included: editing one
/// propagates to every instance built on it.
const BROWSABLE_ASSET_TYPE: &str = "MaterialInstanceConstant";

/// Containers the browser does not index, matched on the start of the file name.
///
/// Measured over the shipped containers, these scan a lot of packages for very
/// few material instances - `Wwise` types 39,898 packages for none at all, and
/// `HQ` plus `LQ` 67,127 for 270 between them - or hold no packages whatsoever
/// (`Locres`, `ShaderAsset`). `pakchunkMap` covers Map1-8 and any later map.
///
/// Prefixes rather than exact names so a container added by a game update is
/// covered without a code change. This only narrows what the tree lists;
/// extraction still loads every container in the Paks directory.
const SKIPPED_CONTAINER_PREFIXES: [&str; 7] = [
    "pakchunkmap",
    "pakchunkhq",
    "pakchunklq",
    "pakchunkmovies",
    "pakchunkwwise",
    "pakchunklocres",
    "pakchunkshaderasset",
];

/// True if a container is left out of the index.
///
/// `global.utoc` is skipped as a listing - it carries the script objects and no
/// packages - but stays reachable through the `game_paks` argument, which is
/// what type resolution actually reads it for. Every `*optional` container
/// holds optional bulk data (`.uptnl`) rather than packages.
fn is_skipped_container(file_name: &str) -> bool {
    let name = file_name.to_ascii_lowercase();
    name == "global.utoc"
        || name.contains("optional")
        || SKIPPED_CONTAINER_PREFIXES
            .iter()
            .any(|prefix| name.starts_with(prefix))
}

/// Collect the game's IoStore containers from the Paks directory.
///
/// Deliberately flat: only `.utoc` files sitting directly in `/Paks/` count as
/// game containers. Mod loaders drop their containers in subfolders such as
/// `~mods/`, and those must never be indexed or extracted from - the browser is
/// for shipped game content, and a mod container would otherwise shadow the
/// real asset. This mirrors `extract_iostore_legacy`, which loads the same
/// directory with `SearchOption.TopDirectoryOnly`.
fn collect_game_containers(paks_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut utocs: Vec<PathBuf> = fs::read_dir(paks_dir)
        .map_err(|e| format!("Failed to read Paks directory: {}", e))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            // is_file() keeps a directory that merely ends in .utoc out of the list.
            path.is_file()
                && path
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("utoc"))
                    .unwrap_or(false)
                && path
                    .file_name()
                    .map(|name| !is_skipped_container(&name.to_string_lossy()))
                    .unwrap_or(false)
        })
        .collect();
    utocs.sort();
    Ok(utocs)
}

#[tauri::command]
async fn list_game_assets(
    app: AppHandle,
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
) -> Result<AssetIndexResult, String> {
    let force = force_refresh.unwrap_or(false);
    eprintln!("[DEBUG] list_game_assets called, force_refresh={}", force);

    let index_cache_path = get_asset_index_cache_path();

    // Cached containers, keyed by file name. A refresh drops them all; otherwise
    // each is reused only if the file on disk still matches what it was read at.
    let mut cached_containers: HashMap<String, CachedContainer> = HashMap::new();
    if !force && index_cache_path.exists() {
        match fs::read_to_string(&index_cache_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<AssetIndexCache>(&raw).ok())
        {
            Some(cache) if cache.version == ASSET_INDEX_CACHE_VERSION => {
                eprintln!(
                    "[DEBUG] Loaded asset index cache: {} containers",
                    cache.containers.len()
                );
                for entry in cache.containers {
                    cached_containers.insert(entry.name.clone(), entry);
                }
            }
            Some(cache) => eprintln!(
                "[DEBUG] Asset index cache is version {}, rebuilding at {}",
                cache.version, ASSET_INDEX_CACHE_VERSION
            ),
            None => eprintln!("[DEBUG] Asset index cache unreadable, rebuilding"),
        }
    }

    let paks_path = {
        let settings = state.settings.lock().unwrap();
        settings.paks_path.clone()
    };
    let paks_path =
        paks_path.ok_or_else(|| "Game Paks path not set. Please set it in Settings.".to_string())?;

    let paks_dir = Path::new(&paks_path);
    if !paks_dir.exists() {
        return Err(format!("Game Paks directory not found: {}", paks_path));
    }

    let tool_path = get_uasset_tool_path(&app);
    if !tool_path.exists() {
        return Err(format!("UAssetTool not found at: {:?}", tool_path));
    }

    let utocs = collect_game_containers(paks_dir)?;

    if utocs.is_empty() {
        return Err(format!("No .utoc containers found in {}", paks_path));
    }

    eprintln!(
        "[DEBUG] Indexing {} top-level IoStore containers (mod subfolders such as ~mods are skipped)...",
        utocs.len()
    );

    let container_count = utocs.len();
    let mut seen: HashSet<String> = HashSet::new();
    let mut total_packages = 0usize;
    let mut first_error: Option<String> = None;
    let mut fresh_entries: Vec<CachedContainer> = Vec::with_capacity(container_count);
    let mut reused = 0usize;

    let mut process_guard = state.tool_process.lock().await;

    for (i, utoc) in utocs.iter().enumerate() {
        let container_name = utoc
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let identity = container_identity(utoc);

        // Unchanged since it was last read: take its assets from the cache and
        // skip the typing pass, which is all of the cost.
        if let Some((size, modified_ms)) = identity {
            if let Some(entry) = cached_containers.get(&container_name) {
                if entry.size == size && entry.modified_ms == modified_ms {
                    total_packages += entry.assets.len();
                    for path in &entry.assets {
                        if !is_hidden_root(path) {
                            seen.insert(path.clone());
                        }
                    }
                    reused += 1;
                    fresh_entries.push(CachedContainer {
                        name: container_name.clone(),
                        size,
                        modified_ms,
                        assets: entry.assets.clone(),
                    });
                    continue;
                }
                eprintln!("[DEBUG] {} changed on disk, re-indexing", container_name);
            }
        }

        let _ = app.emit(
            "conversion-progress",
            ConversionProgress {
                progress_type: Some("progress".to_string()),
                current: i,
                total: container_count,
                file_name: format!("Indexing {}...", container_name),
                cached: false,
                error: None,
            },
        );

        let proc = get_or_spawn_tool(&mut process_guard, &tool_path).await?;
        // type_filter implies include_types, and game_paks locates global.utoc for
        // the script objects. The tool filters, so `files` comes back holding
        // only material instances.
        let request = serde_json::json!({
            "action": "list_iostore_files",
            "file_path": utoc.to_string_lossy(),
            "aes_key": MARVEL_AES_KEY,
            "type_filter": [BROWSABLE_ASSET_TYPE],
            "game_paks": paks_path,
        });

        let response = match send_tool_request(proc, &request).await {
            Ok(resp) => resp,
            Err(e) => {
                eprintln!("[DEBUG] Failed to list {}: {}", container_name, e);
                if first_error.is_none() {
                    first_error = Some(format!("{}: {}", container_name, e));
                }
                continue;
            }
        };

        let success = response.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
        if !success {
            let msg = response
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            eprintln!("[DEBUG] list_iostore_files failed for {}: {}", container_name, msg);
            if first_error.is_none() {
                first_error = Some(format!("{}: {}", container_name, msg));
            }
            continue;
        }

        let data = response.get("data");

        // Without script objects every class reads as unknown, the filter matches
        // nothing, and the container would look empty rather than unresolved.
        if data
            .and_then(|d| d.get("script_objects_loaded"))
            .and_then(|v| v.as_bool())
            == Some(false)
        {
            eprintln!("[DEBUG] {}: script objects not loaded, asset types unresolved", container_name);
            if first_error.is_none() {
                first_error = Some(format!(
                    "Asset types could not be resolved for {} (global.utoc not found in the Paks directory).",
                    container_name
                ));
            }
        }

        if let Some(files) = data.and_then(|d| d.get("files")).and_then(|f| f.as_array()) {
            let mut container_assets = Vec::with_capacity(files.len());
            let mut kept = 0usize;
            for entry in files {
                let Some(raw) = entry.as_str() else { continue };
                total_packages += 1;
                let Some(normalized) = normalize_package_path(raw) else { continue };
                if is_hidden_root(&normalized) {
                    continue;
                }
                if seen.insert(normalized.clone()) {
                    kept += 1;
                }
                container_assets.push(normalized);
            }
            eprintln!(
                "[DEBUG] {}: {} material instances, {} new",
                container_name,
                files.len(),
                kept
            );

            // Only cache a container that was read cleanly - a failed read
            // continues above, so it is re-read next time rather than remembered
            // as empty.
            if let Some((size, modified_ms)) = identity {
                fresh_entries.push(CachedContainer {
                    name: container_name.clone(),
                    size,
                    modified_ms,
                    assets: container_assets,
                });
            }
        }
    }

    drop(process_guard);

    let mut assets: Vec<String> = seen.into_iter().collect();
    assets.sort();

    eprintln!(
        "[DEBUG] Asset index built: {} material instances from {} packages across {} containers ({} reused from cache, {} read)",
        assets.len(),
        total_packages,
        container_count,
        reused,
        container_count - reused
    );

    let _ = app.emit(
        "conversion-progress",
        ConversionProgress {
            progress_type: Some("progress".to_string()),
            current: container_count,
            total: container_count,
            file_name: "Index complete!".to_string(),
            cached: false,
            error: None,
        },
    );

    if assets.is_empty() {
        return Err(first_error.unwrap_or_else(|| {
            "No material instances found in the game containers. Check the Game Paks path in Settings.".to_string()
        }));
    }

    // Written from the containers present now, so one that a patch removed drops
    // out of the cache instead of lingering.
    fs::create_dir_all(get_manual_cache_dir()).map_err(|e| e.to_string())?;
    let cache = AssetIndexCache {
        version: ASSET_INDEX_CACHE_VERSION,
        containers: fresh_entries,
    };
    match serde_json::to_string(&cache) {
        Ok(json) => {
            if let Err(e) = fs::write(&index_cache_path, &json) {
                eprintln!("[DEBUG] Failed to cache asset index: {}", e);
            } else {
                eprintln!("[DEBUG] Cached asset index to {:?}", index_cache_path);
            }
        }
        Err(e) => eprintln!("[DEBUG] Failed to serialize asset index: {}", e),
    }

    Ok(AssetIndexResult {
        total_packages,
        assets,
        // Nothing had to be read: every container came back from the cache.
        cached: reused == container_count,
        container_count,
        error: first_error,
    })
}

#[tauri::command]
async fn extract_manual_assets(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_paths: Vec<String>,
) -> Result<HeroVfxResult, String> {
    eprintln!("[DEBUG] extract_manual_assets called with {} paths", asset_paths.len());

    if asset_paths.is_empty() {
        return Err("No assets queued for extraction.".to_string());
    }

    let (paks_path, usmap_path) = {
        let settings = state.settings.lock().unwrap();
        (settings.paks_path.clone(), settings.usmap_path.clone())
    };
    let paks_path =
        paks_path.ok_or_else(|| "Game Paks path not set. Please set it in Settings.".to_string())?;

    let tool_path = get_uasset_tool_path(&app);
    if !tool_path.exists() {
        return Err(format!("UAssetTool not found at: {:?}", tool_path));
    }

    let extract_dir = get_manual_cache_dir().join("extracted");
    let json_dir = get_manual_cache_dir().join("json");

    // Start from a clean slate so a queue only ever imports what it asked for.
    if extract_dir.exists() {
        fs::remove_dir_all(&extract_dir).map_err(|e| e.to_string())?;
    }
    if json_dir.exists() {
        fs::remove_dir_all(&json_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&json_dir).map_err(|e| e.to_string())?;

    let _ = app.emit(
        "conversion-progress",
        ConversionProgress {
            progress_type: Some("progress".to_string()),
            current: 0,
            total: asset_paths.len(),
            file_name: format!("Extracting {} assets from game files...", asset_paths.len()),
            cached: false,
            error: None,
        },
    );

    // A queue can hold hundreds of entries, well past a safe command line, so the
    // patterns go through a filter file the same way icon extraction does.
    let filters_txt = get_manual_cache_dir().join("manual_filters.txt");
    let filter_content: String = asset_paths
        .iter()
        .map(|p| package_filter_for(p))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&filters_txt, &filter_content)
        .map_err(|e| format!("Failed to write filter file: {}", e))?;

    let (stdout, stderr) = run_uasset_tool_cli(
        &tool_path,
        &[
            "extract_iostore_legacy",
            &paks_path,
            &extract_dir.to_string_lossy(),
            "--filter",
            &filters_txt.to_string_lossy(),
        ],
    )
    .await?;

    let uasset_files = find_files_recursive(&extract_dir, ".uasset");
    if uasset_files.is_empty() {
        return Err(format!(
            "No assets were extracted. stdout: {}... stderr: {}...",
            &stdout[..stdout.len().min(300)],
            &stderr[..stderr.len().min(300)]
        ));
    }

    eprintln!(
        "[DEBUG] Extracted {}/{} queued assets",
        uasset_files.len(),
        asset_paths.len()
    );

    let total = uasset_files.len();
    let _ = app.emit(
        "conversion-progress",
        ConversionProgress {
            progress_type: Some("progress".to_string()),
            current: 0,
            total,
            file_name: format!("Converting {} assets...", total),
            cached: false,
            error: None,
        },
    );

    let file_paths: Vec<String> = uasset_files
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    let mut process_guard = state.tool_process.lock().await;
    let proc = get_or_spawn_tool(&mut process_guard, &tool_path).await?;

    let request = serde_json::json!({
        "action": "batch_to_json",
        "file_paths": file_paths,
        "output_path": json_dir.to_string_lossy(),
        "base_path": extract_dir.to_string_lossy(),
        "usmap_path": usmap_path,
    });

    match send_tool_request(proc, &request).await {
        Ok(resp) => {
            let success = resp.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown");
            eprintln!("[DEBUG] Manual batch_to_json success={}: {}", success, msg);
            if let Some(errors) = resp.get("data").and_then(|d| d.get("errors")).and_then(|e| e.as_array()) {
                for err in errors {
                    eprintln!("[DEBUG] Manual batch_to_json error: {:?}", err);
                }
            }
        }
        Err(e) => {
            eprintln!("[DEBUG] send_tool_request error for batch_to_json: {}", e);
        }
    }

    drop(process_guard);

    // Pair each JSON with its source .uasset by mirrored relative path rather
    // than by walk order - the caller indexes the two lists together for
    // save-back, and two independent directory walks are not guaranteed to
    // enumerate in the same order.
    let mut json_paths: Vec<String> = Vec::new();
    let mut paired_uassets: Vec<String> = Vec::new();
    for json_path in find_files_recursive(&json_dir, ".json") {
        let uasset_path = json_path
            .strip_prefix(&json_dir)
            .map(|rel| extract_dir.join(rel).with_extension("uasset"))
            .ok()
            .filter(|candidate| candidate.exists());

        if uasset_path.is_none() {
            eprintln!("[DEBUG] No source .uasset found for {:?}", json_path);
        }

        json_paths.push(json_path.to_string_lossy().to_string());
        paired_uassets.push(
            uasset_path
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        );
    }

    let _ = app.emit(
        "conversion-progress",
        ConversionProgress {
            progress_type: Some("progress".to_string()),
            current: total,
            total,
            file_name: "Conversion complete!".to_string(),
            cached: false,
            error: None,
        },
    );

    let missing = asset_paths.len().saturating_sub(uasset_files.len());
    let error = if missing > 0 {
        Some(format!(
            "{} of {} queued assets could not be found in the game containers.",
            missing,
            asset_paths.len()
        ))
    } else {
        None
    };

    Ok(HeroVfxResult {
        hero_id: "manual".to_string(),
        uasset_paths: paired_uassets,
        json_paths,
        cached: false,
        error,
    })
}

#[tauri::command]
fn get_manual_cache_info() -> CacheInfo {
    let cache_dir = get_manual_cache_dir();
    let mut file_count: usize = 0;
    let mut total_size = 0u64;

    fn visit_dirs(dir: &Path, count: &mut usize, size: &mut u64) -> std::io::Result<()> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    visit_dirs(&path, count, size)?;
                } else {
                    *count += 1;
                    *size += entry.metadata()?.len();
                }
            }
        }
        Ok(())
    }

    let _ = visit_dirs(&cache_dir, &mut file_count, &mut total_size);

    CacheInfo {
        file_count,
        total_size_bytes: total_size,
        cache_dir: cache_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn clear_manual_cache() -> Result<(), String> {
    let cache_dir = get_manual_cache_dir();
    eprintln!("[DEBUG] Clearing manual extraction cache: {:?}", cache_dir);
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateVfxModResult {
    pub success: bool,
    pub message: String,
    pub output_path: Option<String>,
}

#[tauri::command]
async fn update_vfx_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    mod_path: String,
    usmap_path: Option<String>,
    output_dir: String,
) -> Result<UpdateVfxModResult, String> {
    eprintln!(
        "[DEBUG] update_vfx_mod called with mod_path={}, usmap={:?}, output_dir={}",
        mod_path, usmap_path, output_dir
    );

    let paks_path = {
        let settings = state.settings.lock().unwrap();
        settings.paks_path.clone()
    }
    .ok_or_else(|| "Game Paks path not configured in settings. Please set it in Settings first.".to_string())?;

    let effective_usmap = match usmap_path {
        Some(ref p) if !p.trim().is_empty() => Some(p.clone()),
        _ => {
            let settings = state.settings.lock().unwrap();
            settings.usmap_path.clone()
        }
    };

    let tool_path = get_uasset_tool_path(&app);

    // Create a temporary extraction directory
    let temp_dir = tempfile::Builder::new()
        .prefix("rvfxe-updater-")
        .tempdir()
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    let temp_extract = temp_dir.path().to_path_buf();

    // Step 1: Extract legacy assets from the mod container
    let mut extract_args = vec![
        "extract_iostore_legacy".to_string(),
        paks_path,
        temp_extract.to_string_lossy().to_string(),
        "--mod".to_string(),
        mod_path.clone(),
    ];
    if let Some(ref usm) = effective_usmap {
        extract_args.push("--usmap".to_string());
        extract_args.push(usm.clone());
    }

    let extract_refs: Vec<&str> = extract_args.iter().map(|s| s.as_str()).collect();
    let (stdout, stderr) = run_uasset_tool_cli(&tool_path, &extract_refs).await?;
    eprintln!("[DEBUG] Updater extract stdout: {}", stdout);
    if !stderr.is_empty() {
        eprintln!("[DEBUG] Updater extract stderr: {}", stderr);
    }

    // Check if any legacy files were extracted
    let extracted_files = find_files_recursive(&temp_extract, ".uasset");
    if extracted_files.is_empty() {
        return Ok(UpdateVfxModResult {
            success: false,
            message: format!(
                "No packages could be extracted from mod: {}. Make sure the .utoc file is valid.",
                mod_path
            ),
            output_path: None,
        });
    }

    // Step 2: Repackage into updated mod IoStore bundle
    let mod_file_path = Path::new(&mod_path);
    let mod_name = mod_file_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let target_out_dir = PathBuf::from(&output_dir);
    fs::create_dir_all(&target_out_dir).map_err(|e| e.to_string())?;
    let output_bundle_base = target_out_dir.join(format!("{}_Updated", mod_name));

    let repack_args = vec![
        "create_mod_iostore".to_string(),
        output_bundle_base.to_string_lossy().to_string(),
        temp_extract.to_string_lossy().to_string(),
    ];
    let repack_refs: Vec<&str> = repack_args.iter().map(|s| s.as_str()).collect();
    let (repack_stdout, repack_stderr) = run_uasset_tool_cli(&tool_path, &repack_refs).await?;
    eprintln!("[DEBUG] Updater repack stdout: {}", repack_stdout);
    if !repack_stderr.is_empty() {
        eprintln!("[DEBUG] Updater repack stderr: {}", repack_stderr);
    }

    let result_utoc = format!("{}_Updated.utoc", output_bundle_base.to_string_lossy());
    Ok(UpdateVfxModResult {
        success: true,
        message: format!(
            "Successfully updated mod with {} assets! Output created at: {}",
            extracted_files.len(),
            result_utoc
        ),
        output_path: Some(result_utoc),
    })
}

// ============================================================================
// APP INITIALIZATION
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings();
    let cache_index = load_cache_index();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            settings: Mutex::new(settings),
            cache_index: Mutex::new(cache_index),
            tool_process: TokioMutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_usmap_path,
            set_paks_path,
            set_detailed_errors,
            set_auto_clear_cache,
            set_ui_scale,
            set_filter_dictionary,
            set_header_minimized,
            set_pak_ready_structure,
            get_cache_info,
            clear_cache,
            convert_uasset_to_json,
            convert_json_to_uasset,
            batch_convert_uassets_to_json,
            batch_convert_jsons_to_uassets,
            get_exe_dir,
            log_unique_params,
            get_hero_roster,
            batch_extract_hero_icons,
            get_hero_icon_data_url,
            extract_hero_vfx,
            get_hero_browser_cache_info,
            get_vfx_cache_info,
            clear_hero_browser_cache,
            clear_vfx_cache,
            open_cache_folder,
            open_folder,
            check_usmap_status,
            fetch_latest_usmap,
            scan_directory_for_uassets,
            batch_convert_directory,
            batch_convert_files,
            list_game_assets,
            extract_manual_assets,
            get_manual_cache_info,
            clear_manual_cache,
            update_vfx_mod,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<AppState>();
                let should_clear = {
                    let settings = state.settings.lock().unwrap();
                    settings.auto_clear_cache
                };

                if should_clear {
                    // Clear VFX materials cache
                    let vfx_dir = get_hero_cache_dir().join("vfx");
                    if vfx_dir.exists() {
                        let _ = fs::remove_dir_all(&vfx_dir);
                    }
                    // Clear conversion cache (JSON files) but preserve hero browser data
                    let cache_dir = get_cache_dir();
                    let mut cache_index = state.cache_index.lock().unwrap();
                    cache_index.entries.clear();
                    let _ = save_cache_index(&cache_index);
                    // Remove cached JSON files but keep the hero-browser subdirectory
                    if let Ok(entries) = fs::read_dir(&cache_dir) {
                        for entry in entries.filter_map(|e| e.ok()) {
                            let path = entry.path();
                            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                            if name == "hero-browser" || name == "index.json" {
                                continue;
                            }
                            if path.is_dir() {
                                let _ = fs::remove_dir_all(&path);
                            } else {
                                let _ = fs::remove_file(&path);
                            }
                        }
                    }
                }
            }
        });
}

#[cfg(test)]
mod manual_extraction_tests {
    use super::*;

    // Every sample below is a real chunk path taken from the game's containers,
    // as UAssetTool 1.5.8 hands it over.
    #[test]
    fn keeps_game_content_paths() {
        assert_eq!(
            normalize_package_path(
                "Marvel/Content/Marvel/VFX/Materials/Characters/1030/Materials/1030801/MI_Lobby_1030801_38_017.uasset"
            ),
            Some("Marvel/Content/Marvel/VFX/Materials/Characters/1030/Materials/1030801/MI_Lobby_1030801_38_017.uasset".to_string())
        );
    }

    #[test]
    fn keeps_the_full_root_of_plugin_content_paths() {
        // The plugin nests under Marvel/Plugins in the tree rather than sitting
        // beside it, which is where flattening the root to MarvelGAS put it.
        assert_eq!(
            normalize_package_path(
                "Marvel/Plugins/MarvelGAS/Content/Marvel/VFX/Materials/Characters/1025/MI_1025_ShieldsGlow_103_04.uasset"
            ),
            Some("Marvel/Plugins/MarvelGAS/Content/Marvel/VFX/Materials/Characters/1025/MI_1025_ShieldsGlow_103_04.uasset".to_string())
        );
    }

    #[test]
    fn keeps_engine_content_paths() {
        assert_eq!(
            normalize_package_path("Engine/Content/EditorMaterials/Camera/MI_CineMat_Rig.uasset"),
            Some("Engine/Content/EditorMaterials/Camera/MI_CineMat_Rig.uasset".to_string())
        );
    }

    #[test]
    fn rejects_paths_without_a_content_root() {
        assert_eq!(normalize_package_path("Marvel/VFX/Materials/MI_Thing.uasset"), None);
    }

    #[test]
    fn game_content_uses_direct_lookup_filter() {
        // The `/Game/` form resolves through a package-id hash lookup instead of
        // a full scan of ~570k packages, which is what makes large queues viable.
        assert_eq!(
            package_filter_for("Marvel/Content/Marvel/VFX/Materials/Characters/1030/MI_Lobby_38_017.uasset"),
            "/Game/Marvel/VFX/Materials/Characters/1030/MI_Lobby_38_017"
        );
    }

    #[test]
    fn plugin_content_falls_back_to_substring_filter() {
        // The full root no longer equals "Marvel", so plugin content still takes
        // the scan branch rather than being mistaken for /Game/ content.
        assert_eq!(
            package_filter_for(
                "Marvel/Plugins/MarvelGAS/Content/Marvel/VFX/Materials/Characters/1025/MI_1025_ShieldsGlow_103_04.uasset"
            ),
            "Marvel/VFX/Materials/Characters/1025/MI_1025_ShieldsGlow_103_04"
        );
    }

    #[test]
    fn hides_engine_content_and_its_plugins() {
        assert!(is_hidden_root("Engine/Content/EditorMaterials/Camera/MI_CineMat_Rig.uasset"));
        assert!(is_hidden_root(
            "Engine/Plugins/Interchange/Runtime/Content/gltf/MaterialInstances/MI_ClearCoat_Blend.uasset"
        ));
        assert!(is_hidden_root("Engine/Plugins/FX/Niagara/Content/Materials/MI_Thing.uasset"));
        // Game content and its plugins stay visible.
        assert!(!is_hidden_root("Marvel/Content/Marvel/VFX/Materials/MI_Fire_25_002.uasset"));
        assert!(!is_hidden_root(
            "Marvel/Plugins/MarvelGAS/Content/Marvel/Characters/1023/MI_Weapon_01.uasset"
        ));
        // Matching is on the mount segment, not a substring of it.
        assert!(!is_hidden_root("EngineExtras/Content/Materials/MI_Thing.uasset"));
        assert!(!is_hidden_root("EngineExtras/Plugins/X/Content/MI_Thing.uasset"));
        assert!(!is_hidden_root("Marvel/Content/Engine/MI_Thing.uasset"));
    }

    #[test]
    fn skips_containers_that_carry_no_browsable_materials() {
        // Kept: everything the tree is actually built from.
        for keep in [
            "pakchunkCharacter-Windows.utoc",
            "pakchunkUI-Windows.utoc",
            "pakchunkEnv-Windows.utoc",
            "pakchunkCommon-Windows.utoc",
            "pakchunkVFX-Windows.utoc",
            "pakchunk0-Windows.utoc",
            "Patch_-Windows_1.1.3791970_P.utoc",
        ] {
            assert!(!is_skipped_container(keep), "{} must be indexed", keep);
        }

        // Skipped: scanned a lot for little or nothing.
        for skip in [
            "pakchunkMap1-Windows.utoc",
            "pakchunkMap8-Windows.utoc",
            "pakchunkMap8optional-Windows.utoc",
            "pakchunkHQ-Windows.utoc",
            "pakchunkLQ-Windows.utoc",
            "pakchunkMovies-Windows.utoc",
            "pakchunkWwise-Windows.utoc",
            "pakchunkLocres-Windows.utoc",
            "pakchunkShaderAsset-Windows.utoc",
            "global.utoc",
            "pakchunk0optional-Windows.utoc",
            "pakchunkCharacteroptional-Windows.utoc",
            "pakchunkVFXoptional-Windows.utoc",
        ] {
            assert!(is_skipped_container(skip), "{} must be skipped", skip);
        }

        // A map added by a later update is covered without a code change.
        assert!(is_skipped_container("pakchunkMap9-Windows.utoc"));
    }

    #[test]
    fn container_identity_tracks_patched_files() {
        // What decides whether a container is re-typed after a game update.
        let temp = std::env::temp_dir().join(format!("rvfxe_ident_test_{}", std::process::id()));
        fs::create_dir_all(&temp).unwrap();
        let utoc = temp.join("pakchunkVFX-Windows.utoc");

        fs::write(&utoc, b"original").unwrap();
        let before = container_identity(&utoc).unwrap();
        assert_eq!(before, container_identity(&utoc).unwrap(), "unchanged file must read the same");

        // A patch rewrites the container: different length, so it no longer matches.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&utoc, b"patched content").unwrap();
        let after = container_identity(&utoc).unwrap();
        assert_ne!(before, after, "a rewritten container must not be reused");

        assert!(container_identity(&temp.join("missing.utoc")).is_none());

        fs::remove_dir_all(&temp).unwrap();
    }

    #[test]
    fn skips_mod_containers_in_subfolders() {
        // Mod loaders put containers in ~mods/; only the real game containers
        // sitting directly in /Paks/ may be indexed or extracted from.
        let temp = std::env::temp_dir().join(format!("rvfxe_paks_test_{}", std::process::id()));
        let mods_dir = temp.join("~mods");
        fs::create_dir_all(&mods_dir).unwrap();
        fs::write(temp.join("pakchunkVFX-Windows.utoc"), b"").unwrap();
        fs::write(temp.join("global.utoc"), b"").unwrap();
        fs::write(temp.join("pakchunk0-Windows.pak"), b"").unwrap();
        fs::write(mods_dir.join("some_mod_P.utoc"), b"").unwrap();
        fs::create_dir_all(temp.join("weird.utoc")).unwrap();

        let found = collect_game_containers(&temp).unwrap();
        let names: Vec<String> = found
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();

        // global.utoc is filtered by is_skipped_container, so only the real
        // browsable container survives here.
        assert_eq!(names, vec!["pakchunkVFX-Windows.utoc"]);
        assert!(!names.iter().any(|n| n.contains("some_mod")));

        fs::remove_dir_all(&temp).unwrap();
    }
}
