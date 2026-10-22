# Contributing to TeleDrive 🤝

First off, thank you for taking the time to contribute! It is contributors like you who keep TeleDrive robust, secure, and accessible for everyone.

By contributing to this project, you agree to abide by the terms of the **GNU GPL-3.0 License** under which TeleDrive is distributed.

---

## 🗺️ How Can I Contribute?

### 1. Reporting Bugs
- Search the [Issues](https://github.com/senapati484/teledrive/issues) tracker first to ensure the bug hasn't already been reported.
- If it's a new issue, open a bug report detailing:
  - Clear steps to reproduce the behavior.
  - Expected vs. actual results.
  - Your operating system version (macOS, Windows, Linux, Android).
  - Relevant logs (e.g., contents of `app_data_dir/vault_state.log` or browser console errors).

### 2. Suggesting Enhancements
- Open a feature request on the issues page.
- Explain the use case and why this feature would benefit most TeleDrive users.
- Mockups or diagrams of the UI design changes are highly welcome!

### 3. Submitting Pull Requests (PRs)
- **Fork** the repository and create your branch from `main`.
- Keep changes focused. Avoid mixing unrelated modifications in a single pull request.
- Ensure all automated checks (lints, compiler verification) pass locally.

---

## 🌿 Git Branching Model

Please adhere to the following branch naming conventions:
- **Features**: `feature/your-feature-name` (e.g., `feature/custom-themes`)
- **Bug Fixes**: `bugfix/issue-description` (e.g., `bugfix/otp-input-autofocus`)
- **Documentation**: `docs/update-description` (e.g., `docs/add-api-schema`)

---

## 🎨 Coding Standards & Code Quality

To maintain a clean and readable codebase, we require:

### Frontend (React & TypeScript)
- **Formatting**: Run Prettier to format files before committing.
- **TypeScript**: Ensure strict type-safety. Do not use `any` unless absolutely necessary (e.g. interfacing with dynamic raw API responses from GramJS).
- **Styling**: Use Tailwind CSS utility classes. Avoid creating custom inline styles. Respect both **light** and **dark** mode states when editing visual components.
- **Icons**: Always use `lucide-react` SVG icons. Never use raw emojis as UI icons.
- **Text & translations**: Never hardcode user-facing text. Add it to `src/i18n/locales/en/<namespace>.json` and read it with `useTranslation("<namespace>")` (or `i18n.t("<namespace>:key")` outside React). Add the same key to every other language folder (e.g. `src/i18n/locales/pt-BR/`). To add a new language, copy the `en` folder, translate the values and register the language in `SUPPORTED_LANGUAGES` in `src/i18n/index.ts`.

### Backend (Rust Core)
- **Formatting**: Run `cargo fmt` to auto-format Rust files.
- **Safety**: Ensure there are no compilation warnings. Run `cargo clippy` to check for idiomatic Rust code.

---

## 🚀 Local Development Setup

### 1. Prerequisites
- **Node.js**: `v18.0.0+` (`v20+` LTS recommended)
- **Rust Toolchain**: Latest stable (`rustup default stable`)
- Platform C/C++ toolchain (Xcode Command Line Tools on macOS, `build-essential` on Linux)

### 2. Fork & Clone
```bash
# Fork the repository on GitHub, then clone your fork:
git clone https://github.com/your-username/teledrive.git
cd teledrive

# Or clone the official repository directly:
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

### 3. Install Dependencies
```bash
npm install
```
*(This automatically runs `scripts/patch-telegram.cjs` via `postinstall` to configure GramJS MTProto compatibility for browser and Tauri).*

### 4. Run Locally
```bash
# Launch the desktop application with Tauri v2 hot-reloading:
npm run tauri dev

# Or run the browser frontend dev server:
npm run dev
```

### 5. Running Tests & Verifying Build
```bash
# Run unit and integration tests:
npm test

# Verify production frontend build:
npm run build

# Verify Rust backend compilation:
cargo check --manifest-path src-tauri/Cargo.toml
```

---

## 📋 Pull Request Checklist

Before submitting your PR, verify the following:
- [ ] The app builds cleanly with zero compile warnings or errors:
  ```bash
  npm run build
  ```
- [ ] No temporary debug statements (`console.log`, `println!`) remain in production code pathways.
- [ ] The code runs correctly under both **light** and **dark** themes.
- [ ] Clickable controls include proper cursor styles (`cursor-pointer`).
- [ ] You have updated the `README.md` or other documentation if your pull request introduces config changes or new dependencies.
- [ ] (If visual) Please attach before/after screenshots to your pull request description.
