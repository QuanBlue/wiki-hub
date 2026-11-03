"use client";

import {
  CircleMinus,
  CirclePlus,
  Copy,
  FileText,
  Info,
  Rows3,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import {
  diffBlocks,
  pageBlocks,
  wordSegments,
  type DiffRow,
  type PageBlock,
} from "@/lib/space-health";
import { cn } from "@/lib/utils";
import type { PageRevisionDiffSegment, PageRevisionItem } from "@/types/api";

/** A revision as HTML for the line view: a Markdown revision becomes one paragraph a line. */
export function revisionHtml(
  revision: Pick<PageRevisionItem, "content" | "content_format">,
): string {
  if (revision.content_format === "html") return revision.content;
  return revision.content
    .split("\n")
    .map(
      (line) =>
        `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
    )
    .join("");
}

export interface LineDiffData {
  rows: DiffRow[];
  /** Each side's blocks, one per line, in page order. */
  blocks: [PageBlock[], PageBlock[]];
  /** Lines both sides have, and lines only the old (left) or new (right) side has. */
  same: number;
  onlyOld: number;
  onlyNew: number;
  /**
   * When the words are the same but the HTML is not: what else changed (column widths,
   * styles, links, images, formatting, other attributes), so a version that "changed
   * nothing" in the line view says why it was saved. Empty otherwise.
   */
  markup: MarkupChange[];
}

export type MarkupChange =
  "columns" | "styles" | "links" | "images" | "formatting" | "attributes";

const ATTRIBUTE_KIND: Record<string, MarkupChange> = {
  colwidth: "columns",
  width: "columns",
  colspan: "columns",
  rowspan: "columns",
  style: "styles",
  class: "styles",
  href: "links",
  src: "images",
  alt: "images",
};

/** What differs between two HTML documents beyond their words, by kind. */
export function markupChanges(
  oldHtml: string,
  newHtml: string,
): MarkupChange[] {
  if (oldHtml === newHtml) return [];
  const read = (html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tags: string[] = [];
    const attributes = new Map<MarkupChange, string[]>();
    doc.body.querySelectorAll("*").forEach((el) => {
      tags.push(el.tagName);
      for (const attribute of Array.from(el.attributes)) {
        const kind = ATTRIBUTE_KIND[attribute.name] ?? "attributes";
        const list = attributes.get(kind) ?? [];
        list.push(`${el.tagName}|${attribute.name}=${attribute.value}`);
        attributes.set(kind, list);
      }
    });
    return { tags: tags.join(","), attributes };
  };
  const a = read(oldHtml);
  const b = read(newHtml);
  const kinds: MarkupChange[] = [];
  if (a.tags !== b.tags) kinds.push("formatting");
  (["columns", "styles", "links", "images", "attributes"] as const).forEach(
    (kind) => {
      const before = (a.attributes.get(kind) ?? []).join("\n");
      const after = (b.attributes.get(kind) ?? []).join("\n");
      if (before !== after) kinds.push(kind);
    },
  );
  // Same tags and attributes but different bytes: spacing or entities only.
  return kinds.length > 0 ? kinds : ["formatting"];
}

/** Two pages' HTML (or two versions of one), worked out as aligned lines. */
export function useLineDiff(
  oldHtml: string | null,
  newHtml: string | null,
): LineDiffData | null {
  return useMemo(() => {
    if (oldHtml === null || newHtml === null) return null;
    const blocks: [PageBlock[], PageBlock[]] = [
      pageBlocks(oldHtml),
      pageBlocks(newHtml),
    ];
    const rows = diffBlocks(blocks[0], blocks[1]);
    const textChanged = rows.some((row) => row.kind === "change");
    return {
      rows,
      blocks,
      same: rows.filter((row) => row.kind === "same").length,
      onlyOld: rows.filter((row) => row.kind === "change" && row.a).length,
      onlyNew: rows.filter((row) => row.kind === "change" && row.b).length,
      markup: textChanged ? [] : markupChanges(oldHtml, newHtml),
    };
  }, [oldHtml, newHtml]);
}

/** The words of one side of a changed line, the ones that differ marked. */
function LineSegments({
  segments,
  side,
}: {
  segments: PageRevisionDiffSegment[];
  side: "old" | "new";
}) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.operation === "equal" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <mark
            key={index}
            className={cn(
              "text-foreground rounded-sm px-0.5",
              side === "old" ? "bg-danger/25" : "bg-success/25",
            )}
          >
            {segment.text}
          </mark>
        ),
      )}
    </>
  );
}

/** One side of a line: its number on that side and its words, or a plain grey gap if it has none. */
function LineCell({
  number,
  children,
  tone,
}: {
  number: number | null;
  children?: ReactNode;
  tone: "same" | "old" | "new";
}) {
  if (number === null) {
    return <div className="bg-surface-sunken min-h-7" aria-hidden />;
  }
  return (
    <div
      className={cn(
        "flex min-w-0",
        tone === "old" && "bg-danger-bg",
        tone === "new" && "bg-success-bg",
      )}
    >
      <span
        className={cn(
          "w-11 shrink-0 py-1 pr-2 text-right text-xs tabular-nums select-none",
          tone === "old"
            ? "text-danger"
            : tone === "new"
              ? "text-success"
              : "text-muted-foreground",
        )}
      >
        {number}
      </span>
      <span className="min-w-0 flex-1 py-1 pr-3 pl-2 font-mono text-[13px] leading-5 break-words whitespace-pre-wrap">
        {children}
      </span>
    </div>
  );
}

/**
 * The aligned lines: a line both sides have sits level on both; a changed line is red on the
 * left and green on the right with the differing words marked; a line only one side has faces
 * a plain grey gap. Both columns are one grid, so they scroll as one.
 */
function LineRows({ rows }: { rows: DiffRow[] }) {
  let left = 0;
  let right = 0;
  return (
    <div className="divide-border grid grid-cols-2 divide-x">
      {rows.map((row, index) => {
        const leftNumber = row.a ? ++left : null;
        const rightNumber = row.b ? ++right : null;
        if (row.kind === "same") {
          return (
            <div key={index} className="contents">
              <LineCell number={leftNumber} tone="same">
                {row.a.text}
              </LineCell>
              <LineCell number={rightNumber} tone="same">
                {row.b.text}
              </LineCell>
            </div>
          );
        }
        const words =
          row.a && row.b ? wordSegments(row.a.text, row.b.text) : null;
        return (
          <div key={index} className="contents">
            <LineCell number={leftNumber} tone="old">
              {row.a ? (
                words ? (
                  <LineSegments segments={words.old} side="old" />
                ) : (
                  row.a.text
                )
              ) : null}
            </LineCell>
            <LineCell number={rightNumber} tone="new">
              {row.b ? (
                words ? (
                  <LineSegments segments={words.new} side="new" />
                ) : (
                  row.b.text
                )
              ) : null}
            </LineCell>
          </div>
        );
      })}
    </div>
  );
}

/** Copies one side's text, one line a block, as the line view shows it. */
function CopyLines({ lines }: { lines: string[] }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="md"
      onClick={() => {
        void navigator.clipboard
          .writeText(lines.join("\n"))
          .then(() => toast.success(t("lineDiff.copied")))
          .catch(() => toast.error(t("lineDiff.copyError")));
      }}
    >
      <Copy />
      {t("lineDiff.copy")}
    </Button>
  );
}

/**
 * Two pages, or two versions of one, as numbered, aligned lines - what only the left side
 * says in red, what only the right side says in green - with a header over each side: how
 * many lines only it has, how many lines it has, a copy button and the caller's own heading
 * (a page title, a version and its author). Used by the content health report's comparison,
 * the page history and the home page's "view change".
 */
export function LineDiff({
  diff,
  headings,
  counts,
  className,
}: {
  diff: LineDiffData;
  /** What each side is: shown under its counts. */
  headings: [ReactNode, ReactNode];
  /** The words for each side's own lines, e.g. "3 removals" and "2 additions". */
  counts: [string, string];
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "border-border bg-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border",
        className,
      )}
    >
      <div className="border-border divide-border grid shrink-0 grid-cols-2 divide-x border-b">
        {([0, 1] as const).map((index) => {
          const old = index === 0;
          return (
            <div key={index} className="min-w-0 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-semibold",
                    old ? "text-danger" : "text-success",
                  )}
                >
                  {old ? (
                    <CircleMinus className="size-4" aria-hidden />
                  ) : (
                    <CirclePlus className="size-4" aria-hidden />
                  )}
                  {counts[index]}
                </span>
                <span className="text-muted-foreground flex items-center gap-2 text-xs">
                  {t("lineDiff.lines", { count: diff.blocks[index].length })}
                  <CopyLines
                    lines={diff.blocks[index].map((block) => block.text)}
                  />
                </span>
              </div>
              <div className="min-w-0 truncate text-sm">{headings[index]}</div>
            </div>
          );
        })}
      </div>
      {diff.markup.length > 0 ? (
        <div
          className="border-border border-l-info bg-info-bg flex shrink-0 items-start gap-2.5 border-b border-l-4 px-4 py-2.5 text-sm"
          role="status"
        >
          <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">
              {t("lineDiff.markupOnlyTitle")}
            </strong>{" "}
            {t("lineDiff.markupOnly", {
              what: diff.markup
                .map((kind) => t(`lineDiff.markup_${kind}`))
                .join(", "),
            })}
          </p>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {diff.rows.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">
            {t("lineDiff.empty")}
          </p>
        ) : (
          <LineRows rows={diff.rows} />
        )}
      </div>
    </div>
  );
}

/**
 * How a comparison is shown: "Page view" (each side as it reads, changes tinted) or "Line by
 * line" (numbered text lines side by side). Labelled, with an icon each, so it reads as a view
 * switch rather than one more action button.
 */
export function DiffViewToggle({
  value,
  onChange,
}: {
  value: "lines" | "pages";
  onChange: (value: "lines" | "pages") => void;
}) {
  const { t } = useTranslation();
  const views: ["lines" | "pages", string, typeof FileText][] = [
    ["pages", t("lineDiff.viewPages"), FileText],
    ["lines", t("lineDiff.viewLines"), Rows3],
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs font-medium">
        {t("lineDiff.view")}
      </span>
      <div
        role="group"
        aria-label={t("lineDiff.view")}
        className="bg-surface-sunken border-border flex gap-0.5 rounded-md border p-0.5"
      >
        {views.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            className={cn(
              "focus-visible:ring-ring flex h-7 cursor-pointer items-center gap-1.5 rounded px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
              value === id
                ? "bg-surface text-primary shadow-sm"
                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
