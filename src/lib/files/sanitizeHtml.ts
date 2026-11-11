import DOMPurify from "dompurify";

/**
 * Sanitizes extracted HTML (Markdown, DOCX, ODT, RTF, EPUB) for safe rendering
 * inside TeleDrive's document sheet without allowing scripts, forms, or inline event handlers.
 */
export function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "a", "ul", "ol", "li", "blockquote",
      "code", "pre", "table", "thead", "tbody", "tr", "th", "td",
      "strong", "em", "del", "hr", "br", "img", "span", "div", "sup", "sub",
      "details", "summary", "input",
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "class", "target", "rel", "type", "checked", "disabled",
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base", "link", "style"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "style"],
  });
}

