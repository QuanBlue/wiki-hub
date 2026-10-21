"use client";

import { ChevronRight, FileText, Paperclip } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { AnswerSource } from "@/lib/ai-answer";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** One page an answer was read from: a single quiet line, the excerpt on hover. */
export function SourceRow({
  source,
  onOpen,
  numbered,
}: {
  source: AnswerSource;
  onOpen: (source: AnswerSource) => void;
  numbered: boolean;
}) {
  const { t } = useTranslation();
  const files = source.files ?? [];
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(source)}
        // What was read from the page, on hover, so the row itself stays one line.
        title={source.excerpt || source.title}
        className="hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        {numbered ? (
          <span className="bg-primary-subtle text-primary inline-flex min-w-5 shrink-0 items-center justify-center rounded px-1 text-[11px] leading-5 font-semibold">
            {source.n}
          </span>
        ) : (
          <FileText
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden
          />
        )}
        <span className="text-foreground/90 min-w-0 flex-1 truncate text-[13px]">
          {source.title}
        </span>
        <Badge variant="subtle" className="shrink-0 font-mono text-[10px]">
          {source.space_key}
        </Badge>
      </button>
      {files.map((file) => (
        // The answer was read from a file attached to the page: open that file itself.
        <a
          key={file.id}
          href={`/api/v1/attachments/${file.id}/content`}
          target="_blank"
          rel="noopener noreferrer"
          title={t("search.answerFile", { file: file.filename })}
          className="text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring ml-7 flex max-w-[calc(100%-1.75rem)] items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          <Paperclip className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{file.filename}</span>
        </a>
      ))}
    </li>
  );
}

/** Pages that were read but not cited: folded away, so they are never mistaken for sources. */
export function AlsoRead({
  pages,
  onOpen,
}: {
  pages: AnswerSource[];
  onOpen: (source: AnswerSource) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label={t("search.answerRelated")}
      className="border-border/70 mt-1 border-t pt-1"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform duration-150",
            open && "rotate-90",
          )}
          aria-hidden
        />
        {t("search.answerRelated")} ({pages.length})
      </button>
      {open ? (
        <ul className="mt-0.5 space-y-0.5 opacity-90">
          {pages.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onOpen={onOpen}
              numbered={false}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return (
    <h4 className="text-muted-foreground px-2 pb-0.5 text-[10px] font-semibold tracking-wider uppercase">
      {children}
    </h4>
  );
}
