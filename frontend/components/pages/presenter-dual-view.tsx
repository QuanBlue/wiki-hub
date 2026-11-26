"use client";

import {
  Clock,
  ExternalLink,
  Minus,
  Monitor,
  Pause,
  Play,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { FrontendSlideTheme } from "@/lib/frontend-slides-themes";
import { useTranslation } from "@/lib/i18n/context";
import type { PresentationSlide } from "@/lib/page-presentation";
import { cn } from "@/lib/utils";

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** PowerPoint-style Presenter View top bar (Elapsed Timer, Wall Clock, Audience Window, End Slide Show). */
export function PresenterViewHeader({
  title,
  timerSeconds,
  timerRunning,
  onToggleTimer,
  onResetTimer,
  audienceConnected,
  onReopenAudienceWindow,
  onEndSlideShow,
}: {
  title: string;
  timerSeconds: number;
  timerRunning: boolean;
  onToggleTimer: () => void;
  onResetTimer: () => void;
  audienceConnected: boolean;
  onReopenAudienceWindow: () => void;
  onEndSlideShow: () => void;
}) {
  const { t } = useTranslation();
  const [clockText, setClockText] = useState(() => formatClock(new Date()));

  useEffect(() => {
    const id = window.setInterval(() => {
      setClockText(formatClock(new Date()));
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="border-border bg-surface text-foreground relative z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
          <Monitor className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">
              {t("present.presenterViewTitle")}
            </span>
            <span className="text-muted-foreground hidden truncate text-xs sm:inline">
              — {title}
            </span>
          </div>
        </div>
      </div>

      {/* Center: Elapsed Timer + Wall Clock */}
      <div className="border-border bg-surface-sunken hidden items-center gap-3 rounded-lg border px-3 py-1 md:flex">
        <div className="flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums">
          <Clock className="text-primary size-3.5" aria-hidden />
          <span>{formatElapsed(timerSeconds)}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onToggleTimer}
            title={
              timerRunning
                ? t("present.pauseTimer")
                : t("present.resumeTimer")
            }
            className="text-muted-foreground hover:bg-surface-hover hover:text-foreground cursor-pointer rounded p-1 transition-colors"
          >
            {timerRunning ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onResetTimer}
            title={t("present.resetTimer")}
            className="text-muted-foreground hover:bg-surface-hover hover:text-foreground cursor-pointer rounded p-1 transition-colors"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
        <span aria-hidden className="bg-border h-4 w-px" />
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {clockText}
        </span>
      </div>

      {/* Right: Audience Screen status/reopen + End Slide Show */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onReopenAudienceWindow}
          title={t("present.audienceWindowHint")}
          className="h-8 gap-1.5 text-xs"
        >
          <span
            className={cn(
              "size-2 rounded-full",
              audienceConnected ? "bg-emerald-500" : "bg-amber-500",
            )}
          />
          <ExternalLink className="size-3.5" />
          <span className="hidden sm:inline">
            {audienceConnected
              ? t("present.audienceWindowConnected")
              : t("present.audienceWindowBtn")}
          </span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEndSlideShow}
          className="border-danger/25 bg-danger/10 text-danger [&:not(:disabled)]:hover:border-danger [&:not(:disabled)]:hover:bg-danger [&:not(:disabled)]:hover:text-danger-foreground h-8 gap-1.5 border px-2.5 text-xs font-medium"
        >
          <X className="size-3.5" />
          <span>{t("present.endSlideShow")}</span>
        </Button>
      </div>
    </header>
  );
}

/** PowerPoint-style Presenter View right panel: Next Slide preview + Speaker Notes with A-/A+ zoom. */
export function PresenterViewRightPanel({
  title,
  currentIndex,
  totalSlides,
  currentSlide,
  nextSlide,
  theme,
  onGoNext,
  notesEditor,
}: {
  title: string;
  currentIndex: number;
  totalSlides: number;
  currentSlide: PresentationSlide;
  nextSlide: PresentationSlide | null;
  theme: FrontendSlideTheme;
  onGoNext: () => void;
  notesEditor: ReactNode;
}) {
  const { t } = useTranslation();
  const [noteFontPx, setNoteFontPx] = useState(14);

  return (
    <aside className="border-border bg-surface text-foreground flex w-80 shrink-0 flex-col border-l select-text sm:w-96 xl:w-[420px]">
      {/* Top Half: Next Slide Preview */}
      <div className="border-border border-b p-4">
        <div className="text-muted-foreground mb-2 flex items-center justify-between text-[11px] font-semibold tracking-wider uppercase">
          <span>{t("present.nextSlideLabel")}</span>
          {nextSlide ? (
            <span className="font-mono">
              {currentIndex + 2} / {totalSlides}
            </span>
          ) : null}
        </div>

        {nextSlide ? (
          <button
            type="button"
            onClick={onGoNext}
            className="border-border hover:border-primary/50 relative flex aspect-video w-full cursor-pointer flex-col justify-between overflow-hidden rounded-xl border p-4 text-left shadow-sm transition-colors"
            style={{
              background: theme.slideBg,
              color: theme.textPrimary,
              fontFamily: theme.fontBody,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="font-mono text-xs font-black"
                style={{ color: theme.accent }}
              >
                {String(currentIndex + 2).padStart(2, "0")}
              </span>
              <span
                className="truncate text-[10px] font-bold tracking-wider uppercase"
                style={{ color: theme.textSecondary }}
              >
                {nextSlide.eyebrow || nextSlide.layout}
              </span>
            </div>
            <div className="my-auto">
              <div
                className="line-clamp-2 text-base font-bold sm:text-lg"
                style={{ fontFamily: theme.fontDisplay }}
              >
                {nextSlide.title}
              </div>
              {nextSlide.bullets.length > 0 ? (
                <ul
                  className="mt-2 list-disc space-y-1 pl-4 text-xs"
                  style={{ color: theme.textSecondary }}
                >
                  {nextSlide.bullets.slice(0, 3).map((b, i) => (
                    <li key={i} className="line-clamp-1">
                      {b.replace(/<[^>]*>/g, "")}
                    </li>
                  ))}
                </ul>
              ) : nextSlide.subtitle ? (
                <p
                  className="mt-1.5 line-clamp-2 text-xs"
                  style={{ color: theme.textSecondary }}
                >
                  {nextSlide.subtitle}
                </p>
              ) : null}
            </div>
            <div className="text-[10px]" style={{ color: theme.textSecondary }}>
              {title}
            </div>
          </button>
        ) : (
          <div className="border-border bg-surface-sunken text-muted-foreground flex aspect-video w-full items-center justify-center rounded-xl border text-xs">
            {t("present.endOfDeck")}
          </div>
        )}
      </div>

      {/* Bottom Half: Speaker Notes with A- / A+ font size controls */}
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            {t("present.speakerNotesTitle")}
          </span>
          <div className="border-border bg-surface-sunken inline-flex items-center gap-0.5 rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setNoteFontPx((px) => Math.max(11, px - 2))}
              title={t("present.noteFontSmaller")}
              aria-label={t("present.noteFontSmaller")}
              className="text-muted-foreground hover:bg-surface-hover hover:text-foreground inline-flex size-6 cursor-pointer items-center justify-center rounded transition-colors"
            >
              <Minus className="size-3" />
            </button>
            <span className="text-muted-foreground px-1 font-mono text-[10px] tabular-nums">
              {noteFontPx}px
            </span>
            <button
              type="button"
              onClick={() => setNoteFontPx((px) => Math.min(26, px + 2))}
              title={t("present.noteFontLarger")}
              aria-label={t("present.noteFontLarger")}
              className="text-muted-foreground hover:bg-surface-hover hover:text-foreground inline-flex size-6 cursor-pointer items-center justify-center rounded transition-colors"
            >
              <Plus className="size-3" />
            </button>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ fontSize: `${noteFontPx}px` }}
        >
          {currentSlide.speakerNotes.length > 0 ? (
            <ul className="mb-3 space-y-2">
              {currentSlide.speakerNotes.map((note, idx) => (
                <li
                  key={idx}
                  className="border-border bg-surface-sunken text-foreground rounded-lg border p-3 leading-relaxed"
                >
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
          {notesEditor}
        </div>

        <p className="text-muted-foreground border-border mt-3 border-t pt-2.5 text-[11px] leading-relaxed">
          {t("present.audienceWindowHint")}
        </p>
      </div>
    </aside>
  );
}
