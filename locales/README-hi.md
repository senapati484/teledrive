<div align="center">

<img src="../src-tauri/icons/icon.png" alt="TeleDrive logo" width="100" height="100" />

# TeleDrive

**असीमित व्यक्तिगत क्लाउड स्टोरेज, आपके अपने निजी टेलीग्राम चैनल द्वारा संचालित।**  
शून्य सर्वर लागत। शून्य सदस्यता शुल्क। सीधे टेलीग्राम के साथ सुरक्षित MTProto एन्क्रिप्शन।

[**English**](../README.md) • [**Português (Brasil)**](README-pt-BR.md) • [**Español**](README-es.md) • [**繁體中文**](README-zh-TW.md) • [**简体中文**](README-zh-CN.md) • [**हिन्दी**](README-hi.md) • [**Français**](README-fr.md) • [**Bahasa Indonesia**](README-id.md) • [**Русский**](README-ru.md) • [**日本語**](README-ja.md) • [**Deutsch**](README-de.md)

[![कुल डाउनलोड](https://img.shields.io/sourceforge/dt/teledrive?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/teledrive/files/)
[![नवीनतम रिलीज़](https://img.shields.io/badge/रिलीज़-v0.1.1-2082f7.svg?style=flat-square)](https://sourceforge.net/projects/teledrive/files/v0.1.1/)
[![YouTube डेमो](https://img.shields.io/badge/YouTube-वीडियो%20डेमो-red.svg?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/4AiMn7HSlFg)
[![लाइसेंस: GPL v3](https://img.shields.io/badge/लाइसेंस-GPLv3-gray.svg?style=flat-square)](../LICENSE)
[![GitHub स्टार्स](https://img.shields.io/github/stars/senapati484/teledrive?style=flat-square&logo=github)](https://github.com/senapati484/teledrive/stargazers)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131.svg?style=flat-square&logo=tauri&logoColor=black)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

[**वेबसाइट**](https://teledrive.space) • [**डाउनलोड**](#-डाउनलोड) • [**वीडियो डेमो**](#-वीडियो-वॉकथ्रू-और-डेमो) • [**बग रिपोर्ट करें**](https://github.com/senapati484/teledrive/issues/new) • [**सुविधा का अनुरोध करें**](https://github.com/senapati484/teledrive/issues/new)

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

नवीनतम संस्करण: **v0.1.1** · सभी प्रमुख ऑपरेटिंग सिस्टम के लिए पूर्व-संकलित मूल बाइनरी:

| ऑपरेटिंग सिस्टम | पैकेज प्रारूप | सीधा डाउनलोड लिंक | आकार |
|:---|:---|:---|---:|
| **Windows** | सेटअप इंस्टॉलर (`.exe`) | [**teledrive-setup.exe**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive-setup.exe/download) | 5.5 MB |
| **Windows** | MSI पैकेज (`.msi`) | [**teledrive.msi**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.msi/download) | 7.2 MB |
| **macOS** | यूनिवर्सल डिस्क इमेज (`.dmg`) | [**teledrive.dmg**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.dmg/download) | 15.8 MB |
| **Linux** | यूनिवर्सल AppImage (`.AppImage`) | [**teledrive.AppImage**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.AppImage/download) | 86.1 MB |
| **Linux** | Debian / Ubuntu (`.deb`) | [**teledrive.deb**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.deb/download) | 8.4 MB |
| **Linux** | Fedora / RHEL (`.rpm`) | [**teledrive.rpm**](https://sourceforge.net/projects/teledrive/files/v0.1.1/teledrive.rpm/download) | 8.0 MB |

> 🌐 संपूर्ण पैकेज कैटलॉग, मिरर लिंक और चेकसम [**SourceForge**](https://sourceforge.net/projects/teledrive/files/) या [**teledrive.space**](https://teledrive.space) पर उपलब्ध हैं।

---

## ✨ मुख्य विशेषताएं

- **वास्तव में असीमित क्लाउड**: बिना किसी आवर्ती शुल्क के आपके निजी टेलीग्राम चैनल को बैकएंड के रूप में उपयोग करता है।
- **हल्का और नेटिव क्रॉस-प्लेटफ़ॉर्म**: Tauri v2 + Rust पर निर्मित, अत्यधिक तेज़ और कम मेमोरी उपयोग (सामान्यतः 250MB से कम)।
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

## 🚀 आरंभ करना

### 1. टेलीग्राम API क्रेडेंशियल प्राप्त करें

1. अपने फ़ोन नंबर के साथ [my.telegram.org](https://my.telegram.org) पर साइन इन करें।
2. **API development tools** खोलें और एक ऐप बनाएं (जैसे `TeleDrive`)।
3. अपना `api_id` और `api_hash` कॉपी करें और TeleDrive को पहली बार शुरू करते समय दर्ज करें।

### 2. सोर्स कोड से चलाएं

**आवश्यकताएं:**
- [Rust & Cargo](https://rustup.rs/) (1.78+)
- [Node.js](https://nodejs.org/) (20.19+ या 22.12+)

```bash
# रिपॉजिटरी क्लोन करें
git clone https://github.com/senapati484/teledrive.git
cd teledrive

# निर्भरताएं इंस्टॉल करें
npm install

# डेवलपमेंट मोड में डेस्कटॉप ऐप शुरू करें
npm run tauri dev
```

### 3. रिलीज़ बाइनरी बनाएं

```bash
npm run tauri build
```
संकलित इंस्टॉलर (`.dmg`, `.exe` / `.msi`, `.deb` / `.AppImage`) `src-tauri/target/release/bundle/` निर्देशिका में उत्पन्न होंगे।

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
