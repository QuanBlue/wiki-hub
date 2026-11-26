import type { Metadata } from "next";

import {
  StatisticsView,
  type StatsTab,
} from "@/components/admin/statistics/statistics-view";
import {
  getStatsAi,
  getStatsOverview,
  getStatsTopContributors,
  getStatsTopPages,
  getStatsTopSpaces,
} from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";
import type { StatsDateQuery, StatsRange } from "@/types/api";

export const metadata: Metadata = { title: "Statistics" };
export const dynamic = "force-dynamic";

const RANGES: StatsRange[] = ["7d", "30d", "90d"];
const TABS: StatsTab[] = ["overview", "content", "ai"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AdminStatisticsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    start?: string;
    end?: string;
    tab?: string;
  }>;
}) {
  const [me, { t }, params] = await Promise.all([
    getCurrentUser(),
    getServerLocale(),
    searchParams,
  ]);
  // The statistics API is superuser-only on the backend, so the narrower
  // admin permissions the layout admits (manage_users, ...) do not unlock it.
  if (!me?.is_superuser) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">
          {t("adminShared.permissionRequiredTitle")}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminShared.permissionRequiredBody", {
            feature: t("adminStats.permissionFeature"),
            permission: t("adminShared.systemAdministratorLabel"),
          })}
        </p>
      </div>
    );
  }

  const range = RANGES.find((option) => option === params.range) ?? "30d";
  const initialTab = TABS.find((option) => option === params.tab) ?? "overview";
  const validCustom =
    Boolean(
      params.start &&
        params.end &&
        ISO_DATE.test(params.start) &&
        ISO_DATE.test(params.end) &&
        params.start <= params.end,
    );
  const query: StatsRange | StatsDateQuery = validCustom
    ? { start: params.start, end: params.end }
    : range;

  const [
    overview,
    ai,
    pagesViews,
    pagesStars,
    pagesSaves,
    spacesViews,
    spacesStars,
    contributors,
  ] = await Promise.all([
    getStatsOverview(query),
    getStatsAi(query),
    getStatsTopPages(query, "views"),
    getStatsTopPages(query, "stars"),
    getStatsTopPages(query, "saves"),
    getStatsTopSpaces(query, "views"),
    getStatsTopSpaces(query, "stars"),
    getStatsTopContributors(query),
  ]);

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
          {t("nav.administration")}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          {t("adminStats.title")}
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t("adminStats.description")}
        </p>
      </header>
      <StatisticsView
        range={range}
        initialTab={initialTab}
        initialStart={validCustom ? params.start : undefined}
        initialEnd={validCustom ? params.end : undefined}
        overview={overview}
        ai={ai}
        pages={{ views: pagesViews, stars: pagesStars, saves: pagesSaves }}
        spaces={{ views: spacesViews, stars: spacesStars }}
        contributors={contributors}
      />
    </div>
  );
}
