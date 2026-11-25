use serde::Serialize;
#[cfg(any(not(mobile), test))]
use serde::Deserialize;
#[cfg(any(not(mobile), test))]
use std::path::{Path, PathBuf};
use tauri::AppHandle;
#[cfg(any(not(mobile), test))]
use tauri::Manager;

#[cfg(any(not(mobile), test))]
const DESKTOP_SETTINGS_FILE: &str = "desktop_settings.json";

/// Persisted desktop startup preferences stored locally in `app_data_dir`.
/// Defaults safely to all features disabled (`false`).
#[cfg(any(not(mobile), test))]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopSettings {
    pub start_minimized_to_tray: bool,
}

/// Authoritative desktop startup state returned to the Settings UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStartupState {
    pub supported: bool,
    pub launch_at_login: bool,
    pub start_minimized_to_tray: bool,
}

#[cfg(any(not(mobile), test))]
fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(data_dir.join(DESKTOP_SETTINGS_FILE))
}

/// Reads `desktop_settings.json` safely, falling back to defaults when missing or invalid.
#[cfg(any(not(mobile), test))]
pub(crate) fn load_from_path(path: &Path) -> DesktopSettings {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return DesktopSettings::default();
    };
    serde_json::from_str::<DesktopSettings>(&contents).unwrap_or_default()
}

/// Persists `desktop_settings.json` atomically without restricting permissions further than user scope.
#[cfg(any(not(mobile), test))]
pub(crate) fn save_to_path(path: &Path, settings: &DesktopSettings) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(settings)
        .map_err(|e| format!("Failed to serialize desktop settings: {e}"))?;
    super::atomic_write_with_perms(path, &payload, false)
}

/// Synchronous read helper used during Tauri `.setup()` before building the initial window.
#[cfg(not(mobile))]
pub(crate) fn load_sync(app: &AppHandle) -> DesktopSettings {
    match settings_path(app) {
        Ok(path) => load_from_path(&path),
        Err(_) => DesktopSettings::default(),
    }
}

#[cfg(not(mobile))]
async fn query_autostart_enabled(app: &AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || app_handle.autolaunch().is_enabled())
        .await
        .map_err(|e| format!("Autostart check task join error: {e}"))?
        .map_err(|e| format!("Failed to query OS launch-at-login state: {e}"))
}

#[cfg(not(mobile))]
async fn build_desktop_state(app: &AppHandle, path: &Path) -> DesktopStartupState {
    let local = load_from_path(path);
    let launch_at_login = query_autostart_enabled(app).await.unwrap_or(false);
    DesktopStartupState {
        supported: true,
        launch_at_login,
        start_minimized_to_tray: local.start_minimized_to_tray,
    }
}

#[tauri::command]
pub async fn get_desktop_startup_settings(app: AppHandle) -> Result<DesktopStartupState, String> {
    #[cfg(not(mobile))]
    {
        let path = settings_path(&app)?;
        Ok(build_desktop_state(&app, &path).await)
    }

    #[cfg(mobile)]
    {
        let _ = app;
        Ok(DesktopStartupState {
            supported: false,
            launch_at_login: false,
            start_minimized_to_tray: false,
        })
    }
}

#[tauri::command]
pub async fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<DesktopStartupState, String> {
    #[cfg(not(mobile))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let app_handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mgr = app_handle.autolaunch();
            if enabled {
                mgr.enable()
            } else {
                mgr.disable()
            }
        })
        .await
        .map_err(|e| format!("Autostart update task join error: {e}"))?
        .map_err(|e| format!("Failed to update OS launch-at-login entry: {e}"))?;

        let path = settings_path(&app)?;
        Ok(build_desktop_state(&app, &path).await)
    }

    #[cfg(mobile)]
    {
        let _ = (app, enabled);
        Ok(DesktopStartupState {
            supported: false,
            launch_at_login: false,
            start_minimized_to_tray: false,
        })
    }
}

#[tauri::command]
pub async fn set_start_minimized_to_tray(
    app: AppHandle,
    enabled: bool,
) -> Result<DesktopStartupState, String> {
    #[cfg(not(mobile))]
    {
        let path = settings_path(&app)?;
        let path_for_write = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut settings = load_from_path(&path_for_write);
            settings.start_minimized_to_tray = enabled;
            save_to_path(&path_for_write, &settings)
        })
        .await
        .map_err(|e| format!("Desktop settings save task join error: {e}"))??;

        Ok(build_desktop_state(&app, &path).await)
    }

    #[cfg(mobile)]
    {
        let _ = (app, enabled);
        Ok(DesktopStartupState {
            supported: false,
            launch_at_login: false,
            start_minimized_to_tray: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_settings_path(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("teledrive-desktop-settings-{tag}-{nanos}"))
            .join(DESKTOP_SETTINGS_FILE)
    }

    #[test]
    fn missing_file_defaults_to_disabled() {
        let path = temp_settings_path("missing");
        let loaded = load_from_path(&path);
        assert_eq!(loaded, DesktopSettings { start_minimized_to_tray: false });
    }

    #[test]
    fn corrupt_json_falls_back_to_default() {
        let path = temp_settings_path("corrupt");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ invalid json").unwrap();

        let loaded = load_from_path(&path);
        assert_eq!(loaded, DesktopSettings { start_minimized_to_tray: false });

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn save_and_load_roundtrip_with_camel_case_schema() {
        let path = temp_settings_path("roundtrip");
        let enabled = DesktopSettings { start_minimized_to_tray: true };
        save_to_path(&path, &enabled).unwrap();

        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("\"startMinimizedToTray\": true"));
        assert_eq!(load_from_path(&path), enabled);

        let disabled = DesktopSettings { start_minimized_to_tray: false };
        save_to_path(&path, &disabled).unwrap();
        assert_eq!(load_from_path(&path), disabled);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
