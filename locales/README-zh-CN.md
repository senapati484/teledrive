<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**基于私人 Telegram 频道打造的无限个人云存储桌面客户端。**  
零服务器租金 · 零订阅费用 · 直接通过 MTProto 端到端加密直连 Telegram。

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![总下载量](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![最新版本](https://img.shields.io/badge/版本-v0.1.3-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.3/)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Featured-FF6154.svg?style=flat-square&logo=producthunt&logoColor=white)](https://www.producthunt.com/products/teledrive-3)
[![YouTube 演示视频](https://img.shields.io/badge/YouTube-演示视频-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![开源协议: GPL v3](https://img.shields.io/badge/开源协议-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

<br/>

<a href="https://www.producthunt.com/products/teledrive-3?utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-teledrive-3" target="_blank">
  <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1293880&theme=light" alt="TeleDrive - Unlimited Telegram cloud drive across 5 platforms. | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
</a>

<br/><br/>

[**官方网站**](https://teledrive.space) • [**Product Hunt 🚀**](https://www.producthunt.com/products/teledrive-3) • [**安装包下载**](#-下载) • [**Beta 测试投票 🧪**](https://github.com/senapati484/teledrive/discussions/35) • [**视频演示**](#-视频演示与讲解) • [**提交问题**](https://github.com/senapati484/teledrive/issues/new/choose) • [**建议新功能**](https://github.com/senapati484/teledrive/issues/new/choose)

</div>

---

## 🎬 视频演示与讲解

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="TeleDrive 演示视频" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ 在 YouTube 上观看：“I Turned Telegram Into Unlimited Cloud Storage”](https://youtu.be/4AiMn7HSlFg)**  
*完整演示：直接 MTProto 文件流式传输、多页 PDF 滚动预览、交互式 CSV 表格分析、内置 CodeMirror 6 代码编辑器以及自动化目录备份引擎。*

</div>

---

## 💡 为什么选择 TeleDrive？

Telegram 在私人频道中提供了几乎无限的免费云存储空间，但缺少文件夹层级、虚拟文件索引以及桌面网盘式的操作体验。**TeleDrive** 完美弥补了这一空缺：

- **零中转服务器**：所有文件上传下载与 MTProto 网络交互均在本地设备与 Telegram 数据中心之间直连完成。
- **虚拟云盘系统**：支持多层级嵌套文件夹、全局秒搜、星标收藏、归档与回收站，并在私人频道中维护置顶加密目录索引。
- **硬件级加密保险库**：会话凭据与密钥均保存在 Tauri Stronghold 中，并通过 Argon2id 算法生成强密钥加密保护。
- **多账号无缝切换**：支持绑定多个 Telegram 手机号码，各账号会话和本地密钥库完全隔离。

---

## 📥 下载

当前最新版本：**v0.1.3** · 支持 5 大平台的预编译原生安装包：

| 操作系统 | 安装包格式 | 直接下载链接 | 架构 / 兼容性 | 大小 |
|:---|:---|:---|:---|---:|
| **Windows** | 安装程序 (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-setup.exe/download) | x64 64位 (Windows 10 / 11) | 5.8 MB |
| **Windows** | MSI 安装包 (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.msi/download) | 企业级安装包 (Win 10 / 11) | 7.3 MB |
| **macOS** | 通用磁盘镜像 (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.dmg/download) | Apple Silicon (M1–M4) 与 Intel x64 | 14.4 MB |
| **Linux** | 通用 AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.AppImage/download) | 独立便携版 (glibc 2.31+) | 85.5 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.deb/download) | x86_64 / amd64 | 7.5 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.rpm/download) | x86_64 / amd64 | 7.5 MB |
| **Android** | 通用 APK (`.apk`) | [**teledrive.apk**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.apk/download) | Android 8.0+ (ARM64, ARMv7a, x86_64) | 45.9 MB |
| **iOS** | 侧载安装包 (`.ipa`) | [**teledrive.ipa**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.ipa/download) | iOS 15.0+ (AltStore / TrollStore) | 24.1 MB |
| **iOS** | 模拟器构建包 (`.zip`) | [**teledrive-ios-simulator.zip**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-ios-simulator.zip/download) | iOS 模拟器 (x86_64 / arm64) | 24.1 MB |

> 🌐 所有软件包、镜像下载地址及加密校验码均可在 [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) 或 [**teledrive.space**](https://teledrive.space) 获取。

<details>
<summary>🔐 <b>校验 SHA-256 加密散列校验码 (v0.1.3)</b></summary>

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

- **真正无限容量**：以您的专属私人 Telegram 频道为存储底层，无月租、无订阅、终身免费。
- **轻量原生跨平台**：面向 5 大平台（macOS、Windows、Linux、Android 与 iOS）基于 Tauri v2 + Rust 构建，启动飞快，内存占用低（通常低于 250MB）。
- **11 种本地化语言**：原生全面支持简体中文、繁体中文、英语、西班牙语、德语、法语、葡萄牙语、俄语、印地语、印尼语及日语。
- **MTProto 并发分片传输**：GramJS 核心驱动 512 KB 块直连传输，支持最高 4 个并发上传通道。
- **纯粹隐私安全**：无任何追踪代码、无用户遥测、无第三方中间代理，文件安全直达 Telegram 官方服务器。
- **专业级内置工具**：多页 PDF 批注阅读、交互式 CSV 表格排序、支持 20+ 语言高亮的 CodeMirror 6 代码编辑器。

---

## ⚙️ 架构原理

```
┌─────────────────────────────────────────────────────────────────┐
│                       React 19 前端架构                          │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │    Zustand 全局状态  │             │   GramJS 协议引擎    │   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                           直连 MTProto
         (二进制调用桥梁)                    (TLS 443 安全加密)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Tauri Rust 核心      │              │  Telegram 官方云 API    │
│  ┌───────────────────┐  │              │     (个人私有频道)       │
│  │ Stronghold 保险库  │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **直连协议**：通过安全 TLS 443 端口直接与 Telegram 官方 MTProto 数据中心认证握手。
2. **切片并行传输**：超大文件智能切分为 512 KB 分片并行流水线传输。
3. **加密置顶索引**：在频道中持久化加密维护 JSON 目录树，实现跨设备云盘数据实时一致性。

---

## 🧪 Beta Testers Wanted!

We are looking for beta testers to help test upcoming releases, performance enhancements, and new features:

> 🗳️ **Community Poll:**  
> **👉 [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35)**  
> Vote in our community poll, share your feedback, and get early access to pre-release builds!

## 🚀 快速上手

### 🛠️ 开发者与贡献者极速起步

TeleDrive 是 100% 开源项目，支持本地快速运行。项目已内置开发专用的 Telegram API 凭据，无需自行创建 Telegram 开发者应用，2 分钟内即可开始贡献代码。

#### 1. 克隆代码仓库
```bash
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

#### 2. 安装依赖
```bash
npm install
```
> ℹ️ *`postinstall` 钩子会自动应用 Tauri 与浏览器环境所需的 GramJS MTProto 兼容补丁（`scripts/patch-telegram.cjs`）。*

#### 3. 启动开发服务器
```bash
# 启动带有热重载的 Tauri v2 跨平台桌面端应用：
npm run tauri dev

# 或在浏览器中预览 Web 端：
npm run dev
```

---

### 📋 环境要求（Prerequisites）

- **Node.js**：`>= 18.0.0`（推荐 `v20+` LTS）
- **Rust**：最新稳定版（`rustup default stable`）
- **系统编译工具**：
  - **macOS**：`xcode-select --install`
  - **Linux (Debian/Ubuntu)**：`sudo apt update && sudo apt install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Linux (Fedora/RHEL)**：`sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel`
  - **Windows**：Microsoft Visual Studio C++ 生成工具 & WebView2

---

### 🧪 自动化测试与校验

```bash
# 运行 Vitest 测试套件
npm test

# 校验 TypeScript 类型与 Vite 打包
npm run build

# 校验 Rust 后端编译
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### 🔑 Telegram API 凭据配置（可选）

TeleDrive 已内置开发凭据，开箱即用。若需使用您自己的 Telegram API 凭据进行测试：
1. 使用手机号登录 [**my.telegram.org**](https://my.telegram.org)。
2. 进入 **API development tools**，新建一个应用（例如名称填写 `TeleDrive-Dev`）。
3. 复制生成的 `api_id` 与 `api_hash`。
4. 在 TeleDrive 应用内 **设置 → API 配置** 中填入，或在项目根目录创建 `.env` 文件：
   ```env
   VITE_TELEGRAM_API_ID=your_api_id
   VITE_TELEGRAM_API_HASH=your_api_hash
   ```

---

### 📦 最终用户预编译安装包

如果您不需要从源码编译，只想直接安装使用 TeleDrive，请从上方的 [**下载列表**](#-下载) 或前往 [**teledrive.space**](https://teledrive.space) 获取对应操作系统（macOS、Windows、Linux、Android 或 iOS）的安装包。提交 PR 规范请查阅我们的 [**贡献指南 (CONTRIBUTING.md)**](../CONTRIBUTING.md)。
---

## ⌨️ 常用快捷键

| 快捷键 | 功能说明 |
|:---|:---|
| `/` 或 `⌘ F` | 聚焦搜索栏 |
| `⌘ A` | 全选当前目录下的文件 |
| `⌘ D` | 批量下载选中的文件 |
| `F2` | 重命名选中项目 |
| `Backspace` / `Del` | 将选中项移入回收站 |
| `Esc` | 清除选区 / 退出搜索 |
| `?` | 打开快捷键速查表 |

---

## 🤝 参与贡献

欢迎提交 Issue、功能建议或代码 Pull Request！

- 🧪 **Beta Testing**: [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35) — Vote in the community poll!
1. Fork 本仓库并新建分支：`git checkout -b feat/my-feature`
2. 运行代码检查：`npm run lint` 和 `cargo fmt`
3. 提交语义化 commit 信息（如 `feat(ui): ...`）
4. 发起 Pull Request

---

## 📜 开源协议

TeleDrive 遵循 [GNU GPL-3.0 License](../LICENSE) 开源协议。

*免责声明：TeleDrive 是一个独立的开源项目，未受 Telegram FZ-LLC 赞助、认可或存在附属关系。存储大容量文件需遵守 Telegram 服务条款和 API 公平使用政策。*

---

<div align="center">

Created with ❤️ by **[Senapati484](https://github.com/senapati484)**

如果 TeleDrive 对您有帮助，欢迎在 [GitHub](https://github.com/senapati484/teledrive) 上点亮一颗 ⭐！

</div>
