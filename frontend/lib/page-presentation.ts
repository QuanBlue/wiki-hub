import { api } from "@/lib/api-client";
import { markdownToHtml } from "@/lib/markdown-html";

/** Dispatched when the user runs `:present` from quick search or triggers presentation globally. */
export const PRESENT_OPEN_EVENT = "wikihub:present-open";

export function openPagePresentation(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PRESENT_OPEN_EVENT));
}

/** Whether the given route is a page or shared document that can be presented as slides. */
export function canPresentPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    /^\/spaces\/[^/]+(\/pages\/[^/]+)?$/.test(pathname) ||
    /^\/share\/[^/]+$/.test(pathname)
  );
}

export type SlideGranularity = "standard" | "detailed" | "divider" | "ai";
export type SlideStageTheme = "auto" | "cinema" | "paper";
export type SlideLayoutKind = "cover" | "section" | "split" | "visual" | "standard";
export type SlideLanguage = "page" | "en" | "vi";

export interface SlideVisualBlock {
  id: string;
  kind: "image" | "mermaid" | "table" | "code";
  html: string;
  imageSrc?: string;
  imageAlt?: string;
  mermaidCode?: string;
  codeLanguage?: string;
  caption?: string;
}

export interface PresentationSlide {
  id: string;
  index: number;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  layout: SlideLayoutKind;
  bodyHtml: string;
  bullets: string[];
  callout?: string;
  visuals: SlideVisualBlock[];
  speakerNotes: string[];
  density: "low" | "medium" | "high";
  partIndex?: number;
  partTotal?: number;
}

export interface AiSlideDeckItem {
  title: string;
  subtitle?: string;
  bullets: string[];
  callout?: string;
  speaker_notes?: string;
  layout?: "hero" | "section" | "bullets" | "highlight";
}

export interface AiPageSlideDeckResponse {
  slides: AiSlideDeckItem[];
  cached: boolean;
  too_short: boolean;
}

export async function fetchAiSlideDeck(
  spaceKey: string,
  pageSlug: string,
  options?: { lang?: SlideLanguage; refresh?: boolean },
): Promise<AiPageSlideDeckResponse> {
  const params = new URLSearchParams();
  if (options?.lang && options.lang !== "page") {
    params.set("lang", options.lang);
  }
  if (options?.refresh) {
    params.set("refresh", "true");
  }
  const query = params.toString();
  const base = `/api/v1/ai/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageSlug)}/slides`;
  return api.post<AiPageSlideDeckResponse>(query ? `${base}?${query}` : base);
}

