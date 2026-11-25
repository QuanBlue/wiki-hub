"use client";

import { isAttachmentHref } from "@/components/pages/rich-text-editor";
import { formatDate, formatTime } from "@/lib/i18n/format";
import { escapeHtml } from "@/lib/markdown-html";
import { linkNavigationTarget } from "@/lib/navigation-target";
import type { PageContentFormat, SpaceVisibility, WikiPage } from "@/types/api";
import type { EditMode, PageAccess } from "./types";

/**
 * Where a click would actually take the reader, or null when it takes them
 * nowhere. Exported so the unsaved-changes guard's decision can be tested
 * without standing up the whole workspace.
 */
export function navigationTargetOf(event: MouseEvent): URL | null {
  // An attachment link opens the preview modal and leaves the page where it
  // is, so challenging it would be asking about a departure that is not
  // happening. The editor's own capture listener handles the click.
  return linkNavigationTarget(event, isAttachmentHref);
}

export function pageAccessOf(
  page: Pick<WikiPage, "is_restricted"> | null | undefined,
  visibility: SpaceVisibility,
): PageAccess {
  const pageRestricted = page?.is_restricted === true;
  const spaceRestricted = visibility === "restricted";
  if (pageRestricted && spaceRestricted)
    return {
      restricted: true,
      labelKey: "workspace.accessPrivatePageInRestrictedSpace",
    };
  if (pageRestricted)
    return {
      restricted: true,
      labelKey: "workspace.accessPrivatePage",
    };
  if (spaceRestricted)
    return {
      restricted: true,
      labelKey: "workspace.accessRestrictedSpace",
    };
  return {
    restricted: false,
    labelKey: "workspace.accessPublic",
  };
}

export function formatForMode(mode: EditMode): PageContentFormat {
  return mode === "markdown" ? "markdown" : "html";
}

export function htmlToMarkdown(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const markdownBlocks = new Set(["P", "H1", "H2", "H3", "UL", "OL"]);
  const markdownInline = new Set([
    "A",
    "B",
    "BR",
    "CODE",
    "EM",
    "I",
    "LI",
    "STRONG",
  ]);
  const requiresEmbeddedHtml = (element: Element): boolean =>
    !markdownBlocks.has(element.tagName) ||
    element.matches("[style], [colspan], [rowspan]") ||
    Boolean(element.querySelector("[style], [colspan], [rowspan]")) ||
    Array.from(element.querySelectorAll("*")).some(
      (child) => !markdownInline.has(child.tagName),
    );
  const inline = (element: Element): string => {
    const content = Array.from(element.childNodes)
      .map((node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
        if (!(node instanceof Element)) return "";
        const text = inline(node);
        if (node.tagName === "STRONG" || node.tagName === "B")
          return `**${text}**`;
        if (node.tagName === "EM" || node.tagName === "I") return `_${text}_`;
        if (node.tagName === "CODE") return `\`${text}\``;
        if (node.tagName === "A")
          return `[${text}](${node.getAttribute("href") ?? ""})`;
        if (node.tagName === "BR") return "\n";
        return text;
      })
      .join("");
    return content;
  };

  return Array.from(document.body.children)
    .map((element) => {
      // Tables, colours, cell backgrounds, merged cells and other unsupported
      // rich nodes stay as HTML embedded in the Markdown source.
      if (requiresEmbeddedHtml(element)) return prettyHtml(element.outerHTML);
      const text = inline(element).trim();
      if (/^H[1-3]$/.test(element.tagName)) {
        return `${"#".repeat(Number(element.tagName[1]))} ${text}`;
      }
      if (element.tagName === "UL") {
        return Array.from(element.children)
          .map((item) => `- ${inline(item).trim()}`)
          .join("\n");
      }
      if (element.tagName === "OL") {
        return Array.from(element.children)
          .map((item, index) => `${index + 1}. ${inline(item).trim()}`)
          .join("\n");
      }
      return text;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Format generated HTML source without changing its elements or attributes. */
export function prettyHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const blockTags = new Set([
    "BLOCKQUOTE",
    "COL",
    "COLGROUP",
    "DIV",
    "FIGURE",
    "LI",
    "OL",
    "P",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "UL",
  ]);

  const openingTag = (element: Element): string => {
    const attributes = Array.from(element.attributes)
      .map((attribute) => ` ${attribute.name}="${escapeHtml(attribute.value)}"`)
      .join("");
    return `<${element.tagName.toLowerCase()}${attributes}>`;
  };

  const renderElement = (element: Element, depth: number): string[] => {
    const indent = "  ".repeat(depth);
    const hasBlockChildren = Array.from(element.children).some((child) =>
      blockTags.has(child.tagName),
    );

    // Keep paragraphs and inline markup compact so their text spacing remains
    // exactly as authored; expand only structural containers.
    if (!hasBlockChildren) return [`${indent}${element.outerHTML}`];

    const lines = [`${indent}${openingTag(element)}`];
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        lines.push(`${"  ".repeat(depth + 1)}${escapeHtml(child.textContent)}`);
      } else if (child instanceof Element) {
        lines.push(...renderElement(child, depth + 1));
      }
    }
    lines.push(`${indent}</${element.tagName.toLowerCase()}>`);
    return lines;
  };

  return Array.from(document.body.children)
    .flatMap((element) => renderElement(element, 0))
    .join("\n");
}

export function prettyMarkdownEmbeddedHtml(markdown: string): string {
  return markdown.replace(
    /<(table|blockquote|div|figure|ol|pre|ul)\b[\s\S]*?<\/\1\s*>/gi,
    (block) => prettyHtml(block),
  );
}

export function pageHref(spaceKey: string, slug: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`;
}

export function formatDateAndTime(
  value: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
  locale: "en" | "vi",
): string {
  // Throws on an unparseable value, so past this line the timestamp is valid.
  const date = formatDate(value, locale);
  // Imports can provide a date without a clock value. Do not invent one in
  // the page metadata; normal WikiHub timestamps include an ISO time portion.
  if (!/[T\s]\d{2}:\d{2}/.test(value)) return date;
  return t("workspace.lastModifiedAt", {
    date,
    time: formatTime(value, locale),
  });
}
