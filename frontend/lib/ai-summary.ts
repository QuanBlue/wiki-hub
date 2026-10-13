import { api } from "@/lib/api-client";

/** A file attached to the page, as the summary endpoint reports it. */
export type SummaryAttachment = {
  id: string;
  filename: string;
  content_type: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turn each attachment's file name, where the summary mentions it, into a
 * `[name](attachment:<id>)` link so it can open the file's viewer.
 *
 * Only exact names are linked, and only as whole words: `a.pdf` inside
 * `data_a.pdf` or a path is left alone. A name the model wrapped in bold or
 * backticks is linked too, the wrapper dropped so the link shows. One pass over
 * the text means a short name can never be linked again inside a longer one.
 */
export function linkAttachments(
  summary: string,
  attachments: SummaryAttachment[],
): string {
  const usable = attachments
    // A bracket in the name would break the link text.
    .filter(
      (attachment) => attachment.filename && !/[[\]]/.test(attachment.filename),
    )
    .sort((a, b) => b.filename.length - a.filename.length);
  if (usable.length === 0) return summary;

  const byName = new Map(
    usable.map((attachment) => [attachment.filename, attachment.id]),
  );
  const names = usable
    .map((attachment) => escapeRegExp(attachment.filename))
    .join("|");
  const pattern = new RegExp(
    `(?<![\\w/.-])(?:\\*\\*)?\`?(${names})\`?(?:\\*\\*)?(?!\\w)`,
    "g",
  );
  return summary.replace(
    pattern,
    (_match, name: string) => `[${name}](attachment:${byName.get(name)})`,
  );
}

/** Ask the page to open an attachment's viewer, as clicking it in the page would. */
export function openAttachment(attachmentId: string): void {
  window.dispatchEvent(
    new CustomEvent("wikihub:open-attachment-modal", {
      detail: { attachmentId },
    }),
  );
}

export type AiStatus = { enabled: boolean; can_configure: boolean };

// One status lookup per page load, shared by everything that offers AI.
let statusRequest: Promise<AiStatus> | null = null;

/** Whether the AI assistant is on; a failed lookup counts as off and is retried later. */
export function aiStatus(): Promise<AiStatus> {
  statusRequest ??= (async () => {
    try {
      return await api.get<AiStatus>("/api/v1/ai/status");
    } catch {
      statusRequest = null;
      return { enabled: false, can_configure: false };
    }
  })();
  return statusRequest;
}

export type PageDraft = { title: string; content: string };

/** Ask the AI for a first draft of a new page; nothing is saved until it is created. */
export function draftPage(
  spaceKey: string,
  body: {
    prompt: string;
    title: string;
    lang: string;
    answers?: PageAnswer[];
    related_ids?: string[];
  },
): Promise<PageDraft> {
  return api.post<PageDraft>(
    `/api/v1/ai/spaces/${encodeURIComponent(spaceKey)}/pages/draft`,
    body,
  );
}

export type ClarifyOption = {
  label: string;
  description: string;
  detail?: string;
};

export type ClarifyQuestion = {
  header: string;
  question: string;
  multi_select: boolean;
  options: ClarifyOption[];
};

export type PageAnswer = { question: string; answer: string };

export type RelatedPage = {
  id: string;
  title: string;
  slug: string;
  space_key: string;
  space_name: string;
};

export type PageClarify = {
  questions: ClarifyQuestion[];
  related: RelatedPage[];
};

/** Look the request up in the wiki and get the questions the AI wants answered. */
export function clarifyPage(
  spaceKey: string,
  body: { prompt: string; title: string; lang: string },
): Promise<PageClarify> {
  return api.post<PageClarify>(
    `/api/v1/ai/spaces/${encodeURIComponent(spaceKey)}/pages/clarify`,
    body,
  );
}
