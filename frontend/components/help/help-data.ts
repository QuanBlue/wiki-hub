import {
  FileText,
  FolderKanban,
  KeyRound,
  Paperclip,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { isValidElement, type ReactNode } from "react";

import type { HelpCategory, HelpSection } from "./help-ui";

export type CategoryInfo = {
  /** The fixed, English key: also what a section's ``category`` says. */
  key: HelpCategory;
  /** The URL segment: ``/help/<slug>``. */
  slug: string;
  icon: LucideIcon;
  /** The dictionary key segment for its label and description (``help.<dict>Title``). */
  dict: string;
};

export const HELP_CATEGORIES: CategoryInfo[] = [
  { key: "Workspace", slug: "workspace", icon: FolderKanban, dict: "categoryWorkspace" },
  { key: "Writing", slug: "writing", icon: FileText, dict: "categoryWriting" },
  {
    key: "Attachments & Media",
    slug: "attachments",
    icon: Paperclip,
    dict: "categoryAttachments",
  },
  { key: "Account", slug: "account", icon: KeyRound, dict: "categoryAccount" },
  {
    key: "Administration",
    slug: "administration",
    icon: Settings2,
    dict: "categoryAdministration",
  },
];

/** The guides a newcomer is most likely to want, in order, by section id. */
export const START_HERE = [
  "getting-started",
  "pages",
  "chat-with-ai",
  "importing-documents",
];

export function categoryInfo(key: HelpCategory | string): CategoryInfo {
  return HELP_CATEGORIES.find((category) => category.key === key) ?? HELP_CATEGORIES[0]!;
}

/** Where a guide opens: its topic, scrolled to it. */
export function guideHref(section: Pick<HelpSection, "id" | "category">): string {
  return `/help/${categoryInfo(section.category).slug}#${section.id}`;
}

/**
 * Lower case, without accents, đ as d: "Cài đặt" and "cai dat" are the same words. One
 * character in, one out, so a place found in the folded text is the same place in the original.
 */
export function fold(text: string): string {
  return text
    .replace(/đ/gi, "d")
    .replace(/[^\x00-\x7f]/g, (ch) => ch.normalize("NFD")[0] ?? ch)
    .toLowerCase();
}

/** The words of a piece of React content: the text a reader sees in a guide. */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (isValidElement<{ children?: ReactNode; caption?: string }>(node)) {
    const { children, caption } = node.props;
    return [caption ?? "", nodeText(children)].join(" ");
  }
  return "";
}

const textCache = new WeakMap<HelpSection, string>();

function bodyText(section: HelpSection): string {
  let text = textCache.get(section);
  if (text === undefined) {
    text = nodeText(section.body).replace(/\s+/g, " ").trim();
    textCache.set(section, text);
  }
  return text;
}

export type GuideMatch = {
  section: HelpSection;
  score: number;
  /** A short passage of the guide around the first word found, or its description. */
  snippet: string;
};

const SNIPPET_CHARS = 150;

function snippetAround(text: string, folded: string, words: string[]): string | null {
  const at = words
    .map((word) => folded.indexOf(word))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (at === undefined) return null;
  const start = Math.max(0, at - 50);
  const end = Math.min(text.length, start + SNIPPET_CHARS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Words that carry no meaning in a question, in either language. */
const FILLER = new Set(
  (
    "a an the of to in on for and or is are be do does did how what why when where who which " +
    "can could should would i my me you your it its this that with from by at as about " +
    "lam sao the nao lam the nao co khong duoc cua cho voi va hay la thi nhu toi ban minh " +
    "nhung cac mot nao gi o tai trong de"
  ).split(" "),
);

/**
 * The guides that match what was typed, best first. Filler words are ignored and most of the
 * rest must be found; a word in a guide's title counts for more than one in its keywords, its
 * summary or its text. ``alternates`` are the same guides in the other language, so a question
 * in Vietnamese finds the guide while the interface is in English, and the other way round.
 */
export function searchGuides(
  sections: HelpSection[],
  query: string,
  limit = 6,
  alternates: HelpSection[] = [],
): GuideMatch[] {
  const words = fold(query)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !FILLER.has(word));
  if (words.length === 0) return [];
  const needed = words.length <= 2 ? words.length : Math.ceil(words.length * 0.6);
  const other = new Map(alternates.map((section) => [section.id, section]));
  const matches: GuideMatch[] = [];
  for (const section of sections) {
    let best: { score: number; found: number; text: string; body: string } | null = null;
    for (const version of [section, other.get(section.id)]) {
      if (!version) continue;
      const title = fold(version.title);
      const keywords = fold(version.keywords.join(" "));
      const description = fold(version.description);
      const text = bodyText(version);
      const body = fold(text);
      let score = 0;
      let found = 0;
      for (const word of words) {
        const here =
          (title.includes(word) ? 6 : 0) +
          (keywords.includes(word) ? 4 : 0) +
          (description.includes(word) ? 3 : 0) +
          (body.includes(word) ? 1 : 0);
        if (here > 0) found += 1;
        score += here;
      }
      if (!best || found > best.found || (found === best.found && score > best.score)) {
        best = version === section ? { score, found, text, body } : { score, found, text: "", body: "" };
      }
    }
    if (!best || best.found < needed) continue;
    const ownText = bodyText(section);
    const titleOrSummary = fold(`${section.title} ${section.description}`);
    matches.push({
      section,
      score: best.score * (best.found / words.length),
      snippet:
        (words.some((word) => titleOrSummary.includes(word))
          ? null
          : snippetAround(ownText, fold(ownText), words)) ?? section.description,
    });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}
