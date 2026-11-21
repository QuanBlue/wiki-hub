/**
 * Where to highlight a search result.
 *
 * The server sends the words it searched for already folded (lower-case, no
 * accents, `_ . - / : @` as spaces) - including synonyms such as "account" for
 * "tài khoản". The text is folded the same way, one character for one character,
 * so a match position in the folded text is the position in the original.
 */

function foldChar(char: string): string {
  if (char === "đ" || char === "Đ") return "d";
  const base = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return (base.slice(0, 1) || char).toLowerCase().slice(0, 1);
}

/** Lower-case, accent-free text with the same length as the input. */
export function foldText(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1)
    out += foldChar(value[index]!);
  return out.replace(/[_.\-/:@]/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What the server sends when the query asks about IP addresses. */
const IP_MARKER = "ipaddr";
const IPV4 = /(?<![0-9.])[0-9]{1,3}(?:\.[0-9]{1,3}){3}(?![0-9.])/g;

/**
 * `[start, end)` ranges of `text` to highlight. A term matches from the start
 * of a word to the end of that word ("nuti" marks all of "Nutifood").
 */
export function highlightRanges(
  text: string,
  terms: string[],
): [number, number][] {
  const wanted = [
    ...new Set(terms.map((term) => term.trim()).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
  if (!text || wanted.length === 0) return [];
  // The server's stand-in for "an IP address": it is not in the text, the addresses are.
  const ipRanges: [number, number][] = [];
  if (wanted.includes(IP_MARKER)) {
    for (const match of text.matchAll(IPV4)) {
      ipRanges.push([match.index, match.index + match[0].length]);
    }
  }
  const words = wanted.filter((term) => term !== IP_MARKER);
  if (words.length === 0) return ipRanges;
  const pattern = new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:${words.map(escapeRegExp).join("|")})[\p{L}\p{N}]*`,
    "gu",
  );
  const ranges: [number, number][] = [];
  for (const match of foldText(text).matchAll(pattern)) {
    if (match[0].length > 0)
      ranges.push([match.index, match.index + match[0].length]);
  }
  // Words and addresses together, in reading order.
  return [...ranges, ...ipRanges].sort((a, b) => a[0] - b[0]);
}

/** Folded text without anything but letters and digits: "DMS 1.0" -> "dms10". */
export function compactText(value: string): string {
  return foldText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Where `query` sits in `text` once both are squashed to letters and digits:
 * "dms_1" or "DMS10" marks "dms1.0" in "dms1.0 overview". The search finds names
 * typed with other breaks (or none); this shows where. `[]` when it is not there.
 */
export function compactRanges(text: string, query: string): [number, number][] {
  const wanted = compactText(query);
  if (!text || wanted.length < 2) return [];
  const folded = foldText(text);
  // Where each letter or digit kept stands in `text` (folding keeps one character for one).
  const where: number[] = [];
  let squashed = "";
  for (let index = 0; index < folded.length; index += 1) {
    if (/[\p{L}\p{N}]/u.test(folded[index]!)) {
      where.push(index);
      squashed += folded[index];
    }
  }
  const ranges: [number, number][] = [];
  let start = squashed.indexOf(wanted);
  while (start >= 0) {
    ranges.push([where[start]!, where[start + wanted.length - 1]! + 1]);
    start = squashed.indexOf(wanted, start + wanted.length);
  }
  return ranges;
}
