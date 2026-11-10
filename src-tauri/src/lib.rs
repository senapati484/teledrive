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
    atomic_write(&session_path, json.to_string().as_bytes())
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
    atomic_write(&session_path, parsed.to_string().as_bytes())
        .map_err(|e| format!("Failed to write session file: {e}"))
}

static VAULT_LOCK: Mutex<()> = Mutex::new(());

fn lock_vault() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    VAULT_LOCK
        .lock()
        .map_err(|_| "vault lock poisoned".to_string())
}

/// Restrict a file to the current user (mode 0600 on Unix). Vault and session
/// files contain Telegram credentials, so they must never be group/world
/// readable. No-op on Windows where the app data directory is already ACL'd
/// to the current user.
fn restrict_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to restrict permissions on {}: {e}", path.display()))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn temp_sibling(path: &Path, suffix: &str) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("no parent directory for {}", path.display()))?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    Ok(parent.join(format!(".{name}.{suffix}")))
}

/// Write bytes by replacing the destination with a synced temp file.
/// `rename` is atomic on Unix; on Windows it can fail when the destination
/// exists, so fall back to copy + remove without deleting the old file first.
/// When `private` is true the temp and destination are restricted to the
/// current user (mode 0600 on Unix), which is required for credential files.
fn atomic_write_with_perms(path: &Path, bytes: &[u8], private: bool) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("no parent directory for {}", path.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
    let tmp = temp_sibling(path, &format!("tmp-{}", std::process::id()))?;
    let write_result = (|| -> Result<(), String> {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp)
            .map_err(|e| format!("Failed to create {}: {e}", tmp.display()))?;
        if private {
            restrict_permissions(&tmp)?;
        }
        file.write_all(bytes)
            .map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync {}: {e}", tmp.display()))?;
        Ok(())
    })();
    if let Err(err) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(err);
    }
    if let Err(rename_err) = std::fs::rename(&tmp, path) {
        std::fs::copy(&tmp, path).map_err(|copy_err| {
            let _ = std::fs::remove_file(&tmp);
            format!(
                "Failed to replace {}: rename={rename_err}; copy={copy_err}",
                path.display()
            )
        })?;
        let _ = std::fs::remove_file(&tmp);
    }
    if private {
        restrict_permissions(path)?;
    }
    Ok(())
}

/// Write credential files atomically with owner-only permissions.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    atomic_write_with_perms(path, bytes, true)
}

