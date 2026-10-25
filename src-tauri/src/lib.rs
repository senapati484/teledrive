use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as AsyncMutex;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[tauri::command]
fn log_vault_state(app: tauri::AppHandle, state: String) {
    use std::fs::OpenOptions;
    use std::io::Write;
    let log_path = if let Ok(data_dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&data_dir);
        data_dir.join("vault_state.log")
    } else {
        std::path::PathBuf::from("vault_state.log")
    };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        writeln!(file, "{state}").ok();
    }
}

/// Returns the last N lines of vault_state.log for the diagnostics page.
/// Reads the same file the frontend writes to via log_vault_state, so the
/// output mirrors the live state of the index pipeline without requiring
/// any extra instrumentation on the JS side.
#[tauri::command]
fn get_vault_state(app: tauri::AppHandle, lines: Option<usize>) -> Result<String, String> {
    let limit = lines.unwrap_or(200);
    let log_path = if let Ok(data_dir) = app.path().app_data_dir() {
        data_dir.join("vault_state.log")
    } else {
        std::path::PathBuf::from("vault_state.log")
    };
    if !log_path.exists() {
        return Ok(String::new());
    }
    let contents = std::fs::read_to_string(log_path)
        .map_err(|e| format!("Failed to read vault_state.log: {e}"))?;

    // Take the last `limit` lines without loading more than needed.
    let collected: Vec<&str> = contents.lines().rev().take(limit).collect();
    let mut out: Vec<&str> = collected;
    out.reverse();
    Ok(out.join("\n"))
}



/// Saves the Telegram session string to a simple JSON file in the app data directory.
/// This is reliable, fast, and survives dev-server restarts without Stronghold overhead.
#[tauri::command]
fn save_session(app: tauri::AppHandle, session: String, phone: String) -> Result<(), String> {
    let session_path = get_session_path(&app)?;
    let json = serde_json::json!({ "session": session, "phone": phone });
    std::fs::write(&session_path, json.to_string())
        .map_err(|e| format!("Failed to write session file: {e}"))
}

/// Loads the Telegram session string from the app data directory.
/// Returns null fields if no session file exists.
#[tauri::command]
fn load_session(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let session_path = get_session_path(&app)?;
    if !session_path.exists() {
        return Ok(serde_json::json!({ "session": null, "phone": null }));
    }
    let contents = std::fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {e}"))?;
    let parsed: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse session file: {e}"))?;
    Ok(parsed)
}

/// Clears the saved session file (used on logout).
#[tauri::command]
fn clear_session(app: tauri::AppHandle) -> Result<(), String> {
    let session_path = get_session_path(&app)?;
    if session_path.exists() {
        std::fs::remove_file(&session_path)
            .map_err(|e| format!("Failed to delete session file: {e}"))?;
    }
    Ok(())
}

/// Clears ONLY the session token while preserving the phone number.
/// Used during logout so the phone-keyed channel ID can still be found on next login.
#[tauri::command]
fn clear_session_only(app: tauri::AppHandle) -> Result<(), String> {
    let session_path = get_session_path(&app)?;
    if !session_path.exists() {
        return Ok(());
    }
    let contents = std::fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {e}"))?;
    let mut parsed: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse session file: {e}"))?;
    // Null out the session token but keep the phone number
    if let Some(obj) = parsed.as_object_mut() {
        obj.insert("session".to_string(), serde_json::Value::Null);
    }
    std::fs::write(&session_path, parsed.to_string())
        .map_err(|e| format!("Failed to write session file: {e}"))
}

static VAULT_LOCK: Mutex<()> = Mutex::new(());

fn lock_vault() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    VAULT_LOCK
        .lock()
        .map_err(|_| "vault lock poisoned".to_string())
}

/// Write bytes by replacing the destination with a synced temp file.
/// `rename` is atomic on Unix; on Windows it can fail when the destination
/// exists, so fall back to copy + remove without deleting the old file first.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("no parent directory for {}", path.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let tmp = parent.join(format!(".{name}.tmp-{}", std::process::id()));
    {
        let mut file = std::fs::File::create(&tmp)
            .map_err(|e| format!("Failed to create {}: {e}", tmp.display()))?;
        file.write_all(bytes)
            .map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync {}: {e}", tmp.display()))?;
    }
    if let Err(rename_err) = std::fs::rename(&tmp, path) {
        std::fs::copy(&tmp, path).map_err(|copy_err| {
            format!(
                "Failed to replace {}: rename={rename_err}; copy={copy_err}",
                path.display()
            )
        })?;
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(())
}

