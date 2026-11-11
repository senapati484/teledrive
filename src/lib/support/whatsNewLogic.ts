export type WhatsNewIconKey =
  | "sync"
  | "mobile"
  | "preview"
  | "code"
  | "security"
  | "language"
  | "dnd"
  | "speed"
  | "transfer"
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
    lower.includes("sync") ||
    lower.includes("sincron") ||
    lower.includes("sinkron") ||
    lower.includes("синхрон") ||
    lower.includes("सिंक") ||
    lower.includes("同期") ||
    lower.includes("同步") ||
    lower.includes("协同") ||
    lower.includes("cross-platform") ||
    lower.includes("multiplataforma") ||
    lower.includes("multiplateforme") ||
    lower.includes("plattformübergreifend") ||
    lower.includes("lintas platform") ||
    lower.includes("backup") ||
    lower.includes("mirror") ||
    lower.includes("备份") ||
    lower.includes("備份") ||
    lower.includes("sauvegarde") ||
    lower.includes("sicherung") ||
    lower.includes("copia") ||
    lower.includes("pencadangan") ||
    lower.includes("резерв") ||
    lower.includes("बैकअप")
  ) {
    iconKey = "sync";
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
    lower.includes("vignette") ||
    lower.includes("просмотр") ||
    lower.includes("миниатюр") ||
    lower.includes("peninjau") ||
    lower.includes("pratinjau") ||
    lower.includes("प्रीव्यू") ||
    lower.includes("पूर्वावलोकन") ||
    lower.includes("थंबनेल") ||
    lower.includes("预览") ||
    lower.includes("預覽") ||
    lower.includes("プレビュー") ||
    lower.includes("サムネイル")
  ) {
    iconKey = "preview";
  } else if (
    lower.includes("vault") ||
    lower.includes("coffre") ||
    lower.includes("bóveda") ||
    lower.includes("boveda") ||
    lower.includes("cofre") ||
    lower.includes("secur") ||
    lower.includes("sicher") ||
    lower.includes("segur") ||
    lower.includes("хранилище") ||
    lower.includes("सुरक्षा") ||
    lower.includes("वॉल्ट") ||
    lower.includes("keamanan") ||
    lower.includes("保险库") ||
    lower.includes("保險庫") ||
    lower.includes("encrypt") ||
    lower.includes("cifrad") ||
    lower.includes("chiffr") ||
    lower.includes("verschlüss") ||
    lower.includes("safe") ||
    lower.includes("harden") ||
    lower.includes("fortalec") ||
    lower.includes("renforce") ||
    lower.includes("усил") ||
    lower.includes("шифр") ||
    lower.includes("एन्क्रिप्") ||
    lower.includes("enkrip") ||
    lower.includes("安全") ||
    lower.includes("加密") ||
    lower.includes("暗号") ||
    lower.includes("tde1") ||
    lower.includes("zero-knowledge")
  ) {
    iconKey = "security";
  } else if (
    lower.includes("transfer") ||
    lower.includes("transfert") ||
    lower.includes("transfers") ||
    lower.includes("transferencia") ||
    lower.includes("segment") ||
    lower.includes("segmen") ||
    lower.includes("resumable") ||
    lower.includes("reanudable") ||
    lower.includes("reprenable") ||
    lower.includes("retomáve") ||
    lower.includes("передач") ||
    lower.includes("трансфер") ||
    lower.includes("ट्रांसफर") ||
    lower.includes("सेगमेंट") ||
    lower.includes("分割") ||
    lower.includes("分片") ||
    lower.includes("分段") ||
    lower.includes("断点") ||
    lower.includes("斷點") ||
    lower.includes("checkpoint") ||
    lower.includes("dedup")
  ) {
    iconKey = "transfer";
  } else if (
    lower.includes("fast") ||
    lower.includes("speed") ||
    lower.includes("cache") ||
    lower.includes("pipeline") ||
    lower.includes("pipelining") ||
    lower.includes("пайплайн") ||
    lower.includes("पाइपलाइन") ||
    lower.includes("管線") ||
    lower.includes("streaming") ||
    lower.includes("stream") ||
    lower.includes("cold") ||
    lower.includes("boot") ||
    lower.includes("démarrage") ||
    lower.includes("inicio") ||
    lower.includes("запуск") ||
    lower.includes("startup") ||
    lower.includes("sofortstart") ||
    lower.includes("rápido") ||
    lower.includes("rapide") ||
    lower.includes("schnell") ||
    lower.includes("vitesse") ||
    lower.includes("高速") ||
    lower.includes("极速") ||
    lower.includes("極速") ||
    lower.includes("加速") ||
    lower.includes("缓存") ||
    lower.includes("快") ||
    lower.includes("तेज़") ||
    lower.includes("instan")
  ) {
    iconKey = "speed";
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
  } else if (lower.includes("code") || lower.includes("editor")) {
    iconKey = "code";
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
  } else if (index % 3 === 0) {
    iconKey = "security";
  }

  return { title, description, iconKey };
}
