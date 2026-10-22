import { api } from "@/lib/api-client";
import type { QuestionGroup, QuestionGroupList, QuestionReason } from "@/types/api";

const BASE = "/api/v1/ai/questions";

export function loadQuestions(status: "open" | "resolved"): Promise<QuestionGroupList> {
  return api.get<QuestionGroupList>(`${BASE}?status=${status}`);
}

/** Close an entry: answered by a page (whoever asked is told), or dismissed. */
export function resolveQuestion(
  key: string,
  resolution: "answered" | "dismissed",
  page?: { space_key: string; slug: string } | null,
): Promise<void> {
  return api.post<void>(`${BASE}/${encodeURIComponent(key)}/resolve`, {
    resolution,
    space_key: page?.space_key ?? null,
    slug: page?.slug ?? null,
  });
}

export function reopenQuestion(key: string): Promise<void> {
  return api.post<void>(`${BASE}/${encodeURIComponent(key)}/reopen`);
}

export function deleteQuestion(key: string): Promise<void> {
  return api.delete<void>(`${BASE}/${encodeURIComponent(key)}`);
}

export function setQuestionRecording(enabled: boolean): Promise<{ enabled: boolean }> {
  return api.put<{ enabled: boolean }>(`${BASE}/recording`, { enabled });
}

/** Mark an answer unhelpful, so administrators see what the wiki is missing. */
export function sendAnswerFeedback(body: {
  surface: "chat" | "search";
  question: string;
  answer: string;
  page_ids: string[];
}): Promise<void> {
  return api.post<void>("/api/v1/ai/feedback", {
    ...body,
    question: body.question.slice(0, 2000),
    answer: body.answer.slice(0, 20_000),
    page_ids: body.page_ids.slice(0, 20),
  });
}

/** Reasons from the most telling of a gap to the least, for the chips of an entry. */
const REASON_ORDER: QuestionReason[] = [
  "no_match",
  "not_in_pages",
  "disliked",
  "ungrounded",
  "web_failed",
  "general",
  "web",
];

export function sortedReasons(group: Pick<QuestionGroup, "reasons">): QuestionReason[] {
  return [...group.reasons].sort((a, b) => REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b));
}

/** Entries whose question, other wordings or askers contain the filter text. */
export function filterQuestions(groups: QuestionGroup[], filter: string): QuestionGroup[] {
  const query = filter.trim().toLowerCase();
  if (!query) return groups;
  return groups.filter(
    (group) =>
      [group.question, group.standalone ?? "", ...group.variants].some((text) =>
        text.toLowerCase().includes(query),
      ) ||
      group.askers.some(
        (asker) =>
          asker.name.toLowerCase().includes(query) ||
          asker.username.toLowerCase().includes(query),
      ),
  );
}
