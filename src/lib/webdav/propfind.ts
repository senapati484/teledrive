import type { TeleFile } from "../types";
import { etagForFile, etagForFolder, escapeXml, formatHttpDate } from "./protocol";
import type { WebdavLock } from "./locks";

/** Builds the RFC 4918 multistatus documents served by PROPFIND. */

export interface PropfindEntry {
  href: string;
  name: string;
  isFolder: boolean;
  file: TeleFile | null;
}

const SUPPORTED_LOCK_XML =
  "<D:supportedlock>" +
  "<D:lockentry><D:lockscope><D:exclusive/></D:lockscope>" +
  "<D:locktype><D:write/></D:locktype></D:lockentry>" +
  "</D:supportedlock>";

function propsFor(entry: PropfindEntry): string {
  const parts: string[] = [];
  parts.push(`<D:displayname>${escapeXml(entry.name)}</D:displayname>`);
  parts.push(
    entry.isFolder
      ? "<D:resourcetype><D:collection/></D:resourcetype>"
      : "<D:resourcetype/>"
  );

  if (entry.file) {
    const modified = formatHttpDate(entry.file.uploadedAt);
    parts.push(`<D:getlastmodified>${modified}</D:getlastmodified>`);
    parts.push(
      `<D:getetag>${escapeXml(
        entry.isFolder ? etagForFolder(entry.file) : etagForFile(entry.file)
      )}</D:getetag>`
    );
    if (!entry.isFolder) {
      const size = Number.isFinite(entry.file.size) ? entry.file.size : 0;
      parts.push(`<D:getcontentlength>${size}</D:getcontentlength>`);
      parts.push(
        `<D:getcontenttype>${escapeXml(
          entry.file.mime || "application/octet-stream"
        )}</D:getcontenttype>`
      );
    }
  } else {
    // Implicit collection that has no catalog entry of its own.
    parts.push(`<D:getlastmodified>${formatHttpDate(Date.now())}</D:getlastmodified>`);
    let hash = 0;
    for (const char of entry.href) hash = (hash * 31 + char.codePointAt(0)!) | 0;
    parts.push(
      `<D:getetag>${escapeXml(`"d${hash}-${entry.href.length}"`)}</D:getetag>`
    );
  }

  parts.push(SUPPORTED_LOCK_XML);
  return parts.join("");
}

function responseFor(entry: PropfindEntry, status = "HTTP/1.1 200 OK"): string {
  return (
    "<D:response>" +
    `<D:href>${escapeXml(entry.href)}</D:href>` +
    "<D:propstat>" +
    `<D:prop>${propsFor(entry)}</D:prop>` +
    `<D:status>${status}</D:status>` +
    "</D:propstat>" +
    "</D:response>"
  );
}

export function buildPropfindXml(entries: PropfindEntry[]): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<D:multistatus xmlns:D="DAV:">' +
    entries.map((entry) => responseFor(entry)).join("") +
    "</D:multistatus>"
  );
}

/** PROPPATCH is not supported; every property is reported as forbidden. */
export function buildProppatchForbiddenXml(): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<D:multistatus xmlns:D="DAV:">' +
    "<D:response>" +
    "<D:href>/</D:href>" +
    "<D:propstat>" +
    "<D:prop/>" +
    "<D:status>HTTP/1.1 403 Forbidden</D:status>" +
    "</D:propstat>" +
    "</D:response>" +
    "</D:multistatus>"
  );
}

export function buildLockDiscoveryXml(lock: WebdavLock): string {
  const owner = lock.owner ? `<D:owner>${escapeXml(lock.owner)}</D:owner>` : "";
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<D:prop xmlns:D="DAV:">' +
    "<D:lockdiscovery>" +
    "<D:activelock>" +
    "<D:locktype><D:write/></D:locktype>" +
    "<D:lockscope><D:exclusive/></D:lockscope>" +
    `<D:depth>${lock.depth}</D:depth>` +
    owner +
    `<D:timeout>Second-${lock.timeoutSeconds}</D:timeout>` +
    `<D:locktoken><D:href>${escapeXml(lock.token)}</D:href></D:locktoken>` +
    `<D:lockroot><D:href>${escapeXml(lock.path)}</D:href></D:lockroot>` +
    "</D:activelock>" +
    "</D:lockdiscovery>" +
    "</D:prop>"
  );
}