/// Saves a key-value pair to a vault file in the app data directory.
#[tauri::command]
fn save_vault_value(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let _guard = lock_vault()?;
    let vault_path = get_vault_path(&app)?;
    let mut data = if vault_path.exists() {
        let contents = std::fs::read_to_string(&vault_path)
            .map_err(|e| format!("Failed to read vault file: {e}"))?;
        serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&contents)
            .unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    data.insert(key, serde_json::Value::String(value));
    let bytes = serde_json::to_vec(&data).map_err(|e| format!("Failed to encode vault: {e}"))?;
    atomic_write(&vault_path, &bytes)
}

/// Loads a value for a key from the vault file.
#[tauri::command]
fn load_vault_value(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let _guard = lock_vault()?;
    let vault_path = get_vault_path(&app)?;
    if !vault_path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {e}"))?;
    let data: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse vault file: {e}"))?;
    
    if let Some(val) = data.get(&key) {
        if let Some(s) = val.as_str() {
            return Ok(Some(s.to_string()));
        }
    }
    Ok(None)
}

/// Deletes a key-value pair from the vault file.
#[tauri::command]
fn delete_vault_value(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let _guard = lock_vault()?;
    let vault_path = get_vault_path(&app)?;
    if !vault_path.exists() {
        return Ok(());
    }
    let contents = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {e}"))?;
    let mut data: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse vault file: {e}"))?;

    data.remove(&key);
    let bytes = serde_json::to_vec(&data).map_err(|e| format!("Failed to encode vault: {e}"))?;
    atomic_write(&vault_path, &bytes)
}

/// Quarantines a vault value: reads the value at `key` and copies it under
/// `backup_key` (so it can be inspected/recovered later), then deletes the
/// original. No-op if `key` is missing.
///
/// Used by the backup manifest layer to preserve corrupt JSON instead of
/// silently losing it. The runner checks the sentinel after a failed
/// loadManifest and refuses to upload — the user can manually inspect
/// the quarantined value and decide what to do.
#[tauri::command]
fn quarantine_vault_value(
    app: tauri::AppHandle,
    key: String,
    backup_key: String,
) -> Result<(), String> {
    let _guard = lock_vault()?;
    let vault_path = get_vault_path(&app)?;
    if !vault_path.exists() {
        return Ok(());
    }
    let contents = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {e}"))?;
    let mut data: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse vault file: {e}"))?;

    if let Some(value) = data.remove(&key) {
        data.insert(backup_key, value);
    }
    let bytes = serde_json::to_vec(&data).map_err(|e| format!("Failed to encode vault: {e}"))?;
    atomic_write(&vault_path, &bytes)
}

// ============================================================================
// Device backup manifest + journal (v2)
//
// One base JSON file and one append-only JSONL journal per storage channel.
// The journal carries the base generation; a save bumps the generation and
// truncates the journal. Lines from an older generation are ignored, so a
// crash between the rename and the truncate cannot resurrect superseded ids.
// ============================================================================

static BACKUP_MANIFEST_LOCK: Mutex<()> = Mutex::new(());

#[derive(serde::Serialize)]
struct BackupManifestLoad {
    base: Option<String>,
    generation: u64,
    journal: Vec<String>,
}

fn manifest_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    BACKUP_MANIFEST_LOCK
        .lock()
        .map_err(|_| "backup manifest lock poisoned".to_string())
}

fn safe_manifest_segment(channel_id: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    channel_id.hash(&mut hasher);
    let cleaned: String = channel_id
        .chars()
        .take(64)
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let prefix = if cleaned.is_empty() { "channel" } else { &cleaned };
    format!("{prefix}-{:016x}", hasher.finish())
}

fn backup_manifest_paths(
    app: &tauri::AppHandle,
    channel_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?
        .join("backup_manifests");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create backup manifest dir: {e}"))?;
    let safe = safe_manifest_segment(channel_id);
    Ok((
        dir.join(format!("{safe}.json")),
        dir.join(format!("{safe}.journal.jsonl")),
    ))
}

