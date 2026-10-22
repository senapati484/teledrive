<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**非公開 Telegram チャンネルを活用した、容量無制限のパーソナルクラウドストレージ。**  
サーバー費用ゼロ · 月額サブスクリプション不要 · MTProto による Telegram 直結暗号化。

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![総ダウンロード数](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![最新リリース](https://img.shields.io/badge/リリース-v0.1.2-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.2/)
[![YouTube デモ動画](https://img.shields.io/badge/YouTube-動画デモ-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![ライセンス: GPL v3](https://img.shields.io/badge/ライセンス-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**公式サイト**](https://teledrive.space) • [**ダウンロード**](#-ダウンロード) • [**デモ動画**](#-デモ動画) • [**バグ報告**](https://github.com/senapati484/teledrive/issues/new/choose) • [**機能リクエスト**](https://github.com/senapati484/teledrive/issues/new/choose)

</div>

---

## 🎬 デモ動画

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="TeleDrive デモ動画" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ YouTube で視聴：「I Turned Telegram Into Unlimited Cloud Storage」](https://youtu.be/4AiMn7HSlFg)**  
*MTProto による高速ファイルストリーミング、複数ページ対応 PDF ビューアー、CSV テーブル検査、内蔵 CodeMirror 6 コードエディター、自動ディレクトリバックアップの実演。*

</div>

---

## 💡 なぜ TeleDrive なのか？

Telegram はプライベートチャンネルで実質無制限のクラウドストレージを提供していますが、フォルダ階層やカタログ検索、デスクトップドライブとしての操作性が欠けています。**TeleDrive** はその課題を解決します：

- **中継サーバーなし**：すべてのファイル転送と MTProto 接続は、お使いの端末から Telegram データセンターへ直接行われます。
- **仮想ドライブ構造**：階層フォルダ、高速検索、お気に入り、アーカイブ、ゴミ箱機能がチャンネル内のピン留め暗号化カタログで管理されます。
- **ハードウェア暗号化ボールト**：認証セッションと暗号化キーは、Argon2id 導出キーを使用して Tauri Stronghold に安全に保管されます。
- **複数アカウント対応**：セッションとローカルストレージを完全分離した状態で、複数の電話番号を切り替え可能です。

---

## 📥 ダウンロード

最新リリース: **v0.1.2** · 各 OS 向けビルド済みネイティブインストーラー：

| オペレーティングシステム | パッケージ形式 | 直接ダウンロード | サイズ |
|:---|:---|:---|---:|
| **Windows** | セットアップインストーラー (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive-setup.exe/download) | 5.5 MB |
| **Windows** | MSI パッケージ (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.msi/download) | 7.2 MB |
| **macOS** | Universal ディスクイメージ (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.dmg/download) | 15.8 MB |
| **Linux** | Universal AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.AppImage/download) | 86.1 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.deb/download) | 8.4 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.rpm/download) | 8.0 MB |

> 🌐 パッケージ一覧、ミラーリンク、チェックサムは [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) または [**teledrive.space**](https://teledrive.space) で確認できます。

---

## ✨ 主な機能

- **真の無制限クラウド**：非公開 Telegram チャンネルをバックエンドストレージとして活用し、月額費用は永年ゼロ。
- **軽量ネイティブクロスプラットフォーム**：Tauri v2 + Rust を採用し、メモリ消費量は通常 250MB 未満と極めて軽量。
- **MTProto チャンク分割転送**：GramJS エンジンが 512 KB チャンクを最大 4 スレッド並列で高速アップロード。
- **プライバシー最優先**：テレメトリ、行動追跡、サードパーティのプロキシは一切不使用。データはお使いの端末と Telegram 間でのみ送受信されます。
- **充実の内蔵ツール**：PDF 連続スクロールビューアー、CSV テーブルソート、20以上の言語ハイライトに対応した CodeMirror 6 エディター。

---

## ⚙️ 動作アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                      React 19 フロントエンド                       │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │    Zustand 状態管理  │             │    GramJS エンジン    │   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                         直接 MTProto 接続
         (バイナリブリッジ)                     (安全な TLS 443)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Tauri Rust コア      │              │ Telegram Cloud API     │
│  ┌───────────────────┐  │              │ (非公開チャンネル)        │
│  │ Stronghold 金庫    │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **直接接続**：安全な TLS 443 ポート経由で Telegram の公式 MTProto サーバーと直接認証。
2. **並列チャンク転送**：大容量ファイルを 512 KB に分割し、マルチスレッドで並行送信。
3. **ピン留め暗号化カタログ**：チャンネルに暗号化された JSON ディレクトリツリーを保存し、デバイス間でリアルタイムに同期。

---

## 🧪 Beta Testers Wanted!

We are looking for beta testers to help test upcoming releases, performance enhancements, and new features:

> 🗳️ **Community Poll:**  
> **👉 [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35)**  
> Vote in our community poll, share your feedback, and get early access to pre-release builds!

## 🚀 クイックスタート

### 🛠️ 開発者・コントリビューター向けクイックスタート

TeleDrive は 100% オープンソースであり、ローカル環境で簡単に動かすことができます。開発用 Telegram API 認証情報が内蔵されているため、独自の Telegram 開発者アプリを作成することなく、2分以内にコントリビューションを開始できます。

#### 1. リポジトリをクローン
```bash
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

#### 2. 依存関係のインストール
```bash
npm install
```
> ℹ️ *`postinstall` フックにより、Tauri およびブラウザ環境に必要な GramJS MTProto 互換性パッチ（`scripts/patch-telegram.cjs`）が自動適用されます。*

#### 3. 開発サーバーの起動
```bash
# Tauri v2 のホットリロード付きでデスクトップアプリを起動:
npm run tauri dev

# またはブラウザで Web プレビューを起動:
npm run dev
```

---

### 📋 必要動作環境（Prerequisites）

- **Node.js**: `>= 18.0.0`（`v20+` LTS 推奨）
- **Rust**: 最新安定版（`rustup default stable`）
- **システムビルドツール**:
  - **macOS**: `xcode-select --install`
  - **Linux (Debian/Ubuntu)**: `sudo apt update && sudo apt install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Linux (Fedora/RHEL)**: `sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel`
  - **Windows**: Microsoft Visual Studio C++ Build Tools & WebView2

---

### 🧪 テスト・動作検証

```bash
# Vitest テストスイートの実行
npm test

# TypeScript 型検査と Vite ビルドの検証
npm run build

# Rust バックエンドのコンパイル検証
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### 🔑 Telegram API 認証情報（任意）

TeleDrive には初期開発用の認証情報が組み込まれています。ご自身が作成した Telegram API アプリを利用したい場合:
1. お使いの電話番号で [**my.telegram.org**](https://my.telegram.org) にログインします。
2. **API development tools** を開き、アプリを新規作成します（例: `TeleDrive-Dev`）。
3. 発行された `api_id` と `api_hash` をコピーします。
4. TeleDrive 内の **設定 → API 設定** に入力するか、プロジェクト直下に `.env` ファイルを作成してください:
   ```env
   VITE_TELEGRAM_API_ID=your_api_id
   VITE_TELEGRAM_API_HASH=your_api_hash
   ```

---

### 📦 エンドユーザー向けプリコンパイル済みインストーラー

ソースコードからビルドせずに TeleDrive を利用したい場合は、上記の [**ダウンロード一覧**](#-ダウンロード) からお使いの OS に適したインストーラーを取得してください。プルリクエストのルールは [**Contributing Guide (CONTRIBUTING.md)**](../CONTRIBUTING.md) をご参照ください。
---

## ⌨️ キーボードショートカット

| ショートカット | 動作 |
|:---|:---|
| `/` または `⌘ F` | 検索バーにフォーカス |
| `⌘ A` | フォルダ内の全項目を選択 |
| `⌘ D` | 選択した項目を一括ダウンロード |
| `F2` | 選択項目の名前変更 |
| `Backspace` / `Del` | 選択項目をゴミ箱に移動 |
| `Esc` | 選択解除 / 検索フォーカス解除 |
| `?` | ショートカット一覧を表示 |

---

## 🤝 コントリビューション

バグ報告、改善提案、Pull Request を大歓迎します！

- 🧪 **Beta Testing**: [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35) — Vote in the community poll!
1. リポジトリをフォークしてブランチを作成: `git checkout -b feat/my-feature`
2. リンターの実行: `npm run lint` および `cargo fmt`
3. コミットを作成（例: `feat(ui): ...`）
4. Pull Request を作成

---

## 📜 ライセンス

TeleDrive は [GNU GPL-3.0 License](../LICENSE) のもとで公開されているオープンソースソフトウェアです。

*免責事項：TeleDrive は独立したオープンソースプロジェクトであり、Telegram FZ-LLC との提携、スポンサーシップ、保証関係はありません。大容量ファイルの保存には Telegram の利用規約および API フェアユースポリシーが適用されます。*

---

<div align="center">

Created with ❤️ by **[Senapati484](https://github.com/senapati484)**

TeleDrive が役立ちましたら、ぜひ [GitHub](https://github.com/senapati484/teledrive) で ⭐ をお願いします！

</div>
