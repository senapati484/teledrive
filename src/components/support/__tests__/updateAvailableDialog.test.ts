import { describe, it, expect } from "vitest";
import React from "react";
import { formatInline, renderReleaseNotes } from "../UpdateAvailableDialog";

describe("UpdateAvailableDialog - markdown parsing & formatting", () => {
  it("formats inline bold, code, markdown links, bare URLs, and mentions", () => {
    const raw = "Check **important** change in `src/index.ts` via [Link](https://teledrive.space) and https://github.com from @senapati484";
    const rendered = formatInline(raw) as React.ReactNode[];

    expect(Array.isArray(rendered)).toBe(true);
    // Find bold node
    const boldNode = rendered.find(
      (node) => React.isValidElement(node) && node.type === "strong"
    ) as React.ReactElement<{ children?: React.ReactNode }> | undefined;
    expect(boldNode).toBeDefined();
    expect(boldNode?.props.children).toBe("important");

    // Find code node
    const codeNode = rendered.find(
      (node) => React.isValidElement(node) && node.type === "code"
    ) as React.ReactElement<{ children?: React.ReactNode }> | undefined;
    expect(codeNode).toBeDefined();
    expect(codeNode?.props.children).toBe("src/index.ts");

    // Find link node
    const linkNodes = rendered.filter(
      (node) => React.isValidElement(node) && node.type === "a"
    ) as React.ReactElement<{ href?: string; children?: React.ReactNode }>[];
    expect(linkNodes.length).toBeGreaterThanOrEqual(2);
    expect(linkNodes[0].props.href).toBe("https://teledrive.space");
  });

  it("strips top-level redundant release title from notes", () => {
    const notes = `# 🚀 TeleDrive v0.1.4 — Resilient Multi-Account Vault\n\nThis is the description paragraph.`;
    const rendered = renderReleaseNotes(notes) as React.ReactNode[];

    expect(rendered).toBeDefined();
    // The top title starting with # 🚀 TeleDrive should NOT be in rendered output as an h3/h1
    const h3Titles = rendered.filter(
      (n) => React.isValidElement(n) && (n.type === "h3" || n.type === "h1")
    );
    expect(h3Titles.length).toBe(0);

    // The paragraph should exist
    const pNodes = rendered.filter(
      (n) => React.isValidElement(n) && n.type === "p"
    );
    expect(pNodes.length).toBe(1);
  });

  it("renders lists, section headers, and quotes properly", () => {
    const notes = `### What's Changed
* feat: added multi-account vault
* fix: resolved thumbnail rendering
> Note: this is a breaking change
1. First step
2. Second step`;

    const rendered = renderReleaseNotes(notes) as React.ReactNode[];
    expect(rendered).toBeDefined();

    // Check h4 header
    const h4 = rendered.find(
      (n) => React.isValidElement(n) && n.type === "h4"
    ) as React.ReactElement | undefined;
    expect(h4).toBeDefined();

    // Check ul list
    const ul = rendered.find(
      (n) => React.isValidElement(n) && n.type === "ul"
    ) as React.ReactElement | undefined;
    expect(ul).toBeDefined();

    // Check blockquote
    const quote = rendered.find(
      (n) => React.isValidElement(n) && n.type === "blockquote"
    ) as React.ReactElement | undefined;
    expect(quote).toBeDefined();
  });

  it("handles null or empty release notes gracefully", () => {
    expect(renderReleaseNotes("")).toBeNull();
  });
});