export interface BuildSlidesInput {
  title: string;
  content: string;
  contentFormat?: "html" | "markdown" | string;
  spaceName: string;
  spaceKey: string;
  author?: string | null;
  updatedBy?: string | null;
  updatedAtFormatted?: string | null;
  labels?: string[];
  granularity: Exclude<SlideGranularity, "ai">;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdownToHtml(text: string): string {
  const escaped = escapeHtml(text.trim());
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

function cleanText(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isHeadingBoundary(tagName: string, granularity: Exclude<SlideGranularity, "ai">): boolean {
  if (granularity === "divider") return false;
  if (tagName === "H1" || tagName === "H2") return true;
  if (granularity === "detailed" && tagName === "H3") return true;
  return false;
}

const MAX_TABLE_ROWS_PER_SLIDE = 7;

const CLASHING_STYLE_PROPS = new Set([
  "background",
  "background-color",
  "background-image",
  "color",
  "font-family",
  "font-size",
  "line-height",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-color",
  "border-width",
  "border-style",
  "margin",
  "margin-top",
  "margin-bottom",
  "padding",
]);

function stripClashingTableStyles(root: Element): void {
  root.querySelectorAll("colgroup, col").forEach((el) => el.remove());

  const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const node of nodes) {
    for (const attr of [
      "bgcolor",
      "width",
      "height",
      "border",
      "cellpadding",
      "cellspacing",
      "valign",
      "colwidth",
    ]) {
      node.removeAttribute(attr);
    }

    const rawStyle = node.getAttribute("style");
    if (rawStyle) {
      const kept = rawStyle
        .split(";")
        .map((part) => part.trim())
        .filter((part) => {
          if (!part) return false;
          const colon = part.indexOf(":");
          if (colon <= 0) return false;
          const prop = part.slice(0, colon).trim().toLowerCase();
          return !CLASHING_STYLE_PROPS.has(prop);
        });
      if (kept.length > 0) {
        node.setAttribute("style", kept.join("; "));
      } else {
        node.removeAttribute("style");
      }
    }
  }
}

function isRowEmpty(tr: Element): boolean {
  if (tr.querySelector("img, svg, canvas, video")) return false;
  return cleanText(tr).length === 0;
}

/**
 * Cleans Confluence/Word inline styles & blank spacer rows from a table,
 * and splits tall data tables (> 7 body rows) across consecutive slides
 * while repeating the header row so slides never need scrollbars.
 */
function extractTableVisuals(el: Element, idx: number): SlideVisualBlock[] {
  const rawTable =
    el.tagName.toUpperCase() === "TABLE" ? el : el.querySelector("table") ?? el;
  const clone = rawTable.cloneNode(true) as Element;
  stripClashingTableStyles(clone);

  // Drop completely blank spacer rows (very common in imported Word/Confluence docs)
  const allRows = Array.from(clone.querySelectorAll("tr"));
  for (const tr of allRows) {
    // Only strip empty rows that belong directly to this table (not inside nested tables)
    if (tr.closest("table") === clone && isRowEmpty(tr)) {
      tr.remove();
    }
  }

  const remainingRows = Array.from(clone.querySelectorAll("tr")).filter(
    (tr) => tr.closest("table") === clone,
  );
  if (remainingRows.length === 0) {
    return [];
  }

  const hasNestedTable = clone.querySelector("table") !== null;
  const hasRowSpan = remainingRows.some((tr) =>
    Array.from(tr.children).some((cell) => {
      const rs = Number.parseInt(cell.getAttribute("rowspan") || "1", 10);
      return Number.isFinite(rs) && rs > 1;
    }),
  );

  // Identify header rows vs body rows
  const thead = clone.querySelector(":scope > thead");
  let headerRows: Element[] = thead
    ? Array.from(thead.querySelectorAll(":scope > tr"))
    : [];
  let bodyRows: Element[];

  if (headerRows.length > 0) {
    bodyRows = remainingRows.filter((tr) => !headerRows.includes(tr));
  } else {
    const firstRow = remainingRows[0]!;
    const firstRowHasTh = firstRow.querySelector(":scope > th") !== null;
    if (firstRowHasTh && remainingRows.length > 1) {
      headerRows = [firstRow];
      bodyRows = remainingRows.slice(1);
    } else {
      bodyRows = remainingRows;
    }
  }

  // Promote headerRows into a proper <thead> so theme CSS styles headers cleanly
  if (!thead && headerRows.length > 0 && clone.ownerDocument) {
    const newThead = clone.ownerDocument.createElement("thead");
    for (const hr of headerRows) {
      newThead.appendChild(hr);
    }
    clone.insertBefore(newThead, clone.firstChild);
  }

  // Paginate tall, clean data tables across multiple slides
  if (
    !hasNestedTable &&
    !hasRowSpan &&
    bodyRows.length > MAX_TABLE_ROWS_PER_SLIDE &&
    clone.ownerDocument
  ) {
    const blocks: SlideVisualBlock[] = [];
    for (let start = 0; start < bodyRows.length; start += MAX_TABLE_ROWS_PER_SLIDE) {
      const slice = bodyRows.slice(start, start + MAX_TABLE_ROWS_PER_SLIDE);
      const partTable = clone.ownerDocument.createElement("table");
      if (headerRows.length > 0) {
        const partThead = clone.ownerDocument.createElement("thead");
        for (const hr of headerRows) {
          partThead.appendChild(hr.cloneNode(true));
        }
        partTable.appendChild(partThead);
      }
      const partTbody = clone.ownerDocument.createElement("tbody");
      for (const br of slice) {
        partTbody.appendChild(br.cloneNode(true));
      }
      partTable.appendChild(partTbody);
      blocks.push({
        id: `vis-table-${idx}-p${blocks.length + 1}`,
        kind: "table",
        html: partTable.outerHTML,
      });
    }
    return blocks;
  }

  return [
    {
      id: `vis-table-${idx}`,
      kind: "table",
      html: clone.outerHTML,
    },
  ];
}

function extractVisualFromElement(el: Element, idx: number): SlideVisualBlock | null {
  const tag = el.tagName.toUpperCase();

  // 1. Mermaid diagram node
  if (
    el.hasAttribute("data-diagram-block") ||
    el.querySelector("[data-diagram-block]")
  ) {
    const diagramNode = el.hasAttribute("data-diagram-block")
      ? el
      : el.querySelector("[data-diagram-block]")!;
    const code = diagramNode.getAttribute("data-code") || cleanText(diagramNode);
    if (code.trim()) {
      return {
        id: `vis-mermaid-${idx}`,
        kind: "mermaid",
        html: diagramNode.outerHTML,
        mermaidCode: code.trim(),
      };
    }
  }

  // Also check <pre><code class="language-mermaid">
  if (tag === "PRE") {
    const codeEl = el.querySelector("code");
    const cls = codeEl?.className || "";
    if (/language-mermaid/i.test(cls)) {
      const code = (codeEl?.textContent ?? "").trim();
      if (code) {
        return {
          id: `vis-mermaid-${idx}`,
          kind: "mermaid",
          html: el.outerHTML,
          mermaidCode: code,
        };
      }
    }
    const langMatch = /language-([\w-]+)/i.exec(cls);
    return {
      id: `vis-code-${idx}`,
      kind: "code",
      html: el.outerHTML,
      codeLanguage: langMatch?.[1] ?? (el.getAttribute("data-language") || undefined),
    };
  }

  // 2. Table
  if (tag === "TABLE" || el.classList.contains("tableWrapper")) {
    const tableEl = tag === "TABLE" ? el : el.querySelector("table") ?? el;
    return {
      id: `vis-table-${idx}`,
      kind: "table",
      html: tableEl.outerHTML,
    };
  }

  // 3. Direct image or paragraph containing only an image
  if (tag === "IMG") {
    const src = el.getAttribute("src") || "";
    if (src) {
      return {
        id: `vis-img-${idx}`,
        kind: "image",
        html: el.outerHTML,
        imageSrc: src,
        imageAlt: el.getAttribute("alt") || "",
      };
    }
  }
  const imgs = el.querySelectorAll("img");
  if (imgs.length === 1 && cleanText(el).length < 60) {
    const img = imgs[0]!;
    const src = img.getAttribute("src") || "";
    if (src) {
      return {
        id: `vis-img-${idx}`,
        kind: "image",
        html: img.outerHTML,
        imageSrc: src,
        imageAlt: img.getAttribute("alt") || cleanText(el),
        caption: cleanText(el) || undefined,
      };
    }
  }

  return null;
}

function isSpeakerNoteElement(el: Element): string | null {
  const tag = el.tagName.toUpperCase();
  if (tag === "DETAILS" || el.hasAttribute("data-toggle")) {
    const text = cleanText(el);
    return text ? text : null;
  }
  if (el.hasAttribute("data-callout")) {
    const calloutType = (el.getAttribute("data-type") || "info").toLowerCase();
    if (calloutType === "note" || calloutType === "panel") {
      const text = cleanText(el);
      return text ? text : null;
    }
  }
  return null;
}

function computeDensity(charCount: number, bulletCount: number, visualCount: number): "low" | "medium" | "high" {
  if (charCount > 450 || bulletCount >= 6 || (visualCount > 0 && charCount > 260)) {
    return "high";
  }
  if (charCount > 200 || bulletCount >= 4 || visualCount > 0) {
    return "medium";
  }
  return "low";
}

interface RawSection {
  title: string;
  eyebrow?: string;
  headingLevel: number;
  nodes: Element[];
}

const MAX_NODES_PER_SLIDE = 5;
const MAX_CHARS_PER_SLIDE = 560;
const MAX_LINES_PER_SLIDE = 8.5;

function ownDirectTextLength(el: Element): number {
  let len = 0;
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      len += (child.textContent ?? "").replace(/\s+/g, " ").trim().length;
    } else if (child.nodeType === 1) {
      const tag = (child as Element).tagName.toUpperCase();
      if (tag !== "UL" && tag !== "OL") {
        len += cleanText(child as Element).length;
      }
    }
  }
  return len;
}

