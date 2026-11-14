import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import hljs from "highlight.js";
import { detectLang } from "@/lib/files/langDetect";
import { SyntaxHighlighter } from "../SyntaxHighlighter";

describe("Syntax Highlighting & Language Detection", () => {
  const hljsInstance: typeof hljs = (hljs as any)?.default || hljs;

  it("renders SyntaxHighlighter component with hljs class and highlighted spans", () => {
    const html = renderToStaticMarkup(
      React.createElement(SyntaxHighlighter, {
        code: "for i in range(10):\n    print(i)",
        fileName: "fibonacci.py",
      })
    );
    expect(html).toContain('class="hljs font-mono"');
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("hljs-built_in");
  });

  it("highlights user Python snippets with keywords, built-ins, and strings", () => {
    const userCode = `n = int(input("Enter number: "))\nif n > 0:\n    print(n)`;
    const html = renderToStaticMarkup(
      React.createElement(SyntaxHighlighter, {
        code: userCode,
        fileName: "calculator.py",
      })
    );
    expect(html).toContain("hljs-built_in"); // int, input, print
    expect(html).toContain("hljs-keyword");  // if
    expect(html).toContain("hljs-string");   // "Enter number: "
    expect(html).toContain("hljs-number");   // 0
  });

  it("detects Python correctly and highlights python code", () => {
    const langInfo = detectLang("calculator.py");
    expect(langInfo.displayName).toBe("Python");
    expect(langInfo.hljsLang).toBe("python");

    const code = 'a = int(input("Enter number: "))\nif a == 1:\n    print(a)';
    const highlighted = hljsInstance.highlight(code, {
      language: langInfo.hljsLang,
      ignoreIllegals: true,
    }).value;

    expect(highlighted).toContain("hljs-keyword");
    expect(highlighted).toContain("hljs-string");
  });

  it("detects JavaScript / TypeScript and highlights code", () => {
    const jsInfo = detectLang("index.js");
    expect(jsInfo.hljsLang).toBe("javascript");
    const jsRes = hljsInstance.highlight("const x = 'hello';", { language: jsInfo.hljsLang }).value;
    expect(jsRes).toContain("hljs-keyword");

    const tsInfo = detectLang("app.tsx");
    expect(tsInfo.hljsLang).toBe("typescript");
    const tsRes = hljsInstance.highlight("interface Props { name: string; }", { language: tsInfo.hljsLang }).value;
    expect(tsRes).toContain("hljs-keyword");
  });

  it("detects Rust and Go properly", () => {
    const rsInfo = detectLang("main.rs");
    expect(rsInfo.hljsLang).toBe("rust");
    const rsRes = hljsInstance.highlight("fn main() { println!(\"Hello\"); }", { language: rsInfo.hljsLang }).value;
    expect(rsRes).toContain("hljs-keyword");

    const goInfo = detectLang("server.go");
    expect(goInfo.hljsLang).toBe("go");
    const goRes = hljsInstance.highlight("package main\nimport \"fmt\"", { language: goInfo.hljsLang }).value;
    expect(goRes).toContain("hljs-keyword");
  });

  it("safely handles plaintext and unknown extensions", () => {
    const plainInfo = detectLang("notes.txt");
    expect(plainInfo.hljsLang).toBe("plaintext");

    const unknownInfo = detectLang("unknown.xyz123");
    expect(unknownInfo.hljsLang).toBe("plaintext");
  });
});
