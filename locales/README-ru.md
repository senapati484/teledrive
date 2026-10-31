<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Безлимитное персональное облачное хранилище на базе вашего приватного Telegram-канала.**  
Ноль затрат на серверы. Ноль платных подписок. Прямое сквозное шифрование MTProto в Telegram.

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Всего загрузок](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Последняя версия](https://img.shields.io/badge/релиз-v0.1.2-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.2/)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Featured-FF6154.svg?style=flat-square&logo=producthunt&logoColor=white)](https://www.producthunt.com/products/teledrive-3)
[![Демо на YouTube](https://img.shields.io/badge/YouTube-Видео%20Демо-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![Лицензия: GPL v3](https://img.shields.io/badge/лицензия-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![Звезды на GitHub](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

<br/>

<a href="https://www.producthunt.com/products/teledrive-3?utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-teledrive-3" target="_blank">
  <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1293880&theme=light" alt="TeleDrive - Unlimited Telegram cloud drive across 5 platforms. | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
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

Текущий релиз: **v0.1.2** · Готовые нативные бинарные сборки для всех 5 платформ:

| Операционная система | Формат пакета | Прямая ссылка | Архитектура / Совместимость | Размер |
|:---|:---|:---|:---|---:|
| **Windows** | Установщик (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive-setup.exe/download) | x64 64-Bit (Windows 10 / 11) | 5.8 MB |
| **Windows** | Пакет MSI (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.msi/download) | Корпоративный установщик (Win 10 / 11) | 7.3 MB |
| **macOS** | Образ диска Universal (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.dmg/download) | Apple Silicon (M1–M4) и Intel x64 | 14.4 MB |
| **Linux** | Universal AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.AppImage/download) | Автономный портативный (glibc 2.31+) | 85.5 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.deb/download) | x86_64 / amd64 | 7.5 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.rpm/download) | x86_64 / amd64 | 7.5 MB |
| **Android** | Universal APK (`.apk`) | [**teledrive.apk**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.apk/download) | Android 8.0+ (ARM64, ARMv7a, x86_64) | 45.9 MB |
| **iOS** | Пакет Sideload (`.ipa`) | [**teledrive.ipa**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.ipa/download) | iOS 15.0+ (AltStore / TrollStore) | 24.1 MB |
| **iOS** | Сборка для симулятора (`.zip`) | [**teledrive-ios-simulator.zip**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive-ios-simulator.zip/download) | iOS Simulator (x86_64 / arm64) | 24.1 MB |

> 🌐 Полный список пакетов, зеркал и криптографические контрольные суммы доступны на [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) или на [**teledrive.space**](https://teledrive.space).

<details>
<summary>🔐 <b>Проверка криптографических контрольных сумм SHA-256 (v0.1.2)</b></summary>

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