fn manifest_generation_at(path: &Path) -> Result<u64, String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(serde_json::from_str::<serde_json::Value>(&contents)
            .ok()
            .and_then(|v| v.get("generation").and_then(|g| g.as_u64()))
            .unwrap_or(0)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(err) => Err(format!("Failed to read {}: {err}", path.display())),
    }
}

#[tauri::command]
fn load_backup_manifest(
    app: tauri::AppHandle,
    channel_id: String,
) -> Result<BackupManifestLoad, String> {
    let _guard = manifest_lock()?;
    let (base_path, journal_path) = backup_manifest_paths(&app, &channel_id)?;
    let base = match std::fs::read_to_string(&base_path) {
        Ok(contents) => Some(contents),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(format!("Failed to read manifest: {err}")),
    };
    let generation = manifest_generation_at(&base_path)?;
    let journal = match std::fs::read_to_string(&journal_path) {
        Ok(contents) => contents.lines().map(|l| l.to_string()).collect(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(err) => return Err(format!("Failed to read manifest journal: {err}")),
    };
    Ok(BackupManifestLoad {
        base,
        generation,
        journal,
    })
}

#[tauri::command]
fn save_backup_manifest(
    app: tauri::AppHandle,
    channel_id: String,
    value: String,
    generation: u64,
) -> Result<u64, String> {
    let _guard = manifest_lock()?;
    let (base_path, journal_path) = backup_manifest_paths(&app, &channel_id)?;
    let current = manifest_generation_at(&base_path)?;
    if current != generation {
        return Err(format!(
            "manifest generation changed (expected {generation}, found {current})"
        ));
    }
    let mut parsed: serde_json::Value = serde_json::from_str(&value)
        .map_err(|e| format!("Failed to parse manifest JSON: {e}"))?;
    let next = generation.saturating_add(1);
    if let Some(obj) = parsed.as_object_mut() {
        obj.insert("generation".to_string(), serde_json::json!(next));
    } else {
        return Err("manifest JSON is not an object".to_string());
    }
    let bytes = serde_json::to_vec(&parsed)
        .map_err(|e| format!("Failed to encode manifest: {e}"))?;
    atomic_write(&base_path, &bytes)?;
    if let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&journal_path)
    {
        let _ = file.sync_all();
    }
    Ok(next)
}

#[tauri::command]
fn append_backup_manifest_journal(
    app: tauri::AppHandle,
    channel_id: String,
    generation: u64,
    line: String,
) -> Result<(), String> {
    let _guard = manifest_lock()?;
    let (base_path, journal_path) = backup_manifest_paths(&app, &channel_id)?;
    let current = manifest_generation_at(&base_path)?;
    if current != generation {
        return Err(format!(
            "manifest generation changed (expected {generation}, found {current})"
        ));
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&journal_path)
        .map_err(|e| format!("Failed to open manifest journal: {e}"))?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|e| format!("Failed to append manifest journal: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync manifest journal: {e}"))
}

#[tauri::command]
fn quarantine_backup_manifest(
    app: tauri::AppHandle,
    channel_id: String,
    suffix: String,
) -> Result<Option<String>, String> {
    let _guard = manifest_lock()?;
    let (base_path, journal_path) = backup_manifest_paths(&app, &channel_id)?;
    let base = match std::fs::read_to_string(&base_path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("Failed to read manifest: {err}")),
    };
    let safe_suffix: String = suffix
        .chars()
        .take(48)
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let name = base_path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("manifest");
    let dir = base_path
        .parent()
        .ok_or_else(|| "manifest has no parent directory".to_string())?;
    let quarantine_base = dir.join(format!("{name}-corrupt-{safe_suffix}.json"));
    let quarantine_journal = dir.join(format!("{name}-corrupt-{safe_suffix}.jsonl"));
    std::fs::copy(&base_path, &quarantine_base)
        .map_err(|e| format!("Failed to quarantine manifest: {e}"))?;
    if journal_path.exists() {
        let _ = std::fs::copy(&journal_path, &quarantine_journal);
    }
    std::fs::remove_file(&base_path)
        .map_err(|e| format!("Failed to remove corrupt manifest: {e}"))?;
    let _ = std::fs::remove_file(&journal_path);
    Ok(Some(base))
}

