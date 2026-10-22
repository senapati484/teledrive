# 🚀 TeleDrive v0.1.2 — 5 Platforms & 11 Localized Languages

TeleDrive v0.1.2 is a major release introducing official **Android & iOS mobile packages**, complete native support for **11 localized languages**, QR code login, a 1-tap Telegram launcher, and major storage engine optimizations.

---

## 🌟 What's New in v0.1.2

### 📱 1. Mobile Platform Support (Android & iOS)
- **Android APK**: Native Tauri 2.0 Android package (`teledrive.apk`). Optimized APK build size from 562MB down to ~31–45MB with full background runtime support.
- **iOS Package (`.ipa`)**: Direct `.ipa` packaging and simulator build support for iPhone and iPad devices.
- **Mobile UX & Gestures**: Integrated Google Drive Material You design patterns, touch gestures for image previews (pinch/zoom/swipe), and dynamic safe-area insets.

### 🌐 2. 11 Localized Built-in Languages
Full 100% key parity across 11 languages with in-app language switcher across login, navigation, and settings:
1. 🇺🇸 **English** (`en`)
2. 🇧🇷 **Português (Brasil)** (`pt-BR`)
3. 🇪🇸 **Español** (`es`)
4. 🇮🇳 **हिन्दी (Hindi)** (`hi`)
5. 🇨🇳 **简体中文 (Simplified Chinese)** (`zh-CN`)
6. 🇹🇼 **繁體中文 (Traditional Chinese)** (`zh-TW`)
7. 🇷🇺 **Русский (Russian)** (`ru`)
8. 🇫🇷 **Français (French)** (`fr`)
9. 🇩🇪 **Deutsch (German)** (`de`)
10. 🇯🇵 **日本語 (Japanese)** (`ja`)
11. 🇮🇩 **Bahasa Indonesia** (`id`)

### ⚡ 3. Authentication & UX Overhaul
- **Telegram QR Code Login**: Log in by scanning a dynamic QR code directly from your mobile Telegram app.
- **1-Tap Telegram App Launcher**: Seamlessly open the official Telegram app to retrieve your login OTP without manual app switching.
- **Flexible OTP Verification**: Dynamic verification field handling both 5-digit and 6-digit Telegram login codes.
- **Friendly Rate Limiting**: Graceful mapping of Telegram `FLOOD_WAIT` errors into clear, human-readable cooldown countdowns.

### 🗄️ 4. Storage & Virtual Drive Engine
- **Live Speed & ETA**: Real-time upload speed and remaining time estimation for large file transfers.
- **Index Save Optimization**: Eliminated virtual filesystem index save bottlenecks via in-memory diffing, dynamic chunking, and serialized commits.
- **HEIC Image Previews**: Direct previewing of Apple HEIC/HEIF photo formats alongside standard PNG/JPEG/WebP/GIF.
- **External System Open**: Seamlessly hand off any stored file to native OS default viewers.

### 🛠️ 5. In-App Desktop Workstation Suite
- **Multi-Page PDF Viewer**: High-DPI canvas rendering with continuous vertical scrolling and 50%–300% zoom controls.
- **Interactive CSV Studio**: Tabular data explorer with real-time substring search, asc/desc column sorting, and paginated records.
- **CodeMirror 6 IDE**: In-app developer workstation supporting 20+ programming languages, bracket pairing, and split Markdown HTML previews.
- **Instant Media Streaming**: Byte-range partial streaming for 4K video (MP4/MKV/WebM) and lossless audio (FLAC/MP3/WAV).
- **Background Directory Backup**: Multithreaded Rust folder crawler with SHA-256 differential manifests and collision-free epoch synchronization.

---

## 💾 Downloads & Packages (5 Platforms)

| Platform | Package File | Format | Architecture |
| :--- | :--- | :--- | :--- |
| **macOS** | `teledrive.dmg` / `TeleDrive_0.1.2_universal.dmg` | DMG | Universal (Apple Silicon & Intel) |
| **Windows Setup** | `teledrive-setup.exe` / `TeleDrive_0.1.2_x64-setup.exe` | NSIS EXE | Windows 10/11 64-bit |
| **Windows MSI** | `teledrive.msi` / `TeleDrive_0.1.2_x64_en-US.msi` | MSI | Windows Enterprise Installer |
| **Linux (AppImage)** | `teledrive.AppImage` / `TeleDrive_0.1.2_amd64.AppImage` | AppImage | Universal Linux 64-bit |
| **Linux (Debian/Ubuntu)** | `teledrive.deb` / `TeleDrive_0.1.2_amd64.deb` | DEB | Debian, Ubuntu, Linux Mint |
| **Linux (Fedora/RHEL)** | `teledrive.rpm` | RPM | Fedora, RHEL, openSUSE |
| **Android** | `teledrive.apk` | APK | Android 8.0+ Universal |
| **iOS** | `teledrive.ipa` | IPA | iOS 15.0+ |

---

## 🔒 Verification & Checksums (SHA-256)

```text
05797dcca05decc6ae463a560535ddd6cd013cd941b100e15e89351de6472745  teledrive-ios-simulator.zip
3cfe950e5d64d80c8733586198bd6136fdfc19c3dcde0ee516b5e08eb7ba9491  teledrive-setup.exe
a13e910d62262038bca5203ca652636c738f78f55f25210d60a01c6aadee02dd  teledrive.AppImage
8368b7899484ccf820607df315071e86546c5c94c0534b7d1bf2eb081437cda8  teledrive.apk
fec9e1596ec35d49bebdbbae4579f2abdacb13bdde73156109cf3a4ac57286d2  teledrive.deb
dfb353e361336ebbb8921982aa190b1a4e765f987d6558535582d837e2c3b633  teledrive.dmg
1ee38b2ae8900fdb5a9dbe7d2aded8ad04f719a048400453b02f009cd305c779  teledrive.ipa
fc433cf302a739b8a39a0ac95f85a86e6c2c9ad9e3fc11ae1eae89a49d52cbe3  teledrive.msi
11ce69e7001fe62c8547f5b74f4237bfd3b57b49f723e5d9ad9a58e3200a7fe1  teledrive.rpm
```

---

- **Official Website**: [https://www.teledrive.space](https://www.teledrive.space)
- **Source Code**: [https://github.com/senapati484/teledrive](https://github.com/senapati484/teledrive)
- **License**: GNU General Public License v3.0 (GPLv3)
