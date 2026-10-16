<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Almacenamiento en la nube personal e ilimitado, impulsado por tu propio canal privado de Telegram.**  
Cero costos de servidor. Cero suscripciones. Cifrado MTProto directo hacia Telegram.

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**简体中文**](README-zh-CN.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Descargas Totales](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Última Versión](https://img.shields.io/badge/versión-v0.1.1-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.1/)
[![Demostración en YouTube](https://img.shields.io/badge/YouTube-Vídeo%20Demo-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![Licencia: GPL v3](https://img.shields.io/badge/licencia-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![Estrellas en GitHub](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**Sitio Web**](https://teledrive.space) • [**Descargas**](#-descargas) • [**Vídeo Demo**](#-vídeo-de-demostración) • [**Reportar un Error**](https://github.com/senapati484/teledrive/issues/new) • [**Solicitar una Función**](https://github.com/senapati484/teledrive/issues/new)

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

Versión actual: **v0.1.1** · Instaladores nativos precompilados para los principales sistemas operativos:

| Sistema Operativo | Formato de Paquete | Descarga Directa | Tamaño |
|:---|:---|:---|---:|
| **Windows** | Instalador Setup (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive-setup.exe/download) | 5.5 MB |
| **Windows** | Paquete MSI (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.msi/download) | 7.2 MB |
| **macOS** | Imagen de Disco Universal (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.dmg/download) | 15.8 MB |
| **Linux** | AppImage Universal (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.AppImage/download) | 86.1 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.deb/download) | 8.4 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.rpm/download) | 8.0 MB |

> 🌐 El catálogo completo de paquetes, enlaces espejo y sumas de verificación están disponibles en [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) o en [**teledrive.space**](https://teledrive.space).

---

## ✨ Características

- **Nube Ilimitada**: Utiliza tu canal privado de Telegram como almacenamiento con 0 pagos recurrentes.
- **Multiplataforma Nativo**: Binarios ultraligeros para macOS, Windows y Linux creados sobre Tauri v2 y Rust.
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

## 🚀 Guía de Inicio Rápido

### 1. Obtener Credenciales de la API de Telegram

1. Inicia sesión en [my.telegram.org](https://my.telegram.org) con tu número de teléfono.
2. Abre **API development tools** y crea una aplicación (por ejemplo, `TeleDrive`).
3. Copia tu `api_id` y `api_hash` e ingrésalos al abrir TeleDrive por primera vez.

### 2. Ejecutar desde el Código Fuente

**Requisitos previos:**
- [Rust & Cargo](https://rustup.rs/) (1.78+)
- [Node.js](https://nodejs.org/) (20.19+ o 22.12+)

```bash
# Clonar el repositorio
git clone https://github.com/senapati484/teledrive.git
cd teledrive

# Instalar dependencias
npm install

# Iniciar la aplicación en modo desarrollo
npm run tauri dev
```

### 3. Compilar Paquetes de Instalación

```bash
npm run tauri build
```
Los instaladores generados (`.dmg`, `.exe` / `.msi`, `.deb` / `.AppImage`) estarán en `src-tauri/target/release/bundle/`.

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
