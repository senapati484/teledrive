<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Unbegrenzter persönlicher Cloud-Speicher, betrieben über deinen privaten Telegram-Kanal.**  
Keine Serverkosten. Keine monatlichen Abos. Direkte MTProto-Verschlüsselung direkt zu Telegram.

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Gesamte Downloads](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Neueste Version](https://img.shields.io/badge/Release-v0.1.2-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.2/)
[![YouTube Demo](https://img.shields.io/badge/YouTube-Video%20Demo-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![Lizenz: GPL v3](https://img.shields.io/badge/Lizenz-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**Webseite**](https://teledrive.space) • [**Downloads**](#-downloads) • [**Beta Testing Poll 🧪**](https://github.com/senapati484/teledrive/discussions/35) • [**Video-Demo**](#-video-demo) • [**Fehler melden**](https://github.com/senapati484/teledrive/issues/new/choose) • [**Funktion vorschlagen**](https://github.com/senapati484/teledrive/issues/new/choose)

</div>

---

## 🎬 Video-Demo

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="TeleDrive Demo Video" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ Auf YouTube ansehen: „I Turned Telegram Into Unlimited Cloud Storage“](https://youtu.be/4AiMn7HSlFg)**  
*Vollständige Demonstration: direktes MTProto-Streaming, mehrseitiger PDF-Viewer, CSV-Tabellenanalyse, integrierter CodeMirror 6 Code-Editor und automatische Verzeichnis-Backups.*

</div>

---

## 💡 Warum TeleDrive?

Telegram bietet in privaten Kanälen praktisch unbegrenzten Cloud-Speicher, jedoch ohne Ordnerhierarchie, virtuellen Katalog oder klassischen Desktop-Drive-Workflow. **TeleDrive** schließt diese Lücke:

- **Keine Zwischenserver**: Sämtliche Dateiübertragungen und MTProto-Verbindungen laufen direkt von Ihrem lokalen Computer zu den Telegram-Rechenzentren.
- **Virtuelles Laufwerk**: Verschachtelte Ordner, Sofortsuche, Favoriten, Archiv und Papierkorb werden in einem angehefteten Katalog in Ihrem Kanal verwaltet.
- **Hardware-verschlüsselter Tresor**: Sitzungsschlüssel und Zugangsdaten werden mit Argon2id-abgeleiteten Schlüsseln sicher in Tauri Stronghold abgelegt.
- **Multi-Account**: Nahtloses Umschalten zwischen mehreren Telefonnummern mit vollständiger Sitzungsisolierung.

---

## 📥 Downloads

Aktuelle Version: **v0.1.2** · Vorkompilierte native Installationsprogramme für alle gängigen Betriebssysteme:

| Betriebssystem | Paketformat | Direkter Download | Dateigröße |
|:---|:---|:---|---:|
| **Windows** | Setup-Installer (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive-setup.exe/download) | 5.5 MB |
| **Windows** | MSI-Paket (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.msi/download) | 7.2 MB |
| **macOS** | Universal Disk Image (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.dmg/download) | 15.8 MB |
| **Linux** | Universal AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.AppImage/download) | 86.1 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.deb/download) | 8.4 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.rpm/download) | 8.0 MB |