function estimateNodeLines(el: Element): number {
  const tag = el.tagName.toUpperCase();
  if (tag === "UL" || tag === "OL" || tag === "LI") {
    const allLis =
      tag === "LI"
        ? [el, ...Array.from(el.querySelectorAll("li"))]
        : Array.from(el.querySelectorAll("li"));
    if (allLis.length === 0) return 1.5;
    let total = 0;
    for (const li of allLis) {
      const len = ownDirectTextLength(li);
      total += Math.max(1.25, Math.ceil(Math.max(1, len) / 76) * 1.15);
    }
    return total;
  }
  const len = cleanText(el).length;
  return Math.max(1.4, Math.ceil(Math.max(1, len) / 80) * 1.15 + 0.35);
}

/**
 * Splits a tall <ul>/<ol> (including deeply nested lists inside a single <li>)
 * into smaller list elements so each fits cleanly on a 1920x1080 slide with zero scrollbars.
 */
function splitLongListNode(listEl: Element): Element[] {
  if (estimateNodeLines(listEl) <= MAX_LINES_PER_SLIDE || !listEl.ownerDocument) {
    return [listEl];
  }

  const doc = listEl.ownerDocument;
  const listTag = listEl.tagName.toLowerCase();
  const directLis = Array.from(listEl.querySelectorAll(":scope > li"));
  if (directLis.length === 0) return [listEl];

  // First, expand any single <li> that itself contains a huge nested list
  const normalizedLis: Element[] = [];
  for (const li of directLis) {
    const liLines = estimateNodeLines(li);
    const nestedList = li.querySelector(":scope > ul, :scope > ol");
    if (nestedList && liLines > MAX_LINES_PER_SLIDE) {
      const nestedLis = Array.from(nestedList.querySelectorAll(":scope > li"));
      if (nestedLis.length > 1) {
        // Clone parent lead nodes (everything except the nested list)
        const leadNodes = Array.from(li.childNodes)
          .filter((n) => n !== nestedList)
          .map((n) => n.cloneNode(true));
        const nestedTag = nestedList.tagName.toLowerCase();
        const budget = Math.max(4, MAX_LINES_PER_SLIDE - 1.8);

        let group: Element[] = [];
        let groupLines = 0;

        const flushGroup = () => {
          if (group.length === 0) return;
          const wrapperLi = doc.createElement("li");
          for (const ln of leadNodes) {
            wrapperLi.appendChild(ln.cloneNode(true));
          }
          const subList = doc.createElement(nestedTag);
          for (const item of group) {
            subList.appendChild(item.cloneNode(true));
          }
          wrapperLi.appendChild(subList);
          normalizedLis.push(wrapperLi);
          group = [];
          groupLines = 0;
        };

        for (const subLi of nestedLis) {
          const subLines = estimateNodeLines(subLi);
          if (group.length > 0 && groupLines + subLines > budget) {
            flushGroup();
          }
          group.push(subLi);
          groupLines += subLines;
        }
        flushGroup();
        continue;
      }
    }
    normalizedLis.push(li);
  }

  // Group normalized top-level <li> elements into slide-sized lists
  const result: Element[] = [];
  let currentList = doc.createElement(listTag);
  let currentLines = 0;

  for (const li of normalizedLis) {
    const liLines = estimateNodeLines(li);
    if (
      currentList.children.length > 0 &&
      currentLines + liLines > MAX_LINES_PER_SLIDE
    ) {
      result.push(currentList);
      currentList = doc.createElement(listTag);
      currentLines = 0;
    }
    currentList.appendChild(li.cloneNode(true));
    currentLines += liLines;
  }

  if (currentList.children.length > 0) {
    result.push(currentList);
  }

  return result.length > 0 ? result : [listEl];
}

