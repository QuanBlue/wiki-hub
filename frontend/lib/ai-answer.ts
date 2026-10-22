import { api } from "@/lib/api-client";

/** A wiki page an answer was read from, by the number the answer cites it by. */
export type AnswerSource = {
  n: number;
  id: string;
  title: string;
  slug: string;
  space_key: string;
  space_name: string;
  /** The part of the page the answer was read from. */
  excerpt: string;
  /** Files attached to the page that the excerpt was read from. */
  files?: { id: string; filename: string }[];
};

/** An internet page an answer was read from, cited as ``[w1]``. */
export type WebSource = {
  n: number;
  title: string;
  url: string;
  host: string;
  snippet: string;
};

/** A file the person attached in the chat that an answer was read from, cited as ``[f1]``. */
export type FileSource = {
  n: number;
  filename: string;
  /** The part of the file the answer was read from. */
  excerpt: string;
};

/** A button under an answer that opens a page of the application. */
export type AnswerAction = {
  id: string;
  /** An address inside WikiHub; always starts with a single ``/``. */
  href: string;
  label_en: string;
  label_vi: string;
};

/** One thing the assistant proposes to do; nothing happens until the person confirms. */
export type AnswerPlanStep = {
  type: "create_space" | "create_page" | "favorite_space" | "add_space_member";
  /** Checked values, sent back unchanged to run the step. */
  args: Record<string, unknown>;
  label_en: string;
  label_vi: string;
};

/** Something that was asked for but cannot be offered, and why. */
export type AnswerPlanSkip = {
  label: string;
  reason_en: string;
  reason_vi: string;
};

export type AnswerPlan = { steps: AnswerPlanStep[]; skipped: AnswerPlanSkip[] };

export type AnswerResult = {
  found: boolean;
  /** Markdown with ``[n]`` marks, each naming one of ``sources``. */
  answer: string;
  /** Why there is no answer: ``no_match``, ``not_in_pages`` or ``ungrounded``. */
  reason: string;
  sources: AnswerSource[];
  /** Other pages that were read, or that may help when there is no answer. */
  related: AnswerSource[];
  cached: boolean;
  /** What the answer stands on: the wiki, the internet, or the AI's own general knowledge. */
  basis?: "wiki" | "web" | "general" | "clarify" | "app" | "plan";
  /** The internet pages the answer cites. */
  web_sources?: WebSource[];
  /** The files attached in the chat that the answer cites. */
  file_sources?: FileSource[];
  /** Buttons to the pages the answer is about: settings, the account, the user guide. */
  actions?: AnswerAction[];
  /** Steps to carry out once the person confirms (basis is "plan"). */
  plan?: AnswerPlan | null;
};

/**
 * The longest a question is waited for. The server gives up after 60 seconds, so this is
 * only for when nothing comes back at all (a dropped connection, a stalled proxy): a spinner
 * that turns forever is worse than an error with a button to try again.
 */
export const ANSWER_TIMEOUT_MS = 75_000;

export class AnswerTimeoutError extends Error {
  constructor() {
    super("The answer took too long.");
    this.name = "AnswerTimeoutError";
  }
}

/** Ask the wiki a question. The question goes in the body so it stays out of access logs. */
export function askWiki(
  query: string,
  timeoutMs: number = ANSWER_TIMEOUT_MS,
): Promise<AnswerResult> {
  return new Promise<AnswerResult>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AnswerTimeoutError()), timeoutMs);
    api
      .post<AnswerResult>("/api/v1/ai/answer", { query })
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

/** Turn each ``[n]`` of an answer into a link the Markdown renderer shows as a clickable mark. */
export function citeLinks(answer: string): string {
  return answer.replace(/\[([wf]?\d{1,2})\]/g, "[$1](cite:$1)");
}

/** The page address of a source. */
export function sourceHref(
  source: Pick<AnswerSource, "space_key" | "slug">,
): string {
  return `/spaces/${encodeURIComponent(source.space_key)}/pages/${encodeURIComponent(source.slug)}`;
}
