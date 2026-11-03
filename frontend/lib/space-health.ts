import { api } from "@/lib/api-client";
import type {
  ConflictCheck,
  HealthPage,
  PageRevisionDiff,
  PageRevisionDiffSegment,
  SpaceHealth,
  StaleCheck,
} from "@/types/api";

/** The five lists of the report, in the order their tabs are shown. */
export const HEALTH_TABS = [
  "stale",
  "broken",
  "orphans",
  "duplicates",
  "conflicts",
] as const;
export type HealthTab = (typeof HEALTH_TABS)[number];

/** How long without an edit before a page may be out of date: about 6, 12 and 24 months. */
export const STALE_CHOICES = [180, 365, 730] as const;

function spacePath(spaceKey: string): string {
  return `/api/v1/spaces/${encodeURIComponent(spaceKey)}`;
}

/** Where a listed page opens. */
export function healthPageHref(
  page: Pick<HealthPage, "space_key" | "slug">,
): string {
  return `/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`;
}

export function loadSpaceHealth(
  spaceKey: string,
  staleDays: number,
): Promise<SpaceHealth> {
  return api.get<SpaceHealth>(
    `${spacePath(spaceKey)}/health?stale_days=${staleDays}`,
  );
}

/** Mark a page still correct: it leaves the stale list until it ages again. */
export function markPageReviewed(
  spaceKey: string,
  slug: string,
): Promise<{ reviewed_at: string }> {
  return api.post<{ reviewed_at: string }>(
    `${spacePath(spaceKey)}/pages/${encodeURIComponent(slug)}/review`,
  );
}

/** Ask the AI what in a page the newer pages tied to it contradict or replace. */
export function checkStalePage(
  spaceKey: string,
  slug: string,
  locale: string,
): Promise<StaleCheck> {
  return api.post<StaleCheck>(
    `${spacePath(spaceKey)}/pages/${encodeURIComponent(slug)}/stale-check`,
    { locale: locale === "vi" ? "vi" : "en" },
  );
}

/** Ask the AI to compare two related pages and identify contradictions in parameters, rules, ports or dates. */
export function checkConflict(
  spaceKey: string,
  pageASlug: string,
  pageBSlug: string,
  pageBSpaceKey?: string,
  locale?: string,
): Promise<ConflictCheck> {
  return api.post<ConflictCheck>(`${spacePath(spaceKey)}/conflict-check`, {
    page_a_slug: pageASlug,
    page_b_slug: pageBSlug,
    page_b_space_key: pageBSpaceKey,
    locale: locale === "vi" ? "vi" : "en",
  });
}

/** How many there are of each list (the totals, not just what the report lists). */
export function healthCounts(health: SpaceHealth): Record<HealthTab, number> {
  return {
    stale: health.stale_total,
    broken: health.broken_total,
    orphans: health.orphans_total,
    duplicates: health.duplicates_total,
    conflicts: health.conflicts_total ?? 0,
  };
}

/** Lists of pairs worth comparing, not problems found: left out of the "things to look
 * at" total and of the tab the dialog opens on. Any two linked pages make such a pair. */
const CANDIDATE_TABS: readonly HealthTab[] = ["conflicts"];

/** How many problems the report found, over every list but the candidate ones. */
export function issueTotal(health: SpaceHealth): number {
  const counts = healthCounts(health);
  return HEALTH_TABS.filter((tab) => !CANDIDATE_TABS.includes(tab)).reduce(
    (sum, tab) => sum + counts[tab],
    0,
  );
}

/** The first list with something in it, so the dialog opens where there is work to do. */
export function firstBusyTab(health: SpaceHealth): HealthTab {
  const counts = healthCounts(health);
  return (
    HEALTH_TABS.find(
      (tab) => !CANDIDATE_TABS.includes(tab) && counts[tab] > 0,
    ) ?? "stale"
  );
}

/** Whole days since an ISO date. */
export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/** The text of a page's HTML as one entry per block (paragraph, heading, list item, row…). */
export function pageTextLines(html: string): string[] {
  return pageBlocks(html).map((block) => block.text);
}

const lineKey = (line: string) => line.toLowerCase();

