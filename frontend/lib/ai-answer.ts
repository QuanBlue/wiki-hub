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
};

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
  return answer.replace(/\[(\d{1,2})\]/g, "[$1](cite:$1)");
}

/** The page address of a source. */
export function sourceHref(
  source: Pick<AnswerSource, "space_key" | "slug">,
): string {
  return `/spaces/${encodeURIComponent(source.space_key)}/pages/${encodeURIComponent(source.slug)}`;
}