interface SlideChunk {
  nodes: Element[];
  visuals: SlideVisualBlock[];
}

function finalizeSectionSlides(
  section: RawSection,
  startIndex: number,
  spaceLabel: string,
): PresentationSlide[] {
  const speakerNotes: string[] = [];
  const items: Array<{ kind: "node"; node: Element } | { kind: "visual"; visual: SlideVisualBlock }> = [];

  section.nodes.forEach((node, idx) => {
    const note = isSpeakerNoteElement(node);
    if (note) {
      speakerNotes.push(note);
      // Keep note callouts in speaker notes; if the section has no other nodes, also keep it visible
      if (section.nodes.length > 1) return;
    }
    const tag = node.tagName.toUpperCase();
    if (tag === "TABLE" || node.classList.contains("tableWrapper")) {
      const tableBlocks = extractTableVisuals(node, idx);
      for (const tb of tableBlocks) {
        items.push({ kind: "visual", visual: tb });
      }
      return;
    }
    const visual = extractVisualFromElement(node, idx);
    if (visual) {
      items.push({ kind: "visual", visual });
      return;
    }
    if (tag === "UL" || tag === "OL") {
      const listParts = splitLongListNode(node);
      for (const part of listParts) {
        items.push({ kind: "node", node: part });
      }
      return;
    }
    items.push({ kind: "node", node });
  });

  // Section header slide when a heading has no body and no visuals
  if (items.length === 0) {
    return [
      {
        id: `slide-${startIndex}`,
        index: startIndex,
        title: section.title,
        eyebrow: section.eyebrow || spaceLabel,
        layout: "section",
        bodyHtml: "",
        bullets: [],
        visuals: [],
        speakerNotes,
        density: "low",
      },
    ];
  }

  // Group items into balanced slide chunks (at most 1 table/mermaid/code visual per slide,
  // or up to 2 images, and bounded text/line height so content never overflows or scrolls).
  const chunks: SlideChunk[] = [];
  let currentChunk: SlideChunk = { nodes: [], visuals: [] };
  let currentChars = 0;
  let currentLines = 0;

  const pushCurrentChunk = () => {
    if (currentChunk.nodes.length > 0 || currentChunk.visuals.length > 0) {
      chunks.push(currentChunk);
      currentChunk = { nodes: [], visuals: [] };
      currentChars = 0;
      currentLines = 0;
    }
  };

  for (const item of items) {
    if (item.kind === "visual") {
      const hasHeavyVisual = currentChunk.visuals.some(
        (v) => v.kind === "table" || v.kind === "mermaid" || v.kind === "code",
      );
      const isIncomingHeavy =
        item.visual.kind === "table" ||
        item.visual.kind === "mermaid" ||
        item.visual.kind === "code";

      if (
        (hasHeavyVisual && currentChunk.visuals.length >= 1) ||
        (isIncomingHeavy && currentChunk.visuals.length >= 1) ||
        currentChunk.visuals.length >= 2 ||
        (isIncomingHeavy && (currentChars > 320 || currentLines > 4))
      ) {
        pushCurrentChunk();
      }
      currentChunk.visuals.push(item.visual);
    } else {
      const nodeChars = cleanText(item.node).length;
      const nodeLines = estimateNodeLines(item.node);
      const hasTableOrCode = currentChunk.visuals.some(
        (v) => v.kind === "table" || v.kind === "code",
      );
      const maxChars = hasTableOrCode ? 320 : MAX_CHARS_PER_SLIDE;
      const maxNodes = hasTableOrCode ? 3 : MAX_NODES_PER_SLIDE;
      const maxLines = hasTableOrCode ? 4.5 : MAX_LINES_PER_SLIDE;

      if (
        (currentChunk.nodes.length > 0 || currentChunk.visuals.length > 0) &&
        (currentChunk.nodes.length >= maxNodes ||
          currentChars + nodeChars > maxChars ||
          currentLines + nodeLines > maxLines)
      ) {
        pushCurrentChunk();
      }
      currentChunk.nodes.push(item.node);
      currentChars += nodeChars;
      currentLines += nodeLines;
    }
  }
  pushCurrentChunk();

  const partTotal = chunks.length;
  return chunks.map((chunk, partIdx) => {
    const chunkNodes = chunk.nodes;
    const slideVisuals = chunk.visuals;
    const primarySplitVisuals = slideVisuals.filter(
      (v) => v.kind === "image" || v.kind === "mermaid",
    );
    const bullets: string[] = [];
    let charCount = 0;

    for (const node of chunkNodes) {
      const tag = node.tagName.toUpperCase();
      if (tag === "UL" || tag === "OL") {
        const items = Array.from(node.querySelectorAll(":scope > li"));
        for (const li of items) {
          const text = cleanText(li);
          if (text) {
            bullets.push(li.innerHTML.trim());
            charCount += text.length;
          }
        }
      } else {
        const text = cleanText(node);
        if (text) {
          charCount += text.length;
          if (tag === "P" || tag === "BLOCKQUOTE" || tag === "H3" || tag === "H4") {
            bullets.push(node.innerHTML.trim());
          }
        }
      }
    }

    const bodyHtml = chunkNodes.map((n) => n.outerHTML).join("\n");
    let layout: SlideLayoutKind = "standard";
    if (primarySplitVisuals.length > 0 && chunkNodes.length > 0) {
      layout = "split";
    } else if (primarySplitVisuals.length > 0 && chunkNodes.length === 0) {
      layout = "visual";
    } else if (slideVisuals.some((v) => v.kind === "table" || v.kind === "code") && chunkNodes.length <= 1) {
      layout = "visual";
    }

    return {
      id: `slide-${startIndex + partIdx}`,
      index: startIndex + partIdx,
      title: section.title,
      eyebrow: section.eyebrow || spaceLabel,
      layout,
      bodyHtml,
      bullets,
      visuals: slideVisuals,
      speakerNotes: partIdx === 0 ? speakerNotes : [],
      density: computeDensity(charCount, bullets.length, slideVisuals.length),
      partIndex: partTotal > 1 ? partIdx + 1 : undefined,
      partTotal: partTotal > 1 ? partTotal : undefined,
    };
  });
}