/** One block of a page (paragraph, heading, list item, table cell, code block...): its words,
 * and the same as Markdown so the compare view can keep bold, code, links and headings. */
export interface PageBlock {
  /** Plain words: what two blocks are matched on. */
  text: string;
  /** The block with its formatting, as Markdown. */
  md: string;
}

const BLOCK_TAGS =
  /^(P|DIV|LI|TR|TD|TH|H[1-6]|PRE|BLOCKQUOTE|UL|OL|TABLE|THEAD|TBODY|BR|HR)$/;

/** A page's HTML as blocks, in order, each keeping its inline formatting as Markdown. */
export function pageBlocks(html: string): PageBlock[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: PageBlock[] = [];
  let text = "";
  let md = "";
  let prefix = "";
  const flush = () => {
    const plain = text.replace(/\s+/g, " ").trim();
    if (plain)
      blocks.push({ text: plain, md: prefix + md.replace(/\s+/g, " ").trim() });
    text = "";
    md = "";
    prefix = "";
  };
  const wrap = (mark: string, el: Element) => {
    const before = md;
    md = "";
    el.childNodes.forEach(walk);
    const inner = md.trim();
    md = before + (inner ? mark + inner + mark : "");
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      text += value;
      md += value;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
    // A block with no words of its own - a diagram, an image, an embed - is still a line,
    // named by what it is and its source, so adding, removing or editing one is counted.
    if (el.getAttribute("data-type") === "diagram") {
      flush();
      const engine = el.getAttribute("data-engine") || "diagram";
      const code = (el.getAttribute("data-code") ?? "").trim();
      blocks.push({
        text: `[${engine}] ${code.replace(/\s+/g, " ")}`.trim(),
        md: "```" + engine + "\n" + code + "\n```",
      });
      return;
    }
    if (tag === "IMG" || tag === "IFRAME" || tag === "VIDEO") {
      flush();
      const kind = tag === "IMG" ? "image" : "embed";
      const label =
        el.getAttribute("alt") ||
        el.getAttribute("title") ||
        el.getAttribute("src") ||
        "";
      blocks.push({
        text: `[${kind}] ${label}`.trim(),
        md: `_[${kind}]_ ${label}`.trim(),
      });
      return;
    }
    if (tag === "PRE") {
      flush();
      const code = (el.textContent ?? "").replace(/\n+$/, "");
      const plain = code.replace(/\s+/g, " ").trim();
      if (plain) blocks.push({ text: plain, md: "```\n" + code + "\n```" });
      return;
    }
    if (tag === "STRONG" || tag === "B") return wrap("**", el);
    if (tag === "EM" || tag === "I") return wrap("_", el);
    if (tag === "CODE") {
      const value = el.textContent ?? "";
      text += value;
      if (value.trim()) md += "`" + value.replace(/`/g, "'") + "`";
      return;
    }
    if (tag === "A") {
      const href = el.getAttribute("href") ?? "";
      const before = md;
      md = "";
      el.childNodes.forEach(walk);
      const label = md.trim();
      md =
        before +
        (label && /^https?:\/\//.test(href)
          ? "[" + label + "](" + href + ")"
          : label);
      return;
    }
    const block = BLOCK_TAGS.test(tag);
    if (block) flush();
    if (tag === "LI")
      prefix = el.parentElement?.tagName === "OL" ? "1. " : "- ";
    else if (/^H[1-6]$/.test(tag))
      prefix = "#".repeat(Math.min(3, Number(tag[1]))) + " ";
    else if (tag === "BLOCKQUOTE") prefix = "> ";
    el.childNodes.forEach(walk);
    if (block) flush();
  };
  walk(doc.body);
  flush();
  return blocks;
}

export type DiffRow =
  | { kind: "same"; a: PageBlock; b: PageBlock }
  | { kind: "change"; a: PageBlock | null; b: PageBlock | null };

/** Past this many cells the line-by-line diff is too heavy to run in the browser. */
const DIFF_CELLS = 4_000_000;

/**
 * Two pages laid side by side: blocks both have (same words, any capitals) are one `same` row;
 * what changed sits in a `change` row, the first page's block on the left and the second's on
 * the right. Follows the order of the pages (longest common subsequence); for two very long
 * pages it falls back to matching blocks wherever they are.
 */
export function diffBlocks(a: PageBlock[], b: PageBlock[]): DiffRow[] {
  const ka = a.map((block) => lineKey(block.text));
  const kb = b.map((block) => lineKey(block.text));
  const ops: ({ same: [number, number] } | { a: number } | { b: number })[] =
    [];

  if (a.length * b.length <= DIFF_CELLS) {
    const width = b.length + 1;
    const lcs = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lcs[i * width + j] =
          ka[i] === kb[j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (ka[i] === kb[j]) ops.push({ same: [i++, j++] });
      else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
        ops.push({ a: i++ });
      else ops.push({ b: j++ });
    }
    while (i < a.length) ops.push({ a: i++ });
    while (j < b.length) ops.push({ b: j++ });
  } else {
    const inB = new Map<string, number>();
    kb.forEach((key, index) => inB.has(key) || inB.set(key, index));
    const used = new Set<number>();
    ka.forEach((key, i) => {
      const j = inB.get(key);
      if (j !== undefined && !used.has(j)) {
        used.add(j);
        ops.push({ same: [i, j] });
      } else ops.push({ a: i });
    });
    kb.forEach((_, j) => used.has(j) || ops.push({ b: j }));
  }

  // Runs of removed and added blocks between two identical ones are set side by side.
  const rows: DiffRow[] = [];
  let removed: PageBlock[] = [];
  let added: PageBlock[] = [];
  const settle = () => {
    for (let n = 0; n < Math.max(removed.length, added.length); n++) {
      rows.push({ kind: "change", a: removed[n] ?? null, b: added[n] ?? null });
    }
    removed = [];
    added = [];
  };
  for (const op of ops) {
    if ("same" in op) {
      settle();
      rows.push({ kind: "same", a: a[op.same[0]], b: b[op.same[1]] });
    } else if ("a" in op) removed.push(a[op.a]);
    else added.push(b[op.b]);
  }
  settle();
  return rows;
}

/** A page's HTML, read from the browser (``lib/pages`` is for the server only). */
export async function loadPageContent(
  spaceKey: string,
  slug: string,
): Promise<string> {
  const page = await api.get<{ content: string }>(
    `${spacePath(spaceKey)}/pages/${encodeURIComponent(slug)}`,
  );
  return page.content;
}

export interface ConflictTable {
  header: string[];
  rows: string[][];
  /** What the AI wrote around the table (a callout on what to settle first), as Markdown. */
  rest: string;
}

/** A cell's words without their Markdown marks, for a short label such as a chip. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\*\*|__|`|(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, "")
    .trim();
}

const tableLine = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

/** The table of contradictions the AI writes (Subject | page 1 | page 2 | Note), or null when
 * the answer holds none, e.g. when the pages agree or the model answered in prose. */
export function parseConflictTable(result: string): ConflictTable | null {
  const all = result.split("\n").map((line) => line.trim());
  const lines = all.filter((line) => line.startsWith("|"));
  const rest = all
    .filter((line) => !line.startsWith("|"))
    .join("\n")
    .trim();
  if (lines.length < 3) return null;
  const header = tableLine(lines[0]);
  if (!tableLine(lines[1]).every((cell) => /^:?-{2,}:?$/.test(cell)))
    return null;
  const rows = lines
    .slice(2)
    .map(tableLine)
    .filter((cells) => cells.some(Boolean))
    .map((cells) => header.map((_, index) => cells[index] ?? ""));
  return rows.length > 0 ? { header, rows, rest } : null;
}

/** Past this many words a side, a changed block is marked whole rather than word by word. */
const WORD_DIFF_LIMIT = 400;

/** Which words of two versions of a block differ: the changed ones, for the highlighter. */
export function wordSegments(
  a: string,
  b: string,
): { old: PageRevisionDiffSegment[]; new: PageRevisionDiffSegment[] } {
  const wa = a.split(/(\s+)/).filter(Boolean);
  const wb = b.split(/(\s+)/).filter(Boolean);
  if (wa.length > WORD_DIFF_LIMIT || wb.length > WORD_DIFF_LIMIT) {
    return {
      old: [{ operation: "delete", text: a }],
      new: [{ operation: "add", text: b }],
    };
  }
  const width = wb.length + 1;
  const lcs = new Uint32Array((wa.length + 1) * width);
  for (let i = wa.length - 1; i >= 0; i--) {
    for (let j = wb.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        wa[i] === wb[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const oldSegments: PageRevisionDiffSegment[] = [];
  const newSegments: PageRevisionDiffSegment[] = [];
  const push = (
    list: PageRevisionDiffSegment[],
    operation: PageRevisionDiffSegment["operation"],
    text: string,
  ) => {
    const last = list[list.length - 1];
    if (last && last.operation === operation) last.text += text;
    else list.push({ operation, text });
  };
  let i = 0;
  let j = 0;
  while (i < wa.length || j < wb.length) {
    if (i < wa.length && j < wb.length && wa[i] === wb[j]) {
      push(oldSegments, "equal", wa[i++]);
      push(newSegments, "equal", wb[j++]);
    } else if (
      j >= wb.length ||
      (i < wa.length && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
    ) {
      push(oldSegments, "delete", wa[i++]);
    } else {
      push(newSegments, "add", wb[j++]);
    }
  }
  return { old: joinChanges(oldSegments), new: joinChanges(newSegments) };
}

/** A lone space between two changed words is part of the change: "Bring ID", not "Bring" "ID". */
function joinChanges(
  segments: PageRevisionDiffSegment[],
): PageRevisionDiffSegment[] {
  const out: PageRevisionDiffSegment[] = [];
  segments.forEach((segment, index) => {
    const before = out[out.length - 1];
    const after = segments[index + 1];
    const gap =
      segment.operation === "equal" &&
      /^\s+$/.test(segment.text) &&
      before &&
      before.operation !== "equal" &&
      after &&
      after.operation === before.operation;
    if (gap) before.text += segment.text;
    else if (before && before.operation === segment.operation)
      before.text += segment.text;
    else out.push({ ...segment });
  });
  return out;
}

/**
 * Two pages' side-by-side rows in the shape the page history's diff has, so the compare view
 * can use the same highlighter: the first page plays the "old" side, the second the "new".
 */
export function rowsToRevisionDiff(
  rows: DiffRow[],
  titles: [string, string],
): PageRevisionDiff {
  let oldLine = 0;
  let newLine = 0;
  const lines: PageRevisionDiff["lines"] = rows.map((row) => {
    const a = row.a?.text ?? null;
    const b = row.b?.text ?? null;
    if (row.kind === "same") {
      return {
        operation: "equal",
        old_line_number: ++oldLine,
        new_line_number: ++newLine,
        old_text: a,
        new_text: b,
        old_segments: [{ operation: "equal", text: a ?? "" }],
        new_segments: [{ operation: "equal", text: b ?? "" }],
      };
    }
    if (a !== null && b !== null) {
      const segments = wordSegments(a, b);
      return {
        operation: "replace",
        old_line_number: ++oldLine,
        new_line_number: ++newLine,
        old_text: a,
        new_text: b,
        old_segments: segments.old,
        new_segments: segments.new,
      };
    }
    return a !== null
      ? {
          operation: "delete",
          old_line_number: ++oldLine,
          new_line_number: null,
          old_text: a,
          new_text: null,
          old_segments: [{ operation: "delete", text: a }],
          new_segments: [],
        }
      : {
          operation: "add",
          old_line_number: null,
          new_line_number: ++newLine,
          old_text: null,
          new_text: b,
          old_segments: [],
          new_segments: [{ operation: "add", text: b ?? "" }],
        };
  });
  return {
    from_version: 0,
    to_version: 0,
    title_changed: titles[0] !== titles[1],
    from_title: titles[0],
    to_title: titles[1],
    chunks: [],
    deleted_count: rows.filter((row) => row.kind === "change" && row.a).length,
    added_count: rows.filter((row) => row.kind === "change" && row.b).length,
    lines,
  };
}
