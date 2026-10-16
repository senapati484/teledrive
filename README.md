<div align="center">

<img src="src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Unlimited personal cloud storage, powered by your own private Telegram channel.**  
Zero server costs. Zero subscriptions. Direct MTProto encryption straight to Telegram.

[**English**](README.md) • [**Português (Brasil)**](locales/README-pt-BR.md) • [**Español**](locales/README-es.md) • [**简体中文**](locales/README-zh-CN.md) • [**Русский**](locales/README-ru.md) • [**日本語**](locales/README-ja.md) • [**Deutsch**](locales/README-de.md)

[![Total Downloads](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Latest Release](https://img.shields.io/badge/release-v0.1.1-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.1/)
[![YouTube Walkthrough](https://img.shields.io/badge/YouTube-Video%20Demo-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-gray.svg?style=flat-square)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**Website**](https://teledrive.space) • [**Downloads**](#-downloads) • [**Video Demo**](#-video-walkthrough--demo) • [**Report a Bug**](https://github.com/senapati484/teledrive/issues/new) • [**Request a Feature**](https://github.com/senapati484/teledrive/issues/new)

</div>

---

## 🎬 Video Walkthrough & Demo

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="TeleDrive Demo Video" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ Watch on YouTube: "I Turned Telegram Into Unlimited Cloud Storage"](https://youtu.be/4AiMn7HSlFg)**  
*Full video walkthrough demonstrating direct MTProto file streaming, multi-page PDF viewing, CSV inspection, CodeMirror 6 code editor, and automated directory backups.*

</div>

---

## 💡 Why TeleDrive?

Telegram offers virtually unlimited cloud storage in private channels, but lacks a folder hierarchy, virtual catalog, and drive-style desktop workflow. **TeleDrive** bridges that gap:

- **Zero Relay Backend**: All file operations and MTProto connections happen directly from your local machine to Telegram data centers.
- **Virtual Drive**: Nested directories, search, starred files, archive, and trash are indexed in a pinned catalog inside your channel.
- **Hardware-Encrypted Vault**: Credentials and session keys are locked in Tauri Stronghold using Argon2id-derived keys.
- **Multi-Account**: Switch between multiple phone numbers with complete session and local vault isolation.

---

## 📥 Downloads

Latest release: **v0.1.1** · Pre-compiled native binaries for all major operating systems:

| OS | Package Format | Direct Download | Size |
|:---|:---|:---|---:|
| **Windows** | Setup Installer (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive-setup.exe/download) | 5.5 MB |
| **Windows** | MSI Package (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.msi/download) | 7.2 MB |
| **macOS** | Universal Disk Image (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.dmg/download) | 15.8 MB |
| **Linux** | Universal AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.AppImage/download) | 86.1 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.deb/download) | 8.4 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.rpm/download) | 8.0 MB |

> 🌐 Full package catalog, mirror links, and checksums are available on [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) or [**teledrive.space**](https://teledrive.space).

---

## ✨ Features

- **Unlimited Cloud**: Uses your private Telegram channel as the backing store with 0 recurring fees.
- **Native Cross-Platform**: Ultra-lightweight binaries for macOS, Windows, and Linux built on Tauri v2.
- **Direct MTProto Streaming**: GramJS engine streams 512 KB chunks directly with up to 4 concurrent upload threads.
- **Privacy-First**: No TeleDrive tracking, telemetry, or middleman servers. Your files stay between you and Telegram.
- **Instant Search & Organization**: Breadcrumbs, file type filters, grid/list view, and keyboard navigation.

---

## ⚙️ How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                       React 19 Frontend                         │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │    Zustand State    │             │ GramJS Client Engine│   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
          Tauri IPC                           Direct MTProto
        (Bridge Calls)                       (Secure SSL/TLS)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Tauri Rust Core     │              │   Telegram Cloud API   │
│  ┌───────────────────┐  │              │  (Private Channel)     │
│  │ Stronghold Vault  │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **Direct Connection**: Authenticates directly with Telegram's MTProto servers over TLS port 443.
2. **Chunked Media Upload**: Slices large files into 512 KB fragments streamed concurrently.
3. **Pinned Catalog Index**: Maintains an encrypted JSON descriptor catalog pinned to your private channel for directory navigation across devices.

---

## 🚀 Getting Started

### 1. Obtain Telegram API Credentials

1. Sign in to [my.telegram.org](https://my.telegram.org) with your phone number.
2. Open **API development tools** and create an app (e.g. `TeleDrive`).
3. Copy your `api_id` and `api_hash` and enter them upon first launching TeleDrive.

### 2. Run from Source

**Prerequisites:**
- [Rust & Cargo](https://rustup.rs/) (1.78+)
- [Node.js](https://nodejs.org/) (20.19+ or 22.12+)

```bash
# Clone the repository
git clone https://github.com/senapati484/teledrive.git
cd teledrive

# Install dependencies
npm install

# Launch desktop app in development mode
npm run tauri dev
```

### 3. Build Release Binaries

```bash
npm run tauri build
```
Compiled native installers (`.dmg`, `.exe` / `.msi`, `.deb` / `.AppImage`) will be generated under `src-tauri/target/release/bundle/`.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|:---|:---|
| `/` or `⌘ F` | Focus search bar |
| `⌘ A` | Select all items in folder |
| `⌘ D` | Download selected items |
| `F2` | Rename selected item |
| `Backspace` / `Del` | Move selected item to Trash |
| `Esc` | Clear selection / blur search |
| `?` | Open keyboard cheat sheet |

---

## 🤝 Contributing

We welcome issues, feedback, and pull requests!

1. Fork the repo and create your branch: `git checkout -b feat/my-feature`
2. Run linters: `npm run lint` and `cargo fmt`
3. Commit with semantic commit messages (e.g., `feat(ui): ...`)
4. Open a Pull Request

---

## 📜 License

TeleDrive is open-source software licensed under the [GNU GPL-3.0 License](./LICENSE).

*Disclaimer: TeleDrive is an independent open-source project and is not affiliated with, sponsored by, or endorsed by Telegram FZ-LLC. Storing large volumes of files is subject to Telegram's Terms of Service and API fair-use policies.*

---

<div align="center">

Created with ❤️ by **[Senapati484](https://github.com/senapati484)**

If you like TeleDrive, give it a ⭐ on [GitHub](https://github.com/senapati484/teledrive)!

</div>
