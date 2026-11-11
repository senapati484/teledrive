import { gunzipSync, strFromU8, unzipSync } from "fflate";
import { getFileExtension } from "./fileUtils";

export interface ExtractedDocumentPreview {
  kind: "html";
  content: string;
}

export interface ExtractedSpreadsheetSheet {
  name: string;
  csv: string;
}

export interface ExtractedSlide {
  index: number;
  lines: string[];
  notes?: string;
}

export interface ArchiveEntryInfo {
  path: string;
  size: number;
  isDir: boolean;
  extract?: () => Uint8Array;
}

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<XmlNode | string>;
}

const MAX_EXTRACTED_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_WORKSHEET_COLS = 256;
const MAX_WORKSHEET_ROWS = 20_000;

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => {
      const cp = Number(num);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : "";
    });
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrText)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

/**
 * Pure, DOM-independent XML tree parser so Office/EPUB extractors run identically
 * across Node tests, WKWebView, WebView2, and Android WebView.
 */
function parseXml(xmlText: string): XmlNode {
  const root: XmlNode = { tag: "__root__", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const tokenRe = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![\s\S]*?>|<([^>]+)>|([^<]+)/g;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(xmlText)) !== null) {
    if (m[1] !== undefined) {
      stack[stack.length - 1].children.push(m[1]);
      continue;
    }
    if (m[3] !== undefined) {
      stack[stack.length - 1].children.push(decodeXmlEntities(m[3]));
      continue;
    }
    const tagBody = m[2];
    if (!tagBody) continue;
    if (tagBody.startsWith("/")) {
      const closing = tagBody.slice(1).trim();
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tag === closing) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const selfClosing = tagBody.endsWith("/");
    const cleanBody = selfClosing ? tagBody.slice(0, -1) : tagBody;
    const spaceIdx = cleanBody.search(/\s/);
    const tagName = spaceIdx < 0 ? cleanBody.trim() : cleanBody.slice(0, spaceIdx);
    const attrStr = spaceIdx < 0 ? "" : cleanBody.slice(spaceIdx + 1);
    const node: XmlNode = {
      tag: tagName,
      attrs: parseAttributes(attrStr),
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) {
      stack.push(node);
    }
  }
  return root;
}

function localName(tag: string): string {
  const colon = tag.indexOf(":");
  return colon >= 0 ? tag.slice(colon + 1) : tag;
}

function collectText(node: XmlNode | string): string {
  if (typeof node === "string") return node;
  if (localName(node.tag) === "br") return "\n";
  if (localName(node.tag) === "tab") return "\t";
  let out = "";
  for (const child of node.children) {
    out += collectText(child);
  }
  return out;
}

function findElements(node: XmlNode, targetLocal: string): XmlNode[] {
  const found: XmlNode[] = [];
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (localName(child.tag) === targetLocal) found.push(child);
    found.push(...findElements(child, targetLocal));
  }
  return found;
}

function firstChild(node: XmlNode, targetLocal: string): XmlNode | undefined {
  for (const child of node.children) {
    if (typeof child !== "string" && localName(child.tag) === targetLocal) {
      return child;
    }
  }
  return undefined;
}

function childElements(node: XmlNode, targetLocal?: string): XmlNode[] {
  const out: XmlNode[] = [];
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (!targetLocal || localName(child.tag) === targetLocal) {
      out.push(child);
    }
  }
  return out;
}

function getAttr(node: XmlNode, localKey: string): string | undefined {
  if (node.attrs[localKey] !== undefined) return node.attrs[localKey];
  for (const [k, v] of Object.entries(node.attrs)) {
    if (localName(k) === localKey) return v;
  }
  return undefined;
}

function safeUnzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let accBytes = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      accBytes += file.originalSize || 0;
      return accBytes <= MAX_EXTRACTED_TOTAL_BYTES;
    },
  });
}

