<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Penyimpanan cloud pribadi tak terbatas, didukung oleh saluran privat Telegram Anda sendiri.**  
Tanpa biaya server. Tanpa biaya langganan bulanan. Enkripsi MTProto langsung ke Telegram.

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Total Unduhan](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Rilis Terbaru](https://img.shields.io/badge/rilis-v0.1.3-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.3/)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Featured-FF6154.svg?style=flat-square&logo=producthunt&logoColor=white)](https://www.producthunt.com/products/teledrive-3)
[![Demo YouTube](https://img.shields.io/badge/YouTube-Video%20Demo-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![Lisensi: GPL v3](https://img.shields.io/badge/lisensi-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![Bintang GitHub](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

<br/>

<a href="https://www.producthunt.com/products/teledrive-3?utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-teledrive-3" target="_blank" rel="noopener noreferrer">
  <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1293880&theme=light" alt="TeleDrive - Unlimited Telegram cloud drive across 5 platforms. | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
</a>

<br/><br/>

<a href="https://sourceforge.net/projects/teledrive/" target="_blank" rel="noopener noreferrer">
  <img src="https://b.sf-syn.com/badge_img/4107869/oss-community-choice-black?achievement=oss-community-choice" alt="SourceForge Community Choice Award" width="115" />
</a>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<a href="https://sourceforge.net/projects/teledrive/" target="_blank" rel="noopener noreferrer">
  <img src="https://b.sf-syn.com/badge_img/4107869/oss-users-love-us-black" alt="SourceForge Users Love Us Award" width="115" />
</a>

<br/><br/>

[**Situs Web**](https://teledrive.space) • [**Product Hunt 🚀**](https://www.producthunt.com/products/teledrive-3) • [**Unduhan**](#-unduhan) • [**Jajak Pendapat Beta Testing 🧪**](https://github.com/senapati484/teledrive/discussions/35) • [**Demo Video**](#-panduan-video--demo) • [**Laporkan Bug**](https://github.com/senapati484/teledrive/issues/new/choose) • [**Minta Fitur Baru**](https://github.com/senapati484/teledrive/issues/new/choose)

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

Versi terbaru: **v0.1.3** · Berkas biner native siap pakai untuk semua 5 platform:

| Sistem Operasi | Format Paket | Tautan Unduhan Langsung | Arsitektur / Kompatibilitas | Ukuran |
|:---|:---|:---|:---|---:|
| **Windows** | Setup Installer (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-setup.exe/download) | x64 64-Bit (Windows 10 / 11) | 6.0 MB |
| **Windows** | Paket MSI (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.msi/download) | Installer Enterprise (Win 10 / 11) | 7.7 MB |
| **macOS** | Universal Disk Image (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.dmg/download) | Apple Silicon (M1–M4) & Intel x64 | 14.9 MB |
| **Linux** | Universal AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.AppImage/download) | Portabel mandiri (glibc 2.31+) | 85.9 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.deb/download) | x86_64 / amd64 | 7.7 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.rpm/download) | x86_64 / amd64 | 7.7 MB |
| **Android** | APK Universal (`.apk`) | [**teledrive.apk**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.apk/download) | Android 8.0+ (ARM64, ARMv7a, x86_64) | 47.6 MB |
| **iOS** | Paket Sideload (`.ipa`) | [**teledrive.ipa**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.ipa/download) | iOS 15.0+ (AltStore / TrollStore) | 24.4 MB |
| **iOS** | Build Simulator (`.zip`) | [**teledrive-ios-simulator.zip**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-ios-simulator.zip/download) | Simulator iOS (x86_64 / arm64) | 24.4 MB |

> 🌐 Katalog paket lengkap, tautan cermin (mirror), dan checksum kriptografi tersedia di [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) atau [**teledrive.space**](https://teledrive.space).

<details>
<summary>🔐 <b>Verifikasi Checksum Kriptografi SHA-256 (v0.1.3)</b></summary>

```
c40824614189dd18d39287c20f7201dc88595439b096e4dcc867b8c2c46a064c  teledrive.dmg
8d6135fe6b22e00d3dbb4b92fd16a52fb3f4500260ef4f3782cff6672bb9e675  teledrive-setup.exe
6be694979c9678a0d256bb27bac8acec78e2ba07628ef9290347e526095973f6  teledrive.msi
c6c556f91879fe9004f02edb8a5fa1c40fcb946c47da9e32c12c5afe57478a58  teledrive.AppImage
0828cc1fbaa30063824bf7b2d3e708f178a05fd2353555ad89104fb44f98c5cf  teledrive.deb
7c9a3a5e7306a6cc6ddefd20ec4fdc258ffa83c1fc09e7ff2811d97b6941f1b9  teledrive.rpm
0888ade027c70d16acc9b8d5bca8c688f51568f6e04222760e2ef5bba6ec6de5  teledrive.apk
1ecd0df0ecf284a9389bf0cff1c14a4b5c92711f940a0732c5d80aa71e6dade8  teledrive.ipa
30d878eb7a3bf0c4a87574cb474e16c3d8e7f039c4a1711e550a2b0dde63d3fa  teledrive-ios-simulator.zip
```
</details>

---

## ✨ Fitur Utama

- **Penyimpanan Cloud Tanpa Batas**: Menggunakan saluran privat Telegram Anda sebagai media penyimpanan tanpa biaya berulang.
- **Ringan & Multiplatform Asli**: Dibangun di atas Tauri v2 + Rust untuk 5 platform (macOS, Windows, Linux, Android, dan iOS) dengan kecepatan peluncuran tinggi dan penggunaan memori yang rendah (< 250 MB).
- **11 Bahasa Terlokalisasi**: Dukungan antarmuka native untuk Bahasa Indonesia, Inggris, Spanyol, Jerman, Prancis, Portugis, Rusia, Tionghoa (Sederhana & Tradisional), Hindi, dan Jepang.
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

Jika Anda hanya ingin menggunakan TeleDrive tanpa mengompilasi dari kode sumber, unduh paket penginstal yang sesuai untuk sistem operasi Anda (macOS, Windows, Linux, Android, atau iOS) langsung dari [**tabel unduhan**](#-unduhan) di atas atau di [**teledrive.space**](https://teledrive.space). Untuk pedoman kontribusi, lihat [**Contributing Guide (CONTRIBUTING.md)**](../CONTRIBUTING.md).
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
