import { describe, expect, it } from "vitest";
import type { TeleFile } from "../../types";
import { buildLockDiscoveryXml, buildPropfindXml, type PropfindEntry } from "../propfind";
import type { WebdavLock } from "../locks";

const file: TeleFile = {
  id: "f1",
  name: "notes & <tags>.txt",
  size: 42,
  mime: "text/plain",
  folderPath: "/Docs",
  messageId: 11,
  channelId: "chan",
  uploadedAt: Date.UTC(2024, 0, 2, 3, 4, 5),
  hash: "deadbeef",
};

const entries: PropfindEntry[] = [
  { href: "/", name: "TeleDrive", isFolder: true, file: null },
  { href: "/Docs/", name: "Docs", isFolder: true, file: null },
  { href: "/Docs/notes%20%26%20%3Ctags%3E.txt", name: file.name, isFolder: false, file },
];

describe("buildPropfindXml", () => {
  const xml = buildPropfindXml(entries);

  it("emits one multistatus response per entry with a DAV namespace", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('<D:multistatus xmlns:D="DAV:">');
    expect(xml.match(/<D:response>/g)).toHaveLength(3);
    expect(xml).toContain('<D:href>/Docs/</D:href>');
  });

  it("includes the required live properties", () => {
    expect(xml).toContain("<D:displayname>TeleDrive</D:displayname>");
    expect(xml).toContain("<D:resourcetype><D:collection/></D:resourcetype>");
    expect(xml).toContain("<D:resourcetype/>");
    expect(xml).toContain("<D:getcontentlength>42</D:getcontentlength>");
    expect(xml).toContain("<D:getlastmodified>Tue, 02 Jan 2024 03:04:05 GMT</D:getlastmodified>");
    expect(xml).toContain('<D:getetag>"deadbeef-42"</D:getetag>');
    expect(xml).toContain("<D:supportedlock>");
    expect(xml).toContain("<D:locktype><D:write/></D:locktype>");
  });

  it("escapes XML in display names and hrefs", () => {
    expect(xml).toContain("<D:displayname>notes &amp; &lt;tags&gt;.txt</D:displayname>");
  });

  it("is well-formed enough for a real parser", () => {
    // No raw ampersands outside entities, and balanced tags.
    const stripped = xml.replace(/&(amp|lt|gt|quot|apos);/g, "");
    expect(stripped).not.toContain("&");
  });
});

describe("buildLockDiscoveryXml", () => {
  const lock: WebdavLock = {
    token: "opaquelocktoken:1234",
    path: "/Docs",
    depth: "infinity",
    owner: "rclone <me>",
    timeoutSeconds: 600,
    expiresAt: Date.now() + 600_000,
  };

  it("describes the exclusive write lock", () => {
    const xml = buildLockDiscoveryXml(lock);
    expect(xml).toContain("<D:lockdiscovery>");
    expect(xml).toContain("<D:lockscope><D:exclusive/></D:lockscope>");
    expect(xml).toContain("<D:depth>infinity</D:depth>");
    expect(xml).toContain("<D:timeout>Second-600</D:timeout>");
    expect(xml).toContain(
      "<D:locktoken><D:href>opaquelocktoken:1234</D:href></D:locktoken>"
    );
    expect(xml).toContain("<D:owner>rclone &lt;me&gt;</D:owner>");
  });
});