fn get_vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(data_dir.join("teledrive_vault.json"))
}

fn get_session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(data_dir.join("teledrive_session.json"))
}

// ============================================================================
// Scheduled backup timer (Pro feature)
//
// The desktop owns the actual schedule timer — the backend stores the
// user-configured cadence on the License, but the backend never has the
// Telegram session so it can't run the snapshot. The Rust side is just a
// reliable interval timer that emits a `teledrive://backup-tick` Tauri event
// into the webview; the JS handler in App.tsx does the actual Telegram
// send + audit POST.
//
// Only ONE timer can be active at a time. Calling start_backup_scheduler
// while another timer is running first stops the existing one. This makes
// changing the interval safe and idempotent.
// ============================================================================

static SCHEDULED_BACKUP_HANDLE: OnceLock<AsyncMutex<Option<JoinHandle<()>>>> = OnceLock::new();

fn handle_slot() -> &'static AsyncMutex<Option<JoinHandle<()>>> {
    SCHEDULED_BACKUP_HANDLE.get_or_init(|| AsyncMutex::new(None))
}

/// Start the scheduled backup timer. `interval_minutes` must be > 0.
/// Replaces any existing timer. The first tick fires after `interval_minutes`
/// (no immediate fire on start — that would surprise the user right after
/// they click "Daily").
#[tauri::command]
async fn start_backup_scheduler(app: AppHandle, interval_minutes: u64) -> Result<(), String> {
    if interval_minutes == 0 {
        return Err("interval_minutes must be greater than 0".into());
    }

    // Stop any existing timer first so the interval change is honored.
    stop_backup_scheduler_internal(&app).await;

    let app_handle = app.clone();
    let period = Duration::from_secs(interval_minutes * 60);
    let handle = tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(period);
        // First tick fires immediately by default — skip it so we wait one
        // full period before the first backup, matching user expectations.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(err) = app_handle.emit("teledrive://backup-tick", ()) {
                eprintln!("[backup_scheduler] failed to emit tick: {err}");
                // Don't break the loop on emit error — keep ticking. The JS
                // side just won't hear this one. The next tick is N minutes
                // away, so it's recoverable.
            }
        }
    });

    let mut guard = handle_slot().lock().await;
    *guard = Some(handle);
    log_vault_state(
        app.clone(),
        format!("BACKUP_SCHEDULER_START interval_minutes={interval_minutes}"),
    );
    Ok(())
}

/// Stop the scheduled backup timer. No-op if no timer is running.
#[tauri::command]
async fn stop_backup_scheduler(app: AppHandle) -> Result<(), String> {
    stop_backup_scheduler_internal(&app).await;
    log_vault_state(app, "BACKUP_SCHEDULER_STOP".to_string());
    Ok(())
}

async fn stop_backup_scheduler_internal(_app: &AppHandle) {
    let mut guard = handle_slot().lock().await;
    if let Some(handle) = guard.take() {
        // tauri::async_runtime::JoinHandle has an inherent .abort() that
        // delegates to the underlying Tokio handle. We always spawn on
        // Tokio (via tauri::async_runtime::spawn), so this is safe.
        handle.abort();
    }
}

// ============================================================================
// Device-backup filesystem walker (Pro feature)
//
// Used by the JS-side backup runner to enumerate a user-chosen source
// folder. Tauri's plugin-fs `readDir` returns DirEntry records WITHOUT
// size or mtime — that would force a separate `stat` IPC per file,
// unacceptable for a 100k-file folder. This single Rust command does the
// whole walk in one shot, returning flat entries the JS layer can
// deserialize and diff against its local manifest.
//
// Output shape (matches `RustDirEntry` in src/lib/backup/walker.ts):
//   { absPath: string, relPath: string, isDir: bool, size: number, mtimeMs: number }
//
// We skip symlinks (would loop on `/var -> /private/var`) and unreadable
// files (logged as warnings, walker continues with the rest). The JS side
// does exclude-glob filtering; Rust just returns everything raw so the
// filter happens in one place the user can read.
// ============================================================================

use serde::Serialize;
use std::collections::HashSet;
use std::time::SystemTime;