function renderDocxRun(run: XmlNode): string {
  const rPr = firstChild(run, "rPr");
  const isBold = Boolean(rPr && firstChild(rPr, "b"));
  const isItalic = Boolean(rPr && firstChild(rPr, "i"));
  const isStrike = Boolean(rPr && firstChild(rPr, "strike"));

  let text = "";
  for (const ch of run.children) {
    if (typeof ch === "string") continue;
    const name = localName(ch.tag);
    if (name === "t" || name === "delText") {
      text += escapeHtml(collectText(ch));
    } else if (name === "br") {
      text += "<br/>";
    } else if (name === "tab") {
      text += " &emsp; ";
    }
  }
  if (!text) return "";
  if (isBold) text = `<strong>${text}</strong>`;
  if (isItalic) text = `<em>${text}</em>`;
  if (isStrike) text = `<del>${text}</del>`;
  return text;
}

function renderDocxParagraph(
  p: XmlNode,
  rels: Map<string, string>
): { html: string; isListItem: boolean } {
  const pPr = firstChild(p, "pPr");
  const pStyle = pPr ? firstChild(pPr, "pStyle") : undefined;
  const styleVal = (pStyle ? getAttr(pStyle, "val") : "")?.toLowerCase() ?? "";
  const isListItem = Boolean(pPr && firstChild(pPr, "numPr"));

  let inner = "";
  for (const child of p.children) {
    if (typeof child === "string") continue;
    const name = localName(child.tag);
    if (name === "r") {
      inner += renderDocxRun(child);
    } else if (name === "hyperlink") {
      const rId = getAttr(child, "id");
      const href = rId ? rels.get(rId) : undefined;
      const runsHtml = childElements(child, "r").map(renderDocxRun).join("");
      if (href && /^https?:/i.test(href)) {
        inner += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${runsHtml}</a>`;
      } else {
        inner += runsHtml;
      }
    }
  }

  if (!inner.trim()) return { html: "", isListItem: false };
  if (isListItem) return { html: `<li>${inner}</li>`, isListItem: true };

  if (styleVal === "title" || styleVal === "heading1" || styleVal === "1") {
    return { html: `<h1>${inner}</h1>`, isListItem: false };
  }
  if (styleVal === "subtitle" || styleVal === "heading2" || styleVal === "2") {
    return { html: `<h2>${inner}</h2>`, isListItem: false };
  }
  if (styleVal === "heading3" || styleVal === "3") {
    return { html: `<h3>${inner}</h3>`, isListItem: false };
  }
  if (/^heading[4-6]$/.test(styleVal)) {
    return { html: `<h4>${inner}</h4>`, isListItem: false };
  }
  return { html: `<p>${inner}</p>`, isListItem: false };
}

function extractDocxHtml(bytes: Uint8Array): string {
  const entries = safeUnzip(bytes);
  const docEntry = entries["word/document.xml"];
  if (!docEntry) {
    throw new Error("DOCX archive is missing word/document.xml");
  }

  const rels = new Map<string, string>();
  const relsEntry = entries["word/_rels/document.xml.rels"];
  if (relsEntry) {
    const relTree = parseXml(strFromU8(relsEntry));
    for (const rel of findElements(relTree, "Relationship")) {
      const id = getAttr(rel, "Id");
      const target = getAttr(rel, "Target");
      if (id && target) rels.set(id, target);
    }
  }

  const docTree = parseXml(strFromU8(docEntry));
  const body = findElements(docTree, "body")[0] ?? docTree;
  const blocks: string[] = [];
  let inList = false;

  const flushList = () => {
    if (inList) {
      blocks.push("</ul>");
      inList = false;
    }
  };

  for (const child of childElements(body)) {
    const name = localName(child.tag);
    if (name === "p") {
      const rendered = renderDocxParagraph(child, rels);
      if (!rendered.html) continue;
      if (rendered.isListItem) {
        if (!inList) {
          blocks.push("<ul>");
          inList = true;
        }
        blocks.push(rendered.html);
      } else {
        flushList();
        blocks.push(rendered.html);
      }
    } else if (name === "tbl") {
      flushList();
      const rows = childElements(child, "tr").map((tr) => {
        const cells = childElements(tr, "tc").map((tc) => {
          const text = childElements(tc, "p")
            .map((p) => renderDocxParagraph(p, rels).html.replace(/^<p>|<\/p>$/g, ""))
            .filter(Boolean)
            .join("<br/>");
          return `<td>${text}</td>`;
        });
        return `<tr>${cells.join("")}</tr>`;
      });
      blocks.push(`<table><tbody>${rows.join("")}</tbody></table>`);
    }
  }
  flushList();

  return blocks.join("\n") || "<p><em>Empty document</em></p>";
}

function extractOdtHtml(bytes: Uint8Array): string {
  const entries = safeUnzip(bytes);
  const contentXml = entries["content.xml"];
  if (!contentXml) {
    throw new Error("ODT archive is missing content.xml");
  }
  const tree = parseXml(strFromU8(contentXml));
  const textRoot = findElements(tree, "text")[0] ?? tree;
  const blocks: string[] = [];

  for (const child of childElements(textRoot)) {
    const name = localName(child.tag);
    if (name === "h") {
      const level = Math.min(4, Math.max(1, Number(getAttr(child, "outline-level")) || 1));
      const txt = escapeHtml(collectText(child).trim());
      if (txt) blocks.push(`<h${level}>${txt}</h${level}>`);
    } else if (name === "p") {
      const txt = escapeHtml(collectText(child).trim());
      if (txt) blocks.push(`<p>${txt}</p>`);
    } else if (name === "list") {
      const items = findElements(child, "p")
        .map((p) => `<li>${escapeHtml(collectText(p).trim())}</li>`)
        .join("");
      if (items) blocks.push(`<ul>${items}</ul>`);
    } else if (name === "table") {
      const rows = childElements(child, "table-row")
        .map((tr) => {
          const cells = childElements(tr, "table-cell")
            .map((tc) => `<td>${escapeHtml(collectText(tc).trim())}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      if (rows) blocks.push(`<table><tbody>${rows}</tbody></table>`);
    }
  }
  return blocks.join("\n") || "<p><em>Empty document</em></p>";
}

function rtfToHtml(raw: string): string {
  const skipDestinations = new Set([
    "fonttbl", "colortbl", "stylesheet", "info", "pict", "object",
    "header", "footer", "headerl", "headerr", "headerf", "footerl",
    "footerr", "footerf", "footnote", "xmlnstbl", "listtable", "listoverridetable",
  ]);
  const stack: Array<{ uc: number; skip: boolean }> = [{ uc: 1, skip: false }];
  let out = "";
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];
    const top = stack[stack.length - 1];
    if (ch === "{") {
      stack.push({ uc: top.uc, skip: top.skip });
      i++;
      continue;
    }
    if (ch === "}") {
      if (stack.length > 1) stack.pop();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "\\") {
      i++;
      if (i >= raw.length) break;
      const next = raw[i];
      if (next === "\\" || next === "{" || next === "}") {
        if (!top.skip) out += next;
        i++;
        continue;
      }
      if (next === "*") {
        top.skip = true;
        i++;
        continue;
      }
      if (next === "'" && i + 2 < raw.length) {
        const byteVal = parseInt(raw.slice(i + 1, i + 3), 16);
        if (!top.skip && Number.isFinite(byteVal)) {
          out += String.fromCharCode(byteVal);
        }
        i += 3;
        continue;
      }
      if (next === "~") {
        if (!top.skip) out += " ";
        i++;
        continue;
      }
      if (next === "-" || next === "_") {
        if (!top.skip && next === "_") out += "-";
        i++;
        continue;
      }
      const ctrlMatch = /^([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i));
      if (ctrlMatch) {
        const word = ctrlMatch[1];
        const param = ctrlMatch[2] ? Number(ctrlMatch[2]) : undefined;
        i += ctrlMatch[0].length;
        if (skipDestinations.has(word)) {
          top.skip = true;
        } else if (word === "uc" && param !== undefined) {
          top.uc = Math.max(0, param);
        } else if (word === "u" && param !== undefined) {
          const codePoint = param < 0 ? param + 65536 : param;
          if (!top.skip) out += String.fromCodePoint(codePoint);
          // Skip `uc` replacement characters following `\uN`
          let rem = top.uc;
          while (rem > 0 && i < raw.length && raw[i] !== "\\" && raw[i] !== "{" && raw[i] !== "}") {
            i++;
            rem--;
          }
        } else if (!top.skip) {
          if (word === "par" || word === "line") out += "\n";
          else if (word === "tab") out += "\t";
        }
        continue;
      }
      i++;
      continue;
    }
    if (!top.skip) out += ch;
    i++;
  }

  const paragraphs = out
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`);
  return paragraphs.join("\n") || "<p><em>Empty document</em></p>";
}

function extractEpubHtml(bytes: Uint8Array): string {
  const entries = safeUnzip(bytes);
  const containerXml = entries["META-INF/container.xml"];
  if (!containerXml) throw new Error("EPUB missing container.xml");

  const containerTree = parseXml(strFromU8(containerXml));
  const rootfile = findElements(containerTree, "rootfile")[0];
  const opfPath = rootfile ? getAttr(rootfile, "full-path") : undefined;
  if (!opfPath || !entries[opfPath]) {
    throw new Error("EPUB missing OPF package");
  }

  const opfDir = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
    : "";
  const opfTree = parseXml(strFromU8(entries[opfPath]));
  const manifestById = new Map<string, string>();
  for (const item of findElements(opfTree, "item")) {
    const id = getAttr(item, "id");
    const href = getAttr(item, "href");
    if (id && href) manifestById.set(id, opfDir + href);
  }

  const chapters: string[] = [];
  for (const itemref of findElements(opfTree, "itemref")) {
    const idref = getAttr(itemref, "idref");
    if (!idref) continue;
    const chapterPath = manifestById.get(idref);
    if (!chapterPath || !entries[chapterPath]) continue;
    const rawHtml = strFromU8(entries[chapterPath]);
    const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(rawHtml);
    chapters.push(`<section>${bodyMatch ? bodyMatch[1] : rawHtml}</section>`);
  }
  return chapters.join("\n<hr/>\n") || "<p><em>Empty e-book</em></p>";
}

export function extractDocumentPreview(
  bytes: Uint8Array,
  fileName: string
): ExtractedDocumentPreview {
  const ext = getFileExtension(fileName);
  if (ext === "docx") return { kind: "html", content: extractDocxHtml(bytes) };
  if (ext === "odt") return { kind: "html", content: extractOdtHtml(bytes) };
  if (ext === "rtf") return { kind: "html", content: rtfToHtml(strFromU8(bytes)) };
  if (ext === "epub") return { kind: "html", content: extractEpubHtml(bytes) };
  throw new Error(`Unsupported rich document extension: .${ext}`);
}

function colRefToIndex(ref: string): number {
  const letters = /^([A-Za-z]+)/.exec(ref)?.[1]?.toUpperCase() ?? "";
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

function csvEscapeCell(val: string): string {
  if (/[",\n\r]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscapeCell).join(",")).join("\n");
}

function extractXlsxSheets(bytes: Uint8Array): ExtractedSpreadsheetSheet[] {
  const entries = safeUnzip(bytes);
  const sharedStrings: string[] = [];
  if (entries["xl/sharedStrings.xml"]) {
    const sstTree = parseXml(strFromU8(entries["xl/sharedStrings.xml"]));
    for (const si of findElements(sstTree, "si")) {
      const text = findElements(si, "t").map(collectText).join("");
      sharedStrings.push(text);
    }
  }

  const relTargets = new Map<string, string>();
  if (entries["xl/_rels/workbook.xml.rels"]) {
    const relTree = parseXml(strFromU8(entries["xl/_rels/workbook.xml.rels"]));
    for (const rel of findElements(relTree, "Relationship")) {
      const id = getAttr(rel, "Id");
      const target = getAttr(rel, "Target");
      if (id && target) {
        relTargets.set(
          id,
          target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\//, "")}`
        );
      }
    }
  }

  const sheetSpecs: Array<{ name: string; path: string }> = [];
  if (entries["xl/workbook.xml"]) {
    const wbTree = parseXml(strFromU8(entries["xl/workbook.xml"]));
    findElements(wbTree, "sheet").forEach((sh, i) => {
      const name = getAttr(sh, "name") || `Sheet ${i + 1}`;
      const rId = getAttr(sh, "id");
      const path = (rId && relTargets.get(rId)) || `xl/worksheets/sheet${i + 1}.xml`;
      if (entries[path]) sheetSpecs.push({ name, path });
    });
  }

  if (sheetSpecs.length === 0) {
    Object.keys(entries)
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort()
      .forEach((p, idx) => sheetSpecs.push({ name: `Sheet ${idx + 1}`, path: p }));
  }

  return sheetSpecs.map((spec) => {
    const tree = parseXml(strFromU8(entries[spec.path]));
    const rowsOut: string[][] = [];
    const rowNodes = findElements(tree, "row").slice(0, MAX_WORKSHEET_ROWS);

    for (const rowNode of rowNodes) {
      const rowCells: string[] = [];
      let sequentialCol = 0;
      for (const cell of childElements(rowNode, "c")) {
        const ref = getAttr(cell, "r");
        const colIdx = ref ? colRefToIndex(ref) : sequentialCol;
        sequentialCol = colIdx + 1;
        if (colIdx >= MAX_WORKSHEET_COLS) continue;

        const cellType = getAttr(cell, "t") ?? "";
        let value = "";
        if (cellType === "inlineStr") {
          const isNode = firstChild(cell, "is");
          value = isNode ? findElements(isNode, "t").map(collectText).join("") : "";
        } else {
          const vNode = firstChild(cell, "v");
          const rawVal = vNode ? collectText(vNode) : "";
          if (cellType === "s") {
            const sstIdx = Number(rawVal);
            value = Number.isInteger(sstIdx) ? sharedStrings[sstIdx] ?? "" : "";
          } else if (cellType === "b") {
            value = rawVal === "1" ? "TRUE" : "FALSE";
          } else {
            value = rawVal;
          }
        }
        while (rowCells.length <= colIdx) rowCells.push("");
        rowCells[colIdx] = value;
      }
      if (rowCells.length > 0) rowsOut.push(rowCells);
    }

    return { name: spec.name, csv: rowsToCsv(rowsOut) };
  });
}

