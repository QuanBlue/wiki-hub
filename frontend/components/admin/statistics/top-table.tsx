"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { StatsTopContent } from "@/types/api";

type Sort = "views" | "stars" | "saves";

/**
 * A ranked table of pages or spaces. Every ranking is fetched up front, so
 * switching the metric or searching is instant and never reloads.
 */
export function TopTable({
  kind,
  rankings,
  title,
  searchable = false,
}: {
  kind: "page" | "space";
  rankings: Partial<Record<Sort, StatsTopContent>>;
  title?: string;
  searchable?: boolean;
}) {
  const { t, locale } = useTranslation();
  const sorts = (["views", "stars", "saves"] as const).filter(
    (sort) => rankings[sort],
  );
  const [sort, setSort] = useState<Sort>("views");
  const [query, setQuery] = useState("");
  const rawItems = useMemo(
    () => rankings[sort]?.items ?? [],
    [rankings, sort],
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rawItems;
    return rawItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.space_name.toLowerCase().includes(q) ||
        item.space_key.toLowerCase().includes(q),
    );
  }, [rawItems, query]);

  const metricOf = (item: (typeof rawItems)[number]) =>
    sort === "views"
      ? item.views
      : sort === "stars"
        ? item.stars
        : (item.saves ?? 0);
  const maxMetric = Math.max(1, ...rawItems.map(metricOf));

  const number = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US");
  const labels: Record<Sort, string> = {
    views: t("adminStats.sortViews"),
    stars: t("adminStats.sortStars"),
    saves: t("adminStats.sortSaves"),
  };

  return (
    <section className="border-border bg-surface min-w-0 rounded-xl border shadow-sm">
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          {title ? (
            <h3 className="text-sm font-semibold">{title}</h3>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {t("adminStats.topNote")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {searchable ? (
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("adminStats.searchContent")}
                aria-label={t("adminStats.searchContent")}
                className="border-border bg-background text-foreground placeholder:text-muted-foreground hover:border-border-strong focus-visible:ring-ring h-8 w-44 rounded-md border pr-2.5 pl-8 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none sm:w-56"
              />
            </div>
          ) : null}

          <div
            role="group"
            aria-label={t("adminStats.rankBy")}
            className="bg-surface-sunken flex items-center gap-0.5 rounded-lg p-0.5"
          >
            <span className="sr-only">{t("adminStats.rankBy")}</span>
            {sorts.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={sort === option}
                onClick={() => setSort(option)}
                className={cn(
                  "focus-visible:ring-ring cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  sort === option
                    ? "bg-surface text-primary font-semibold shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {labels[option]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">
          {query.trim() ? t("adminStats.noSearchMatches") : t("adminStats.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs">
                <th scope="col" className="w-10 px-4 py-2 font-medium">
                  {t("adminStats.colRank")}
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  {kind === "page"
                    ? t("adminStats.colPage")
                    : t("adminStats.colSpace")}
                </th>
                {kind === "page" ? (
                  <th scope="col" className="px-2 py-2 font-medium">
                    {t("adminStats.colSpace")}
                  </th>
                ) : (
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t("adminStats.pages")}
                  </th>
                )}
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {t("adminStats.colViews")}
                </th>
                <th
                  scope="col"
                  className={cn(
                    "py-2 text-right font-medium",
                    kind === "page" ? "px-2" : "px-4",
                  )}
                >
                  {t("adminStats.colStars")}
                </th>
                {kind === "page" ? (
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    {t("adminStats.colSaves")}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const ratioPct = Math.max(
                  2,
                  Math.round((metricOf(item) / maxMetric) * 100),
                );
                return (
                  <tr
                    key={item.id}
                    className="border-border/70 hover:bg-surface-hover border-b transition-colors duration-150 last:border-b-0"
                  >
                    <td className="text-muted-foreground px-4 py-2.5 tabular-nums">
                      {index + 1}
                    </td>
                    <td className="max-w-88 px-2 py-2.5">
                      <Link
                        href={
                          kind === "page"
                            ? `/spaces/${encodeURIComponent(item.space_key)}/pages/${encodeURIComponent(item.slug ?? "")}`
                            : `/spaces/${encodeURIComponent(item.space_key)}`
                        }
                        className="text-primary focus-visible:ring-ring block truncate rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {item.title}
                      </Link>
                      <div className="bg-surface-sunken mt-1 h-1 max-w-36 overflow-hidden rounded-full">
                        <div
                          className="bg-primary/60 h-full rounded-full"
                          style={{ width: `${ratioPct}%` }}
                        />
                      </div>
                    </td>
                    {kind === "page" ? (
                      <td className="text-muted-foreground max-w-56 truncate px-2 py-2.5">
                        {item.space_name}
                      </td>
                    ) : (
                      <td className="text-muted-foreground px-2 py-2.5 text-right tabular-nums">
                        {item.page_count !== null && item.page_count !== undefined
                          ? number.format(item.page_count)
                          : "—"}
                      </td>
                    )}
                    <td
                      className={cn(
                        "px-2 py-2.5 text-right tabular-nums",
                        sort === "views" && "font-semibold",
                      )}
                    >
                      {number.format(item.views)}
                    </td>
                    <td
                      className={cn(
                        "py-2.5 text-right tabular-nums",
                        kind === "page" ? "px-2" : "px-4",
                        sort === "stars" && "font-semibold",
                      )}
                    >
                      {number.format(item.stars)}
                    </td>
                    {kind === "page" ? (
                      <td
                        className={cn(
                          "px-4 py-2.5 text-right tabular-nums",
                          sort === "saves" && "font-semibold",
                        )}
                      >
                        {number.format(item.saves ?? 0)}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
