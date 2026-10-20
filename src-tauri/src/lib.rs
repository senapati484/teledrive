use std::path::PathBuf;
use std::sync::OnceLock;
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

/// Saves a key-value pair to a vault file in the app data directory.
#[tauri::command]
fn save_vault_value(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
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
    
    std::fs::write(&vault_path, serde_json::to_string(&data).unwrap())
        .map_err(|e| format!("Failed to write vault file: {e}"))
}

/// Loads a value for a key from the vault file.
#[tauri::command]
fn load_vault_value(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
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
    let vault_path = get_vault_path(&app)?;
    if !vault_path.exists() {
        return Ok(());
    }
    let contents = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {e}"))?;
    let mut data: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse vault file: {e}"))?;

    data.remove(&key);

    std::fs::write(&vault_path, serde_json::to_string(&data).unwrap())
        .map_err(|e| format!("Failed to write vault file: {e}"))
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

    std::fs::write(&vault_path, serde_json::to_string(&data).unwrap())
        .map_err(|e| format!("Failed to write vault file: {e}"))
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
use std::path::Path;
use std::time::SystemTime;

#[derive(Serialize)]
struct DirEntry {
    abs_path: String,
    rel_path: String,
    is_dir: bool,
    size: u64,
    mtime_ms: u64,
}

fn unix_ms(t: SystemTime) -> u64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn walk_recursive(root: &Path, current: &Path, out: &mut Vec<DirEntry>) {
    let entries = match std::fs::read_dir(current) {
        Ok(it) => it,
        Err(err) => {
            eprintln!("[read_dir_recursive] read_dir({current:?}) failed: {err}");
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue, // skip non-UTF8 names
        };

        // Symlink check via metadata — read_link would also work but we
        // want to skip BEFORE stat so we don't follow the link.
        let meta = match std::fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(_) => continue, // dangling or unreadable — skip
        };

        let is_dir = meta.is_dir();
        let size = if is_dir { 0 } else { meta.len() };
        let mtime_ms = unix_ms(meta.modified().unwrap_or(SystemTime::UNIX_EPOCH));

        // Compute relPath relative to the source root.
        let rel_path = match path.strip_prefix(root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => file_name.clone(),
        };

        out.push(DirEntry {
            abs_path: path.to_string_lossy().into_owned(),
            rel_path,
            is_dir,
            size,
            mtime_ms,
        });

        // Recurse into directories. We push the dir entry FIRST so the JS
        // layer can prune it via exclude globs before processing children.
        if is_dir {
            walk_recursive(root, &path, out);
        }
    }
}

#[tauri::command]
async fn read_dir_recursive(app: tauri::AppHandle, path: String) -> Result<Vec<DirEntry>, String> {
    // On mobile, restrict directory walking to the app data directory only.
    // Android scoped storage (API 29+) prevents arbitrary filesystem access;
    // broad access requires SAF which must go through the dialog file picker.
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
    // Suppress unused-variable warning on desktop builds
    #[cfg(not(mobile))]
    let _ = &app;

    let root = Path::new(&path);
    let meta = std::fs::metadata(root).map_err(|e| format!("stat({path}) failed: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    // Run the walk on a blocking thread — std::fs::read_dir is sync and
    // can be slow on huge trees. Tokio would block the runtime otherwise.
    let path_owned = path.clone();
    let entries = tauri::async_runtime::spawn_blocking(move || {
        let mut out: Vec<DirEntry> = Vec::new();
        walk_recursive(Path::new(&path_owned), Path::new(&path_owned), &mut out);
        out
    })
    .await
    .map_err(|e| format!("walker join failed: {e}"))?;
    Ok(entries)
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
            start_backup_scheduler,
            stop_backup_scheduler,
            read_dir_recursive,
            read_file_chunk,
            write_file_binary,
            write_file_chunk,
            open_file_in_system_viewer,
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
