<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Almacenamiento en la nube personal e ilimitado, impulsado por tu propio canal privado de Telegram.**  
Cero costos de servidor. Cero suscripciones. Cifrado MTProto directo hacia Telegram.

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Descargas Totales](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Última Versión](https://img.shields.io/badge/versión-v0.1.2-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.2/)
[![Demostración en YouTube](https://img.shields.io/badge/YouTube-Vídeo%20Demo-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![Licencia: GPL v3](https://img.shields.io/badge/licencia-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![Estrellas en GitHub](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**Sitio Web**](https://teledrive.space) • [**Descargas**](#-descargas) • [**Vídeo Demo**](#-vídeo-de-demostración) • [**Reportar un Error**](https://github.com/senapati484/teledrive/issues/new/choose) • [**Solicitar una Función**](https://github.com/senapati484/teledrive/issues/new/choose)

</div>

---

## 🎬 Vídeo de Demostración

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="Vídeo de demostración de TeleDrive" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ Ver en YouTube: "I Turned Telegram Into Unlimited Cloud Storage"](https://youtu.be/4AiMn7HSlFg)**  
*Demostración completa que muestra transmisión directa vía MTProto, visor de PDF multipágina, inspección de tablas CSV, editor de código CodeMirror 6 y sincronización automática de carpetas.*

</div>

---

## 💡 ¿Por qué TeleDrive?

Telegram ofrece almacenamiento en la nube prácticamente ilimitado en canales privados, pero carece de jerarquía de carpetas, catálogo virtual y un flujo de trabajo de escritorio similar a Google Drive. **TeleDrive** cierra esa brecha:

- **Cero Servidores Intermediarios**: Todas las transferencias de archivos y conexiones MTProto se realizan directamente desde tu equipo local hacia los servidores de Telegram.
- **Unidad Virtual**: Carpetas anidadas, búsqueda instantánea, archivos destacados, archivo y papelera indexados en un catálogo anclado dentro de tu canal privado.
- **Bóveda con Cifrado de Hardware**: Credenciales y claves de sesión protegidas en Tauri Stronghold utilizando claves derivadas con Argon2id.
- **Multicuenta**: Alterna entre múltiples números de teléfono con aislamiento completo de sesiones y almacenamiento local.

---

## 📥 Descargas

Versión actual: **v0.1.2** · Instaladores nativos precompilados para las 5 plataformas:

| Sistema Operativo | Formato de Paquete | Descarga Directa | Arquitectura / Compatibilidad | Tamaño |
|:---|:---|:---|:---|---:|
| **Windows** | Instalador Setup (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive-setup.exe/download) | x64 64-Bit (Windows 10 / 11) | 5.8 MB |
| **Windows** | Paquete MSI (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.msi/download) | Instalador Enterprise (Win 10 / 11) | 7.3 MB |
| **macOS** | Imagen de Disco Universal (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.dmg/download) | Apple Silicon (M1–M4) e Intel x64 | 14.4 MB |
| **Linux** | AppImage Universal (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.AppImage/download) | Portable Independiente (glibc 2.31+) | 85.5 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.deb/download) | x86_64 / amd64 | 7.5 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.rpm/download) | x86_64 / amd64 | 7.5 MB |
| **Android** | APK Universal (`.apk`) | [**teledrive.apk**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.apk/download) | Android 8.0+ (ARM64, ARMv7a, x86_64) | 45.9 MB |
| **iOS** | Paquete Sideload (`.ipa`) | [**teledrive.ipa**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.ipa/download) | iOS 15.0+ (AltStore / TrollStore) | 24.1 MB |
| **iOS** | Build para Simulador (`.zip`) | [**teledrive-ios-simulator.zip**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive-ios-simulator.zip/download) | Simulador iOS (x86_64 / arm64) | 24.1 MB |

> 🌐 El catálogo completo de paquetes, enlaces espejo y sumas de verificación criptográficas están disponibles en [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) o en [**teledrive.space**](https://teledrive.space).

<details>
<summary>🔐 <b>Verificar sumas criptográficas SHA-256 (v0.1.2)</b></summary>

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

## ✨ Características

- **Nube Ilimitada**: Utiliza tu canal privado de Telegram como almacenamiento con 0 pagos recurrentes.
- **Multiplataforma Nativo**: Binarios ultraligeros para 5 plataformas (macOS, Windows, Linux, Android e iOS) creados sobre Tauri v2 y Rust.
- **11 Idiomas Localizados**: Soporte nativo para Español, Inglés, Portugués, Francés, Alemán, Ruso, Chino (simplificado y tradicional), Hindi, Indonesio y Japonés.
- **Streaming Directo MTProto**: El motor GramJS transmite fragmentos de 512 KB directamente con hasta 4 subprocesos de subida concurrentes.
- **Privacidad Ante Todo**: Sin seguimiento, telemetría oculta ni servidores intermediarios. Tus datos permanecen únicamente entre tú y Telegram.
- **Búsqueda y Organización Instantánea**: Migas de pan (breadcrumbs), filtros por tipo de archivo, vistas en cuadrícula o lista y atajos de teclado.

---

## ⚙️ Cómo Funciona

```
┌─────────────────────────────────────────────────────────────────┐
│                       Frontend en React 19                      │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │    Estado Zustand   │             │   Motor GramJS      │   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                           MTProto Directo
         (Llamadas Bridge)                    (SSL/TLS Seguro)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Núcleo Rust Tauri   │              │   API Cloud Telegram   │
│  ┌───────────────────┐  │              │    (Canal Privado)     │
│  │ Bóveda Stronghold │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **Conexión Directa**: Se autentica directamente con los centros de datos MTProto de Telegram por el puerto seguro TLS 443.
2. **Subida por Fragmentos**: Divide archivos grandes en fragmentos de 512 KB transmitidos simultáneamente.
3. **Catálogo de Carpetas Anclado**: Mantiene un índice JSON cifrado fijado en tu canal para una navegación fluida en todos tus dispositivos.

---

## 🧪 Beta Testers Wanted!

We are looking for beta testers to help test upcoming releases, performance enhancements, and new features:

> 🗳️ **Community Poll:**  
> **👉 [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35)**  
> Vote in our community poll, share your feedback, and get early access to pre-release builds!

## 🚀 Guía de Inicio Rápido

### 🛠️ Inicio Rápido para Desarrolladores y Colaboradores

TeleDrive es 100% código abierto y muy fácil de ejecutar localmente. Incluye credenciales de desarrollo preconfiguradas, lo que te permite comenzar a colaborar en menos de 2 minutos sin necesidad de crear una aplicación en Telegram.

#### 1. Clonar el repositorio
```bash
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

#### 2. Instalar dependencias
```bash
npm install
```
> ℹ️ *El hook `postinstall` aplica automáticamente los parches de compatibilidad de GramJS MTProto (`scripts/patch-telegram.cjs`) necesarios para Tauri y el navegador.*

#### 3. Iniciar el servidor de desarrollo
```bash
# Iniciar la aplicación de escritorio con recarga en caliente de Tauri v2:
npm run tauri dev

# O abrir la vista previa web en el navegador:
npm run dev
```

---

### 📋 Requisitos Previos del Sistema

- **Node.js**: `>= 18.0.0` (`v20+` LTS recomendado)
- **Rust**: Última versión estable (`rustup default stable`)
- **Herramientas de compilación**:
  - **macOS**: `xcode-select --install`
  - **Linux (Debian/Ubuntu)**: `sudo apt update && sudo apt install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Linux (Fedora/RHEL)**: `sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel`
  - **Windows**: Microsoft Visual Studio C++ Build Tools & WebView2

---

### 🧪 Pruebas y Validación

```bash
# Ejecutar la suite de pruebas Vitest
npm test

# Validar tipado TypeScript y empaquetado Vite
npm run build

# Validar compilación del backend en Rust
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### 🔑 Credenciales de la API de Telegram (Opcional)

TeleDrive incluye credenciales integradas para desarrollo local. Si prefieres utilizar tus propias credenciales de Telegram:
1. Inicia sesión en [**my.telegram.org**](https://my.telegram.org) con tu teléfono.
2. Ve a **API development tools** y crea una aplicación (ej. `TeleDrive-Dev`).
3. Copia `api_id` y `api_hash`.
4. Introdúcelos en TeleDrive en **Ajustes → Configuración de API** o crea un archivo `.env`:
   ```env
   VITE_TELEGRAM_API_ID=your_api_id
   VITE_TELEGRAM_API_HASH=your_api_hash
   ```

---

### 📦 Instaladores Precompilados para Usuarios Finales

Si solo deseas instalar y usar TeleDrive sin compilar el código fuente, descarga el instalador correspondiente a tu sistema operativo (macOS, Windows, Linux, Android o iOS) directamente desde la [**tabla de descargas**](#-descargas) superior o en [**teledrive.space**](https://teledrive.space). Para pautas de Pull Request, consulta nuestra [**Guía de Contribución (CONTRIBUTING.md)**](../CONTRIBUTING.md).
---

## ⌨️ Atajos de Teclado

| Atajo | Acción |
|:---|:---|
| `/` o `⌘ F` | Enfocar la barra de búsqueda |
| `⌘ A` | Seleccionar todos los elementos |
| `⌘ D` | Descargar elementos seleccionados |
| `F2` | Renombrar elemento seleccionado |
| `Backspace` / `Del` | Enviar a la Papelera |
| `Esc` | Limpiar selección / desenfocar búsqueda |
| `?` | Abrir ayuda de atajos de teclado |

---

## 🤝 Contribuir

¡Agradecemos enormemente las contribuciones, reportes de fallos e ideas!

- 🧪 **Beta Testing**: [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35) — Vote in the community poll!
1. Realiza un Fork del repositorio y crea una rama: `git checkout -b feat/mi-mejora`
2. Ejecuta los analizadores: `npm run lint` y `cargo fmt`
3. Realiza tus commits con formato semántico (por ejemplo, `feat(ui): ...`)
4. Envía un Pull Request

---

## 📜 Licencia

TeleDrive es software libre y de código abierto bajo la [Licencia GNU GPL-3.0](../LICENSE).

*Aviso: TeleDrive es un proyecto de código abierto independiente y no está asociado, patrocinado ni respaldado por Telegram FZ-LLC. El almacenamiento de datos masivos está sujeto a los Términos de Servicio y políticas de uso aceptable de la API de Telegram.*

---

<div align="center">

Desarrollado con ❤️ por **[Senapati484](https://github.com/senapati484)**

¡Si te gusta TeleDrive, déjanos una estrella ⭐ en [GitHub](https://github.com/senapati484/teledrive)!

</div>
