export type WhatsNewIconKey =
  | "sync"
  | "mobile"
  | "preview"
  | "code"
  | "security"
  | "language"
  | "dnd"
  | "speed"
  | "sparkle";

export interface ParsedWhatsNewFeature {
  title: string;
  description: string | null;
  iconKey: WhatsNewIconKey;
}

const FEATURE_SEPARATORS = [" — ", "——", " - ", " – "] as const;

export function parseFeatureItem(
  featureText: string,
  index: number
): ParsedWhatsNewFeature {
  let title = featureText;
  let description: string | null = null;

  for (const sep of FEATURE_SEPARATORS) {
    if (featureText.includes(sep)) {
      const parts = featureText.split(sep);
      title = parts[0].trim();
      description = parts.slice(1).join(sep).trim();
      break;
    }
  }

  const lower = featureText.toLowerCase();
  let iconKey: WhatsNewIconKey = "sparkle";

  if (
    lower.includes("backup") ||
    lower.includes("mirror") ||
    lower.includes("sync") ||
    lower.includes("sincron") ||
    lower.includes("备份") ||
    lower.includes("備份") ||
    lower.includes("sauvegarde") ||
    lower.includes("sicherung") ||
    lower.includes("copia") ||
    lower.includes("pencadangan") ||
    lower.includes("резерв") ||
    lower.includes("синхрон") ||
    lower.includes("बैकअप") ||
    lower.includes("सिंक") ||
    lower.includes("同期") ||
    lower.includes("同步") ||
    lower.includes("协同")
  ) {
    iconKey = "sync";
  } else if (
    lower.includes("android") ||
    lower.includes("mobile") ||
    lower.includes("phone") ||
    lower.includes("ios") ||
    lower.includes("móvil") ||
    lower.includes("seluler") ||
    lower.includes("mobil") ||
    lower.includes("移动") ||
    lower.includes("行動") ||
    lower.includes("モバイル")
  ) {
    iconKey = "mobile";
  } else if (
    lower.includes("preview") ||
    lower.includes("thumbnail") ||
    lower.includes("archive") ||
    lower.includes("viewer") ||
    lower.includes("visua") ||
    lower.includes("view") ||
    lower.includes("previsual") ||
    lower.includes("vista previa") ||
    lower.includes("miniatura") ||
    lower.includes("vorschau") ||
    lower.includes("aperçu") ||
    lower.includes("просмотр") ||
    lower.includes("миниатюр") ||
    lower.includes("peninjau") ||
    lower.includes("pratinjau") ||
    lower.includes("प्रीव्यू") ||
    lower.includes("पूर्वावलोकन") ||
    lower.includes("थंबनेल") ||
    lower.includes("预览") ||
    lower.includes("預覽") ||
    lower.includes("プレビュー")
  ) {
    iconKey = "preview";
  } else if (lower.includes("code") || lower.includes("editor")) {
    iconKey = "code";
  } else if (
    lower.includes("secur") ||
    lower.includes("encrypt") ||
    lower.includes("tde1") ||
    lower.includes("zero-knowledge") ||
    lower.includes("segur") ||
    lower.includes("cifrad") ||
    lower.includes("chiffr") ||
    lower.includes("sicher") ||
    lower.includes("verschlüss") ||
    lower.includes("safe") ||
    lower.includes("vault") ||
    lower.includes("harden") ||
    lower.includes("fortalec") ||
    lower.includes("renforce") ||
    lower.includes("усил") ||
    lower.includes("шифр") ||
    lower.includes("सुरक्षा") ||
    lower.includes("एन्क्रिप्") ||
    lower.includes("keamanan") ||
    lower.includes("enkrip") ||
    lower.includes("安全") ||
    lower.includes("加密") ||
    lower.includes("暗号")
  ) {
    iconKey = "security";
  } else if (
    lower.includes("language") ||
    lower.includes("idioma") ||
    lower.includes("sprache") ||
    lower.includes("lang") ||
    lower.includes("multilingual") ||
    lower.includes("multilingüe") ||
    lower.includes("mehrsprach") ||
    lower.includes("multilingue") ||
    lower.includes("язык") ||
    lower.includes("bahasa") ||
    lower.includes("语言") ||
    lower.includes("語言") ||
    lower.includes("言語") ||
    lower.includes("भाषा")
  ) {
    iconKey = "language";
  } else if (
    lower.includes("drag") ||
    lower.includes("drop") ||
    lower.includes("arrastar") ||
    lower.includes("glisser") ||
    lower.includes("拖拽") ||
    lower.includes("拖曳") ||
    lower.includes("gestione")
  ) {
    iconKey = "dnd";
  } else if (
    lower.includes("fast") ||
    lower.includes("speed") ||
    lower.includes("cache") ||
    lower.includes("pipeline") ||
    lower.includes("segment") ||
    lower.includes("dedup") ||
    lower.includes("checkpoint") ||
    lower.includes("cold") ||
    lower.includes("rápido") ||
    lower.includes("schnell") ||
    lower.includes("vitesse") ||
    lower.includes("加速") ||
    lower.includes("缓存") ||
    lower.includes("快") ||
    lower.includes("पाइपलाइन") ||
    lower.includes("रिज़्यूमेबल") ||
    lower.includes("断")
  ) {
    iconKey = "speed";
  } else if (index % 3 === 0) {
    iconKey = "security";
  }

  return { title, description, iconKey };
}
