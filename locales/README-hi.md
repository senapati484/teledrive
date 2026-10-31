<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**असीमित व्यक्तिगत क्लाउड स्टोरेज, आपके अपने निजी टेलीग्राम चैनल द्वारा संचालित।**  
शून्य सर्वर लागत। शून्य सदस्यता शुल्क। सीधे टेलीग्राम के साथ सुरक्षित MTProto एन्क्रिप्शन।

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![कुल डाउनलोड](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![नवीनतम रिलीज़](https://img.shields.io/badge/रिलीज़-v0.1.3-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.3/)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Featured-FF6154.svg?style=flat-square&logo=producthunt&logoColor=white)](https://www.producthunt.com/products/teledrive-3)
[![YouTube डेमो](https://img.shields.io/badge/YouTube-वीडियो%20डेमो-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![लाइसेंस: GPL v3](https://img.shields.io/badge/लाइसेंस-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![GitHub स्टार्स](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

<br/>

<a href="https://www.producthunt.com/products/teledrive-3?utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-teledrive-3" target="_blank">
  <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1293880&theme=light" alt="TeleDrive - Unlimited Telegram cloud drive across 5 platforms. | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
</a>

<br/><br/>

[**वेबसाइट**](https://teledrive.space) • [**Product Hunt 🚀**](https://www.producthunt.com/products/teledrive-3) • [**डाउनलोड**](#-डाउनलोड) • [**बीटा टेस्टिंग पोल 🧪**](https://github.com/senapati484/teledrive/discussions/35) • [**वीडियो डेमो**](#-वीडियो-वॉकथ्रू-और-डेमो) • [**बग रिपोर्ट करें**](https://github.com/senapati484/teledrive/issues/new/choose) • [**सुविधा का अनुरोध करें**](https://github.com/senapati484/teledrive/issues/new/choose)

</div>

---

## 🎬 वीडियो वॉकथ्रू और डेमो

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="TeleDrive डेमो वीडियो" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ YouTube पर देखें: "I Turned Telegram Into Unlimited Cloud Storage"](https://youtu.be/4AiMn7HSlFg)**  
*सीधे MTProto फ़ाइल स्ट्रीमिंग, बहु-पृष्ठ PDF दृश्य, CSV तालिका विश्लेषण, CodeMirror 6 कोड संपादक और स्वचालित निर्देशिका बैकअप प्रदर्शित करने वाला पूर्ण वीडियो वॉकथ्रू।*

</div>

---

## 💡 TeleDrive ही क्यों?

टेलीग्राम निजी चैनलों में वस्तुतः असीमित मुफ्त क्लाउड स्टोरेज प्रदान करता है, लेकिन इसमें फ़ोल्डर पदानुक्रम, वर्चुअल कैटलॉग और डेस्कटॉप ड्राइव जैसी कार्यप्रणाली का अभाव है। **TeleDrive** इस अंतर को पाटता है:

- **शून्य मध्यस्थ सर्वर**: सभी फ़ाइल संचालन और MTProto कनेक्शन सीधे आपकी स्थानीय मशीन से टेलीग्राम डेटा केंद्रों तक होते हैं।
- **वर्चुअल ड्राइव**: नेस्टेड डायरेक्टरीज़, त्वरित खोज, तारांकित फ़ाइलें, संग्रह और रीसायकल बिन आपके चैनल में पिन किए गए कैटलॉग में अनुक्रमित होते हैं।
- **हार्डवेयर-एन्क्रिप्टेड वॉल्ट**: क्रेडेंशियल और सत्र कुंजी Argon2id-व्युत्पन्न कुंजियों का उपयोग करके Tauri Stronghold में सुरक्षित रूप से बंद हैं।
- **मल्टी-अकाउंट**: पूर्ण सत्र और स्थानीय वॉल्ट अलगाव के साथ कई फ़ोन नंबरों के बीच सहजता से स्विच करें।

---

## 📥 डाउनलोड

नवीनतम संस्करण: **v0.1.3** · सभी 5 प्लेटफ़ॉर्म के लिए पूर्व-संकलित मूल बाइनरी:

| ऑपरेटिंग सिस्टम | पैकेज प्रारूप | सीधा डाउनलोड लिंक | आर्किटेक्चर / अनुकूलता | आकार |
|:---|:---|:---|:---|---:|
| **Windows** | सेटअप इंस्टॉलर (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-setup.exe/download) | x64 64-Bit (Windows 10 / 11) | 5.8 MB |
| **Windows** | MSI पैकेज (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.msi/download) | एंटरप्राइज़ इंस्टॉलर (Win 10 / 11) | 7.3 MB |
| **macOS** | यूनिवर्सल डिस्क इमेज (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.dmg/download) | Apple Silicon (M1–M4) और Intel x64 | 14.4 MB |
| **Linux** | यूनिवर्सल AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.AppImage/download) | स्टैंडअलोन पोर्टेबल (glibc 2.31+) | 85.5 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.deb/download) | x86_64 / amd64 | 7.5 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.rpm/download) | x86_64 / amd64 | 7.5 MB |
| **Android** | यूनिवर्सल APK (`.apk`) | [**teledrive.apk**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.apk/download) | Android 8.0+ (ARM64, ARMv7a, x86_64) | 45.9 MB |
| **iOS** | साइडलोड पैकेज (`.ipa`) | [**teledrive.ipa**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive.ipa/download) | iOS 15.0+ (AltStore / TrollStore) | 24.1 MB |
| **iOS** | सिम्युलेटर बिल्ड (`.zip`) | [**teledrive-ios-simulator.zip**](https://sourceforge.net/projects/teledrive/files/v0.1.3/teledrive-ios-simulator.zip/download) | iOS सिम्युलेटर (x86_64 / arm64) | 24.1 MB |

> 🌐 संपूर्ण पैकेज कैटलॉग, मिरर लिंक और क्रिप्टोग्राफ़िक चेकसम [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) या [**teledrive.space**](https://teledrive.space) पर उपलब्ध हैं।

<details>
<summary>🔐 <b>SHA-256 क्रिप्टोग्राफ़िक चेकसम सत्यापित करें (v0.1.3)</b></summary>

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

## ✨ मुख्य विशेषताएं

- **वास्तव में असीमित क्लाउड**: बिना किसी आवर्ती शुल्क के आपके निजी टेलीग्राम चैनल को बैकएंड के रूप में उपयोग करता है।
- **हल्का और नेटिव क्रॉस-प्लेटफ़ॉर्म**: 5 प्लेटफ़ॉर्म (macOS, Windows, Linux, Android और iOS) के लिए Tauri v2 + Rust पर निर्मित, अत्यधिक तेज़ और कम मेमोरी उपयोग (सामान्यतः 250MB से कम)।
- **11 स्थानीय भाषाएं**: हिंदी, अंग्रेज़ी, स्पैनिश, जर्मन, फ्रेंच, पुर्तगाली, रूसी, चीनी (सरलीकृत और पारंपरिक), इंडोनेशियाई और जापानी के लिए पूर्ण नेटिव यूआई समर्थन।
- **डायरेक्ट MTProto स्ट्रीमिंग**: GramJS इंजन 4 समवर्ती अपलोड थ्रेड तक 512 KB विखंडों को सीधे स्ट्रीम करता है।
- **गोपनीयता सर्वोपरि**: कोई ट्रैकिंग नहीं, कोई टेलीमेट्री नहीं, कोई बिचौलिया सर्वर नहीं। आपकी फ़ाइलें केवल आपके और टेलीग्राम के बीच सुरक्षित रहती हैं।
- **व्यावसायिक अंतर्निहित उपकरण**: बहु-पृष्ठ PDF व्यूअर, इंटरैक्टिव CSV सॉर्टिंग और 20+ भाषाओं के सिंटैक्स हाइलाइटिंग वाला CodeMirror 6 कोड एडिटर।

---

## ⚙️ यह कैसे काम करता है

```
┌─────────────────────────────────────────────────────────────────┐
│                       React 19 फ्रंटएंड                             │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │   Zustand ग्लोबल स्टेट  │             │   GramJS क्लाइंट       │   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                        डायरेक्ट MTProto
        (बाइनरी कॉल ब्रिज)                      (सुरक्षित TLS 443)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Tauri Rust कोर       │              │   टेलीग्राम क्लाउड API       │
│  ┌───────────────────┐  │              │     (निजी चैनल)          │
│  │ Stronghold वॉल्ट    │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **डायरेक्ट कनेक्शन**: TLS पोर्ट 443 पर टेलीग्राम के आधिकारिक MTProto सर्वर से सीधे प्रमाणित होता है।
2. **चंक्ड मीडिया अपलोड**: बड़ी फ़ाइलों को 512 KB के टुकड़ों में विभाजित कर समानांतर रूप से स्ट्रीम करता है।
3. **पिन किया गया कैटलॉग इंडेक्स**: सभी डिवाइसों में फ़ोल्डर नेविगेशन के लिए आपके चैनल में पिन किए गए एन्क्रिप्टेड JSON कैटलॉग का रखरखाव करता है।

---

## 🧪 Beta Testers Wanted!

We are looking for beta testers to help test upcoming releases, performance enhancements, and new features:

> 🗳️ **Community Poll:**  
> **👉 [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35)**  
> Vote in our community poll, share your feedback, and get early access to pre-release builds!

## 🚀 आरंभ करना

### 🛠️ डेवलपर्स और योगदानकर्ताओं के लिए त्वरित शुरुआत

TeleDrive पूरी तरह से ओपन-सोर्स है और स्थानीय रूप से चलाना बेहद आसान है। इसमें पहले से अंतर्निहित विकास क्रेडेंशियल शामिल हैं, जिससे आप बिना किसी कस्टम टेलीग्राम डेवलपर ऐप बनाए 2 मिनट के भीतर योगदान शुरू कर सकते हैं।

#### 1. रिपॉजिटरी क्लोन करें
```bash
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

#### 2. निर्भरताएँ (Dependencies) इंस्टॉल करें
```bash
npm install
```
> ℹ️ *`postinstall` हुक स्वचालित रूप से GramJS MTProto संगतता पैच (`scripts/patch-telegram.cjs`) लागू करता है जो Tauri और ब्राउज़र के लिए आवश्यक हैं।*

#### 3. डेवलपमेंट सर्वर शुरू करें
```bash
# Tauri v2 हॉट-रीलोडिंग के साथ डेस्कटॉप एप्लिकेशन चलाएं:
npm run tauri dev

# या ब्राउज़र में वेब पूर्वावलोकन चलाएं:
npm run dev
```

---

### 📋 पूर्वापेक्षाएँ (Prerequisites)

- **Node.js**: `>= 18.0.0` (`v20+` LTS अनुशंसित)
- **Rust**: नवीनतम स्थिर संस्करण (`rustup default stable`)
- **सिस्टम टूलचेन**:
  - **macOS**: `xcode-select --install`
  - **Linux (Debian/Ubuntu)**: `sudo apt update && sudo apt install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Linux (Fedora/RHEL)**: `sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel`
  - **Windows**: Microsoft Visual Studio C++ Build Tools & WebView2

---

### 🧪 परीक्षण एवं सत्यापन

```bash
# Vitest टेस्ट सुइट चलाएं
npm test

# TypeScript प्रकार और Vite बंडल सत्यापित करें
npm run build

# Rust बैकएंड संकलन सत्यापित करें
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### 🔑 टेलीग्राम API क्रेडेंशियल (वैकल्पिक)

TeleDrive में स्थानीय परीक्षण के लिए डिफ़ॉल्ट क्रेडेंशियल पहले से मौजूद हैं। यदि आप अपने स्वयं के टेलीग्राम क्रेडेंशियल का उपयोग करना चाहते हैं:
1. [**my.telegram.org**](https://my.telegram.org) पर साइन इन करें।
2. **API development tools** पर जाएं और एक ऐप बनाएं (उदा. `TeleDrive-Dev`)।
3. अपना `api_id` और `api_hash` कॉपी करें।
4. इन्हें ऐप में **सेटिंग्स → API कॉन्फ़िगरेशन** में दर्ज करें या एक `.env` फ़ाइल बनाएं:
   ```env
   VITE_TELEGRAM_API_ID=your_api_id
   VITE_TELEGRAM_API_HASH=your_api_hash
   ```

---

### 📦 अंतिम उपयोगकर्ताओं के लिए प्री-कंपाइल इंस्टॉलर

यदि आप स्रोत कोड को कंपाइल किए बिना केवल TeleDrive का उपयोग करना चाहते हैं, तो ऊपर दी गई [**डाउनलोड तालिका**](#-डाउनलोड) या [**teledrive.space**](https://teledrive.space) से अपने ऑपरेटिंग सिस्टम (macOS, Windows, Linux, Android या iOS) के लिए इंस्टॉलर डाउनलोड करें। योगदान दिशानिर्देशों के लिए हमारा [**Contributing Guide (CONTRIBUTING.md)**](../CONTRIBUTING.md) देखें।
---

## ⌨️ कीबोर्ड शॉर्टकट

| शॉर्टकट | क्रिया |
|:---|:---|
| `/` या `⌘ F` | सर्च बार पर फ़ोकस करें |
| `⌘ A` | वर्तमान फ़ोल्डर के सभी आइटम चुनें |
| `⌘ D` | चयनित आइटम डाउनलोड करें |
| `F2` | चयनित आइटम का नाम बदलें |
| `Backspace` / `Del` | चयनित आइटम को ट्रैश में भेजें |
| `Esc` | चयन साफ़ करें / खोज से बाहर निकलें |
| `?` | कीबोर्ड शॉर्टकट तालिका खोलें |

---

## 🤝 योगदान दें

समस्याओं की रिपोर्ट करने, नई सुविधाओं के सुझाव देने और Pull Requests का स्वागत है!

- 🧪 **Beta Testing**: [Want to beta test the next version of TeleDrive? 🧪](https://github.com/senapati484/teledrive/discussions/35) — Vote in the community poll!
1. इस रेपो को Fork करें और अपनी शाखा बनाएं: `git checkout -b feat/my-feature`
2. कोड लिंटिंग चलाएं: `npm run lint` और `cargo fmt`
3. अर्थपूर्ण कमिट संदेश लिखें (उदा. `feat(ui): ...`)
4. एक Pull Request खोलें

---

## 📜 लाइसेंस

TeleDrive [GNU GPL-3.0 License](../LICENSE) के तहत लाइसेंस प्राप्त एक ओपन-सोर्स सॉफ़्टवेयर है।

*अस्वीकरण: TeleDrive एक स्वतंत्र ओपन-सोर्स प्रोजेक्ट है और यह Telegram FZ-LLC द्वारा प्रायोजित, समर्थित या उससे संबद्ध नहीं है। बड़ी फ़ाइलों का भंडारण टेलीग्राम की सेवा की शर्तों और API निष्पक्ष उपयोग नीतियों के अधीन है।*

---

<div align="center">

Created with ❤️ by **[Senapati484](https://github.com/senapati484)**

यदि आपको TeleDrive उपयोगी लगा, तो कृपया [GitHub](https://github.com/senapati484/teledrive) पर एक ⭐ दें!

</div>
