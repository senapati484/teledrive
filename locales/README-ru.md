<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Безлимитное персональное облачное хранилище на базе вашего приватного Telegram-канала.**  
Ноль затрат на серверы. Ноль платных подписок. Прямое сквозное шифрование MTProto в Telegram.

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Всего загрузок](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Последняя версия](https://img.shields.io/badge/релиз-v0.1.3-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.3/)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Featured-FF6154.svg?style=flat-square&logo=producthunt&logoColor=white)](https://www.producthunt.com/products/teledrive-3)
[![Демо на YouTube](https://img.shields.io/badge/YouTube-Видео%20Демо-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![Лицензия: GPL v3](https://img.shields.io/badge/лицензия-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![Звезды на GitHub](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
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

[**Веб-сайт**](https://teledrive.space) • [**Product Hunt 🚀**](https://www.producthunt.com/products/teledrive-3) • [**Скачать**](#-скачать) • [**Опрос бета-тестирования 🧪**](https://github.com/senapati484/teledrive/discussions/35) • [**Видео Демо**](#-видео-демонстрация) • [**Сообщить об ошибке**](https://github.com/senapati484/teledrive/issues/new/choose) • [**Предложить функцию**](https://github.com/senapati484/teledrive/issues/new/choose)

</div>

---

## 🎬 Видео-демонстрация

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="Видео-демонстрация TeleDrive" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ Смотреть на YouTube: "I Turned Telegram Into Unlimited Cloud Storage"](https://youtu.be/4AiMn7HSlFg)**  
*Полный обзор возможностей: прямая передача данных MTProto, многостраничный просмотрщик PDF, анализ CSV-таблиц, встроенная IDE CodeMirror 6 и автоматическое резервное копирование папок.*

</div>

---

## 💡 Почему TeleDrive?

Telegram предоставляет практически неограниченное облачное хранилище в закрытых каналах, однако не имеет иерархии папок, удобного каталога и привычного рабочего интерфейса настольного диска. **TeleDrive** восполняет этот пробел:

- **Без промежуточных серверов**: Все операции с файлами и сессии MTProto выполняются напрямую с вашего компьютера в дата-центры Telegram.
- **Виртуальный диск**: Дерево папок, мгновенный поиск, избранное, архив и корзина индексируются в закрепленном зашифрованном каталоге внутри вашего канала.
- **Аппаратное шифрование**: Учетные данные и ключи сессий защищены в Tauri Stronghold с использованием алгоритма Argon2id.
- **Мультиаккаунт**: Легкое переключение между несколькими номерами телефонов с полной изоляцией сессий.

---

## 📥 Скачать

Текущий релиз: **v0.1.3** · Готовые нативные бинарные сборки для всех 5 платформ:

| Операционная система | Формат пакета | Прямая ссылка | Архитектура / Совместимость | Размер |
|:---|:---|:---|:---|---:|
| **Windows** | Установщик (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-setup.exe/download) | x64 64-Bit (Windows 10 / 11) | 6.0 MB |
| **Windows** | Пакет MSI (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.msi/download) | Корпоративный установщик (Win 10 / 11) | 7.7 MB |
| **macOS** | Образ диска Universal (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.dmg/download) | Apple Silicon (M1–M4) и Intel x64 | 14.9 MB |
| **Linux** | Universal AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.AppImage/download) | Автономный портативный (glibc 2.31+) | 85.9 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.deb/download) | x86_64 / amd64 | 7.7 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.rpm/download) | x86_64 / amd64 | 7.7 MB |
| **Android** | Universal APK (`.apk`) | [**teledrive.apk**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.apk/download) | Android 8.0+ (ARM64, ARMv7a, x86_64) | 47.6 MB |
| **iOS** | Пакет Sideload (`.ipa`) | [**teledrive.ipa**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.ipa/download) | iOS 15.0+ (AltStore / TrollStore) | 24.4 MB |
| **iOS** | Сборка для симулятора (`.zip`) | [**teledrive-ios-simulator.zip**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-ios-simulator.zip/download) | iOS Simulator (x86_64 / arm64) | 24.4 MB |

> 🌐 Полный список пакетов, зеркал и криптографические контрольные суммы доступны на [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) или на [**teledrive.space**](https://teledrive.space).

<details>
<summary>🔐 <b>Проверка криптографических контрольных сумм SHA-256 (v0.1.3)</b></summary>

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

## ✨ Возможности

- **Действительно безлимитное облако**: Ваш личный канал Telegram используется как хранилище без абонентской платы.
- **Нативная кроссплатформенность**: Легковесное приложение для 5 платформ (macOS, Windows, Linux, Android и iOS) на базе Tauri v2 и Rust с минимальным потреблением ресурсов (< 250 МБ).
- **11 локализованных языков**: Полная нативная поддержка интерфейса на русском, английском, испанском, немецком, французском, португальском, китайском (упрощенном и традиционном), хинди, индонезийском и японском языках.
- **Прямой стриминг MTProto**: Движок GramJS передает файлы блоками по 512 КБ с поддержкой до 4 параллельных потоков.
- **Приватность превыше всего**: Никакой телеметрии, трекеров или скрытых прокси. Данные циркулируют строго между вами и Telegram.
- **Быстрый поиск и навигация**: Хлебные крошки, фильтры по типу файлов, табличный вид и горячие клавиши.

---

## ⚙️ Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend на React 19                       │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │  Состояние Zustand  │             │    Движок GramJS    │   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                           Прямой MTProto
        (Вызовы моста)                        (Безопасный TLS)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Ядро Tauri Rust     │              │    Telegram API Cloud  │
│  ┌───────────────────┐  │              │    (Приватный канал)   │
│  │ Сейф Stronghold   │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **Прямое соединение**: Прямая авторизация на серверах MTProto Telegram через защищенный порт TLS 443.
2. **Многопоточная фрагментация**: Разбивка больших файлов на чанки по 512 КБ для параллельной загрузки.
3. **Закрепленный индекс**: Синхронизация защищенного каталога в канале для мгновенного доступа со всех устройств.

---

## 🧪 Beta Testers Wanted!

We are looking for beta testers to help test upcoming releases, performance enhancements, and new features:

> 🗳️ **Community Poll:**  
> **👉 [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35)**  
> Vote in our community poll, share your feedback, and get early access to pre-release builds!

## 🚀 Быстрый старт

### 🛠️ Быстрый старт для разработчиков и участников

TeleDrive — проект с полностью открытым исходным кодом (100% Open Source), готовый к локальному запуску. В него уже встроены ключи Telegram API для разработки, поэтому вы можете начать работу и внести свой вклад менее чем за 2 минуты без необходимости создавать отдельное приложение на портале разработчиков Telegram.

#### 1. Клонирование репозитория
```bash
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

#### 2. Установка зависимостей
```bash
npm install
```
> ℹ️ *Хук `postinstall` автоматически применяет патчи совместимости GramJS MTProto (`scripts/patch-telegram.cjs`), необходимые для Tauri и браузерной среды.*

#### 3. Запуск сервера разработки
```bash
# Запуск кроссплатформенного десктопного приложения с горячей перезагрузкой Tauri v2:
npm run tauri dev

# Или запуск веб-версии в браузере:
npm run dev
```

---

### 📋 Системные требования

- **Node.js**: `>= 18.0.0` (рекомендуется `v20+` LTS)
- **Rust**: актуальная стабильная версия (`rustup default stable`)
- **Инструменты сборки**:
  - **macOS**: `xcode-select --install`
  - **Linux (Debian/Ubuntu)**: `sudo apt update && sudo apt install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Linux (Fedora/RHEL)**: `sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel`
  - **Windows**: Microsoft Visual Studio C++ Build Tools и WebView2

---

### 🧪 Тестирование и верификация

```bash
# Запуск тестов Vitest
npm test

# Проверка типов TypeScript и сборки Vite
npm run build

# Проверка компиляции бекенда Rust
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### 🔑 Ключи Telegram API (Опционально)

TeleDrive уже содержит встроенные ключи для разработки. Если вы хотите протестировать работу со своим собственным приложением Telegram API:
1. Авторизуйтесь на [**my.telegram.org**](https://my.telegram.org) по номеру телефона.
2. Перейдите в **API development tools** и создайте приложение (например, `TeleDrive-Dev`).
3. Скопируйте `api_id` и `api_hash`.
4. Укажите их в приложении в разделе **Настройки → Конфигурация API** или создайте файл `.env`:
   ```env
   VITE_TELEGRAM_API_ID=your_api_id
   VITE_TELEGRAM_API_HASH=your_api_hash
   ```

---

### 📦 Готовые пакеты для пользователей

Если вам не нужно собирать приложение из исходного кода, скачайте готовый установщик для вашей операционной системы (macOS, Windows, Linux, Android или iOS) прямо из [**таблицы загрузок**](#-скачать) выше или на [**teledrive.space**](https://teledrive.space). С правилами оформления Pull Request можно ознакомиться в [**Contributing Guide (CONTRIBUTING.md)**](../CONTRIBUTING.md).
---

## ⌨️ Горячие клавиши

| Сочетание | Действие |
|:---|:---|
| `/` или `⌘ F` | Фокус на строке поиска |
| `⌘ A` | Выделить все файлы в папке |
| `⌘ D` | Скачать выбранные файлы |
| `F2` | Переименовать файл |
| `Backspace` / `Del` | Переместить в Корзину |
| `Esc` | Снять выделение / сбросить поиск |
| `?` | Открыть справку по горячим клавишам |

---

## 🤝 Участие в разработке

Мы рады предложениям, сообщениям об ошибках и Pull Request'ам!

- 🧪 **Beta Testing**: [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35) — Vote in the community poll!
1. Сделайте Fork репозитория и создайте ветку: `git checkout -b feat/my-feature`
2. Проверьте код линтерами: `npm run lint` и `cargo fmt`
3. Сделайте коммит с понятным описанием (например: `feat(ui): ...`)
4. Создайте Pull Request

---

## 📜 Лицензия

TeleDrive распространяется под свободной лицензией [GNU GPL-3.0 License](../LICENSE).

*Отказ от ответственности: TeleDrive является независимым проектом с открытым исходным кодом и не связан, не спонсируется и не поддерживается компанией Telegram FZ-LLC. Хранение файлов регулируется Условиями использования и политикой Telegram.*

---

<div align="center">

Создано с ❤️ автором **[Senapati484](https://github.com/senapati484)**

Если вам понравился TeleDrive, поставьте звезду ⭐ на [GitHub](https://github.com/senapati484/teledrive)!

</div>
