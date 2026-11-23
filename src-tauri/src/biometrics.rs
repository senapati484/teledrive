use serde::Serialize;

#[derive(Serialize)]
pub struct BiometricInfo {
    pub available: bool,
    pub biometry_type: String, // "touch_id", "face_id", "optic_id", "windows_hello", "system_password", "none"
}

#[cfg(target_os = "macos")]
extern "C" {
    fn teledrive_can_authenticate_biometrics(out_biometry_type: *mut i32) -> bool;
    fn teledrive_authenticate_device_owner(reason_utf8: *const std::os::raw::c_char) -> bool;
}

#[tauri::command]
pub async fn check_biometrics_available() -> Result<BiometricInfo, String> {
    #[cfg(target_os = "macos")]
    {
        let mut biometry_type_code: i32 = 0;
        let available = unsafe { teledrive_can_authenticate_biometrics(&mut biometry_type_code) };
        let biometry_type = match biometry_type_code {
            1 => "touch_id",
            2 => "face_id",
            4 => "optic_id",
            _ => {
                if available {
                    "system_password"
                } else {
                    "none"
                }
            }
        };
        Ok(BiometricInfo {
            available,
            biometry_type: biometry_type.to_string(),
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(BiometricInfo {
            available: false,
            biometry_type: "none".to_string(),
        })
    }
}

#[tauri::command]
pub async fn authenticate_device_owner(reason: Option<String>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let reason_str = reason.unwrap_or_else(|| "Unlock TeleDrive".to_string());
        let c_reason = std::ffi::CString::new(reason_str)
            .map_err(|e| format!("Invalid UTF-8 in reason: {e}"))?;

        let success = tauri::async_runtime::spawn_blocking(move || {
            unsafe { teledrive_authenticate_device_owner(c_reason.as_ptr()) }
        })
        .await
        .map_err(|e| format!("Task join error: {e}"))?;

        Ok(success)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = reason;
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_biometrics_returns_valid_info() {
        let info = tauri::async_runtime::block_on(check_biometrics_available())
            .expect("query succeeds");
        #[cfg(target_os = "macos")]
        {
            assert!(info.available);
            assert!(matches!(
                info.biometry_type.as_str(),
                "touch_id" | "face_id" | "optic_id" | "system_password"
            ));
        }
        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(info.biometry_type, "none");
        }
    }
}

