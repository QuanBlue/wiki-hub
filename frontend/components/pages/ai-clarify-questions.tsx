"use client";

import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { inputClassName } from "@/components/ui/input";
import type { ClarifyQuestion, PageAnswer } from "@/lib/ai-summary";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type Pick = { labels: string[]; other: string };

const EMPTY: Pick = { labels: [], other: "" };

/** What one question's picks say, in a single line for the model. */
function answerText(pick: Pick): string {
  const other = pick.other.trim();
  return [...pick.labels, ...(other ? [other] : [])].join(", ");
}

/**
 * The AI's clarifying questions, one at a time like a plan-mode / grill-me
 * interview: pick an option (with recommended defaults highlighted) or write
 * your own, then advance. Supports both fixed-list mode and adaptive turn-by-turn
 * grilling with "Enough, write now" at every step.
 */
export function AiClarifyQuestions({
  questions,
  busy,
  onSubmit,
  onSkip,
  adaptive = false,
  questionNumber = 1,
  maxQuestions = 10,
  canGoBack = false,
  thinking = false,
  onAnswer,
  onBack,
  onWriteNow,
}: {
  questions: ClarifyQuestion[];
  busy: boolean;
  onSubmit: (answers: PageAnswer[]) => void;
  onSkip: () => void;
  adaptive?: boolean;
  questionNumber?: number;
  maxQuestions?: number;
  canGoBack?: boolean;
  thinking?: boolean;
  onAnswer?: (answer: PageAnswer) => void;
  onBack?: () => void;
  onWriteNow?: (currentAnswer?: PageAnswer) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<Pick[]>(() => questions.map(() => EMPTY));

  const activeIndex = adaptive ? 0 : step;
  const question = questions[activeIndex];
  const pick = picks[activeIndex] ?? EMPTY;
  const last = !adaptive && activeIndex === questions.length - 1;
  const currentText = answerText(pick);
  const answered = currentText.length > 0;
  const locked = busy || thinking;

  if (!question) return null;

  function update(next: Pick) {
    setPicks((all) =>
      all.map((value, index) => (index === activeIndex ? next : value)),
    );
  }

  function toggle(label: string) {
    if (locked) return;
    if (question.multi_select) {
      update({
        ...pick,
        labels: pick.labels.includes(label)
          ? pick.labels.filter((value) => value !== label)
          : [...pick.labels, label],
      });
    } else {
      // One answer: choosing an option replaces anything written in "Other".
      update({ labels: pick.labels[0] === label ? [] : [label], other: "" });
    }
  }

  function currentAnswer(): PageAnswer {
    return {
      header: question.header || undefined,
      question: question.question,
      answer: currentText,
    };
  }

  function advance() {
    if (!answered || locked) return;
    if (adaptive) {
      onAnswer?.(currentAnswer());
      return;
    }
    if (!last) {
      setStep(activeIndex + 1);
      return;
    }
    onSubmit(
      questions
        .map((item, index) => ({
          question: item.question,
          answer: answerText(picks[index] ?? EMPTY),
        }))
        .filter((item) => item.answer),
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          {question.header ? (
            <span className="bg-primary-subtle text-primary rounded-full px-2 py-0.5 text-xs font-medium">
              {question.header}
            </span>
          ) : null}
          <span className="text-muted-foreground text-xs tabular-nums">
            {adaptive
              ? t("pageCreate.aiDeepStep", {
                  current: questionNumber,
                  max: maxQuestions,
                })
              : t("pageCreate.aiStep", {
                  current: activeIndex + 1,
                  total: questions.length,
                })}
          </span>
        </span>
        {!adaptive ? (
          <button
            type="button"
            onClick={onSkip}
            disabled={locked}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring cursor-pointer rounded px-1 text-xs underline-offset-2 transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("pageCreate.aiSkipQuestions")}
          </button>
        ) : null}
      </div>

      <fieldset className="wh-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        <legend className="mb-1 text-sm leading-snug font-medium">
          {question.question}
        </legend>
        {question.rationale ? (
          <p className="text-muted-foreground mb-2 text-xs leading-relaxed">
            {question.rationale}
          </p>
        ) : null}
        {question.options.map((option) => {
          const selected = pick.labels.includes(option.label);
          return (
            <div
              key={option.label}
              className={cn(
                "flex items-center gap-1 rounded-lg border pr-2 transition-colors duration-150",
                selected
                  ? "border-primary bg-primary-subtle"
                  : option.recommended
                    ? "border-primary/40 bg-surface hover:bg-surface-hover"
                    : "border-border bg-surface hover:bg-surface-hover",
              )}
            >
              <button
                type="button"
                role={question.multi_select ? "checkbox" : "radio"}
                aria-checked={selected}
                disabled={locked}
                onClick={() => toggle(option.label)}
                className="focus-visible:ring-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center border",
                    question.multi_select ? "rounded" : "rounded-full",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border-strong",
                  )}
                >
                  {selected ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{option.label}</span>
                    {option.recommended ? (
                      <Badge
                        variant="info"
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {t("pageCreate.aiRecommended")}
                      </Badge>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="text-muted-foreground block text-xs leading-snug">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
              {option.detail && option.detail !== option.description ? (
                <InfoTip>{option.detail}</InfoTip>
              ) : null}
            </div>
          );
        })}
        <input
          type="text"
          value={pick.other}
          disabled={locked}
          onChange={(event) =>
            update({
              labels: question.multi_select ? pick.labels : [],
              other: event.target.value,
            })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              advance();
            }
          }}
          maxLength={400}
          aria-label={t("pageCreate.aiOther")}
          placeholder={t("pageCreate.aiOther")}
          className={cn(inputClassName, "h-9 text-sm")}
        />
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={(adaptive ? !canGoBack : activeIndex === 0) || locked}
          onClick={() =>
            adaptive ? onBack?.() : setStep(Math.max(0, activeIndex - 1))
          }
        >
          <ArrowLeft aria-hidden />
          {t("pageCreate.aiBack")}
        </Button>
        <div className="flex items-center gap-2">
          {adaptive && onWriteNow ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={locked}
              onClick={() =>
                onWriteNow(answered ? currentAnswer() : undefined)
              }
            >
              <Sparkles aria-hidden />
              {t("pageCreate.aiWriteNow")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary"
            disabled={!answered || locked}
            onClick={advance}
          >
            {thinking ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : busy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : last ? (
              <Sparkles aria-hidden />
            ) : (
              <ArrowRight aria-hidden />
            )}
            {thinking
              ? t("pageCreate.aiThinkingNext")
              : busy
                ? t("pageCreate.aiGenerating")
                : last
                  ? t("pageCreate.aiWritePage")
                  : t("pageCreate.aiNext")}
          </Button>
        </div>
      </div>
    </div>
  );
}
