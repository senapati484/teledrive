<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Безлимитное персональное облачное хранилище на базе вашего приватного Telegram-канала.**  
Ноль затрат на серверы. Ноль платных подписок. Прямое сквозное шифрование MTProto в Telegram.

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**简体中文**](README-zh-CN.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Всего загрузок](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Последняя версия](https://img.shields.io/badge/релиз-v0.1.1-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.1/)
[![Демо на YouTube](https://img.shields.io/badge/YouTube-Видео%20Демо-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![Лицензия: GPL v3](https://img.shields.io/badge/лицензия-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![Звезды на GitHub](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**Веб-сайт**](https://teledrive.space) • [**Скачать**](#-скачать) • [**Видео Демо**](#-видео-демонстрация) • [**Сообщить об ошибке**](https://github.com/senapati484/teledrive/issues/new) • [**Предложить функцию**](https://github.com/senapati484/teledrive/issues/new)

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

Текущий релиз: **v0.1.1** · Готовые бинарные сборки для всех основных операционных систем:

| Операционная система | Формат пакета | Прямая ссылка | Размер |
|:---|:---|:---|---:|
| **Windows** | Установщик (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive-setup.exe/download) | 5.5 MB |
| **Windows** | Пакет MSI (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.msi/download) | 7.2 MB |
| **macOS** | Образ диска Universal (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.dmg/download) | 15.8 MB |
| **Linux** | Universal AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.AppImage/download) | 86.1 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.deb/download) | 8.4 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.rpm/download) | 8.0 MB |

> 🌐 Полный список зеркал и контрольные суммы доступны на [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) или на [**teledrive.space**](https://teledrive.space).

---

## ✨ Возможности

- **Действительно безлимитное облако**: Ваш личный канал Telegram используется как хранилище без абонентской платы.
- **Нативная кроссплатформенность**: Легковесное приложение на базе Tauri v2 и Rust с минимальным потреблением ресурсов.
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

## 🚀 Быстрый старт

### 1. Получение ключей Telegram API

1. Авторизуйтесь на сайте [my.telegram.org](https://my.telegram.org) по номеру телефона.
2. Перейдите в раздел **API development tools** и создайте приложение (например, `TeleDrive`).
3. Скопируйте `api_id` и `api_hash` и укажите их при первом запуске TeleDrive.

### 2. Сборка и запуск из исходников

**Требования:**
- [Rust & Cargo](https://rustup.rs/) (1.78+)
- [Node.js](https://nodejs.org/) (20.19+ или 22.12+)

```bash
# Клонировать репозиторий
git clone https://github.com/senapati484/teledrive.git
cd teledrive

# Установить зависимости
npm install

# Запустить в режиме разработки
npm run tauri dev
```

### 3. Сборка релизных пакетов

```bash
npm run tauri build
```
Готовые установщики (`.dmg`, `.exe` / `.msi`, `.deb` / `.AppImage`) будут скомпилированы в `src-tauri/target/release/bundle/`.

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
