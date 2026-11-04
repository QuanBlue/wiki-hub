"use client";

import { forwardRef, useMemo } from "react";

import { highlightMarkdown, type MarkdownTone } from "@/lib/issue-markdown-highlight";
import { cn } from "@/lib/utils";

/**
 * Only weight, slant, colour and background: anything that changed a
 * character's width or the line height would drift out of step with the
 * textarea underneath. (Backgrounds are translucent so the selection painted
 * by the textarea still shows through.)
 */
const TONE_CLASS: Record<MarkdownTone, string> = {
  plain: "",
  marker: "text-muted-foreground/70",
  bold: "font-bold",
  italic: "italic",
  code: "bg-foreground/10 text-foreground",
  link: "text-primary underline underline-offset-2",
  heading: "font-bold text-foreground",
  quote: "text-muted-foreground italic",
  list: "text-primary font-bold",
};

/**
 * Draws the description's markdown, styled, exactly over a transparent
 * textarea (which keeps the caret, selection, typing and spell-check). It
 * takes no pointer events and is hidden from assistive tech: the textarea is
 * still the one real control.
 *
 * The parent must give both elements the same box, font and padding, and
 * forward the textarea's scroll position to this element's `scrollTop`.
 */
export const MarkdownMirror = forwardRef<HTMLDivElement, { value: string; className?: string }>(
  function MarkdownMirror({ value, className }, ref) {
    const runs = useMemo(() => highlightMarkdown(value), [value]);
    return (
      <div
        ref={ref}
        aria-hidden="true"
        data-testid="markdown-mirror"
        className={cn(
          "text-foreground pointer-events-none absolute inset-0 z-10 overflow-y-auto break-words whitespace-pre-wrap select-none",
          className,
        )}
      >
        {runs.map((run, index) => (
          <span key={index} className={TONE_CLASS[run.tone]}>
            {run.text}
          </span>
        ))}
        {/* A trailing newline would otherwise add no line here, though the textarea has one. */}
        {"​"}
      </div>
    );
  },
);
