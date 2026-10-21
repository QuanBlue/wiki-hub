/**
 * Linking the words of a page that name another page, at reading time.
 *
 * The backend finds which pages a page names (see `app/modules/graph/extract.py`);
 * this turns the first place each one is named into a link. The stored page is
 * never changed - only the HTML handed to the reader. Text is compared the way the
 * backend folds it: lower case, no accents, `_.-/:@` as spaces, whole words only.
 */

import type { MentionedPage } from "@/types/api";

/** Text inside these is left as it is: it is already a link, code, or a heading. */
const SKIP = new Set(["A", "CODE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "BUTTON"]);
const BREAKS = new Set(["_", ".", "-", "/", ":", "@"]);

/** One UTF-16 unit folded as the backend folds a character - always exactly one
 * unit, so an index into the folded text is an index into the original. */
export function foldChar(char: string): string {
  if (char === "đ" || char === "Đ") return "d";
  if (BREAKS.has(char)) return " ";
  const base = char.normalize("NFD").replace(/\p{M}/gu, "");
  return (base.charAt(0) || char).toLowerCase().charAt(0) || char;
}

export function fold(value: string): string {
  return value.split("").map(foldChar).join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A pattern finding the title in folded text, as whole words, any spacing between. */
function titlePattern(title: string): RegExp | null {
  const words = fold(title).match(/[\p{L}\p{N}_]+/gu);
  if (!words?.length) return null;
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${words.map(escapeRegExp).join("[^\\p{L}\\p{N}_]+")}(?![\\p{L}\\p{N}_])`,
    "u",
  );
}

export function pageHref(spaceKey: string, slug: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`;
}

/**
 * `html` with the first mention of each page in `mentions` turned into a link to it.
 * Longer titles go first, so "Leave request form" wins over "Leave request".
 */
export function linkMentions(html: string, mentions: MentionedPage[]): string {
  if (typeof document === "undefined" || !html || !mentions.length) return html;
  const parsed = document.implementation.createHTMLDocument("");
  parsed.body.innerHTML = html;
  const ordered = [...mentions].sort((a, b) => b.title.length - a.title.length);
  let changed = false;
  for (const mention of ordered) {
    const pattern = titlePattern(mention.title);
    if (!pattern) continue;
    const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      if (!insideSkipped(node)) {
        // Indexes line up: every unit folds to exactly one unit.
        const match = pattern.exec(fold(node.data));
        if (match) {
          const end = match.index + match[0].length;
          const before = node.data.slice(0, match.index);
          const words = node.data.slice(match.index, end);
          const after = node.data.slice(end);
          const anchor = parsed.createElement("a");
          anchor.href = pageHref(mention.space_key, mention.slug);
          anchor.textContent = words;
          node.replaceWith(before, anchor, after);
          changed = true;
          break;
        }
      }
      node = walker.nextNode() as Text | null;
    }
  }
  return changed ? parsed.body.innerHTML : html;
}

function insideSkipped(node: Node): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP.has(el.tagName)) return true;
  }
  return false;
}
