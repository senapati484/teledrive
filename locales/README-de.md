<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Unbegrenzter persönlicher Cloud-Speicher, betrieben über deinen privaten Telegram-Kanal.**  
Keine Serverkosten. Keine monatlichen Abos. Direkte MTProto-Verschlüsselung direkt zu Telegram.

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**简体中文**](README-zh-CN.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Gesamte Downloads](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Neueste Version](https://img.shields.io/badge/Release-v0.1.1-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.1/)
[![YouTube Demo](https://img.shields.io/badge/YouTube-Video%20Demo-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![Lizenz: GPL v3](https://img.shields.io/badge/Lizenz-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**Webseite**](https://teledrive.space) • [**Downloads**](#-downloads) • [**Video-Demo**](#-video-demo) • [**Fehler melden**](https://github.com/senapati484/teledrive/issues/new) • [**Funktion vorschlagen**](https://github.com/senapati484/teledrive/issues/new)

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

Aktuelle Version: **v0.1.1** · Vorkompilierte native Installationsprogramme für alle gängigen Betriebssysteme:

| Betriebssystem | Paketformat | Direkter Download | Dateigröße |
|:---|:---|:---|---:|
| **Windows** | Setup-Installer (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive-setup.exe/download) | 5.5 MB |
| **Windows** | MSI-Paket (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.msi/download) | 7.2 MB |
| **macOS** | Universal Disk Image (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.dmg/download) | 15.8 MB |
| **Linux** | Universal AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.AppImage/download) | 86.1 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.deb/download) | 8.4 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.rpm/download) | 8.0 MB |

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

## 🚀 Erste Schritte

### 1. Telegram API-Zugangsdaten anfordern

1. Melden Sie sich unter [my.telegram.org](https://my.telegram.org) mit Ihrer Handynummer an.
2. Öffnen Sie **API development tools** und erstellen Sie eine App (z. B. `TeleDrive`).
3. Kopieren Sie `api_id` und `api_hash` und geben Sie diese beim ersten Start von TeleDrive ein.

### 2. Aus dem Quellcode ausführen

**Voraussetzungen:**
- [Rust & Cargo](https://rustup.rs/) (1.78+)
- [Node.js](https://nodejs.org/) (20.19+ oder 22.12+)

```bash
# Repository klonen
git clone https://github.com/senapati484/teledrive.git
cd teledrive

# Abhängigkeiten installieren
npm install

# Desktop-App im Entwicklungsmodus starten
npm run tauri dev
```

### 3. Release-Installationspakete erstellen

```bash
npm run tauri build
```
Die erstellten Installationsprogramme (`.dmg`, `.exe` / `.msi`, `.deb` / `.AppImage`) liegen anschließend im Verzeichnis `src-tauri/target/release/bundle/`.

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