/**
 * Deterministically segments any WikiHub page (HTML or Markdown) into a deck
 * of presentation slides with automatic layout classification and speaker notes.
 */
export function buildSlidesFromPage(input: BuildSlidesInput): PresentationSlide[] {
  const spaceLabel = input.spaceKey
    ? `${input.spaceName} (${input.spaceKey})`
    : input.spaceName;
  const rawHtml =
    input.contentFormat === "markdown"
      ? markdownToHtml(input.content || "")
      : input.content || "";

  if (typeof DOMParser === "undefined") {
    return [
      {
        id: "slide-0",
        index: 0,
        title: input.title,
        eyebrow: spaceLabel,
        layout: "cover",
        bodyHtml: "",
        bullets: [],
        visuals: [],
        speakerNotes: [],
        density: "low",
      },
    ];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${rawHtml}</div>`, "text/html");
  const root = doc.body.firstElementChild ?? doc.body;
  const children = Array.from(root.children);

  let coverSubtitle = "";
  const sections: RawSection[] = [];
  let currentSection: RawSection | null = null;
  let lastH1Title = "";

  for (const child of children) {
    const tag = child.tagName.toUpperCase();

    // Skip empty paragraphs
    if (
      tag === "P" &&
      !cleanText(child) &&
      child.querySelectorAll("img, [data-diagram-block]").length === 0
    ) {
      continue;
    }

    // Skip table-of-contents macro blocks in slides
    if (
      child.hasAttribute("data-toc") ||
      child.classList.contains("wikihub-toc")
    ) {
      continue;
    }

    if (tag === "HR") {
      if (currentSection && (currentSection.nodes.length > 0 || currentSection.headingLevel > 0)) {
        sections.push(currentSection);
      }
      currentSection = null;
      continue;
    }

    if (isHeadingBoundary(tag, input.granularity)) {
      const headingText = cleanText(child) || input.title;
      const level = Number(tag.slice(1)) || 2;
      if (level === 1) {
        lastH1Title = headingText;
      }
      if (currentSection && (currentSection.nodes.length > 0 || currentSection.headingLevel > 0)) {
        sections.push(currentSection);
      }
      currentSection = {
        title: headingText,
        eyebrow: level >= 3 && lastH1Title ? lastH1Title : spaceLabel,
        headingLevel: level,
        nodes: [],
      };
      continue;
    }

    // Lead paragraph before the first heading can become the cover slide's subtitle
    if (
      !currentSection &&
      sections.length === 0 &&
      !coverSubtitle &&
      tag === "P" &&
      child.querySelectorAll("img").length === 0 &&
      cleanText(child).length <= 240
    ) {
      coverSubtitle = cleanText(child);
      continue;
    }

    if (!currentSection) {
      currentSection = {
        title: input.title,
        eyebrow: spaceLabel,
        headingLevel: 0,
        nodes: [],
      };
    }
    currentSection.nodes.push(child);
  }

  if (currentSection && (currentSection.nodes.length > 0 || currentSection.headingLevel > 0)) {
    sections.push(currentSection);
  }

  const slides: PresentationSlide[] = [];

  // Slide 0: Cover Slide
  const metaParts: string[] = [];
  if (input.author) metaParts.push(input.author);
  if (input.updatedAtFormatted) metaParts.push(input.updatedAtFormatted);

  slides.push({
    id: "slide-0",
    index: 0,
    title: input.title,
    subtitle: coverSubtitle || undefined,
    eyebrow: spaceLabel,
    layout: "cover",
    bodyHtml: "",
    bullets: input.labels ?? [],
    callout: metaParts.join(" • "),
    visuals: [],
    speakerNotes: coverSubtitle ? [coverSubtitle] : [],
    density: "low",
  });

  for (const section of sections) {
    const built = finalizeSectionSlides(section, slides.length, spaceLabel);
    slides.push(...built);
  }

  return slides;
}

/**
 * Converts an AI-generated executive deck response into PresentationSlide items,
 * prepending the page's Cover slide.
 */
export function buildSlidesFromAiDeck(
  deck: AiSlideDeckItem[],
  meta: {
    title: string;
    spaceName: string;
    spaceKey: string;
    author?: string | null;
    updatedAtFormatted?: string | null;
    labels?: string[];
  },
): PresentationSlide[] {
  const spaceLabel = meta.spaceKey
    ? `${meta.spaceName} (${meta.spaceKey})`
    : meta.spaceName;
  const metaParts: string[] = [];
  if (meta.author) metaParts.push(meta.author);
  if (meta.updatedAtFormatted) metaParts.push(meta.updatedAtFormatted);

  const slides: PresentationSlide[] = [
    {
      id: "ai-slide-0",
      index: 0,
      title: meta.title,
      subtitle: deck[0]?.subtitle || undefined,
      eyebrow: spaceLabel,
      layout: "cover",
      bodyHtml: "",
      bullets: meta.labels ?? [],
      callout: metaParts.join(" • "),
      visuals: [],
      speakerNotes: deck[0]?.speaker_notes ? [deck[0].speaker_notes] : [],
      density: "low",
    },
  ];

  deck.forEach((item, idx) => {
    const formattedBullets = (item.bullets ?? []).map((b) => inlineMarkdownToHtml(b));
    const listHtml =
      formattedBullets.length > 0
        ? `<ul>${formattedBullets.map((b) => `<li>${b}</li>`).join("")}</ul>`
        : "";
    const calloutHtml = item.callout
      ? `<div data-callout data-type="info"><p>${inlineMarkdownToHtml(item.callout)}</p></div>`
      : "";
    const layout: SlideLayoutKind =
      item.layout === "section" && formattedBullets.length === 0
        ? "section"
        : "standard";

    slides.push({
      id: `ai-slide-${idx + 1}`,
      index: idx + 1,
      title: item.title,
      subtitle: item.subtitle || undefined,
      eyebrow: spaceLabel,
      layout,
      bodyHtml: `${listHtml}${calloutHtml}`,
      bullets: formattedBullets,
      callout: item.callout || undefined,
      visuals: [],
      speakerNotes: item.speaker_notes ? [item.speaker_notes] : [],
      density: computeDensity(
        formattedBullets.join(" ").length,
        formattedBullets.length,
        0,
      ),
    });
  });

  return slides;
}
