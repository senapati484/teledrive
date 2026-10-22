<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Penyimpanan cloud pribadi tak terbatas, didukung oleh saluran privat Telegram Anda sendiri.**  
Tanpa biaya server. Tanpa biaya langganan bulanan. Enkripsi MTProto langsung ke Telegram.

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Total Unduhan](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Rilis Terbaru](https://img.shields.io/badge/rilis-v0.1.2-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.2/)
[![Demo YouTube](https://img.shields.io/badge/YouTube-Video%20Demo-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![Lisensi: GPL v3](https://img.shields.io/badge/lisensi-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![Bintang GitHub](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**Situs Web**](https://teledrive.space) • [**Unduhan**](#-unduhan) • [**Demo Video**](#-panduan-video--demo) • [**Laporkan Bug**](https://github.com/senapati484/teledrive/issues/new/choose) • [**Minta Fitur Baru**](https://github.com/senapati484/teledrive/issues/new/choose)

</div>

---

## 🎬 Panduan Video & Demo

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="Video Demo TeleDrive" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ Tonton di YouTube: "I Turned Telegram Into Unlimited Cloud Storage"](https://youtu.be/4AiMn7HSlFg)**  
*Panduan video lengkap yang menampilkan streaming berkas langsung via MTProto, penampil PDF multi-halaman, inspeksi CSV interaktif, editor kode CodeMirror 6, dan pencadangan direktori otomatis.*

</div>

---

## 💡 Mengapa TeleDrive?

Telegram menyediakan penyimpanan cloud gratis yang hampir tak terbatas di saluran privat, namun tidak memiliki hierarki folder, katalog virtual, dan alur kerja drive desktop. **TeleDrive** menjembatani kesenjangan tersebut:

- **Nol Server Perantara**: Semua operasi berkas dan koneksi MTProto terjadi langsung dari perangkat lokal Anda ke pusat data Telegram.
- **Drive Virtual**: Folder bersarang, pencarian instan, berkas berbintang, arsip, dan tempat sampah diindeks dalam katalog terenkripsi yang disematkan di saluran pribadi Anda.
- **Brankas Terenkripsi Perangkat Keras**: Kredensial dan kunci sesi diamankan di Tauri Stronghold menggunakan kunci turunan Argon2id.
- **Multi-Akun**: Beralih di antara beberapa nomor telepon dengan isolasi sesi dan brankas lokal yang menyeluruh.

---

## 📥 Unduhan

Versi terbaru: **v0.1.2** · Berkas biner native siap pakai untuk semua sistem operasi utama:

| Sistem Operasi | Format Paket | Tautan Unduhan Langsung | Ukuran |
|:---|:---|:---|---:|
| **Windows** | Setup Installer (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive-setup.exe/download) | 5.5 MB |
| **Windows** | Paket MSI (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.msi/download) | 7.2 MB |
| **macOS** | Universal Disk Image (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.dmg/download) | 15.8 MB |
| **Linux** | Universal AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.AppImage/download) | 86.1 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.deb/download) | 8.4 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.rpm/download) | 8.0 MB |

