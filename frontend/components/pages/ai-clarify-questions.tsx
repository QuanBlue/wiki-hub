"use client";

import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

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
 * The AI's clarifying questions, one at a time like a plan-mode prompt: pick an
 * option (or several, when the question allows it) or write your own, then go
 * on. The last step hands every answer back; Skip writes without answers.
 */
export function AiClarifyQuestions({
  questions,
  busy,
  onSubmit,
  onSkip,
}: {
  questions: ClarifyQuestion[];
  busy: boolean;
  onSubmit: (answers: PageAnswer[]) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<Pick[]>(() => questions.map(() => EMPTY));
  const question = questions[step];
  const pick = picks[step] ?? EMPTY;
  const last = step === questions.length - 1;
  const answered = answerText(pick).length > 0;

  function update(next: Pick) {
    setPicks((all) =>
      all.map((value, index) => (index === step ? next : value)),
    );
  }

  function toggle(label: string) {
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

  function advance() {
    if (!last) {
      setStep(step + 1);
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
            {t("pageCreate.aiStep", {
              current: step + 1,
              total: questions.length,
            })}
          </span>
        </span>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring cursor-pointer rounded px-1 text-xs underline-offset-2 transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("pageCreate.aiSkipQuestions")}
        </button>
      </div>

      <fieldset className="wh-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        <legend className="mb-2 text-sm font-medium">
          {question.question}
        </legend>
        {question.options.map((option) => {
          const selected = pick.labels.includes(option.label);
          return (
            <div
              key={option.label}
              className={cn(
                "flex items-center gap-1 rounded-lg border pr-2 transition-colors duration-150",
                selected
                  ? "border-primary bg-primary-subtle"
                  : "border-border bg-surface hover:bg-surface-hover",
              )}
            >
              <button
                type="button"
                role={question.multi_select ? "checkbox" : "radio"}
                aria-checked={selected}
                onClick={() => toggle(option.label)}
                className="focus-visible:ring-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
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
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="text-muted-foreground block truncate text-xs">
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
          onChange={(event) =>
            update({
              labels: question.multi_select ? pick.labels : [],
              other: event.target.value,
            })
          }
          maxLength={200}
          aria-label={t("pageCreate.aiOther")}
          placeholder={t("pageCreate.aiOther")}
          className={cn(inputClassName, "h-9 text-sm")}
        />
      </fieldset>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={step === 0 || busy}
          onClick={() => setStep(step - 1)}
        >
          <ArrowLeft aria-hidden />
          {t("pageCreate.aiBack")}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!answered || busy}
          onClick={advance}
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : last ? (
            <Sparkles aria-hidden />
          ) : (
            <ArrowRight aria-hidden />
          )}
          {busy
            ? t("pageCreate.aiGenerating")
            : last
              ? t("pageCreate.aiWritePage")
              : t("pageCreate.aiNext")}
        </Button>
      </div>
    </div>
  );
}
