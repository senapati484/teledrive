import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parseFeatureItem } from "../whatsNewLogic";

const LOCALES_DIR = path.resolve(
  import.meta.dirname,
  "../../../i18n/locales"
);
const BOOTSTRAP_PATH = path.resolve(
  import.meta.dirname,
  "../../../../public/bootstrap.js"
);
const INDEX_HTML_PATH = path.resolve(
  import.meta.dirname,
  "../../../../index.html"
);

describe("WhatsNewDialog feature parsing across locales", () => {
  it("parses non-empty titles and descriptions for all 11 locales", () => {
    const locales = fs.readdirSync(LOCALES_DIR);
    expect(locales.length).toBeGreaterThanOrEqual(11);

    for (const lng of locales) {
      const supportPath = path.join(LOCALES_DIR, lng, "support.json");
      const raw = JSON.parse(fs.readFileSync(supportPath, "utf8"));
      const features: string[] = raw.whatsNew?.features ?? [];
      expect(features.length, `${lng} missing features`).toBeGreaterThanOrEqual(4);

      const parsed = features.map((f, i) => parseFeatureItem(f, i));
      for (const item of parsed) {
        expect(item.title.length, `${lng} empty title`).toBeGreaterThan(0);
        expect(item.description, `${lng} dropped description for ${item.title}`).toBeTruthy();
      }

      // Universal Previews feature should resolve cleanly to preview icon in every locale
      expect(parsed.some((p) => p.iconKey === "preview"), `${lng} missing preview icon`).toBe(true);
      // TDE1 security feature should resolve cleanly to security icon in every locale
      expect(parsed.some((p) => p.iconKey === "security"), `${lng} missing security icon`).toBe(true);
    }
  });
});

describe("Boot recovery & CSP safety invariants", () => {
  it("keeps bootstrap.js CSP-compliant and attaches capture-phase error listener", () => {
    const bootstrap = fs.readFileSync(BOOTSTRAP_PATH, "utf8");
    const indexHtml = fs.readFileSync(INDEX_HTML_PATH, "utf8");

    // Inline onclick="..." is blocked by production CSP (script-src 'self')
    expect(bootstrap).not.toMatch(/onclick\s*=/i);
    expect(bootstrap).toContain("addEventListener('error'");
    expect(bootstrap).toContain("}, true);");
    expect(bootstrap).toContain("startBootWatchdog");
    expect(indexHtml).toContain('<script src="/bootstrap.js"></script>');
  });
});

