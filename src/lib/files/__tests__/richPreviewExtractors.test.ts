import { describe, expect, it } from "vitest";
import { gzipSync, strToU8, zipSync } from "fflate";
import { decodeTextBuffer } from "../fileUtils";
import {
  extractDocumentPreview,
  extractPresentationSlides,
  extractSpreadsheetSheets,
  inspectArchiveEntries,
} from "../richPreviewExtractors";

function buildTarArchive(entries: Array<{ name: string; content: Uint8Array }>): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(512);
    const nameBytes = strToU8(entry.name);
    header.set(nameBytes.subarray(0, 100), 0);
    // mode, uid, gid
    header.set(strToU8("0000644\0"), 100);
    header.set(strToU8("0000000\0"), 108);
    header.set(strToU8("0000000\0"), 116);
    // size in octal (11 digits + NUL)
    const sizeOct = entry.content.length.toString(8).padStart(11, "0") + "\0";
    header.set(strToU8(sizeOct), 124);
    header.set(strToU8("00000000000\0"), 136);
    header[156] = "0".charCodeAt(0); // regular file
    // checksum placeholder spaces (bytes 148..155)
    for (let i = 148; i < 156; i++) header[i] = 32;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    const chk = sum.toString(8).padStart(6, "0") + "\0 ";
    header.set(strToU8(chk), 148);
    blocks.push(header);

    const paddedLen = Math.ceil(entry.content.length / 512) * 512;
    const dataBlock = new Uint8Array(paddedLen);
    dataBlock.set(entry.content, 0);
    blocks.push(dataBlock);
  }
  blocks.push(new Uint8Array(1024)); // EOF two zero blocks
  const total = blocks.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

describe("decodeTextBuffer", () => {
  it("decodes UTF-8, UTF-16LE, and UTF-16BE text without false binary rejection", () => {
    const utf8 = decodeTextBuffer(strToU8("hello world\nline 2"));
    expect(utf8).toMatchObject({ isText: true, text: "hello world\nline 2" });

    // UTF-16LE BOM + "Hi"
    const utf16le = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
    expect(decodeTextBuffer(utf16le)).toMatchObject({
      isText: true,
      encoding: "UTF-16LE",
      text: "Hi",
    });

    // UTF-16BE BOM + "OK"
    const utf16be = new Uint8Array([0xfe, 0xff, 0x00, 0x4f, 0x00, 0x4b]);
    expect(decodeTextBuffer(utf16be)).toMatchObject({
      isText: true,
      encoding: "UTF-16BE",
      text: "OK",
    });

    // True binary with NUL byte should fail text check
    const binary = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02]);
    expect(decodeTextBuffer(binary).isText).toBe(false);
  });
});