function extractOdsSheets(bytes: Uint8Array): ExtractedSpreadsheetSheet[] {
  const entries = safeUnzip(bytes);
  const contentXml = entries["content.xml"];
  if (!contentXml) throw new Error("ODS missing content.xml");
  const tree = parseXml(strFromU8(contentXml));
  const tables = findElements(tree, "table");

  return tables.map((tbl, idx) => {
    const name = getAttr(tbl, "name") || `Sheet ${idx + 1}`;
    const rowsOut: string[][] = [];
    for (const tr of childElements(tbl, "table-row").slice(0, MAX_WORKSHEET_ROWS)) {
      const rowCells: string[] = [];
      for (const tc of childElements(tr, "table-cell")) {
        const rep = Math.min(
          64,
          Math.max(1, Number(getAttr(tc, "number-columns-repeated")) || 1)
        );
        const text = childElements(tc, "p").map(collectText).join(" ").trim();
        for (let r = 0; r < rep && rowCells.length < MAX_WORKSHEET_COLS; r++) {
          rowCells.push(text);
        }
      }
      // Trim trailing empty cells repeated past last value
      while (rowCells.length > 0 && rowCells[rowCells.length - 1] === "") {
        rowCells.pop();
      }
      if (rowCells.length > 0) rowsOut.push(rowCells);
    }
    return { name, csv: rowsToCsv(rowsOut) };
  });
}

