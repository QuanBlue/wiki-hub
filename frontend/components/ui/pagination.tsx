"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** Page numbers to show: first, last, and a window around the current page. */
export function pageWindow(
  page: number,
  pageCount: number,
): (number | "gap")[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const pages = [...wanted]
    .filter((n) => n >= 1 && n <= pageCount)
    .sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  pages.forEach((n, index) => {
    if (index > 0 && n - pages[index - 1]! > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

const cell =
  "focus-visible:ring-ring inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none";
const idle = "text-foreground hover:bg-surface-hover cursor-pointer";
const off = "text-muted-foreground pointer-events-none opacity-50";

/**
 * Numbered pagination. Pass `onPageChange` for client-side lists, or `hrefFor`
 * for server-rendered pages where each page is a link.
 */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  hrefFor,
  previousLabel,
  nextLabel,
  className,
}: {
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  hrefFor?: (page: number) => string;
  previousLabel: string;
  nextLabel: string;
  className?: string;
}) {
  if (pageCount <= 1) return null;

  const item = (
    target: number,
    content: React.ReactNode,
    options: { active?: boolean; disabled?: boolean; label?: string } = {},
  ) => {
    const classes = cn(
      cell,
      options.active
        ? "bg-primary text-primary-foreground"
        : options.disabled
          ? off
          : idle,
    );
    if (hrefFor && !options.disabled) {
      return (
        <Link
          href={hrefFor(target)}
          aria-label={options.label}
          aria-current={options.active ? "page" : undefined}
          className={classes}
        >
          {content}
        </Link>
      );
    }
    return (
      <button
        type="button"
        disabled={options.disabled}
        aria-label={options.label}
        aria-current={options.active ? "page" : undefined}
        onClick={() => onPageChange?.(target)}
        className={classes}
      >
        {content}
      </button>
    );
  };

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center gap-1", className)}
    >
      {item(
        page - 1,
        <>
          <ChevronLeft className="size-4" aria-hidden />
          <span className="hidden sm:inline">{previousLabel}</span>
        </>,
        { disabled: page <= 1, label: previousLabel },
      )}
      {pageWindow(page, pageCount).map((entry, index) =>
        entry === "gap" ? (
          <span
            key={`gap-${index}`}
            aria-hidden
            className="text-muted-foreground px-1 text-sm"
          >
            …
          </span>
        ) : (
          <span key={entry} className="inline-flex">
            {item(entry, entry, {
              active: entry === page,
              label: String(entry),
            })}
          </span>
        ),
      )}
      {item(
        page + 1,
        <>
          <span className="hidden sm:inline">{nextLabel}</span>
          <ChevronRight className="size-4" aria-hidden />
        </>,
        { disabled: page >= pageCount, label: nextLabel },
      )}
    </nav>
  );
}