#[derive(Serialize)]
struct DirEntry {
    abs_path: String,
    rel_path: String,
    is_dir: bool,
    size: u64,
    mtime_ms: u64,
}

#[derive(Serialize)]
struct WalkRoot {
    path: String,
    status: String,
    skipped: u32,
}

#[derive(Serialize)]
struct WalkError {
    path: String,
    code: String,
}

#[derive(Serialize)]
struct WalkOutput {
    entries: Vec<DirEntry>,
    roots: Vec<WalkRoot>,
    cancelled: bool,
    complete: bool,
    errors: Vec<WalkError>,
}

static WALK_CANCELS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
const WALK_ENTRY_CAP: usize = 250_000;

fn walk_cancels() -> &'static Mutex<HashSet<String>> {
    WALK_CANCELS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn walk_cancelled(run_id: &str) -> bool {
    walk_cancels()
        .lock()
        .map(|set| set.contains(run_id))
        .unwrap_or(false)
}

#[tauri::command]
fn cancel_backup_walk(run_id: String) {
    if let Ok(mut set) = walk_cancels().lock() {
        set.insert(run_id);
    }
}

fn unix_ms(t: SystemTime) -> u64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

struct WalkState {
    entries: Vec<DirEntry>,
    errors: Vec<WalkError>,
    cancelled: bool,
    truncated: bool,
}

fn walk_recursive(root: &Path, current: &Path, run_id: &str, state: &mut WalkState) {
    if state.cancelled || state.truncated {
        return;
    }
    if walk_cancelled(run_id) {
        state.cancelled = true;
        return;
    }
    let entries = match std::fs::read_dir(current) {
        Ok(it) => it,
        Err(err) => {
            let code = if err.kind() == std::io::ErrorKind::NotFound {
                "not_found"
            } else if err.kind() == std::io::ErrorKind::PermissionDenied {
                "permission_denied"
            } else {
                "io_error"
            };
            state.errors.push(WalkError {
                path: current.to_string_lossy().into_owned(),
                code: code.to_string(),
            });
            return;
        }
    };

    for entry in entries.flatten() {
        if state.cancelled || state.truncated {
            return;
        }
        if walk_cancelled(run_id) {
            state.cancelled = true;
            return;
        }
        if state.entries.len() >= WALK_ENTRY_CAP {
            state.truncated = true;
            return;
        }
        let path = entry.path();
        let file_name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        let meta = match std::fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let file_type = meta.file_type();
        if file_type.is_symlink() {
            continue;
        }
        let is_dir = file_type.is_dir();
        if !is_dir && !file_type.is_file() {
            continue;
        }
        let size = if is_dir { 0 } else { meta.len() };
        let mtime_ms = unix_ms(meta.modified().unwrap_or(SystemTime::UNIX_EPOCH));
        let rel_path = match path.strip_prefix(root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => file_name.clone(),
        };
        state.entries.push(DirEntry {
            abs_path: path.to_string_lossy().into_owned(),
            rel_path,
            is_dir,
            size,
            mtime_ms,
        });
        if is_dir {
            walk_recursive(root, &path, run_id, state);
        }
    }
}

