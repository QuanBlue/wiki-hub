"use client";

import { Check, Loader2, ThumbsDown } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "@/lib/i18n/context";
import { sendAnswerFeedback } from "@/lib/question-gaps";
import { cn } from "@/lib/utils";

/**
 * "Not helpful" under an answer of the assistant: the question goes to the administrators'
 * Unanswered questions, so the page that would have answered it can be written. Once sent it
 * says so, and cannot be sent twice.
 */
export function AnswerFeedback({
  surface,
  question,
  answer,
  pageIds,
  className,
}: {
  surface: "chat" | "search";
  question: string;
  answer: string;
  pageIds: string[];
  className?: string;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  if (!question.trim()) return null;

  async function send() {
    setState("sending");
    try {
      await sendAnswerFeedback({ surface, question, answer, page_ids: pageIds });
      setState("sent");
    } catch {
      setState("failed");
    }
  }

  if (state === "sent") {
    return (
      <p
        role="status"
        className={cn("text-muted-foreground flex items-center gap-1.5 text-xs", className)}
      >
        <Check className="text-success size-3.5" aria-hidden />
        {t("chat.feedbackSent")}
      </p>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => void send()}
        disabled={state === "sending"}
        aria-label={t("chat.feedbackDislike")}
        title={t("chat.feedbackDislikeHint")}
        className="text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === "sending" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <ThumbsDown className="size-3.5" aria-hidden />
        )}
        {t("chat.feedbackDislike")}
      </button>
      {state === "failed" ? (
        <span role="alert" className="text-danger text-xs">
          {t("chat.feedbackError")}
        </span>
      ) : null}
    </div>
  );
}
