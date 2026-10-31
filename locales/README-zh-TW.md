<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**基於私人 Telegram 頻道打造的無限個人雲端儲存桌面客戶端。**  
零伺服器租金 · 零訂閱費用 · 直接透過 MTProto 端到端加密直連 Telegram。

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![總下載量](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![最新版本](https://img.shields.io/badge/版本-v0.1.3-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.3/)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Featured-FF6154.svg?style=flat-square&logo=producthunt&logoColor=white)](https://www.producthunt.com/products/teledrive-3)
[![YouTube 示範影片](https://img.shields.io/badge/YouTube-示範影片-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![開源協議: GPL v3](https://img.shields.io/badge/開源協議-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

<br/>

<a href="https://www.producthunt.com/products/teledrive-3?utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-teledrive-3" target="_blank">
  <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1293880&theme=light" alt="TeleDrive - Unlimited Telegram cloud drive across 5 platforms. | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
</a>

<br/><br/>

[**官方網站**](https://teledrive.space) • [**Product Hunt 🚀**](https://www.producthunt.com/products/teledrive-3) • [**安裝包下載**](#-下載) • [**Beta 測試投票 🧪**](https://github.com/senapati484/teledrive/discussions/35) • [**影片示範**](#-影片示範與講解) • [**回報問題**](https://github.com/senapati484/teledrive/issues/new/choose) • [**建議新功能**](https://github.com/senapati484/teledrive/issues/new/choose)

</div>

---

## 🎬 影片示範與講解

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="TeleDrive 示範影片" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ 在 YouTube 上觀看：“I Turned Telegram Into Unlimited Cloud Storage”](https://youtu.be/4AiMn7HSlFg)**  
*完整示範：直接 MTProto 檔案串流傳輸、多頁 PDF 滾動預覽、互動式 CSV 表格分析、內建 CodeMirror 6 程式碼編輯器以及自動化目錄備份引擎。*

</div>

---

## 💡 為什麼選擇 TeleDrive？

Telegram 在私人頻道中提供了幾乎無限的免費雲端儲存空間，但缺少資料夾層級、虛擬檔案索引以及桌面雲端硬碟式的操作體驗。**TeleDrive** 完美彌補了這一空缺：

- **零中轉伺服器**：所有檔案上傳下載與 MTProto 網路互動均在本地裝置與 Telegram 資料中心之間直連完成。
- **虛擬雲端硬碟**：支援多層級巢狀資料夾、全域秒搜、星標收藏、封存與垃圾桶，並在私人頻道中維護置頂加密目錄索引。
- **硬體級加密保險庫**：工作階段憑證與金鑰均保存在 Tauri Stronghold 中，並透過 Argon2id 演算法生成強金鑰加密保護。
- **多帳號無縫切換**：支援綁定多個 Telegram 手機號碼，各帳號工作階段與本地金鑰庫完全隔離。

---

## 📥 下載

目前最新版本：**v0.1.3** · 支援 5 大平台的預先編譯原生安裝包：

| 作業系統 | 安裝包格式 | 直接下載連結 | 架構 / 相容性 | 大小 |
|:---|:---|:---|:---|---:|
| **Windows** | 安裝程式 (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-setup.exe/download) | x64 64位元 (Windows 10 / 11) | 5.8 MB |
| **Windows** | MSI 安裝包 (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.msi/download) | 企業級安裝包 (Win 10 / 11) | 7.3 MB |
| **macOS** | 通用映像檔 (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.dmg/download) | Apple Silicon (M1–M4) 與 Intel x64 | 14.4 MB |
| **Linux** | 通用 AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.AppImage/download) | 獨立可攜版 (glibc 2.31+) | 85.5 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.deb/download) | x86_64 / amd64 | 7.5 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.rpm/download) | x86_64 / amd64 | 7.5 MB |
| **Android** | 通用 APK (`.apk`) | [**teledrive.apk**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.apk/download) | Android 8.0+ (ARM64, ARMv7a, x86_64) | 45.9 MB |
| **iOS** | 側載安裝包 (`.ipa`) | [**teledrive.ipa**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.ipa/download) | iOS 15.0+ (AltStore / TrollStore) | 24.1 MB |
| **iOS** | 模擬器組建包 (`.zip`) | [**teledrive-ios-simulator.zip**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-ios-simulator.zip/download) | iOS 模擬器 (x86_64 / arm64) | 24.1 MB |

> 🌐 所有套件、映像檔下載位址及加密校驗碼均可在 [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) 或 [**teledrive.space**](https://teledrive.space) 取得。

<details>
<summary>🔐 <b>驗證 SHA-256 加密雜湊校驗碼 (v0.1.3)</b></summary>

```
dfb353e361336ebbb8921982aa190b1a4e765f987d6558535582d837e2c3b633  teledrive.dmg
3cfe950e5d64d80c8733586198bd6136fdfc19c3dcde0ee516b5e08eb7ba9491  teledrive-setup.exe
fc433cf302a739b8a39a0ac95f85a86e6c2c9ad9e3fc11ae1eae89a49d52cbe3  teledrive.msi
a13e910d62262038bca5203ca652636c738f78f55f25210d60a01c6aadee02dd  teledrive.AppImage
fec9e1596ec35d49bebdbbae4579f2abdacb13bdde73156109cf3a4ac57286d2  teledrive.deb
11ce69e7001fe62c8547f5b74f4237bfd3b57b49f723e5d9ad9a58e3200a7fe1  teledrive.rpm
8368b7899484ccf820607df315071e86546c5c94c0534b7d1bf2eb081437cda8  teledrive.apk
1ee38b2ae8900fdb5a9dbe7d2aded8ad04f719a048400453b02f009cd305c779  teledrive.ipa
05797dcca05decc6ae463a560535ddd6cd013cd941b100e15e89351de6472745  teledrive-ios-simulator.zip
```
</details>

---

## ✨ 核心特性

- **真正無限容量**：以您的專屬私人 Telegram 頻道為儲存底層，無月租、無訂閱、終身免費。
- **輕量原生跨平台**：面向 5 大平台（macOS、Windows、Linux、Android 與 iOS）基於 Tauri v2 + Rust 構建，啟動飛快，記憶體佔用極低（通常低於 250MB）。
- **11 種在地化語言**：原生全面支援繁體中文、簡體中文、英語、西班牙語、德語、法語、葡萄牙語、俄語、印地語、印尼語及日語。
- **MTProto 並行分塊傳輸**：GramJS 核心驅動 512 KB 區塊直連傳輸，支援最高 4 個並行上傳通道。
- **純粹隱私安全**：無任何追蹤程式碼、無使用者遙測、無第三方中介代理，檔案安全直達 Telegram 官方伺服器。
- **專業級內建工具**：多頁 PDF 標註閱讀、互動式 CSV 表格排序、支援 20+ 種語言語法突顯的 CodeMirror 6 程式碼編輯器。

---

## ⚙️ 架構原理

```
┌─────────────────────────────────────────────────────────────────┐
│                       React 19 前端架構                          │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │    Zustand 全域狀態  │             │   GramJS 協議引擎    │   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                           直連 MTProto
         (二進位呼叫橋樑)                    (TLS 443 安全加密)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Tauri Rust 核心      │              │  Telegram 官方雲端 API  │
│  ┌───────────────────┐  │              │     (個人私有頻道)       │
│  │ Stronghold 保險庫  │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **直連協議**：透過安全 TLS 443 埠直接與 Telegram 官方 MTProto 資料中心認證交握。
2. **分塊並行傳輸**：超大檔案智慧切分為 512 KB 分塊並行流水線傳輸。
3. **加密置頂索引**：在頻道中持久化加密維護 JSON 目錄樹，實現跨裝置雲端資料即時一致性。

---

## 🧪 Beta Testers Wanted!

We are looking for beta testers to help test upcoming releases, performance enhancements, and new features:

> 🗳️ **Community Poll:**  
> **👉 [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35)**  
> Vote in our community poll, share your feedback, and get early access to pre-release builds!

## 🚀 快速上手

### 🛠️ 開發者與貢獻者極速起步

TeleDrive 是 100% 開源專案，支援本機快速運行。專案已內建開發專用的 Telegram API 憑證，無需自行建立 Telegram 開發者應用程式，2 分鐘內即可開始貢獻程式碼。

#### 1. 複製代碼庫
```bash
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

#### 2. 安裝依賴套件
```bash
npm install
```
> ℹ️ *`postinstall` 鉤子會自動套用 Tauri 與瀏覽器環境所需的 GramJS MTProto 相容性修補檔（`scripts/patch-telegram.cjs`）。*

#### 3. 啟動開發伺服器
```bash
# 啟動具備熱重載的 Tauri v2 跨平台桌面端應用程式：
npm run tauri dev

# 或在瀏覽器中預覽 Web 端：
npm run dev
```

---

### 📋 環境需求（Prerequisites）

- **Node.js**：`>= 18.0.0`（推薦 `v20+` LTS）
- **Rust**：最新穩定版（`rustup default stable`）
- **系統編譯工具**：
  - **macOS**：`xcode-select --install`
  - **Linux (Debian/Ubuntu)**：`sudo apt update && sudo apt install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Linux (Fedora/RHEL)**：`sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel`
  - **Windows**：Microsoft Visual Studio C++ 生成工具 & WebView2

---

### 🧪 自動化測試與校驗

```bash
# 執行 Vitest 測試套件
npm test

# 校驗 TypeScript 型別與 Vite 打包
npm run build

# 校驗 Rust 後端編譯
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### 🔑 Telegram API 憑證設定（選填）

TeleDrive 已內建開發憑證，開箱即用。若需使用您自己的 Telegram API 憑證進行測試：
1. 使用手機號碼登入 [**my.telegram.org**](https://my.telegram.org)。
2. 進入 **API development tools**，新建一個應用程式（例如名稱填寫 `TeleDrive-Dev`）。
3. 複製產生的 `api_id` 與 `api_hash`。
4. 在 TeleDrive 應用程式內 **設定 → API 設定** 中填入，或在專案根目錄建立 `.env` 檔案：
   ```env
   VITE_TELEGRAM_API_ID=your_api_id
   VITE_TELEGRAM_API_HASH=your_api_hash
   ```

---

### 📦 最終使用者預編譯安裝包

如果您不需要從源碼編譯，只想直接安裝使用 TeleDrive，請從上方的 [**下載列表**](#-下載) 或前往 [**teledrive.space**](https://teledrive.space) 取得對應作業系統（macOS、Windows、Linux、Android 或 iOS）的安裝包。提交 PR 規範請查閱我們的 [**貢獻指南 (CONTRIBUTING.md)**](../CONTRIBUTING.md)。
---

## ⌨️ 常用快捷鍵

| 快捷鍵 | 功能說明 |
|:---|:---|
| `/` 或 `⌘ F` | 聚焦搜尋欄 |
| `⌘ A` | 全選目前目錄下的檔案 |
| `⌘ D` | 批次下載選取的檔案 |
| `F2` | 重新命名選取項目 |
| `Backspace` / `Del` | 將選取項目移入垃圾桶 |
| `Esc` | 清除選取範圍 / 退出搜尋 |
| `?` | 開啟快捷鍵速查表 |

---

## 🤝 參與貢獻

歡迎提交 Issue、功能建議或程式碼 Pull Request！

- 🧪 **Beta Testing**: [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35) — Vote in the community poll!
1. Fork 本倉庫並新建分支：`git checkout -b feat/my-feature`
2. 執行程式碼檢查：`npm run lint` 和 `cargo fmt`
3. 提交語意化 commit 訊息（如 `feat(ui): ...`）
4. 發起 Pull Request

---

## 📜 開源協議

TeleDrive 遵循 [GNU GPL-3.0 License](../LICENSE) 開源協議。

*免責聲明：TeleDrive 是一個獨立的開源專案，未受 Telegram FZ-LLC 贊助、認可或存在附屬關係。儲存大容量檔案需遵守 Telegram 服務條款和 API 公平使用政策。*

---

<div align="center">

Created with ❤️ by **[Senapati484](https://github.com/senapati484)**

如果 TeleDrive 對您有幫助，歡迎在 [GitHub](https://github.com/senapati484/teledrive) 上點亮一顆 ⭐！

</div>
