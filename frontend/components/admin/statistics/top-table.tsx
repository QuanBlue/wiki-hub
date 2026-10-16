"use client";

import Link from "next/link";
import { useState } from "react";

import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { StatsTopContent } from "@/types/api";

type Sort = "views" | "stars" | "saves";

/**
 * A ranked table of pages or spaces. Every ranking is fetched up front by the
 * server page, so switching the metric is instant and never reloads.
 */
export function TopTable({
  kind,
  rankings,
}: {
  kind: "page" | "space";
  rankings: Partial<Record<Sort, StatsTopContent>>;
}) {
  const { t, locale } = useTranslation();
  const sorts = (["views", "stars", "saves"] as const).filter(
    (sort) => rankings[sort],
  );
  const [sort, setSort] = useState<Sort>("views");
  const items = rankings[sort]?.items ?? [];
  const number = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US");
  const labels: Record<Sort, string> = {
    views: t("adminStats.sortViews"),
    stars: t("adminStats.sortStars"),
    saves: t("adminStats.sortSaves"),
  };

  return (
    <section className="border-border bg-surface min-w-0 rounded-xl border shadow-sm">
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <p className="text-muted-foreground text-xs">
          {t("adminStats.topNote")}
        </p>
        <div
          role="group"
          aria-label={t("adminStats.rankBy")}
          className="flex items-center gap-1"
        >
          <span className="text-muted-foreground mr-1 text-xs">
            {t("adminStats.rankBy")}
          </span>
          {sorts.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={sort === option}
              onClick={() => setSort(option)}
              className={cn(
                "focus-visible:ring-ring cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                sort === option
                  ? "bg-surface-selected text-primary hover:bg-surface-selected-hover"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {labels[option]}
            </button>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">
          {t("adminStats.empty")}
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
                ) : null}
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {t("adminStats.colViews")}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
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
              {items.map((item, index) => (
                <tr
                  key={item.id}
                  className="border-border/70 hover:bg-surface-hover border-b transition-colors last:border-b-0"
                >
                  <td className="text-muted-foreground px-4 py-2 tabular-nums">
                    {index + 1}
                  </td>
                  <td className="max-w-88 truncate px-2 py-2">
                    <Link
                      href={
                        kind === "page"
                          ? `/spaces/${encodeURIComponent(item.space_key)}/pages/${encodeURIComponent(item.slug ?? "")}`
                          : `/spaces/${encodeURIComponent(item.space_key)}`
                      }
                      className="text-primary focus-visible:ring-ring rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {item.title}
                    </Link>
                  </td>
                  {kind === "page" ? (
                    <td className="text-muted-foreground max-w-56 truncate px-2 py-2">
                      {item.space_name}
                    </td>
                  ) : null}
                  <td className="px-2 py-2 text-right tabular-nums">
                    {number.format(item.views)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {number.format(item.stars)}
                  </td>
                  {kind === "page" ? (
                    <td className="px-4 py-2 text-right tabular-nums">
                      {number.format(item.saves ?? 0)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
