<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**基于私人 Telegram 频道打造的无限个人云存储桌面客户端。**  
零服务器租金 · 零订阅费用 · 直接通过 MTProto 端到端加密直连 Telegram。

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**简体中文**](README-zh-CN.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![总下载量](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![最新版本](https://img.shields.io/badge/版本-v0.1.1-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.1/)
[![YouTube 演示视频](https://img.shields.io/badge/YouTube-演示视频-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![开源协议: GPL v3](https://img.shields.io/badge/开源协议-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**官方网站**](https://teledrive.space) • [**安装包下载**](#-下载) • [**视频演示**](#-视频演示与讲解) • [**提交问题**](https://github.com/senapati484/teledrive/issues/new) • [**建议新功能**](https://github.com/senapati484/teledrive/issues/new)

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

当前最新版本：**v0.1.1** · 全平台预编译原生安装包：

| 操作系统 | 安装包格式 | 直接下载链接 | 大小 |
|:---|:---|:---|---:|
| **Windows** | 安装程序 (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive-setup.exe/download) | 5.5 MB |
| **Windows** | MSI 安装包 (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.msi/download) | 7.2 MB |
| **macOS** | 通用镜像 (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.dmg/download) | 15.8 MB |
| **Linux** | 通用 AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.AppImage/download) | 86.1 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.deb/download) | 8.4 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.rpm/download) | 8.0 MB |

> 🌐 所有软件包、镜像下载地址及校验码均可在 [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) 或 [**teledrive.space**](https://teledrive.space) 获取。

---

## ✨ 核心特性

- **真正无限容量**：以您的专属私人 Telegram 频道为存储底层，无月租、无订阅、终身免费。
- **轻量原生跨平台**：基于 Tauri v2 + Rust 构建，启动飞快，内存占用低（通常低于 250MB）。
- **MTProto 并发分片传输**：GramJS 核心驱动 512 KB 块直连传输，支持最高 4 个并发上传通道。
- **纯粹隐私安全**：无任何追踪代码、无用户遥测、无第三方中间代理，文件安全直达 Telegram 官方服务器。
- **专业级内置工具**：多页 PDF 批注阅读、交互式 CSV 表格排序、支持 20+ 语言高亮的 CodeMirror 6 代码编辑器。

---

## ⚙️ 架构原理

```
┌─────────────────────────────────────────────────────────────────┐
│                       React 19 前端架构                         │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │    Zustand 全局状态  │             │   GramJS 协议引擎   │   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                           直连 MTProto
         (二进制调用桥梁)                    (TLS 443 安全加密)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Tauri Rust 核心     │              │  Telegram 官方云 API   │
│  ┌───────────────────┐  │              │     (个人私有频道)      │
│  │ Stronghold 保险库 │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **直连协议**：通过安全 TLS 443 端口直接与 Telegram 官方 MTProto 数据中心认证握手。
2. **切片并行传输**：超大文件智能切分为 512 KB 分片并行流水线传输。
3. **加密置顶索引**：在频道中持久化加密维护 JSON 目录树，实现跨设备云盘数据实时一致性。

---

## 🚀 快速上手

### 1. 获取 Telegram API 凭据

1. 使用手机号登录 [my.telegram.org](https://my.telegram.org)。
2. 进入 **API development tools**，新建一个应用（例如名称填写 `TeleDrive`）。
3. 复制生成的 `api_id` 和 `api_hash`，在首次启动 TeleDrive 时填入即可。

### 2. 源码本地运行

**开发环境准备：**
- [Rust & Cargo](https://rustup.rs/) (1.78+)
- [Node.js](https://nodejs.org/) (20.19+ 或 22.12+)

```bash
# 克隆仓库
git clone https://github.com/senapati484/teledrive.git
cd teledrive

# 安装依赖
npm install

# 以开发模式启动桌面客户端
npm run tauri dev
```

### 3. 构建发布安装包

```bash
npm run tauri build
```
编译生成的本地系统安装包 (`.dmg`, `.exe` / `.msi`, `.deb` / `.AppImage`) 将位于 `src-tauri/target/release/bundle/` 目录下。

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
