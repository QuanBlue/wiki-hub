/**
 * A small, predictable Markdown subset, turned into the HTML the page reader draws: the
 * source editor's preview, and a Markdown page seen from the Trash.
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMarkdownInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** A small, predictable Markdown subset for the source editor and preview. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    // HTML blocks are valid Markdown. The HTML-to-Markdown conversion emits
    // them for rich structures that Markdown cannot describe without loss.
    const htmlBlock = /^<([a-z][\w-]*)\b[^>]*>/i.exec(line);
    if (htmlBlock) {
      const tagName = htmlBlock[1].toLowerCase();
      if (
        [
          "area",
          "base",
          "br",
          "col",
          "embed",
          "hr",
          "img",
          "input",
          "link",
          "meta",
          "source",
          "wbr",
        ].includes(tagName)
      ) {
        blocks.push(lines[index]);
        index += 1;
        continue;
      }
      const closingTag = new RegExp(`</${tagName}\\s*>`, "i");
      const htmlLines = [lines[index]];
      index += 1;
      while (index < lines.length && !closingTag.test(htmlLines.join("\n"))) {
        htmlLines.push(lines[index]);
        index += 1;
      }
      blocks.push(htmlLines.join("\n"));
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(
          `<li>${renderMarkdownInline(lines[index].trim().slice(2))}</li>`,
        );
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(
          `<li>${renderMarkdownInline(lines[index].trim().replace(/^\d+\.\s+/, ""))}</li>`,
        );
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    blocks.push(`<p>${renderMarkdownInline(line)}</p>`);
    index += 1;
  }
  return blocks.join("");
}