> 🌐 Katalog paket lengkap, tautan cermin (mirror), dan checksum tersedia di [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) atau [**teledrive.space**](https://teledrive.space).

---

## ✨ Fitur Utama

- **Penyimpanan Cloud Tanpa Batas**: Menggunakan saluran privat Telegram Anda sebagai media penyimpanan tanpa biaya berulang.
- **Ringan & Multiplatform Asli**: Dibangun di atas Tauri v2 + Rust untuk kecepatan peluncuran tinggi dan penggunaan memori yang rendah (< 250 MB).
- **Streaming MTProto Langsung**: Engine GramJS melakukan transmisi langsung pecahan 512 KB dengan dukungan hingga 4 thread unggahan bersamaan.
- **Privasi Terjamin**: Tanpa pelacak, tanpa telemetri, tanpa server perantara. Berkas hanya berpindah antara Anda dan Telegram.
- **Peralatan Bawaan Profesional**: Pembaca PDF multi-halaman, pengurutan tabel CSV interaktif, dan editor kode CodeMirror 6 dengan penyorotan sintaks untuk 20+ bahasa.

---

## ⚙️ Cara Kerja

```
┌─────────────────────────────────────────────────────────────────┐
│                       Frontend React 19                         │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │    Status Zustand   │             │     Mesin GramJS    │   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                           MTProto Langsung
       (Panggilan Biner)                     (Aman via TLS 443)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Tauri Rust Core     │              │    Cloud API Telegram  │
│  ┌───────────────────┐  │              │     (Saluran Privat)   │
│  │ Brankas Stronghold│  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **Koneksi Langsung**: Mengautentikasi langsung dengan server MTProto resmi Telegram melalui port aman TLS 443.
2. **Unggahan Media Terfragmentasi**: Membagi berkas besar menjadi segmen 512 KB dan mengirimkannya secara paralel.
3. **Indeks Katalog Tersemat**: Mempertahankan indeks JSON terenkripsi yang disematkan di saluran pribadi Anda untuk sinkronisasi antardisk lintas perangkat.

---

## 🧪 Beta Testers Wanted!

We are looking for beta testers to help test upcoming releases, performance enhancements, and new features:

> 🗳️ **Community Poll:**  
> **👉 [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35)**  
> Vote in our community poll, share your feedback, and get early access to pre-release builds!

## 🚀 Memulai

### 🛠️ Panduan Cepat untuk Pengembang & Kontributor

TeleDrive adalah proyek open-source 100% dan sangat mudah dijalankan secara lokal. Kredensial pengembangan bawaan sudah disertakan sehingga Anda dapat mulai berkontribusi dalam waktu kurang dari 2 menit tanpa perlu membuat aplikasi pengembang Telegram kustom.

#### 1. Kloning Repositori
```bash
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

#### 2. Instal Dependensi
```bash
npm install
```
> ℹ️ *Hook `postinstall` secara otomatis menerapkan patch kompatibilitas GramJS MTProto (`scripts/patch-telegram.cjs`) yang dibutuhkan oleh Tauri dan browser.*

#### 3. Jalankan Server Pengembangan
```bash
# Jalankan aplikasi desktop dengan hot-reloading Tauri v2:
npm run tauri dev

# Atau jalankan pratinjau web di browser:
npm run dev
```

---

### 📋 Prasyarat Sistem

- **Node.js**: `>= 18.0.0` (`v20+` LTS disarankan)
- **Rust**: Versi stabil terbaru (`rustup default stable`)
- **Peralatan Kompilasi Sistem**:
  - **macOS**: `xcode-select --install`
  - **Linux (Debian/Ubuntu)**: `sudo apt update && sudo apt install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Linux (Fedora/RHEL)**: `sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel`
  - **Windows**: Microsoft Visual Studio C++ Build Tools & WebView2

---

### 🧪 Pengujian & Verifikasi

```bash
# Jalankan rangkaian tes Vitest
npm test

# Verifikasi tipe TypeScript dan bundel Vite
npm run build

# Verifikasi kompilasi backend Rust
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### 🔑 Kredensial API Telegram (Opsional)

TeleDrive menyertakan kredensial default untuk pengujian lokal. Jika Anda ingin menggunakan kredensial API Telegram Anda sendiri:
1. Masuk ke [**my.telegram.org**](https://my.telegram.org) dengan nomor telepon Anda.
2. Buka **API development tools** dan buat aplikasi baru (contoh: `TeleDrive-Dev`).
3. Salin `api_id` dan `api_hash`.
4. Masukkan ke dalam TeleDrive di menu **Pengaturan → Konfigurasi API**, atau buat file `.env`:
   ```env
   VITE_TELEGRAM_API_ID=your_api_id
   VITE_TELEGRAM_API_HASH=your_api_hash
   ```

---

### 📦 Penginstal Siap Pakai untuk Pengguna Akhir

Jika Anda hanya ingin menggunakan TeleDrive tanpa mengompilasi dari kode sumber, unduh paket penginstal yang sesuai untuk sistem operasi Anda dari [**tabel unduhan**](#-unduhan) di atas. Untuk pedoman kontribusi, lihat [**Contributing Guide (CONTRIBUTING.md)**](../CONTRIBUTING.md).
---

## ⌨️ Pintasan Papan Ketik

| Pintasan | Tindakan |
|:---|:---|
| `/` atau `⌘ F` | Fokus pada bilah pencarian |
| `⌘ A` | Pilih semua berkas di folder |
| `⌘ D` | Unduh berkas yang dipilih |
| `F2` | Ganti nama item yang dipilih |
| `Backspace` / `Del` | Pindahkan item yang dipilih ke Tempat Sampah |
| `Esc` | Hapus pilihan / batalkan pencarian |
| `?` | Buka daftar pintasan papan ketik |

---

## 🤝 Berkontribusi

Kami menyambut baik pelaporan bug, ide fitur baru, dan Pull Request!

- 🧪 **Beta Testing**: [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35) — Vote in the community poll!
1. Fork repositori ini dan buat branch Anda: `git checkout -b feat/fitur-saya`
2. Jalankan linter: `npm run lint` dan `cargo fmt`
3. Buat pesan commit yang jelas (contoh: `feat(ui): ...`)
4. Ajukan Pull Request

---

## 📜 Lisensi

TeleDrive adalah perangkat lunak sumber terbuka yang dilisensikan di bawah [GNU GPL-3.0 License](../LICENSE).

*Pemberitahuan: TeleDrive adalah proyek open-source independen dan tidak berafiliasi, disponsori, atau didukung oleh Telegram FZ-LLC. Penyimpanan berkas berukuran besar tunduk pada Syarat Layanan dan kebijakan penggunaan wajar API Telegram.*

---

<div align="center">

Dibuat dengan ❤️ oleh **[Senapati484](https://github.com/senapati484)**

Jika Anda menyukai TeleDrive, berikan ⭐ di [GitHub](https://github.com/senapati484/teledrive)!

</div>
