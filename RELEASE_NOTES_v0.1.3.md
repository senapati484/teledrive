# 🚀 TeleDrive v0.1.3 — Mobile Bottom Sheet UX, Multi-Platform Hardening & Complete Localization

TeleDrive v0.1.3 is a major stability and user-experience release delivering responsive native bottom sheets on mobile, enhanced batch backup durability, hardened iOS & Android packaging pipelines, and seamless 11-language localized parity.

---

## 🌟 What's New in v0.1.3

### 📱 1. Mobile Experience & Bottom Sheet UX
- **Native Bottom Sheets**: Redesigned dialogs (including What's New and Star Prompt) into native iOS/Android bottom sheets (`max-h-[88dvh]`, `rounded-t-[28px]`, dynamic safe-area insets).
- **Zero Viewport Clipping**: Responsive button layouts (`w-full sm:w-auto`), natural line breaking (`break-words`), and fluid scrolling on small mobile screens while maintaining elegant centered modals on desktop.
- **Gesture Navigation**: Touch-optimized preview gestures for photos, documents, and code files.

### 🛡️ 2. Storage Engine & Batch Backup Hardening
- **FLOOD_WAIT Cascade Elimination**: Re-engineered batch backups with debounced index synchronization, incremental transaction queues, and graceful Telegram rate-limit cooldown recovery.
- **Differential Backup Hashing**: Skip unchanged files automatically using SHA-256 content hashes, saving bandwidth and transfer time.
- **Remote Delete Synchronization**: Real-time propagation of remote file deletions with automated rollback safeguards.

### 📦 3. CI/CD & Multi-Platform Packaging
- **Direct iOS IPA Packaging**: Fixed Xcode packaging and added strict artifact validation (`> 5MB`), ensuring direct IPA installation on physical iOS devices alongside the iOS Simulator archive.
- **Android Gradle Upgrades**: Updated Android build pipelines to Tauri 2.12 with NDK resilience and optimized APK footprint (~47.6 MB).
- **Universal Desktop Builds**: Automated production packaging for macOS (Universal Apple Silicon & Intel DMG), Windows (NSIS Setup & Enterprise MSI), and Linux (AppImage, DEB, RPM).

### 🌐 4. 100% Localization Parity across 11 Languages
- Complete key parity and native human translations across all 11 supported languages:
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

---

## 💾 Downloads & Packages (5 Platforms)

| Platform | Package File | Direct Download | Format | Size | Architecture / Compatibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **macOS** | `teledrive.dmg` | [Download](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.dmg/download) | DMG | 14.9 MB | Universal (Apple Silicon & Intel) |
| **Windows Setup** | `teledrive-setup.exe` | [Download](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-setup.exe/download) | NSIS EXE | 6.0 MB | Windows 10/11 64-bit |
| **Windows MSI** | `teledrive.msi` | [Download](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.msi/download) | MSI | 7.5 MB | Windows Enterprise Installer |
| **Linux (AppImage)** | `teledrive.AppImage` | [Download](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.AppImage/download) | AppImage | 85.9 MB | Universal Linux 64-bit (glibc 2.31+) |
| **Linux (Debian/Ubuntu)** | `teledrive.deb` | [Download](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.deb/download) | DEB | 7.7 MB | Debian, Ubuntu, Linux Mint |
| **Linux (Fedora/RHEL)** | `teledrive.rpm` | [Download](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.rpm/download) | RPM | 7.7 MB | Fedora, RHEL, openSUSE |
| **Android** | `teledrive.apk` | [Download](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.apk/download) | APK | 47.6 MB | Android 8.0+ Universal |
| **iOS (Direct IPA)** | `teledrive.ipa` | [Download](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.ipa/download) | IPA | 24.4 MB | iOS 15.0+ (AltStore / TrollStore) |
| **iOS (Simulator)** | `teledrive-ios-simulator.zip` | [Download](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-ios-simulator.zip/download) | ZIP | 24.4 MB | iOS Simulator (x86_64 / arm64) |

---

## 🔒 Verification & Checksums (SHA-256)

```text
30d878eb7a3bf0c4a87574cb474e16c3d8e7f039c4a1711e550a2b0dde63d3fa  teledrive-ios-simulator.zip
a88e12046dfde5a5591c07ce44de59e80ac303cba2eac3ba65cf2d1a187d533a  teledrive-setup.exe
2e7ca293858875097d8e40aece73513dd743bf3fccb43e3c07ff156c2b977ef7  teledrive.AppImage
0d481d33a5588b2352a4bfb1b6eff6f2e0854e4b0e9ae39501cdc63b71738cce  teledrive.apk
391d18daa75c19f126c89f3a98f6782567300988d807eab635b5d157f43b443b  teledrive.deb
ddbe39cec27793de436a8b91557b4d50c1691102cfe0b0ddfa64c974b71a5c12  teledrive.dmg
c63422f089b858c5437b09dc78f579bbb2aab5e81d38376fa7d916654da46214  teledrive.ipa
365b3de549e344056f7980ee0ace946d6d0221b91ac067d8beb1f2f06a0679e7  teledrive.msi
5a9cc52739e0f729f52152772771d8adcc17aed88b02b713577dfd90e81b07c8  teledrive.rpm
```

---

- **Official Website**: [https://www.teledrive.space](https://www.teledrive.space)
- **SourceForge Project**: [https://sourceforge.net/projects/teledrive/](https://sourceforge.net/projects/teledrive/)
- **Source Code**: [https://github.com/senapati484/teledrive](https://github.com/senapati484/teledrive)
- **License**: GNU General Public License v3.0 (GPLv3)