export function extractSpreadsheetSheets(
  bytes: Uint8Array,
  fileName: string
): ExtractedSpreadsheetSheet[] {
  const ext = getFileExtension(fileName);
  if (ext === "xlsx") return extractXlsxSheets(bytes);
  if (ext === "ods") return extractOdsSheets(bytes);
  throw new Error(`Unsupported spreadsheet format: .${ext}`);
}

export function extractPresentationSlides(
  bytes: Uint8Array,
  fileName: string
): ExtractedSlide[] {
  const ext = getFileExtension(fileName);
  const entries = safeUnzip(bytes);

  if (ext === "odp") {
    const contentXml = entries["content.xml"];
    if (!contentXml) throw new Error("ODP missing content.xml");
    const tree = parseXml(strFromU8(contentXml));
    return findElements(tree, "page").map((page, i) => ({
      index: i + 1,
      lines: findElements(page, "p")
        .map((p) => collectText(p).trim())
        .filter(Boolean),
    }));
  }

  const slideKeys = Object.keys(entries)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const na = Number(/slide(\d+)\.xml/i.exec(a)?.[1] ?? 0);
      const nb = Number(/slide(\d+)\.xml/i.exec(b)?.[1] ?? 0);
      return na - nb;
    });

  return slideKeys.map((key, idx) => {
    const slideNum = Number(/slide(\d+)\.xml/i.exec(key)?.[1] ?? idx + 1);
    const slideTree = parseXml(strFromU8(entries[key]));
    const lines = findElements(slideTree, "p")
      .map((p) => findElements(p, "t").map(collectText).join("").trim())
      .filter(Boolean);

    const noteKey = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    let notes: string | undefined;
    if (entries[noteKey]) {
      const noteTree = parseXml(strFromU8(entries[noteKey]));
      const noteText = findElements(noteTree, "t")
        .map(collectText)
        .join(" ")
        .trim();
      if (noteText) notes = noteText;
    }

    return { index: slideNum, lines, notes };
  });
}

