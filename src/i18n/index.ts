import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

/**
 * Translation resources live in `locales/<language>/<namespace>.json`.
 * Every JSON file is picked up automatically, so adding a new language is
 * just a matter of creating a new folder with the same namespace files.
 */
const modules = import.meta.glob<{ default: Record<string, unknown> }>("./locales/*/*.json", {
  eager: true,
});

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, lng, ns] = match;
  (resources[lng] ??= {})[ns] = mod.default;
}

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "es", label: "Español" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "zh-CN", label: "简体中文" },
  { code: "hi", label: "हिन्दी" },
  { code: "fr", label: "Français" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "ja", label: "日本語" },
  { code: "de", label: "Deutsch" },
  { code: "ru", label: "Русский" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const LANGUAGE_STORAGE_KEY = "teledrive-language";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    // "pt" / "pt-PT" system locales fall back to pt-BR before English.
    nonExplicitSupportedLngs: false,
    load: "currentOnly",
    defaultNS: "common",
    ns: Object.keys(resources.en ?? {}),
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
      convertDetectedLanguage: (lng: string) => {
        const lower = lng.toLowerCase();
        if (lower.startsWith("pt")) return "pt-BR";
        if (lower.startsWith("es")) return "es";
        if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo" || lower.includes("hant")) return "zh-TW";
        if (lower.startsWith("zh")) return "zh-CN";
        if (lower.startsWith("hi")) return "hi";
        if (lower.startsWith("fr")) return "fr";
        if (lower.startsWith("id") || lower.startsWith("in")) return "id";
        if (lower.startsWith("ja")) return "ja";
        if (lower.startsWith("de")) return "de";
        if (lower.startsWith("ru")) return "ru";
        return lng;
      },
    },
    returnNull: false,
  });

i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
});
if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.resolvedLanguage ?? "en";
}

export default i18n;
