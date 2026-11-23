<div align="center">

<img src="../docs/logo.png" alt="TeleDrive logo" width="110" />

# TeleDrive

**असीमित व्यक्तिगत क्लाउड स्टोरेज, आपके अपने निजी टेलीग्राम चैनल द्वारा संचालित।**  
शून्य सर्वर लागत। शून्य सदस्यता शुल्क। सीधे टेलीग्राम पर एंड-टू-एंड MTProto एन्क्रिप्शन।

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![Total Downloads](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![Monthly Downloads](https://img.shields.io/sourceforge/dm/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![रिलीज़](https://img.shields.io/badge/release-v0.1.5-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.5/)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Featured-FF6154.svg?style=flat-square&logo=producthunt&logoColor=white)](https://www.producthunt.com/products/teledrive-3)
[![YouTube Walkthrough](https://img.shields.io/badge/YouTube-Video%20Demo-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![लाइसेंस: GPL v3](https://img.shields.io/badge/license-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

<br/>

<p align="center">
  <a href="https://www.producthunt.com/products/teledrive-3?utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-teledrive-3" target="_blank" rel="noopener noreferrer">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1293880&theme=light" alt="TeleDrive on Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
  </a>
  &nbsp;&nbsp;
  <a href="https://sourceforge.net/projects/teledrive/files/latest/download" target="_blank" rel="noopener noreferrer">
    <img src="https://a.fsdn.com/con/app/sf-download-button" alt="Download TeleDrive on SourceForge" style="width: 276px; height: 54px;" width="276" height="54" />
  </a>
</p>

<p align="center">
  <a href="https://sourceforge.net/projects/teledrive/" target="_blank" rel="noopener noreferrer">
    <img src="https://b.sf-syn.com/badge_img/4107869/oss-rising-star-black?achievement=oss-rising-star" alt="SourceForge Rising Star Award" width="105" />
  </a>
  &nbsp;&nbsp;
  <a href="https://sourceforge.net/projects/teledrive/" target="_blank" rel="noopener noreferrer">
    <img src="https://b.sf-syn.com/badge_img/4107869/oss-sf-favorite-black?achievement=oss-sf-favorite" alt="SourceForge Favorite Award" width="105" />
  </a>
  &nbsp;&nbsp;
  <a href="https://sourceforge.net/projects/teledrive/" target="_blank" rel="noopener noreferrer">
    <img src="https://b.sf-syn.com/badge_img/4107869/oss-open-source-excellence-black?achievement=oss-open-source-excellence" alt="SourceForge Open Source Excellence Award" width="105" />
  </a>
  &nbsp;&nbsp;
  <a href="https://sourceforge.net/projects/teledrive/" target="_blank" rel="noopener noreferrer">
    <img src="https://b.sf-syn.com/badge_img/4107869/oss-community-choice-black?achievement=oss-community-choice" alt="SourceForge Community Choice Award" width="105" />
  </a>
  &nbsp;&nbsp;
  <a href="https://sourceforge.net/projects/teledrive/" target="_blank" rel="noopener noreferrer">
    <img src="https://b.sf-syn.com/badge_img/4107869/oss-users-love-us-black" alt="SourceForge Users Love Us Award" width="105" />
  </a>
</p>

<br/><br/>

[**वेबसाइट**](https://teledrive.space) • [**Product Hunt 🚀**](https://www.producthunt.com/products/teledrive-3) • [**डाउनलोड**](#-डाउनलोड) • [**आर्किटेक्चर दस्तावेज़ 🏗️**](../docs/ARCHITECTURE.md) • [**Star History ⭐**](#star-history) • [**v0.1.5 में क्या नया है 📝**](https://github.com/senapati484/teledrive/releases/tag/v0.1.5) • [**बीटा टेस्टिंग पोल 🧪**](https://github.com/senapati484/teledrive/discussions/35) • [**वीडियो डेमो**](#-वीडियो-वॉकथ्रू-और-डेमो) • [**बग रिपोर्ट करें**](https://github.com/senapati484/teledrive/issues/new/choose) • [**सुविधा का अनुरोध करें**](https://github.com/senapati484/teledrive/issues/new/choose)

</div>

---

> [!IMPORTANT]
> 🚀 **TeleDrive v0.1.5 आधिकारिक तौर पर लाइव है!** हार्डवेयर बायोमेट्रिक्स प्रमाणीकरण (Touch ID, Windows Hello, Android Biometrics), 4-6 अंकों का गतिशील पिन, ऐप स्विचर प्राइवेसी शील्ड, लाइव इन-ऐप अपडेट चेकर और परिष्कृत UI/UX शिल्प। [**v0.1.5 रिलीज़ नोट्स**](https://github.com/senapati484/teledrive/releases/tag/v0.1.5) देखें या नीचे सत्यापित इंस्टॉलर डाउनलोड करें।

---

## 🎬 वीडियो वॉकथ्रू और डेमो

<div align="center">

<a href="https://youtu.be/4AiMn7HSlFg" target="_blank">
  <img src="https://img.youtube.com/vi/4AiMn7HSlFg/maxresdefault.jpg" alt="TeleDrive Demo Video" width="800" style="max-width: 100%; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);" />
</a>

<br/>

**[▶️ YouTube पर देखें: «I Turned Telegram Into Unlimited Cloud Storage»](https://youtu.be/4AiMn7HSlFg)**  
*संपूर्ण वीडियो वॉकथ्रू: प्रत्यक्ष MTProto फ़ाइल स्ट्रीमिंग, बहु-पृष्ठ PDF व्यूअर, CSV डेटा विश्लेषण, CodeMirror 6 कोड एडिटर और स्वचालित फ़ोल्डर बैकअप।*

</div>

---

## 💡 TeleDrive ही क्यों?

टेलीग्राम निजी चैनलों में वस्तुतः असीमित क्लाउड स्टोरेज प्रदान करता है, लेकिन इसमें फ़ोल्डर पदानुक्रम, वर्चुअल कैटलॉग और डेस्कटॉप ड्राइव वर्कफ़्लो का अभाव है। **TeleDrive** इस अंतर को पाटता है:

- **शून्य रिले बैकएंड**: सभी फ़ाइल ऑपरेशन और MTProto कनेक्शन आपके स्थानीय डिवाइस से सीधे टेलीग्राम डेटा केंद्रों तक होते हैं।
- **वर्चुअल ड्राइव**: नेस्टेड फ़ोल्डर, त्वरित खोज, पसंदीदा, संग्रह और ट्रैश आपके चैनल में पिन किए गए gzip-संपीड़ित स्कीमा v3 कैटलॉग में अनुक्रमित होते हैं और IndexedDB में स्थानीय रूप से कैश किए जाते हैं।
- **क्लाइंट-साइड गोपनीयता और सुरक्षित वॉल्ट**: स्थानीय क्रेडेंशियल एक परमाणु रस्ट कुंजी-मान वॉल्ट / टौरी स्ट्रॉन्गहोल्ड स्नैपशॉट में रहते हैं, जिसमें अपलोड की गई फ़ाइलों के लिए वैकल्पिक शून्य-ज्ञान `TDE1` PBKDF2-SHA256 + AES-256-GCM एन्क्रिप्शन शामिल है।
- **मल्टी-अकाउंट सपोर्ट**: पूर्ण सत्र और स्थानीय वॉल्ट अलगाव के साथ कई फ़ोन नंबरों के बीच निर्बाध रूप से स्विच करें।

---

## 📥 डाउनलोड

नवीनतम रिलीज़: **v0.1.5** · सभी 5 प्लेटफ़ॉर्म के लिए पूर्व-संकलित मूल बाइनरी:

| ऑपरेटिंग सिस्टम | पैकेज प्रारूप | सीधा डाउनलोड लिंक | आर्किटेक्चर / संगतता | आकार |
|:---|:---|:---|:---|---:|
| **Windows** | सेटअप इंस्टॉलर (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.5/teledrive-setup.exe/download) | x64 64-Bit (Windows 10 / 11) | 6.0 MB |
| **Windows** | MSI पैकेज (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.5/teledrive.msi/download) | एंटरप्राइज़ इंस्टॉलर (Win 10 / 11) | 7.5 MB |
| **macOS** | यूनिवर्सल डिस्क इमेज (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.5/teledrive.dmg/download) | Apple Silicon (M1–M4) और Intel x64 | 15.0 MB |
| **Linux** | यूनिवर्सल AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.5/teledrive.AppImage/download) | स्टैंडअलोन पोर्टेबल (glibc 2.31+) | 82.4 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.5/teledrive.deb/download) | x86_64 / amd64 | 7.8 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.5/teledrive.rpm/download) | x86_64 / amd64 | 7.8 MB |
| **Android** | यूनिवर्सल APK (`.apk`) | [**teledrive.apk**](https://sourceforge.net/projects/teledrive/files/v0.1.5/teledrive.apk/download) | Android 8.0+ (ARM64, ARMv7a, x86_64) | 46.8 MB |
| **iOS** | साइडलोड पैकेज (`.ipa`) | [**teledrive.ipa**](https://sourceforge.net/projects/teledrive/files/v0.1.5/teledrive.ipa/download) | iOS 15.0+ (AltStore / TrollStore / SideStore) | 23.1 MB |

> 🌐 संपूर्ण पैकेज कैटलॉग, मिरर लिंक और चेकसम [**SourceForge**](https://sourceforge.net/projects/teledrive/files/v0.1.5/) या [**teledrive.space**](https://teledrive.space) पर उपलब्ध हैं।

<details>
<summary>🔐 <b>SHA-256 क्रिप्टोग्राफ़िक चेकसम सत्यापित करें (v0.1.5)</b></summary>

```
ccd312b929778edc7d3f9969eac29e89c013464e9f8fe60dc77143aff289776e  teledrive-setup.exe
77473cd7e9c2a62fe91953cce18f3a848f48ac099a6521c2372b8be6165949c7  teledrive.AppImage
523db94bb82d55433e74364380ef292d8ac42c79b1d31740cb4222f4071ad5f0  teledrive.apk
14a982f9784fd03ff1cce64d1830c281957493edc1a979fdaeb20be7f21b0304  teledrive.deb
9c81dece56a58a535ba238dd840f097eedc4b5cda4d64a40abc224e9a90e557a  teledrive.dmg
89d428a70ef005fbc12d6ea48456546562ddb76576f60466c5b9a51d05934549  teledrive.ipa
c6f6c3a6c88104527ee3d88ee159f425b4fb91b03846cd9f31c201f0590d342e  teledrive.msi
5ffa74bd2e50bd841bba2cdbc4470ed0f15dfcbc382d91e1b83b2e46464a9a68  teledrive.rpm
```

टर्मिनल में बाइनरी अखंडता की पुष्टि करें:
```bash
shasum -a 256 <फ़ाइल_का_नाम>
```
</details>

---

## ✨ मुख्य विशेषताएं

- **हार्डवेयर बायोमेट्रिक्स और ऐप लॉक (v0.1.5)**: Touch ID, Windows Hello और Android बायोमेट्रिक्स, अनुकूलन योग्य 4–6 अंकों के डायनामिक पिन, ऐप स्विचर प्राइवेसी शील्ड और निष्क्रियता ऑटो-लॉक टाइमर के साथ अपने ड्राइव को सुरक्षित करें।
- **लाइव इन-ऐप अपडेट चेकर (v0.1.5)**: आधिकारिक रिलीज़ के लिए स्वचालित पृष्ठभूमि और ऑन-डिमांड संस्करण जांच, इन-ऐप रिलीज़ अलर्ट और सीधे SourceForge इंस्टॉलर डाउनलोड लिंक के साथ।
- **वास्तव में असीमित क्लाउड**: शून्य आवर्ती शुल्क, SHA-256 डुप्लिकेट पहचान (`<= 2 GiB` शून्य-अपलोड संदेश क्लोनिंग) और रिज़्यूमेबल चेकपॉइंट के साथ आपके निजी टेलीग्राम चैनल का उपयोग।
- **एकल-फ़ाइल सीमा को बायपास करें (`> 2/4 GB`)**: अत्यधिक बड़ी फ़ाइलों को स्वतः व्यवस्थित खंडों में विभाजित करता है और डाउनलोड करते समय उन्हें सहज रूप से स्ट्रीम करता है।
- **वैकल्पिक शून्य-ज्ञान E2EE (`TDE1`)**: यादृच्छिक ब्लॉक एक्सेस के साथ क्लाइंट-साइड PBKDF2-SHA256 + 512 KiB चंक्ड AES-256-GCM एन्क्रिप्शन।
- **सार्वभौमिक इन-ऐप पूर्वावलोकनकर्ता और ग्रिड थंबनेल**:
  - छवियों, ब्राउज़र में चलने वाले वीडियो और PDF (पहला पृष्ठ) के लिए वास्तविक ग्रिड थंबनेल।
  - PDF (`pdf.js`), Office और OpenDocument फ़ाइलें (`.docx`, `.odt`, `.rtf`, `.epub`), बहु-शीट स्प्रेडशीट (`.xlsx`, `.ods`, `.csv`, `.tsv`), प्रस्तुतियाँ (`.pptx`, `.odp`), संपीड़ित अभिलेखागार (`.zip`, `.tar`, `.tar.gz`, `.tgz`, `.gz`, `.apk`, `.jar`), सैंडबॉक्स किया गया HTML, CodeMirror 6 कोड एडिटर (50+ भाषाएँ), UTF-16 टेक्स्ट, HEIC छवियां और मीडिया स्ट्रीमिंग।
- **अल्ट्रा-लाइटवेट नेटिव क्रॉस-प्लेटफ़ॉर्म**: Tauri v2 और Rust पर निर्मित 5 प्लेटफ़ॉर्म (macOS, Windows, Linux, Android और iOS) के लिए त्वरित और हल्का ऐप।
- **स्वचालित फ़ोल्डर बैकअप और क्रॉस-डिवाइस सिंक**: क्रैश-सुरक्षित वृद्धिशील बैकअप और मल्टी-डिवाइस डेल्टा पोलिंग के लिए जर्नल्ड `v2` स्थानीय मैनिफ़ेस्ट।
- **11 स्थानीयकृत भाषाएँ**: हिंदी, अंग्रेजी, स्पैनिश, जर्मन, फ्रेंच, पुर्तगाली, रूसी, चीनी (सरलीकृत और पारंपरिक), इंडोनेशियाई और जापानी के लिए पूर्ण नेटिव समर्थन।
- **पाइपलाइन्ड MTProto इंजन**: अधिकतम 3 समानांतर MTProto `upload.GetFile` / `SaveBigFilePart` वर्करों और अनुकूली `FloodWait` हैंडलिंग के साथ सीधा 512 KiB चंक स्ट्रीमिंग।

---

## ⚙️ यह कैसे काम करता है

```
┌─────────────────────────────────────────────────────────────────┐
│                       React 19 Frontend                         │
│   ┌─────────────────────┐             ┌─────────────────────┐   │
│   │    Zustand State    │             │ GramJS Client Engine│   │
│   └──────────┬──────────┘             └──────────┬──────────┘   │
└──────────────┼───────────────────────────────────┼──────────────┘
               │                                   │
           Tauri IPC                           प्रत्यक्ष MTProto
         (Bridge कॉल)                         (सुरक्षित SSL/TLS)
               │                                   │
┌──────────────▼──────────┐              ┌─────────▼──────────────┐
│     Tauri Rust Core     │              │   Telegram Cloud API   │
│  ┌───────────────────┐  │              │     (निजी चैनल)        │
│  │ Stronghold Vault  │  │              └────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

1. **सीधा कनेक्शन**: सुरक्षित TLS पोर्ट 443 पर सीधे टेलीग्राम MTProto सर्वर से प्रमाणित होता है।
2. **पाइपलाइन्ड मीडिया ट्रांसफर**: फ़ाइलों को रिज़्यूमेबल चेकपॉइंट, वैकल्पिक `TDE1` AEAD एन्क्रिप्शन और 2/4 GiB से बड़ी फ़ाइलों के लिए मल्टी-सेगमेंट स्प्लिटिंग के साथ 512 KiB चंक में काटता है।
3. **पिन किया गया कैटलॉग इंडेक्स और स्थानीय कैश**: एक सिंगल-राइटर `IndexQueue` के माध्यम से आपके चैनल में पिन किए गए gzip-कंप्रेस्ड स्कीमा v3 JSON इंडेक्स को बनाए रखता है, जो स्टार्टअप पर IndexedDB (`teledrive_cache_v1`) से लोड होता है।

> 📘 **गहन तकनीकी विवरण:** सिस्टम सीमाओं, अनुक्रम आरेखों, Tauri Rust IPC कमांड, एन्क्रिप्शन प्रारूप और मॉड्यूल संदर्भों के लिए [**तकनीकी वास्तुकला और इंजीनियरिंग गाइड (`docs/ARCHITECTURE.md`)**](../docs/ARCHITECTURE.md) देखें।

---

## 🧪 Beta Testers Wanted!

हम आगामी रिलीज़, प्रदर्शन संवर्द्धन और नई सुविधाओं का परीक्षण करने के लिए बीटा परीक्षकों की तलाश कर रहे हैं:

> 🗳️ **सामुदायिक मतदान:**  
> **👉 [क्या आप TeleDrive के अगले संस्करण का बीटा परीक्षण करना चाहते हैं? 🧪](https://github.com/senapati484/teledrive/discussions/35)**  
> हमारे सामुदायिक पोल में वोट करें, अपनी प्रतिक्रिया साझा करें और प्री-रिलीज़ बिल्ड तक जल्दी पहुंच प्राप्त करें!

---

## 🚀 आरंभ करना

### 🛠️ डेवलपर्स और योगदानकर्ताओं के लिए त्वरित शुरुआत

TeleDrive 100% ओपन-सोर्स है और 2 मिनट से भी कम समय में स्थानीय रूप से सेट हो जाता है। इसमें अंतर्निहित विकास क्रेडेंशियल शामिल हैं, इसलिए आपको कस्टम टेलीग्राम डेवलपर ऐप बनाने की आवश्यकता नहीं है।

#### 1. रिपॉजिटरी क्लोन करें
```bash
git clone https://github.com/senapati484/teledrive.git
cd teledrive
```

#### 2. निर्भरताएँ स्थापित करें
```bash
npm install
```
> ℹ️ *`postinstall` हुक स्वचालित रूप से GramJS MTProto संगतता पैच (`scripts/patch-telegram.cjs`) लागू करता है जो Tauri और ब्राउज़र रनटाइम के लिए आवश्यक हैं।*

#### 3. विकास सर्वर प्रारंभ करें
```bash
# Tauri v2 हॉट-रीलोडिंग के साथ क्रॉस-प्लेटफ़ॉर्म डेस्कटॉप ऐप चलाएं:
npm run tauri dev

# या ब्राउज़र में वेब क्लाइंट पूर्वावलोकन चलाएं:
npm run dev
```

---

### 📋 पूर्वापेक्षाएँ

स्थानीय रूप से चलाने से पहले सुनिश्चित करें कि आपका विकास वातावरण इन बुनियादी आवश्यकताओं को पूरा करता है:

| आवश्यकता | समर्थित संस्करण | टिप्पणियाँ |
|:---|:---|:---|
| **Node.js** | `>= 18.0.0` (`v20+` LTS अनुशंसित) | JavaScript/TypeScript रनटाइम और पैकेज टूलींग |
| **Rust** | नवीनतम स्थिर (`rustup default stable`) | नेटिव Tauri रस्ट कोर को संकलित करने के लिए आवश्यक |
| **सिस्टम टूलचेन** | प्लेटफ़ॉर्म विशिष्ट (नीचे देखें) | C/C++ कंपाइलर और वेबव्यू रनटाइम लाइब्रेरी |

#### प्लेटफ़ॉर्म-विशिष्ट बिल्ड निर्भरताएँ
- **macOS**:
  ```bash
  xcode-select --install
  ```
- **Linux (Ubuntu / Debian)**:
  ```bash
  sudo apt update && sudo apt install -y build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  ```
- **Linux (Fedora / RHEL)**:
  ```bash
  sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel
  ```
- **Windows**:
  - [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++" चुनें)।
  - [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (Windows 10/11 पर पहले से इंस्टॉल)।

---

### 🧪 सत्यापन और परीक्षण

पुल अनुरोध सबमिट करने से पहले, स्थानीय सत्यापन जांच चलाएं:

```bash
# Vitest परीक्षण सूट चलाएं
npm test

# TypeScript प्रकारों और Vite बंडल को सत्यापित करें
npm run build

# रस्ट बैकएंड संकलन सत्यापित करें और परीक्षण चलाएं
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

---

### 🔑 टेलीग्राम API क्रेडेंशियल (वैकल्पिक)

TeleDrive में स्थानीय विकास के लिए क्रेडेंशियल शामिल हैं। यदि आप अपने स्वयं के टेलीग्राम एप्लिकेशन आईडी और हैश का उपयोग करना चाहते हैं:
1. अपने फ़ोन नंबर से [**my.telegram.org**](https://my.telegram.org) पर साइन इन करें।
2. **API development tools** पर जाएं और एक एप्लिकेशन बनाएं (जैसे `TeleDrive-Dev`)।
3. अपना `api_id` और `api_hash` कॉपी करें।
4. उन्हें ऐप के अंदर **सेटिंग्स → API कॉन्फ़िगरेशन** में दर्ज करें, या रूट निर्देशिका में एक `.env` फ़ाइल बनाएं:
   ```env
   VITE_TELEGRAM_API_ID=your_api_id
   VITE_TELEGRAM_API_HASH=your_api_hash
   ```

---

### 📦 अंतिम उपयोगकर्ताओं के लिए संकलित इंस्टॉलर

यदि आप स्रोत कोड से संकलित किए बिना TeleDrive का उपयोग करना चाहते हैं, तो ऊपर दी गई [**डाउनलोड तालिका**](#-डाउनलोड) या [**teledrive.space**](https://teledrive.space) से आधिकारिक इंस्टॉलर डाउनलोड करें।

पुल अनुरोध परंपराओं, शाखा नामकरण और वास्तुशिल्प दिशानिर्देशों के लिए, कृपया हमारे [**योगदान दिशानिर्देश (CONTRIBUTING.md)**](../CONTRIBUTING.md) की समीक्षा करें।

---

## ⌨️ कीबोर्ड शॉर्टकट

| शॉर्टकट | क्रिया |
|:---|:---|
| `/` या `⌘ F` | खोज बार पर फ़ोकस करें |
| `⌘ A` | फ़ोल्डर के सभी आइटम चुनें |
| `⌘ D` | चयनित आइटम डाउनलोड करें |
| `F2` | चयनित आइटम का नाम बदलें |
| `Backspace` / `Del` | चयनित आइटम को ट्रैश में ले जाएं |
| `Esc` | चयन साफ़ करें / खोज से बाहर निकलें |
| `?` | कीबोर्ड शॉर्टकट सहायता खोलें |

---

## 🤝 योगदान दें

हम बग रिपोर्ट, प्रतिक्रिया, विचारों और पुल अनुरोधों का स्वागत करते हैं!

- 🧪 **बीटा परीक्षण**: [क्या आप TeleDrive के अगले संस्करण का परीक्षण करना चाहते हैं? 🧪](https://github.com/senapati484/teledrive/discussions/35) — पोल में वोट करें!
- 💬 **चर्चाएँ**: प्रश्न पूछने या विचार साझा करने के लिए हमारी [GitHub Discussions](https://github.com/senapati484/teledrive/discussions) से जुड़ें।
- 🛠️ **विकास गाइड**: स्थानीय वातावरण सेटअप और PR दिशानिर्देशों के लिए [**CONTRIBUTING.md**](../CONTRIBUTING.md) पढ़ें।
- 🏗️ **वास्तुकला संदर्भ**: MTProto इंजन, स्कीमा v3 कैटलॉग और रस्ट कोर पर विस्तृत दस्तावेज़ के लिए [**docs/ARCHITECTURE.md**](../docs/ARCHITECTURE.md) पढ़ें।
- 🐛 **समस्याओं की रिपोर्ट करें**: हमारे संरचित [इश्यू फॉर्म्स](https://github.com/senapati484/teledrive/issues/new/choose) का उपयोग करें।

---

## 📜 लाइसेंस

TeleDrive [GNU GPL-3.0 लाइसेंस](../LICENSE) के तहत जारी किया गया ओपन-सोर्स सॉफ्टवेयर है।

*अस्वीकरण: TeleDrive एक स्वतंत्र ओपन-सोर्स परियोजना है और यह Telegram FZ-LLC द्वारा संबद्ध, प्रायोजित या समर्थित नहीं है। बड़ी मात्रा में फ़ाइलों को संग्रहीत करना टेलीग्राम की सेवा की शर्तों और API उचित-उपयोग नीतियों के अधीन है।*

---

## Star History

<a href="https://www.star-history.com/?repos=senapati484%2Fteledrive&type=date&releases=&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=senapati484/teledrive&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=senapati484/teledrive&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=senapati484/teledrive&type=date&legend=top-left" />
 </picture>
</a>

---

<div align="center">

Created with ❤️ by **[Senapati484](https://github.com/senapati484)**

If you like TeleDrive, give it a ⭐ on [GitHub](https://github.com/senapati484/teledrive)!

</div>
