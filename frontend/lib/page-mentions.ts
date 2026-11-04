/**
 * Folding text the way the backend does, so the page map and the page search
 * agree with it: lower case, no accents, `_.-/:@` as spaces. (The backend finds
 * which pages a page names - see `app/modules/graph/extract.py` - and the map
 * and Related pages show that; the page itself is never rewritten with links.)
 */

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

export function pageHref(spaceKey: string, slug: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`;
}
