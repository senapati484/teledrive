import { describe, it, expect } from "vitest";
import { StringSession } from "telegram/sessions";
import {
  decodeMtproxySecret,
  normalizeMtproxySecretForGramJs,
  normalizeStringSessionTransport,
  parseProxyLink,
  resolveTelegramDcEndpoint,
  validateProxySettings,
  DEFAULT_PROXY_SETTINGS,
} from "../proxy";

describe("MTProxy secret validation & normalization", () => {
  const hex16 = "0123456789abcdef0123456789abcdef";
  const ddHex = `dd${hex16}`;
  // ee + hex16 + "cloudflare.com"
  const eeHex = `ee${hex16}636c6f7564666c6172652e636f6d`;

  it("decodes standard, dd-padded, and ee Fake-TLS hex and base64url secrets", () => {
    const std = decodeMtproxySecret(hex16);
    expect(std.padded).toBe(false);
    expect(std.fakeTlsDomain).toBeNull();
    expect(std.secret16.length).toBe(16);

    const dd = decodeMtproxySecret(ddHex);
    expect(dd.padded).toBe(true);
    expect(dd.fakeTlsDomain).toBeNull();

    const ee = decodeMtproxySecret(eeHex);
    expect(ee.padded).toBe(true);
    expect(ee.fakeTlsDomain).toBe("cloudflare.com");

    // Base64url form of the ee Fake-TLS secret
    const eeBytes = Buffer.from(eeHex, "hex");
    const b64url = eeBytes
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const decodedB64 = decodeMtproxySecret(b64url);
    expect(decodedB64.fakeTlsDomain).toBe("cloudflare.com");
    expect(Buffer.from(decodedB64.secret16).toString("hex")).toBe(hex16);
  });

  it("normalizes Fake-TLS secrets into 17-byte dd hex for GramJS", () => {
    expect(normalizeMtproxySecretForGramJs(hex16)).toBe(hex16);
    expect(normalizeMtproxySecretForGramJs(ddHex)).toBe(ddHex);
    expect(normalizeMtproxySecretForGramJs(eeHex)).toBe(ddHex);
  });

  it("rejects malformed MTProxy secrets and bad ports/hosts", () => {
    expect(() => decodeMtproxySecret("")).toThrow();
    expect(() => decodeMtproxySecret("deadbeef")).toThrow();
    expect(() => decodeMtproxySecret(`ee${hex16}`)).toThrow();

    expect(
      validateProxySettings({ ...DEFAULT_PROXY_SETTINGS, host: "", port: 443, secret: hex16 })
    ).toContain("host");
    expect(
      validateProxySettings({ ...DEFAULT_PROXY_SETTINGS, host: "proxy.example.com", port: 0, secret: hex16 })
    ).toContain("port");
    expect(
      validateProxySettings({ ...DEFAULT_PROXY_SETTINGS, host: "proxy.example.com", port: 443, secret: "bad" })
    ).toContain("Invalid MTProxy secret");
  });
});

describe("Proxy link parser", () => {
  const hex16 = "0123456789abcdef0123456789abcdef";

  it("parses tg://proxy and https://t.me/proxy links", () => {
    const p1 = parseProxyLink(`tg://proxy?server=1.2.3.4&port=8443&secret=dd${hex16}`);
    expect(p1).toEqual({
      proxyType: "mtproxy",
      host: "1.2.3.4",
      port: 8443,
      secret: `dd${hex16}`,
      username: "",
      password: "",
    });

    const p2 = parseProxyLink(`https://t.me/proxy?server=mt.example.org&port=443&secret=${hex16}`);
    expect(p2.proxyType).toBe("mtproxy");
    expect(p2.host).toBe("mt.example.org");
    expect(p2.port).toBe(443);
  });

  it("parses tg://socks, socks5://, and http:// proxy URLs", () => {
    const s1 = parseProxyLink("tg://socks?server=127.0.0.1&port=1080&user=bob&pass=pw");
    expect(s1).toEqual({
      proxyType: "socks5",
      host: "127.0.0.1",
      port: 1080,
      secret: "",
      username: "bob",
      password: "pw",
    });

    const s2 = parseProxyLink("socks5://alice:s%40cr%25t@10.0.0.1:9050");
    expect(s2).toEqual({
      proxyType: "socks5",
      host: "10.0.0.1",
      port: 9050,
      secret: "",
      username: "alice",
      password: "s@cr%t",
    });

    const h1 = parseProxyLink("http://user:pass@proxy.corp:3128");
    expect(h1).toEqual({
      proxyType: "http",
      host: "proxy.corp",
      port: 3128,
      secret: "",
      username: "user",
      password: "pass",
    });
  });

  it("rejects invalid proxy links clearly", () => {
    expect(() => parseProxyLink("not-a-url")).toThrow();
    expect(() => parseProxyLink("ftp://example.com:21")).toThrow();
    expect(() => parseProxyLink("tg://proxy?server=1.2.3.4&port=443")).toThrow();
  });
});

describe("Session DC transport normalization", () => {
  it("remaps *.web.telegram.org <-> IPv4 cleanly without destroying authKey", async () => {
    const session = new StringSession("");
    const fakeKey = Buffer.alloc(256, 0xab);
    session.setDC(4, "vesta.web.telegram.org", 443);
    session.setAuthKey({ getKey: () => fakeKey } as any, 4);

    normalizeStringSessionTransport(session, true);
    expect(session.dcId).toBe(4);
    expect(session.serverAddress).toBe("149.154.167.91");
    expect(session.port).toBe(443);
    expect(session.getAuthKey(4)).toBeDefined();

    // Media DC suffix `-1` also maps cleanly to the base DC IPv4
    session.setDC(2, "venus-1.web.telegram.org", 80);
    normalizeStringSessionTransport(session, true);
    expect(session.dcId).toBe(2);
    expect(session.serverAddress).toBe("149.154.167.51");
    expect(session.port).toBe(443);

    // Switching back to Direct WSS restores *.web.telegram.org
    normalizeStringSessionTransport(session, false);
    expect(session.dcId).toBe(2);
    expect(session.serverAddress).toBe("venus.web.telegram.org");
    expect(session.port).toBe(443);
  });

  it("resolves Telegram DC IPv4 from dcOptions or canonical defaults", () => {
    expect(resolveTelegramDcEndpoint(4)).toEqual({
      id: 4,
      ipAddress: "149.154.167.91",
      port: 443,
    });
    expect(
      resolveTelegramDcEndpoint(2, [{ id: 2, ipv6: false, ipAddress: "149.154.167.50" }])
    ).toEqual({
      id: 2,
      ipAddress: "149.154.167.50",
      port: 443,
    });
  });
});
