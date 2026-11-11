import fs from "node:fs";
import { describe, it, expect } from "vitest";
import { parseFeatureItem } from "../whatsNewLogic";

const LOCALES_DIR_URL = new URL("../../../i18n/locales/", import.meta.url);
const BOOTSTRAP_URL = new URL("../../../../public/bootstrap.js", import.meta.url);
const INDEX_HTML_URL = new URL("../../../../index.html", import.meta.url);

describe("WhatsNewDialog feature parsing across locales", () => {
  it("parses non-empty titles and descriptions for all 11 locales", () => {
    const locales = fs
      .readdirSync(LOCALES_DIR_URL, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(locales.length).toBeGreaterThanOrEqual(11);

    for (const lng of locales) {
      const supportUrl = new URL(`${lng}/support.json`, LOCALES_DIR_URL);
      const raw = JSON.parse(fs.readFileSync(supportUrl, "utf8"));
      const features: string[] = raw.whatsNew?.features ?? [];
      expect(features.length, `${lng} missing features`).toBeGreaterThanOrEqual(4);

      const parsed = features.map((f, i) => parseFeatureItem(f, i));
      for (const item of parsed) {
        expect(item.title.length, `${lng} empty title`).toBeGreaterThan(0);
        expect(item.description, `${lng} dropped description for ${item.title}`).toBeTruthy();
      }

      // Universal Previews feature should resolve cleanly to preview icon in every locale
      expect(parsed.some((p) => p.iconKey === "preview"), `${lng} missing preview icon`).toBe(true);
      // Security / Vault feature should resolve cleanly to security icon in every locale
      expect(parsed.some((p) => p.iconKey === "security"), `${lng} missing security icon`).toBe(true);
    }
  });
});

describe("Boot recovery & CSP safety invariants", () => {
  it("keeps bootstrap.js CSP-compliant and attaches capture-phase error listener", () => {
    const bootstrap = fs.readFileSync(BOOTSTRAP_URL, "utf8");
    const indexHtml = fs.readFileSync(INDEX_HTML_URL, "utf8");

    // Inline onclick="..." is blocked by production CSP (script-src 'self')
    expect(bootstrap).not.toMatch(/onclick\s*=/i);
    expect(bootstrap).toContain("addEventListener('error'");
    expect(bootstrap).toContain("}, true);");
    expect(bootstrap).toContain("startBootWatchdog");
    expect(indexHtml).toContain('<script src="/bootstrap.js"></script>');
  });
});