> 🌐 Vollständige Paketübersicht, Mirror-Links und Prüfsummen sind auf [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) oder [**teledrive.space**](https://teledrive.space) abrufbar.

---

## ✨ Features

- **Echter unbegrenzter Speicher**: Nutzt Ihren privaten Telegram-Kanal als Cloud-Backend ohne wiederkehrende Gebühren.
- **Nativ und plattformübergreifend**: Schlanke Anwendung für macOS, Windows und Linux, entwickelt mit Tauri v2 und Rust.
- **Direktes MTProto-Streaming**: Die GramJS-Engine überträgt 512-KB-Blöcke parallel über bis zu 4 Upload-Threads.
- **Datenschutz an erster Stelle**: Keine Tracker, keine Telemetriedaten, keine Zwischenstationen. Ihre Daten bleiben privat zwischen Ihnen und Telegram.
- **Integrierte Werkzeuge**: Durchgehender PDF-Betrachter, interaktive CSV-Inspektion und CodeMirror 6 Editor für über 20 Programmiersprachen.

---

## ⚙️ Funktionsweise

```
┌─────────────────────────────────────────────────────────────────┐
│                      React 19 Frontend                          │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │    Zustand State    │             │    GramJS Client    │   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                           Direktes MTProto
       (Bridge-Aufrufe)                       (Sicheres TLS 443)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Tauri Rust Core     │              │   Telegram Cloud API   │
│  ┌───────────────────┐  │              │    (Privater Kanal)    │
│  │ Stronghold Vault  │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **Direktverbindung**: Authentifiziert sich über den sicheren TLS-Port 443 direkt bei den Telegram-MTProto-Servern.
2. **Chunk-Uploads**: Große Dateien werden in 512-KB-Segmente aufgeteilt und simultan gestreamt.
3. **Angehefteter Katalog**: Hält einen verschlüsselten JSON-Verzeichnisbaum im Kanal synchron für alle Geräte.

---

## 🧪 Beta Testers Wanted!

We are looking for beta testers to help test upcoming releases, performance enhancements, and new features:

> 🗳️ **Community Poll:**  
> **👉 [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35)**  
> Vote in our community poll, share your feedback, and get early access to pre-release builds!

## 🚀 Erste Schritte

### 🛠️ Schnellstart für Entwickler & Mitwirkende

TeleDrive ist 100% Open-Source und sofort einsatzbereit. Vorkonfigurierte Entwicklungs-Zugangsdaten sind bereits integriert, sodass Sie in unter 2 Minuten mitwirken können, ohne eine eigene Telegram-App erstellen zu müssen.

#### 1. Repository klonen
```bash
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

#### 2. Abhängigkeiten installieren
```bash
npm install
```
> ℹ️ *Der `postinstall`-Hook wendet automatisch die für Tauri und Webbrowser erforderlichen GramJS-MTProto-Kompatibilitätspatches (`scripts/patch-telegram.cjs`) an.*

#### 3. Entwicklungsserver starten
```bash
# Desktop-Applikation mit Tauri v2 Hot-Reloading starten:
npm run tauri dev

# Oder Web-Vorschau im Browser ausführen:
npm run dev
```

---

### 📋 Systemvoraussetzungen

- **Node.js**: `>= 18.0.0` (`v20+` LTS empfohlen)
- **Rust**: Aktuelle stabile Version (`rustup default stable`)
- **Build-Tools**:
  - **macOS**: `xcode-select --install`
  - **Linux (Debian/Ubuntu)**: `sudo apt update && sudo apt install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Linux (Fedora/RHEL)**: `sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel`
  - **Windows**: Microsoft Visual Studio C++ Build Tools & WebView2

---

### 🧪 Tests & Verifizierung

```bash
# Vitest Testsuite ausführen
npm test

# TypeScript-Typen und Vite-Build prüfen
npm run build

# Rust Backend-Kompilierung prüfen
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### 🔑 Telegram API-Zugangsdaten (Optional)

TeleDrive enthält bereits eingebaute Zugangsdaten für die lokale Entwicklung. Wenn Sie Ihre eigenen Telegram-API-Daten verwenden möchten:
1. Melden Sie sich unter [**my.telegram.org**](https://my.telegram.org) an.
2. Erstellen Sie unter **API development tools** eine Anwendung (z. B. `TeleDrive-Dev`).
3. Kopieren Sie `api_id` und `api_hash`.
4. Tragen Sie diese in TeleDrive unter **Einstellungen → API-Konfiguration** ein oder erstellen Sie eine `.env`-Datei:
   ```env
   VITE_TELEGRAM_API_ID=your_api_id
   VITE_TELEGRAM_API_HASH=your_api_hash
   ```

---

### 📦 Fertige Installationsprogramme für Endbenutzer

Wenn Sie TeleDrive als Endbenutzer verwenden möchten, laden Sie die Installationsdatei für Ihr Betriebssystem aus der obigen [**Download-Tabelle**](#-downloads) herunter. Richtlinien für Pull Requests finden Sie in unserem [**Contributing Guide (CONTRIBUTING.md)**](../CONTRIBUTING.md).
---

## ⌨️ Tastaturkürzel

| Tastenkürzel | Aktion |
|:---|:---|
| `/` oder `⌘ F` | Suchleiste fokussieren |
| `⌘ A` | Alle Elemente im Ordner auswählen |
| `⌘ D` | Ausgewählte Dateien herunterladen |
| `F2` | Ausgewähltes Element umbenennen |
| `Backspace` / `Del` | In den Papierkorb verschieben |
| `Esc` | Auswahl aufheben / Suche schließen |
| `?` | Tastaturkürzel-Übersicht anzeigen |

---

## 🤝 Mitwirken

Beiträge, Problemmeldungen und Pull Requests sind herzlich willkommen!

- 🧪 **Beta Testing**: [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35) — Vote in the community poll!
1. Forken Sie das Repository und erstellen Sie einen Branch: `git checkout -b feat/mein-feature`
2. Linter ausführen: `npm run lint` und `cargo fmt`
3. Semantische Commits erstellen (z. B. `feat(ui): ...`)
4. Einen Pull Request eröffnen

---

## 📜 Lizenz

TeleDrive ist freie und quelloffene Software unter der [GNU GPL-3.0 License](../LICENSE).

*Haftungsausschluss: TeleDrive ist ein unabhängiges Open-Source-Projekt und steht in keiner Verbindung zu Telegram FZ-LLC. Die Speicherung großer Datenmengen unterliegt den Nutzungsbedingungen und API-Richtlinien von Telegram.*

---

<div align="center">

Erstellt mit ❤️ von **[Senapati484](https://github.com/senapati484)**

Wenn Ihnen TeleDrive gefällt, vergeben Sie gerne einen Stern ⭐ auf [GitHub](https://github.com/senapati484/teledrive)!

</div>