describe("richPreviewExtractors", () => {
  it("extracts headings, styled runs, lists, and tables from DOCX archives", () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Project Proposal</w:t></w:r></w:p>
          <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Executive Summary</w:t></w:r><w:r><w:t> body text.</w:t></w:r></w:p>
          <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>First bullet</w:t></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        </w:body>
      </w:document>`;
    const bytes = zipSync({ "word/document.xml": strToU8(docXml) });
    const res = extractDocumentPreview(bytes, "proposal.docx");
    expect(res.kind).toBe("html");
    expect(res.content).toContain("<h1>Project Proposal</h1>");
    expect(res.content).toContain("<strong>Executive Summary</strong>");
    expect(res.content).toContain("<li>First bullet</li>");
    expect(res.content).toContain("<td>Cell A</td>");
    expect(res.content).toContain("<td>Cell B</td>");
  });

  it("extracts clean readable paragraphs from RTF files", () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Helvetica;}} \b Hello \b0 World!\par Second line}`;
    const res = extractDocumentPreview(strToU8(rtf), "notes.rtf");
    expect(res.kind).toBe("html");
    expect(res.content).toContain("Hello");
    expect(res.content).toContain("World!");
    expect(res.content).toContain("Second line");
    expect(res.content).not.toContain("Helvetica");
  });

  it("extracts multi-sheet CSV matrices from XLSX spreadsheets", () => {
    const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>
          <sheet name="Revenue" sheetId="1" r:id="rId1"/>
          <sheet name="Costs" sheetId="2" r:id="rId2"/>
        </sheets>
      </workbook>`;
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
      </Relationships>`;
    const sstXml = `<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <si><t>Quarter</t></si>
        <si><t>Amount</t></si>
        <si><t>Q1</t></si>
      </sst>`;
    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>4200</v></c></row>
        </sheetData>
      </worksheet>`;
    const sheet2Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="C1"><v>99</v></c></row>
        </sheetData>
      </worksheet>`;

    const xlsx = zipSync({
      "xl/workbook.xml": strToU8(workbookXml),
      "xl/_rels/workbook.xml.rels": strToU8(relsXml),
      "xl/sharedStrings.xml": strToU8(sstXml),
      "xl/worksheets/sheet1.xml": strToU8(sheet1Xml),
      "xl/worksheets/sheet2.xml": strToU8(sheet2Xml),
    });

    const sheets = extractSpreadsheetSheets(xlsx, "report.xlsx");
    expect(sheets).toHaveLength(2);
    expect(sheets[0].name).toBe("Revenue");
    expect(sheets[0].csv).toBe("Quarter,Amount\nQ1,4200");
    expect(sheets[1].name).toBe("Costs");
    expect(sheets[1].csv).toBe("Item,,99");
  });

  it("extracts ordered slide titles, bullet text, and notes from PPTX decks", () => {
    const slide1 = `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree>
        <p:sp><p:txBody><a:p><a:r><a:t>Intro Slide</a:t></a:r></a:p><a:p><a:r><a:t>Point A</a:t></a:r></a:p></p:txBody></p:sp>
      </p:spTree></p:cSld></p:sld>`;
    const slide2 = `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree>
        <p:sp><p:txBody><a:p><a:r><a:t>Conclusion</a:t></a:r></a:p></p:txBody></p:sp>
      </p:spTree></p:cSld></p:sld>`;
    const pptx = zipSync({
      "ppt/slides/slide2.xml": strToU8(slide2),
      "ppt/slides/slide1.xml": strToU8(slide1),
    });
    const slides = extractPresentationSlides(pptx, "deck.pptx");
    expect(slides).toHaveLength(2);
    expect(slides[0].index).toBe(1);
    expect(slides[0].lines).toEqual(["Intro Slide", "Point A"]);
    expect(slides[1].index).toBe(2);
    expect(slides[1].lines).toEqual(["Conclusion"]);
  });

  it("inspects ZIP and TAR.GZ archive entries accurately with extractable bytes", () => {
    const zipBytes = zipSync({
      "src/app.ts": strToU8("console.log('hi');"),
      "README.md": strToU8("# Hello"),
    });
    const zipEntries = inspectArchiveEntries(zipBytes, "bundle.zip");
    expect(zipEntries.map((e) => e.path)).toEqual(["README.md", "src/app.ts"]);
    expect(new TextDecoder().decode(zipEntries[0].extract!())).toBe("# Hello");

    const tar = buildTarArchive([
      { name: "hello.txt", content: strToU8("tar payload") },
    ]);
    const tgz = gzipSync(tar);
    const tarEntries = inspectArchiveEntries(tgz, "release.tar.gz");
    expect(tarEntries.map((e) => e.path)).toEqual(["hello.txt"]);
    expect(new TextDecoder().decode(tarEntries[0].extract!())).toBe("tar payload");
  });

  it("extracts ODT, EPUB, ODS, and ODP formats cleanly", () => {
    const odtXml = `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
      <office:body><office:text>
        <text:h text:outline-level="1">Spec</text:h>
        <text:p>OpenDocument body paragraph.</text:p>
      </office:text></office:body>
    </office:document-content>`;
    const odtRes = extractDocumentPreview(zipSync({ "content.xml": strToU8(odtXml) }), "spec.odt");
    expect(odtRes.content).toContain("<h1>Spec</h1>");
    expect(odtRes.content).toContain("<p>OpenDocument body paragraph.</p>");

    const containerXml = `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`;
    const opfXml = `<package xmlns="http://www.idpf.org/2007/opf">
      <manifest><item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="ch1"/></spine>
    </package>`;
    const ch1Html = `<html><head><title>Ch 1</title><style>body{}</style></head><body><h1>Chapter One</h1><p>Book text.</p></body></html>`;
    const epubBytes = zipSync({
      "META-INF/container.xml": strToU8(containerXml),
      "OEBPS/content.opf": strToU8(opfXml),
      "OEBPS/text/ch1.xhtml": strToU8(ch1Html),
    });
    const epubRes = extractDocumentPreview(epubBytes, "book.epub");
    expect(epubRes.content).toContain("Chapter One");
    expect(epubRes.content).toContain("Book text.");
    expect(epubRes.content).not.toContain("<style>");

    const odsXml = `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
      <office:body><office:spreadsheet>
        <table:table table:name="Budget">
          <table:table-row><table:table-cell><text:p>Item</text:p></table:table-cell><table:table-cell><text:p>Cost</text:p></table:table-cell></table:table-row>
          <table:table-row><table:table-cell><text:p>Server</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell></table:table-row>
        </table:table>
      </office:spreadsheet></office:body>
    </office:document-content>`;
    const odsSheets = extractSpreadsheetSheets(zipSync({ "content.xml": strToU8(odsXml) }), "budget.ods");
    expect(odsSheets).toEqual([{ name: "Budget", csv: "Item,Cost\nServer,42" }]);

    const odpXml = `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
      <office:body><office:presentation>
        <draw:page draw:name="Slide1"><draw:frame><draw:text-box><text:p>Keynote Title</text:p><text:p>Bullet one</text:p></draw:text-box></draw:frame></draw:page>
      </office:presentation></office:body>
    </office:document-content>`;
    const odpSlides = extractPresentationSlides(zipSync({ "content.xml": strToU8(odpXml) }), "keynote.odp");
    expect(odpSlides).toEqual([{ index: 1, lines: ["Keynote Title", "Bullet one"], notes: undefined }]);
  });
});