/// Saves a key-value pair to a vault file in the app data directory.
#[tauri::command]
fn save_vault_value(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let _guard = lock_vault()?;
    let vault_path = get_vault_path(&app)?;
    let mut data = if vault_path.exists() {
        let contents = std::fs::read_to_string(&vault_path)
            .map_err(|e| format!("Failed to read vault file: {e}"))?;
        // Never silently replace a corrupt vault with an empty map: that would
        // destroy every other stored credential on the next save.
        serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&contents)
            .map_err(|e| format!("Vault file is corrupt (refusing to overwrite): {e}"))?
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
        // Never trust the frontend for allocation size. Uploads use 512 KiB
        // chunks, so 8 MiB is a generous ceiling that prevents an OOM/DoS
        // from a compromised or buggy webview.
        const MAX_CHUNK: u64 = 8 * 1024 * 1024;
        let length = length.min(MAX_CHUNK);
        let mut file = std::fs::File::open(&path_owned)
            .map_err(|e| format!("open({path_owned}) failed: {e}"))?;
        let file_len = file
            .metadata()
            .map_err(|e| format!("metadata({path_owned}) failed: {e}"))?
            .len();
        if offset > file_len || offset.saturating_add(length) > file_len {
            return Err(format!(
                "read({length} bytes @{offset}) is out of bounds for {path_owned} ({file_len} bytes)"
            ));
        }
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

/// Streams `path` in 512 KiB chunks and returns the lowercase hex SHA-256.
/// Used by the backup runner to detect touch-only changes without sending
/// the file to Telegram again.
fn hash_file_sync(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("open({}) failed: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 512 * 1024];
    loop {
        let read = file
            .read(&mut buf)
            .map_err(|e| format!("read({}) failed: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
async fn hash_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || hash_file_sync(Path::new(&path)))
        .await
        .map_err(|e| format!("hash_file join failed: {e}"))?
}

/// Native binary file writer that bypasses tauri-plugin-fs IPC quirks,
/// capability scope limits, and Windows WebView2 payload drops.
/// Automatically creates parent directories if needed.
#[tauri::command]
async fn write_file_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    let path_owned = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Atomic replace: a crash mid-write leaves the previous file intact
        // instead of a truncated cache entry.
        atomic_write_with_perms(std::path::Path::new(&path_owned), &data, false)
    })
    .await
    .map_err(|e| format!("write_file_binary task join error: {e}"))?
}

/// Pure-Rust RFC 4648 base64 decoder used for compact binary chunk IPC payloads
/// (especially over Android WebView postMessage where raw binary bodies fall back to JSON).
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn val(b: u8) -> Option<u8> {
        match b {
            b'A'..=b'Z' => Some(b - b'A'),
            b'a'..=b'z' => Some(b - b'a' + 26),
            b'0'..=b'9' => Some(b - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let bytes: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if bytes.len() % 4 != 0 {
        return Err("Invalid base64 length".to_string());
    }

    let mut out = Vec::with_capacity((bytes.len() / 4) * 3);
    for (idx, chunk) in bytes.chunks_exact(4).enumerate() {
        let is_last = idx + 1 == bytes.len() / 4;
        let a = val(chunk[0]).ok_or_else(|| "Invalid base64 character".to_string())?;
        let b = val(chunk[1]).ok_or_else(|| "Invalid base64 character".to_string())?;
        let c = if chunk[2] == b'=' {
            if !is_last || chunk[3] != b'=' {
                return Err("Invalid base64 padding".to_string());
            }
            None
        } else {
            Some(val(chunk[2]).ok_or_else(|| "Invalid base64 character".to_string())?)
        };
        let d = if chunk[3] == b'=' {
            if !is_last {
                return Err("Invalid base64 padding".to_string());
            }
            None
        } else {
            Some(val(chunk[3]).ok_or_else(|| "Invalid base64 character".to_string())?)
        };

        out.push((a << 2) | (b >> 4));
        if let Some(c_val) = c {
            out.push((b << 4) | (c_val >> 2));
            if let Some(d_val) = d {
                out.push((c_val << 6) | d_val);
            }
        }
    }
    Ok(out)
}

#[cfg(target_os = "android")]
fn content_uri_handles() -> &'static Mutex<std::collections::HashMap<String, std::fs::File>> {
    static HANDLES: OnceLock<Mutex<std::collections::HashMap<String, std::fs::File>>> =
        OnceLock::new();
    HANDLES.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

#[cfg(target_os = "android")]
fn open_content_uri_modes(
    app: &AppHandle,
    url: &tauri::Url,
    candidates: &[tauri_plugin_fs::OpenOptions],
) -> Result<std::fs::File, String> {
    use tauri_plugin_fs::FsExt;
    let mut last_err = String::new();
    for opts in candidates {
        match app
            .fs()
            .open(tauri_plugin_fs::FilePath::Url(url.clone()), opts.clone())
        {
            Ok(file) => return Ok(file),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!(
        "Failed to open content URI {}: {}",
        url, last_err
    ))
}

/// Streams a chunk directly to an Android SAF `content://` URI by holding one open
/// descriptor per active transfer instead of repeatedly re-opening with `wa`/`wt`
/// (which Android 11–16 Downloads/MediaProvider SAF frequently rejects).
#[cfg(target_os = "android")]
fn write_content_uri_chunk_sync(
    app: &AppHandle,
    uri_str: &str,
    data: &[u8],
    append: bool,
    done: bool,
    discard: bool,
    sync: bool,
) -> Result<(), String> {
    use std::io::{Seek, SeekFrom, Write};

    let url = tauri::Url::parse(uri_str)
        .map_err(|e| format!("Invalid content URI {uri_str}: {e}"))?;
    let handles = content_uri_handles();

    if discard {
        let existing = handles.lock().map(|mut m| m.remove(uri_str)).ok().flatten();
        if let Some(file) = existing {
            let _ = file.set_len(0);
            drop(file);
            return Ok(());
        }
        let mut trunc_opts = tauri_plugin_fs::OpenOptions::new();
        trunc_opts.write(true).truncate(true);
        let mut w_opts = tauri_plugin_fs::OpenOptions::new();
        w_opts.write(true);
        if let Ok(file) = open_content_uri_modes(app, &url, &[trunc_opts, w_opts]) {
            let _ = file.set_len(0);
        }
        return Ok(());
    }

    let mut file = if append {
        let existing = handles
            .lock()
            .map_err(|_| "Content URI lock poisoned".to_string())?
            .remove(uri_str);
        if let Some(f) = existing {
            f
        } else {
            let mut wa_opts = tauri_plugin_fs::OpenOptions::new();
            wa_opts.write(true).append(true);
            let mut rw_opts = tauri_plugin_fs::OpenOptions::new();
            rw_opts.read(true).write(true);
            let mut w_opts = tauri_plugin_fs::OpenOptions::new();
            w_opts.write(true);
            let mut f = open_content_uri_modes(app, &url, &[wa_opts, rw_opts, w_opts])?;
            let _ = f.seek(SeekFrom::End(0));
            f
        }
    } else {
        if let Ok(mut guard) = handles.lock() {
            guard.remove(uri_str);
        }
        let mut w_opts = tauri_plugin_fs::OpenOptions::new();
        w_opts.write(true);
        let mut rw_opts = tauri_plugin_fs::OpenOptions::new();
        rw_opts.read(true).write(true);
        let mut wt_opts = tauri_plugin_fs::OpenOptions::new();
        wt_opts.write(true).truncate(true);
        let mut f = open_content_uri_modes(app, &url, &[w_opts, rw_opts, wt_opts])?;
        let _ = f.seek(SeekFrom::Start(0));
        let _ = f.set_len(0);
        f
    };

    if !data.is_empty() {
        file.write_all(data)
            .map_err(|e| format!("Failed to write chunk to {uri_str}: {e}"))?;
    }

    if done {
        file.flush()
            .map_err(|e| format!("Failed to flush {uri_str}: {e}"))?;
        // Some Android SAF DocumentProviders expose pipe-backed descriptors where fsync returns EINVAL/ENOTSUP.
        let _ = file.sync_all();
        drop(file);
    } else {
        if sync {
            let _ = file.flush();
        }
        handles
            .lock()
            .map_err(|_| "Content URI lock poisoned".to_string())?
            .insert(uri_str.to_string(), file);
    }
    Ok(())
}

/// Normalizes a filesystem path string, converting `file://` URLs into local paths.
fn normalize_local_file_path(path: &str) -> Result<PathBuf, String> {
    if path.starts_with("file://") {
        let url = tauri::Url::parse(path)
            .map_err(|e| format!("Invalid file URL {path}: {e}"))?;
        return url
            .to_file_path()
            .map_err(|_| format!("Cannot convert file URL to local path: {path}"));
    }
    Ok(PathBuf::from(path))
}

/// Appends or writes a chunk of binary data to disk.
/// The first chunk truncates a private temp file, subsequent chunks append to
/// it, and the final chunk (`done = true`) atomically renames it over the
/// destination. A crash therefore never leaves a half-written file at `path`.
///
/// `discard = true` removes the temp file and leaves the destination untouched
/// (used when a download is cancelled or fails), and `sync = false` skips the
/// per-chunk fsync so streaming a large file only pays for it once at the end.
fn write_file_chunk_sync(
    path: &str,
    data: &[u8],
    append: bool,
    done: bool,
    discard: bool,
    sync: bool,
) -> Result<(), String> {
    use std::io::Write;
    let p = normalize_local_file_path(path)?;
    let tmp = temp_sibling(&p, "part")?;
    if discard {
        return match std::fs::remove_file(&tmp) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Failed to discard {}: {e}", tmp.display())),
        };
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!append)
        .append(append)
        .open(&tmp)
        .map_err(|e| format!("Failed to open temp file {}: {e}", tmp.display()))?;
    if !data.is_empty() {
        file.write_all(data)
            .map_err(|e| format!("Failed to write chunk to {}: {e}", tmp.display()))?;
    }
    if sync {
        file.sync_all()
            .map_err(|e| format!("Failed to sync {}: {e}", tmp.display()))?;
    }
    drop(file);
    if done {
        if let Err(rename_err) = std::fs::rename(&tmp, &p) {
            std::fs::copy(&tmp, &p).map_err(|copy_err| {
                let _ = std::fs::remove_file(&tmp);
                format!(
                    "Failed to finalize {}: rename={rename_err}; copy={copy_err}",
                    p.display()
                )
            })?;
            let _ = std::fs::remove_file(&tmp);
        }
    }
    Ok(())
}

#[tauri::command]
async fn write_file_chunk(
    #[allow(unused)] app: AppHandle,
    path: String,
    data: Option<Vec<u8>>,
    data_b64: Option<String>,
    append: bool,
    done: Option<bool>,
    discard: Option<bool>,
    sync: Option<bool>,
) -> Result<(), String> {
    let done = done.unwrap_or(false);
    let discard = discard.unwrap_or(false);
    let sync = sync.unwrap_or(true);
    let bytes = if let Some(b64) = data_b64 {
        decode_base64(&b64)?
    } else {
        data.unwrap_or_default()
    };

    if path.starts_with("content://") {
        #[cfg(target_os = "android")]
        return tauri::async_runtime::spawn_blocking(move || {
            write_content_uri_chunk_sync(&app, &path, &bytes, append, done, discard, sync)
        })
        .await
        .map_err(|e| format!("write_file_chunk content URI task join error: {e}"))?;

        #[cfg(not(target_os = "android"))]
        return Err("content:// URIs are only supported on Android".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        write_file_chunk_sync(&path, &bytes, append, done, discard, sync)
    })
    .await
    .map_err(|e| format!("write_file_chunk task join error: {e}"))?
}

fn preview_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app_local_data_dir: {e}"))?;
    let dir = base.join("preview_cache");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create preview_cache dir: {e}"))?;
    Ok(dir)
}

fn sanitize_preview_cache_filename(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("preview.bin");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()
            {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('.').trim();
    if trimmed.is_empty() {
        "preview.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
fn get_preview_cache_path(app: AppHandle, file_name: String) -> Result<String, String> {
    let root = preview_cache_root(&app)?;
    let safe = sanitize_preview_cache_filename(&file_name);
    Ok(root.join(safe).to_string_lossy().into_owned())
}

#[tauri::command]
fn check_preview_cache(
    app: AppHandle,
    file_name: String,
    expected_size: Option<u64>,
) -> Result<Option<String>, String> {
    let root = preview_cache_root(&app)?;
    let safe = sanitize_preview_cache_filename(&file_name);
    let path = root.join(safe);
    let Ok(meta) = std::fs::metadata(&path) else {
        return Ok(None);
    };
    if !meta.is_file() || meta.len() == 0 {
        return Ok(None);
    }
    if let Some(expected) = expected_size {
        if expected > 0 && meta.len() != expected {
            return Ok(None);
        }
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn cleanup_preview_cache(
    app: AppHandle,
    max_bytes: Option<u64>,
    max_part_age_secs: Option<u64>,
) -> Result<(), String> {
    let root = preview_cache_root(&app)?;
    let max_bytes = max_bytes.unwrap_or(1_536 * 1024 * 1024);
    let max_part_age = Duration::from_secs(max_part_age_secs.unwrap_or(3600));

    tauri::async_runtime::spawn_blocking(move || {
        let Ok(entries) = std::fs::read_dir(&root) else {
            return Ok(());
        };
        let now = std::time::SystemTime::now();
        let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
        let mut total_bytes: u64 = 0;

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            let is_part = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.contains(".part"))
                .unwrap_or(false);
            if is_part {
                if let Ok(age) = now.duration_since(modified) {
                    if age > max_part_age {
                        let _ = std::fs::remove_file(&path);
                    }
                }
                continue;
            }
            let len = meta.len();
            total_bytes = total_bytes.saturating_add(len);
            files.push((path, len, modified));
        }

        if total_bytes > max_bytes {
            files.sort_by_key(|(_, _, modified)| *modified);
            for (path, len, _) in files {
                if total_bytes <= max_bytes {
                    break;
                }
                if std::fs::remove_file(&path).is_ok() {
                    total_bytes = total_bytes.saturating_sub(len);
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("cleanup_preview_cache join error: {e}"))?
}

/// Opens any file with the host system's default viewer application.
/// Uses tauri-plugin-opener on every platform so we never route a
/// user/Telegram-controlled filename through a shell (`cmd /C start`), which
/// is vulnerable to command injection on Windows.
#[tauri::command]
fn open_file_in_system_viewer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| format!("Failed to open file in system viewer: {e}"))
}

/// Launches the native Telegram app via its registered deep-link handler.
/// Uses tauri-plugin-opener (ShellExecute on Windows) instead of `cmd`.
#[tauri::command]
fn open_telegram_app(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Failed to open Telegram app: {e}"))
}

#[cfg(not(mobile))]
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("TeleDrive") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Desktop shell behaviour: closing the window keeps the process alive in the
/// system tray so uploads/downloads and scheduled backups keep running.
/// Quitting only happens through the tray menu (or Cmd+Q / app exit).
#[cfg(not(mobile))]
fn setup_desktop_shell(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show_item = MenuItem::with_id(app, "show", "Open TeleDrive", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit TeleDrive", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    if let Some(window) = app.get_webview_window("TeleDrive") {
        let handle = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = handle.hide();
            }
        });
    }

    Ok(())
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
            hash_file,
            write_file_binary,
            write_file_chunk,
            get_preview_cache_path,
            check_preview_cache,
            cleanup_preview_cache,
            open_file_in_system_viewer,
            open_telegram_app,
        ])
        .setup(|app| {
            #[cfg(not(mobile))]
            setup_desktop_shell(app)?;

            #[cfg(debug_assertions)]
            {
                #[cfg(not(mobile))]
                if let Some(window) = app.get_webview_window("TeleDrive") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_main_window(_app_handle);
            }
        })
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
    fn hash_file_matches_known_sha256_vector() {
        let dir = temp_path("hash");
        let path = dir.join("abc.txt");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, b"abc").unwrap();

        assert_eq!(
            hash_file_sync(&path).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
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

    #[test]
    fn chunked_write_appends_until_finalized() {
        let dir = temp_path("chunks");
        let path = dir.join("download.bin");
        let path_str = path.to_str().unwrap();

        write_file_chunk_sync(path_str, b"hello ", false, false, false, false).unwrap();
        write_file_chunk_sync(path_str, b"world", true, false, false, false).unwrap();

        assert!(!path.exists(), "destination must stay untouched until done");
        write_file_chunk_sync(path_str, b"", true, true, false, true).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello world");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn discarding_a_chunked_write_leaves_the_destination_untouched() {
        let dir = temp_path("discard");
        let path = dir.join("download.bin");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, b"existing").unwrap();
        let path_str = path.to_str().unwrap();

        write_file_chunk_sync(path_str, b"partial", false, false, false, false).unwrap();
        write_file_chunk_sync(path_str, b"", true, false, true, false).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "existing");
        let entries: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(entries.len(), 1, "temp file must be removed");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn decode_base64_decodes_valid_and_padded_inputs() {
        assert_eq!(decode_base64("").unwrap(), b"");
        assert_eq!(decode_base64("Zg==").unwrap(), b"f");
        assert_eq!(decode_base64("Zm8=").unwrap(), b"fo");
        assert_eq!(decode_base64("Zm9v").unwrap(), b"foo");
        assert_eq!(decode_base64("SGVs bG8s\nIHdvcmxkIQ==").unwrap(), b"Hello, world!");
        assert!(decode_base64("abc").is_err());
        assert!(decode_base64("ab*=").is_err());
    }

    #[test]
    fn sanitize_preview_cache_filename_strips_traversal_and_unsafe_chars() {
        assert_eq!(sanitize_preview_cache_filename("../../etc/passwd"), "passwd");
        assert_eq!(
            sanitize_preview_cache_filename("123_clip:2026*final?.mkv"),
            "123_clip_2026_final_.mkv"
        );
        assert_eq!(sanitize_preview_cache_filename("..."), "preview.bin");
    }
}