function parseOctal(bytes: Uint8Array): number {
  const s = strFromU8(bytes).replace(/\0.*$/, "").trim();
  if (!s) return 0;
  return parseInt(s, 8) || 0;
}

function parseTarBuffer(tarBytes: Uint8Array): ArchiveEntryInfo[] {
  const entries: ArchiveEntryInfo[] = [];
  let offset = 0;

  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const rawName = strFromU8(header.subarray(0, 100)).replace(/\0.*$/, "");
    const prefix = strFromU8(header.subarray(345, 500)).replace(/\0.*$/, "");
    const fullPath = prefix ? `${prefix}/${rawName}` : rawName;
    const size = parseOctal(header.subarray(124, 136));
    const typeFlag = String.fromCharCode(header[156] || 48);
    const isDir = typeFlag === "5" || fullPath.endsWith("/");
    const dataStart = offset + 512;
    const dataEnd = Math.min(tarBytes.length, dataStart + size);

    if (fullPath && typeFlag !== "x" && typeFlag !== "g") {
      entries.push({
        path: fullPath.replace(/\/+$/, "") || fullPath,
        size,
        isDir,
        ...(isDir
          ? {}
          : { extract: () => tarBytes.slice(dataStart, dataEnd) }),
      });
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

export function inspectArchiveEntries(
  bytes: Uint8Array,
  fileName: string
): ArchiveEntryInfo[] {
  const lower = fileName.toLowerCase();
  const ext = getFileExtension(fileName);

  if (lower.endsWith(".tar.gz") || ext === "tgz") {
    const tarBytes = gunzipSync(bytes);
    return parseTarBuffer(tarBytes).sort((a, b) => a.path.localeCompare(b.path));
  }
  if (ext === "tar") {
    return parseTarBuffer(bytes).sort((a, b) => a.path.localeCompare(b.path));
  }
  if (ext === "gz") {
    const plainName = fileName.replace(/\.gz$/i, "") || "uncompressed";
    return [
      {
        path: plainName,
        size: bytes.length,
        isDir: false,
        extract: () => gunzipSync(bytes),
      },
    ];
  }

  const unzipped = safeUnzip(bytes);
  return Object.entries(unzipped)
    .filter(([name]) => !name.endsWith("/"))
    .map(([name, entryBytes]) => ({
      path: name,
      size: entryBytes.length,
      isDir: false,
      extract: () => entryBytes,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
