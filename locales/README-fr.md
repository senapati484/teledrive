<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**Stockage cloud personnel illimité, propulsé par votre propre canal privé Telegram.**  
Zéro coût d'infrastructure. Zéro abonnement. Chiffrement direct MTProto de bout en bout vers Telegram.

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Téléchargements Totaux](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Dernière Version](https://img.shields.io/badge/version-v0.1.2-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.2/)
[![Démo YouTube](https://img.shields.io/badge/YouTube-Vidéo%20Démo-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![Licence : GPL v3](https://img.shields.io/badge/licence-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![Étoiles GitHub](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**Site Officiel**](https://teledrive.space) • [**Téléchargements**](#-téléchargements) • [**Vidéo Démo**](#-visite-guidée-en-vidéo--démo) • [**Signaler un Bug**](https://github.com/senapati484/teledrive/issues/new/choose) • [**Proposer une Fonctionnalité**](https://github.com/senapati484/teledrive/issues/new/choose)

</div>

---

## 🎬 Visite guidée en vidéo & Démo

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="Vidéo de Démonstration TeleDrive" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ Regarder sur YouTube : « I Turned Telegram Into Unlimited Cloud Storage »](https://youtu.be/4AiMn7HSlFg)**  
*Démonstration complète : streaming direct de fichiers via MTProto, visionneuse PDF multipages, inspection interactive de CSV, éditeur de code CodeMirror 6 et sauvegardes automatisées de répertoires.*

</div>

---

## 💡 Pourquoi TeleDrive ?

Telegram offre un espace de stockage cloud pratiquement illimité dans les canaux privés, mais ne dispose pas d'arborescence de dossiers, de catalogue virtuel ni d'expérience de type disque dur de bureau. **TeleDrive** comble parfaitement cette lacune :

- **Zéro serveur relais** : toutes les opérations de fichiers et connexions MTProto s'effectuent directement depuis votre machine locale vers les centres de données de Telegram.
- **Disque virtuel complet** : dossiers imbriqués, recherche instantanée, favoris, archives et corbeille sont répertoriés dans un catalogue chiffré épinglé dans votre canal.
- **Coffre chiffré matériellement** : les identifiants et clés de session sont sécurisés dans Tauri Stronghold avec des clés dérivées d'Argon2id.
- **Multi-comptes** : passez facilement d'un numéro de téléphone à un autre avec une isolation absolue des sessions et du coffre local.

---

## 📥 Téléchargements

Dernière version : **v0.1.2** · Fichiers binaires précompilés pour tous les systèmes d'exploitation :

| Système d'exploitation | Format du paquet | Téléchargement direct | Taille |
|:---|:---|:---|---:|
| **Windows** | Programme d'installation (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive-setup.exe/download) | 5.5 MB |
| **Windows** | Paquet MSI (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.msi/download) | 7.2 MB |
| **macOS** | Image disque universelle (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.dmg/download) | 15.8 MB |
| **Linux** | AppImage universelle (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.AppImage/download) | 86.1 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.deb/download) | 8.4 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.2/teledrive.rpm/download) | 8.0 MB |

> 🌐 Le catalogue complet des paquets, miroirs de téléchargement et sommes de contrôle sont disponibles sur [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) ou sur [**teledrive.space**](https://teledrive.space).

---

## ✨ Fonctionnalités

- **Stockage Cloud Illimité** : utilise votre canal privé Telegram comme support de stockage, sans frais récurrents.
- **Léger et multiplateforme natif** : conçu avec Tauri v2 + Rust pour un lancement ultra-rapide et une empreinte mémoire minimale (< 250 Mo).
- **Streaming MTProto direct** : le moteur GramJS envoie et reçoit directement des fragments de 512 Ko avec jusqu'à 4 flux d'envoi simultanés.
- **Confidentialité absolue** : aucun pistage, aucune télémétrie, aucun intermédiaire. Vos fichiers ne transitent qu'entre vous et Telegram.
- **Outils intégrés professionnels** : lecteur PDF multipages, affichage interactif de tableaux CSV et éditeur de code CodeMirror 6 avec coloration syntaxique de plus de 20 langages.

---

## ⚙️ Fonctionnement

```
┌─────────────────────────────────────────────────────────────────┐
│                       Frontend React 19                         │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │    État Zustand     │             │    Moteur GramJS    │   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                           MTProto direct
        (Pont binaire)                       (Sécurisé TLS 443)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Cœur Tauri Rust     │              │    API Cloud Telegram  │
│  ┌───────────────────┐  │              │     (Canal Privé)      │
│  │ Coffre Stronghold │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **Connexion directe** : authentification directe avec les serveurs MTProto de Telegram sur le port sécurisé TLS 443.
2. **Transfert fractionné** : découpage intelligent des fichiers volumineux en segments de 512 Ko envoyés en parallèle.
3. **Index catalogue épinglé** : maintien d'un index chiffré JSON épinglé dans votre canal pour la synchronisation entre appareils.

---

## 🧪 Beta Testers Wanted!

We are looking for beta testers to help test upcoming releases, performance enhancements, and new features:

> 🗳️ **Community Poll:**  
> **👉 [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35)**  
> Vote in our community poll, share your feedback, and get early access to pre-release builds!

## 🚀 Pour commencer

### 🛠️ Démarrage rapide pour développeurs et contributeurs

TeleDrive est 100% open-source et simple à exécuter localement. Des identifiants de développement intégrés sont inclus pour vous permettre de commencer à contribuer en moins de 2 minutes sans avoir à créer une application Telegram dédiée.

#### 1. Cloner le dépôt
```bash
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

#### 2. Installer les dépendances
```bash
npm install
```
> ℹ️ *Le hook `postinstall` applique automatiquement les correctifs de compatibilité GramJS MTProto (`scripts/patch-telegram.cjs`) requis pour Tauri et les navigateurs.*

#### 3. Lancer en mode développement
```bash
# Lancer l'application de bureau avec rechargement à chaud Tauri v2 :
npm run tauri dev

# Ou exécuter l'aperçu web dans votre navigateur :
npm run dev
```

---

### 📋 Prérequis

- **Node.js**: `>= 18.0.0` (`v20+` LTS recommandé)
- **Rust**: Dernière version stable (`rustup default stable`)
- **Outils de compilation**:
  - **macOS**: `xcode-select --install`
  - **Linux (Debian/Ubuntu)**: `sudo apt update && sudo apt install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Linux (Fedora/RHEL)**: `sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel`
  - **Windows**: Microsoft Visual Studio C++ Build Tools & WebView2

---

### 🧪 Vérification & Tests

```bash
# Exécuter la suite de tests Vitest
npm test

# Vérifier les types TypeScript et le build Vite
npm run build

# Vérifier la compilation du backend Rust
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### 🔑 Identifiants API Telegram (Optionnel)

TeleDrive intègre des identifiants de test préconfigurés. Si vous souhaitez utiliser vos propres clés Telegram :
1. Connectez-vous sur [**my.telegram.org**](https://my.telegram.org).
2. Ouvrez **API development tools** et créez une application (par ex. `TeleDrive-Dev`).
3. Copiez votre `api_id` et votre `api_hash`.
4. Renseignez-les dans TeleDrive sous **Paramètres → Configuration API**, ou créez un fichier `.env` :
   ```env
   VITE_TELEGRAM_API_ID=your_api_id
   VITE_TELEGRAM_API_HASH=your_api_hash
   ```

---

### 📦 Installateurs précompilés pour utilisateurs finaux

Si vous souhaitez simplement utiliser TeleDrive sans compiler les sources, téléchargez le package correspondant à votre système depuis le [**tableau des téléchargements**](#-téléchargements) ci-dessus. Consultez notre [**Contributing Guide (CONTRIBUTING.md)**](../CONTRIBUTING.md) pour les règles de pull request.
---

## ⌨️ Raccourcis clavier

| Raccourci | Action |
|:---|:---|
| `/` ou `⌘ F` | Cibler la barre de recherche |
| `⌘ A` | Sélectionner tous les éléments |
| `⌘ D` | Télécharger les éléments sélectionnés |
| `F2` | Renommer l'élément sélectionné |
| `Backspace` / `Suppr` | Déplacer vers la corbeille |
| `Échap` | Effacer la sélection / fermer la recherche |
| `?` | Ouvrir le guide des raccourcis |

---

## 🤝 Contribuer

Les contributions, signalements de bugs et suggestions de fonctionnalités sont les bienvenus !

- 🧪 **Beta Testing**: [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35) — Vote in the community poll!
1. Forkez le dépôt et créez votre branche : `git checkout -b feat/ma-fonctionnalite`
2. Vérifiez le code : `npm run lint` et `cargo fmt`
3. Rédigez des messages de commit clairs (ex : `feat(ui): ...`)
4. Ouvrez une Pull Request

---

## 📜 Licence

TeleDrive est un logiciel libre sous licence [GNU GPL-3.0 License](../LICENSE).

*Avertissement : TeleDrive est un projet open-source indépendant et n'est ni affilié à, ni sponsorisé, ni approuvé par Telegram FZ-LLC. Le stockage de gros volumes de fichiers reste soumis aux conditions d'utilisation et aux règles de Telegram.*

---

<div align="center">

Créé avec ❤️ par **[Senapati484](https://github.com/senapati484)**

Si vous appréciez TeleDrive, laissez une ⭐ sur [GitHub](https://github.com/senapati484/teledrive) !

</div>
