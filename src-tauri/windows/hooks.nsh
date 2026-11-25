; Custom Tauri NSIS lifecycle hooks for TeleDrive on Windows.
; Removes runtime-created startup registry values on true uninstall while
; preserving them across silent/interactive upgrades ($UpdateMode = 1).

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "TeleDrive"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "TeleDrive"
    DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "TeleDrive"
    DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "TeleDrive"
    ClearErrors
  ${EndIf}
!macroend