#[tauri::command]
async fn read_dir_recursive(
    app: tauri::AppHandle,
    path: String,
    run_id: Option<String>,
) -> Result<WalkOutput, String> {
    #[cfg(mobile)]
    {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {e}"))?;
        let requested = Path::new(&path);
        if !requested.starts_with(&data_dir) {
            return Err(format!(
                "Mobile: directory access is restricted to the app data directory. Requested: {path}"
            ));
        }
    }
    #[cfg(not(mobile))]
    let _ = &app;

    let run_id = run_id.unwrap_or_else(|| "default".to_string());
    let root = Path::new(&path);
    let meta = match std::fs::metadata(root) {
        Ok(m) => m,
        Err(err) => {
            let status = if err.kind() == std::io::ErrorKind::NotFound {
                "missing"
            } else {
                "unreadable"
            };
            return Ok(WalkOutput {
                entries: Vec::new(),
                roots: vec![WalkRoot {
                    path: path.clone(),
                    status: status.to_string(),
                    skipped: 0,
                }],
                cancelled: false,
                complete: false,
                errors: vec![WalkError {
                    path: path.clone(),
                    code: status.to_string(),
                }],
            });
        }
    };
    if !meta.is_dir() {
        return Ok(WalkOutput {
            entries: Vec::new(),
            roots: vec![WalkRoot {
                path: path.clone(),
                status: "unreadable".to_string(),
                skipped: 0,
            }],
            cancelled: false,
            complete: false,
            errors: vec![WalkError {
                path: path.clone(),
                code: "not_a_directory".to_string(),
            }],
        });
    }

    let path_owned = path.clone();
    let run_id_owned = run_id.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut state = WalkState {
            entries: Vec::new(),
            errors: Vec::new(),
            cancelled: false,
            truncated: false,
        };
        walk_recursive(
            Path::new(&path_owned),
            Path::new(&path_owned),
            &run_id_owned,
            &mut state,
        );
        let has_files = state.entries.iter().any(|e| !e.is_dir);
        let status = if state.truncated {
            "truncated"
        } else if has_files {
            "ok"
        } else {
            "empty"
        };
        WalkOutput {
            entries: state.entries,
            roots: vec![WalkRoot {
                path: path_owned,
                status: status.to_string(),
                skipped: state.errors.len() as u32,
            }],
            cancelled: state.cancelled,
            complete: !state.cancelled && !state.truncated && state.errors.is_empty(),
            errors: state.errors,
        }
    })
    .await
    .map_err(|e| format!("walker join failed: {e}"))?;

    if let Ok(mut set) = walk_cancels().lock() {
        set.remove(&run_id);
    }
    Ok(output)
}

#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("Failed to get app data dir: {e}"))
}

/// Reads `length` bytes from `path` starting at `offset`. Returns the bytes
/// as a Vec<u8>; the JS side wraps them in a Uint8Array for upload chunks.
///
/// This is the Rust-side replacement for `@tauri-apps/plugin-fs`'s `open()`
/// + `seek()` + `read()`. The JS plugin-fs is constrained by capability
/// scopes (`fs:allow-open` etc.) — for backup source folders the user picks
/// arbitrary paths that are NOT in any scope, so the plugin denies every
/// read. The Rust side runs with full filesystem access (Tauri's Rust
/// commands are not subject to the JS plugin-fs scope), so this command
/// works for any path the OS can read.
#[tauri::command]
async fn read_file_chunk(
    path: String,
    offset: u64,
    length: u64,
) -> Result<tauri::ipc::Response, String> {
    use std::io::{Read, Seek, SeekFrom};
    let path_owned = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = std::fs::File::open(&path_owned)
            .map_err(|e| format!("open({path_owned}) failed: {e}"))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| format!("seek({offset}) failed: {e}"))?;
        let mut buf = vec![0u8; length as usize];
        file.read_exact(&mut buf)
            .map_err(|e| format!("read({length} bytes @{offset}) failed: {e}"))?;
        Ok::<tauri::ipc::Response, String>(tauri::ipc::Response::new(buf))
    })
    .await
    .map_err(|e| format!("read_file_chunk join failed: {e}"))?
}

/// Native binary file writer that bypasses tauri-plugin-fs IPC quirks,
/// capability scope limits, and Windows WebView2 payload drops.
/// Automatically creates parent directories if needed.
#[tauri::command]
async fn write_file_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    use std::io::Write;
    let path_owned = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path_owned);
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut file = std::fs::File::create(p)
            .map_err(|e| format!("Failed to create file {path_owned}: {e}"))?;
        file.write_all(&data)
            .map_err(|e| format!("Failed to write data to {path_owned}: {e}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("write_file_binary task join error: {e}"))?
}

/// Appends or writes a chunk of binary data to disk.
/// Useful for chunked streaming writes of large files without memory spikes.
#[tauri::command]
async fn write_file_chunk(path: String, data: Vec<u8>, append: bool) -> Result<(), String> {
    use std::io::Write;
    let path_owned = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path_owned);
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(!append)
            .append(append)
            .open(p)
            .map_err(|e| format!("Failed to open file {path_owned}: {e}"))?;
        file.write_all(&data)
            .map_err(|e| format!("Failed to write chunk to {path_owned}: {e}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("write_file_chunk task join error: {e}"))?
}

/// Opens any file with the host system's default viewer application.
/// On desktop: uses OS-native commands (open/cmd/xdg-open).
/// On mobile: delegates to tauri-plugin-opener which maps to
///   - Android: ACTION_VIEW intent
///   - iOS: UIDocumentInteractionController
#[tauri::command]
fn open_file_in_system_viewer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(mobile)]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_path(&path, None::<&str>)
            .map_err(|e| format!("Failed to open file on mobile: {e}"))
    }
    #[cfg(not(mobile))]
    {
        // Suppress unused variable warning on mobile builds
        let _ = &app;
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &path])
                .spawn()
                .map_err(|e| format!("Failed to open file on Windows: {e}"))?;
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open file on macOS: {e}"))?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open file on Linux: {e}"))?;
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            Err("Unsupported operating system for opening files".to_string())
        }
    }
}

