"use client";

import { useNavigationPending } from "@/components/navigation-loading";

const CONTENT_LINES = ["w-full", "w-11/12", "w-full", "w-2/3", "w-5/6", "w-full", "w-1/2"];

/**
 * Covers only the page's reading column while a navigation is pending; the
 * space sidebar (page tree) and app shell stay mounted and untouched. Sticky
 * with zero height so the cover follows the scroll position of the `<main>`
 * it sits in instead of scrolling away with the old content.
 */
export function PageContentLoading() {
  const pending = useNavigationPending();
  if (!pending) return null;

  return (
    <div className="sticky top-0 z-20 h-0" role="status" aria-busy="true">
      <div className="bg-background absolute inset-x-0 top-0 h-[calc(100vh-var(--wh-topbar-height))] overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 pb-5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-2 py-5" aria-hidden="true">
            <div className="loading-shimmer h-3.5 w-14 rounded" />
            <span className="text-muted-foreground">/</span>
            <div className="loading-shimmer h-3.5 w-24 rounded" />
          </div>
          <div className="loading-shimmer mb-8 h-8 w-2/3 rounded" aria-hidden="true" />
          <div className="space-y-3.5" aria-hidden="true">
            {CONTENT_LINES.map((width, index) => (
              <div key={index} className={`loading-shimmer h-3.5 rounded ${width}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
