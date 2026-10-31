# 🛡️ TeleDrive v0.1.3 — Security Hardening, Sync Integrity & Stability

TeleDrive v0.1.3 is an essential stability, reliability, and security release featuring hardened production Content Security Policies (CSP), atomic credential storage, SHA-256 virtual filesystem directory identifiers, remote sync epoch protections, and comprehensive code quality optimizations.

---

## 🌟 What's New in v0.1.3

### 🔒 1. Security Hardening & Zero-Trust Isolation
- **Production Content Security Policy (CSP)**: Hardened production CSP restricting script execution strictly to verified sources (`'self'`), eliminated `'unsafe-eval'`, and decoupled dev-only tooling into dedicated development builds.
- **Atomic 0600 File Permissions**: Cryptographic session strings and vault state files written by the Rust engine are now strictly bound to `0600` Unix file permissions (`read/write owner only`), preventing unauthorized local process inspection.
- **Safe External Handlers**: Replaced legacy shell-invoked command handlers (`cmd /C start`) with native OS dispatchers via `tauri-plugin-opener` with strict URL scheme allowlisting (`https://t.me`, `tg:`).
- **Hardened Mobile Networking**: Explicitly disabled Android `usesCleartextTraffic` in release builds to guarantee all MTProto and web transports use TLS/encrypted endpoints.

### 🗄️ 2. Storage & Virtual Filesystem Integrity
- **SHA-256 Folder ID Generation**: Replaced truncated base64 path hashes with full 32-character SHA-256 digests in folder generation, completely eliminating directory ID collisions across nested folder structures.
- **Deduplication Safeguards**: Hardened file deduplication logic using content hash validation and retry-orphan detection to ensure distinct files sharing names or attributes are never prematurely purged.
- **Safe Chunked File Operations**: Clamped filesystem chunk reads in Rust to an enforced 8 MiB maximum and introduced temporary file writes with atomic renames for cache downloads to prevent corrupted partial files.
- **Zero-Byte File Upload Protection**: Added client-side and background runner guards to gracefully handle and skip empty (0-byte) files without failing upload queues.

### 🔄 3. Remote Sync & Multi-Device Coordination
- **Epoch Generation Tokens**: Remote sync cycles now maintain monotonically increasing epoch tokens with staleness checks, preventing out-of-order updates from racing base index states.
- **Session-Aware Sync Timers**: Integrated logout state listeners into `RemoteSyncOrchestrator` to automatically halt Rust background sync timers when user sessions terminate.

### 🖥️ 4. Desktop UX & Workstation Enhancements
- **Live Preview File Refresh**: Saving edits in the CodeMirror 6 text editor or markdown suite immediately updates the active preview modal state and file tree without needing manual page reloads.
- **Modal Accessibility & Shortcuts**: File preview modals now implement full WAI-ARIA dialog attributes (`role="dialog"`, `aria-modal="true"`), Escape key dismissals, memory-leak-free pointer listeners, and global drive keyboard shortcut suppression while modals are open.
- **Zero Linter & Compiler Diagnostics**: Cleaned up all language server warnings, typed configuration parameters, and configured workspace-level TSServer scoping.

---

## 💾 Downloads & Packages (5 Platforms)

| Platform | Package File | Format | Architecture |
| :--- | :--- | :--- | :--- |
| **macOS** | `teledrive.dmg` / `TeleDrive_0.1.3_universal.dmg` | DMG | Universal (Apple Silicon & Intel) |
| **Windows Setup** | `teledrive-setup.exe` / `TeleDrive_0.1.3_x64-setup.exe` | NSIS EXE | Windows 10/11 64-bit |
| **Windows MSI** | `teledrive.msi` / `TeleDrive_0.1.3_x64_en-US.msi` | MSI | Windows Enterprise Installer |
| **Linux (AppImage)** | `teledrive.AppImage` / `TeleDrive_0.1.3_amd64.AppImage` | AppImage | Universal Linux 64-bit |
| **Linux (Debian/Ubuntu)** | `teledrive.deb` / `TeleDrive_0.1.3_amd64.deb` | DEB | Debian, Ubuntu, Linux Mint |
| **Linux (Fedora/RHEL)** | `teledrive.rpm` | RPM | Fedora, RHEL, openSUSE |
| **Android** | `teledrive.apk` | APK | Android 8.0+ Universal |
| **iOS** | `teledrive.ipa` | IPA | iOS 15.0+ |

---

## 🔍 Verification & Integrity Checks

All native bundles, unit tests, and cross-platform compilation targets pass cleanly with 100% test coverage for core storage and encryption primitives:
```bash
npm test      # 26 test files / 192 tests passing
npm run build # Clean production build
cargo check   # Clean Rust engine check (0 warnings, 0 errors)
```