/// Launches the native Telegram app directly using OS-level commands or deep links,
/// preventing accidental fallback to web browsers on desktop and mobile.
#[tauri::command]
fn open_telegram_app(app: tauri::AppHandle, url: String) -> Result<(), String> {
    #[cfg(mobile)]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| format!("Failed to open Telegram app: {e}"))
    }
    #[cfg(not(mobile))]
    {
        let _ = &app;
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&url)
                .spawn()
                .map_err(|e| format!("Failed to launch Telegram on macOS: {e}"))?;
            Ok(())
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &url])
                .spawn()
                .map_err(|e| format!("Failed to launch Telegram on Windows: {e}"))?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&url)
                .spawn()
                .map_err(|e| format!("Failed to launch Telegram on Linux: {e}"))?;
            Ok(())
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Err("Unsupported operating system for launching Telegram".to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Build the Tauri application.
    // Some plugins are desktop-only (shell, process) because they rely on
    // system binaries that are not available in Android/iOS sandboxes.
    // The cfg(mobile) / cfg(not(mobile)) guards below ensure the correct
    // plugin set is registered at compile time for each target platform.
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Fixed salt for local vault key derivation
                let salt = b"teledrive-vault-salt-value";
                let params = argon2::Params::new(1024, 2, 1, Some(32)).unwrap();
                let argon2 = argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
                let mut output_key = [0u8; 32];
                argon2.hash_password_into(password.as_bytes(), salt, &mut output_key)
                    .expect("stronghold password hashing failed");
                output_key.to_vec()
            })
            .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // Desktop-only plugins: shell and process are not available on Android/iOS
    #[cfg(not(mobile))]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init());

    builder
        .invoke_handler(tauri::generate_handler![
            greet,
            log_vault_state,
            get_vault_state,
            save_session,
            load_session,
            clear_session,
            clear_session_only,
            save_vault_value,
            load_vault_value,
            delete_vault_value,
            quarantine_vault_value,
            load_backup_manifest,
            save_backup_manifest,
            append_backup_manifest_journal,
            quarantine_backup_manifest,
            start_backup_scheduler,
            stop_backup_scheduler,
            read_dir_recursive,
            cancel_backup_walk,
            get_app_data_dir,
            read_file_chunk,
            write_file_binary,
            write_file_chunk,
            open_file_in_system_viewer,
            open_telegram_app,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                #[cfg(not(mobile))]
                if let Some(window) = app.get_webview_window("TeleDrive") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "teledrive-{tag}-{}-{nanos}",
            std::process::id()
        ))
    }

    #[test]
    fn atomic_write_replaces_existing_file_without_leftover_temp() {
        let dir = temp_path("atomic");
        let path = dir.join("manifest.json");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, b"old").unwrap();

        atomic_write(&path, b"new").unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        let entries: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(entries.len(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_creates_missing_parent_directories() {
        let dir = temp_path("nested");
        let path = dir.join("a/b/manifest.json");

        atomic_write(&path, b"payload").unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "payload");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn manifest_generation_is_zero_when_file_is_missing() {
        let path = temp_path("missing").join("manifest.json");
        assert_eq!(manifest_generation_at(&path).unwrap(), 0);
    }

    #[test]
    fn manifest_generation_reads_the_persisted_value() {
        let dir = temp_path("generation");
        let path = dir.join("manifest.json");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, br#"{"generation":7}"#).unwrap();

        assert_eq!(manifest_generation_at(&path).unwrap(), 7);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
