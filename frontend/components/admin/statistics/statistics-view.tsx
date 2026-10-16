"use client";

import {
  BookOpen,
  FileText,
  FolderOpen,
  Pencil,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BarList } from "@/components/admin/statistics/bar-list";
import { TopTable } from "@/components/admin/statistics/top-table";
import { TrendChart } from "@/components/admin/statistics/trend-chart";
import { StatCards } from "@/components/admin/statistics/stat-cards";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  StatsAi,
  StatsOverview,
  StatsRange,
  StatsTopContent,
} from "@/types/api";

type Tab = "overview" | "ai" | "pages" | "spaces";

const RANGES: StatsRange[] = ["7d", "30d", "90d"];

const FEATURE_KEYS: Record<string, string> = {
  clarify: "adminStats.featureClarify",
  draft: "adminStats.featureDraft",
  assist: "adminStats.featureAssist",
  answer: "adminStats.featureAnswer",
  suggest: "adminStats.featureSuggest",
  explain: "adminStats.featureExplain",
  summarize: "adminStats.featureSummarize",
  translate: "adminStats.featureTranslate",
};

export interface StatisticsViewProps {
  range: StatsRange;
  overview: StatsOverview;
  ai: StatsAi;
  pages: Partial<Record<"views" | "stars" | "saves", StatsTopContent>>;
  spaces: Partial<Record<"views" | "stars", StatsTopContent>>;
}

export function StatisticsView({
  range,
  overview,
  ai,
  pages,
  spaces,
}: StatisticsViewProps) {
  const { t, locale } = useTranslation();
  const [tab, setTab] = useState<Tab>("overview");
  const number = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US");
  const dateFormat = new Intl.DateTimeFormat(
    locale === "vi" ? "vi-VN" : "en-US",
    {
      dateStyle: "medium",
    },
  );
  const dateTime = new Intl.DateTimeFormat(
    locale === "vi" ? "vi-VN" : "en-US",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );

  const tabs: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
    { id: "overview", label: t("adminStats.tabOverview"), icon: Users },
    { id: "ai", label: t("adminStats.tabAi"), icon: Sparkles },
    { id: "pages", label: t("adminStats.tabPages"), icon: FileText },
    { id: "spaces", label: t("adminStats.tabSpaces"), icon: FolderOpen },
  ];
  const rangeLabels: Record<StatsRange, string> = {
    "7d": t("adminStats.range7d"),
    "30d": t("adminStats.range30d"),
    "90d": t("adminStats.range90d"),
  };
  const featureLabel = (feature: string) =>
    FEATURE_KEYS[feature] ? t(FEATURE_KEYS[feature]) : feature;

  const { totals } = overview;
  const days = Math.max(1, overview.range_days);
  const fixed = (value: number) => number.format(Math.round(value * 10) / 10);
  const whole = (value: number) => number.format(Math.round(value));
  const share = (part: number, total: number) =>
    number.format(total ? Math.round((part / total) * 100) : 0);
  const unitOf = (one: string, many: string) => (count: number) =>
    t(count === 1 ? one : many);
  const ratio = (part: number, total: number) => (total ? part / total : 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t("adminStats.sections")}
          className="bg-surface-sunken flex flex-wrap gap-1 rounded-lg p-1"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "focus-visible:ring-ring flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                tab === id
                  ? "bg-surface text-primary font-semibold shadow-sm"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
        <nav
          aria-label={t("adminStats.rangeLabel")}
          className="bg-surface-sunken flex items-center gap-1 rounded-lg p-1"
        >
          {RANGES.map((option) => (
            <Link
              key={option}
              href={`/admin/statistics?range=${option}`}
              aria-current={range === option ? "true" : undefined}
              className={cn(
                "focus-visible:ring-ring rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                range === option
                  ? "bg-surface text-primary font-semibold shadow-sm"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {rangeLabels[option]}
            </Link>
          ))}
        </nav>
      </div>

      {tab === "overview" ? (
        <div className="space-y-5" role="tabpanel">
          <StatCards
            label={t("adminStats.metricsLabel")}
            locale={locale}
            items={[
              {
                icon: Users,
                label: t("adminStats.users"),
                value: totals.users,
                hint: t("adminStats.hintNew", {
                  count: number.format(totals.new_users),
                }),
                tone: "primary",
              },
              {
                icon: UserCheck,
                label: t("adminStats.activeUsers"),
                value: totals.active_users,
                hint: t("adminStats.hintActiveShare", {
                  percent: share(totals.active_users, totals.users),
                }),
                tone: "success",
              },
              {
                icon: UserPlus,
                label: t("adminStats.newUsers"),
                value: totals.new_users,
                hint: t("adminStats.hintPerDay", {
                  count: fixed(totals.new_users / days),
                }),
                tone: "info",
              },
              {
                icon: FileText,
                label: t("adminStats.pages"),
                value: totals.pages,
                hint: t("adminStats.hintPerSpace", {
                  count: fixed(ratio(totals.pages, totals.spaces)),
                }),
              },
              {
                icon: FolderOpen,
                label: t("adminStats.spaces"),
                value: totals.spaces,
                hint: t("adminStats.hintPerSpaceUsers", {
                  count: fixed(ratio(totals.users, totals.spaces)),
                }),
              },
              {
                icon: Pencil,
                label: t("adminStats.edits"),
                value: totals.edits,
                hint: t("adminStats.hintPerDay", {
                  count: fixed(totals.edits / days),
                }),
                tone: "warning",
              },
              {
                icon: BookOpen,
                label: t("adminStats.views"),
                value: totals.views,
                hint: t("adminStats.hintPerDay", {
                  count: fixed(totals.views / days),
                }),
                tone: "primary",
              },
            ]}
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <TrendChart
              title={t("adminStats.chartViews")}
              unit={unitOf("adminStats.unitView", "adminStats.unitViews")}
              points={overview.daily.map((d) => ({
                day: d.day,
                value: d.views,
              }))}
            />
            <TrendChart
              title={t("adminStats.chartEdits")}
              unit={unitOf("adminStats.unitEdit", "adminStats.unitEdits")}
              tone="warning"
              points={overview.daily.map((d) => ({
                day: d.day,
                value: d.edits,
              }))}
            />
            <TrendChart
              title={t("adminStats.chartNewUsers")}
              unit={unitOf("adminStats.unitNewUser", "adminStats.unitNewUsers")}
              tone="success"
              points={overview.daily.map((d) => ({
                day: d.day,
                value: d.new_users,
              }))}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {overview.views_tracked_since
              ? t("adminStats.viewsSince", {
                  date: dateFormat.format(
                    new Date(`${overview.views_tracked_since}T00:00:00`),
                  ),
                })
              : t("adminStats.viewsNone")}
          </p>
          <section className="border-border bg-surface rounded-xl border shadow-sm">
            <h3 className="border-border border-b px-4 py-3 text-sm font-semibold">
              {t("adminStats.recentActivity")}
            </h3>
            {overview.recent_activity.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm">
                {t("adminStats.noActivity")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-border border-b text-left text-xs">
                      <th scope="col" className="px-4 py-2 font-medium">
                        {t("adminStats.colWhen")}
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        {t("adminStats.colActor")}
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        {t("adminStats.colAction")}
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        {t("adminStats.colTarget")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recent_activity.map((item) => (
                      <tr
                        key={item.id}
                        className="border-border/70 hover:bg-surface-hover border-b transition-colors last:border-b-0"
                      >
                        <td className="text-muted-foreground px-4 py-2 whitespace-nowrap">
                          {dateTime.format(new Date(item.created_at))}
                        </td>
                        <td className="px-2 py-2 font-medium">
                          {item.actor_username}
                        </td>
                        <td className="px-2 py-2">
                          <span className="bg-surface-sunken text-muted-foreground inline-block rounded-md px-2 py-0.5 text-xs font-medium capitalize">
                            {item.action.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td className="max-w-80 truncate px-4 py-2">
                          {item.entity_label}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "ai" ? (
        <div className="space-y-5" role="tabpanel">
          <StatCards
            label={t("adminStats.metricsLabel")}
            locale={locale}
            items={[
              {
                icon: Sparkles,
                label: t("adminStats.aiTokens"),
                value: ai.totals.tokens,
                hint: t("adminStats.hintPerRequest", {
                  count: whole(ratio(ai.totals.tokens, ai.totals.calls)),
                }),
                tone: "primary",
              },
              {
                icon: FileText,
                label: t("adminStats.aiPrompt"),
                value: ai.totals.prompt_tokens,
                hint: t("adminStats.hintTokenShare", {
                  percent: share(ai.totals.prompt_tokens, ai.totals.tokens),
                }),
                tone: "info",
              },
              {
                icon: Pencil,
                label: t("adminStats.aiCompletion"),
                value: ai.totals.completion_tokens,
                hint: t("adminStats.hintTokenShare", {
                  percent: share(ai.totals.completion_tokens, ai.totals.tokens),
                }),
                tone: "success",
              },
              {
                icon: BookOpen,
                label: t("adminStats.aiRequests"),
                value: ai.totals.calls,
                hint: t("adminStats.hintPerDay", {
                  count: fixed(ai.totals.calls / days),
                }),
                tone: "warning",
              },
              {
                icon: Users,
                label: t("adminStats.aiPeople"),
                value: ai.totals.users,
                hint: t("adminStats.hintPerPerson", {
                  count: whole(ratio(ai.totals.tokens, ai.totals.users)),
                }),
              },
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <TrendChart
              title={t("adminStats.chartTokens")}
              unit={unitOf("adminStats.unitToken", "adminStats.unitTokens")}
              points={ai.daily.map((d) => ({ day: d.day, value: d.tokens }))}
            />
            <TrendChart
              title={t("adminStats.chartRequests")}
              unit={unitOf("adminStats.unitRequest", "adminStats.unitRequests")}
              tone="warning"
              points={ai.daily.map((d) => ({ day: d.day, value: d.calls }))}
            />
          </div>
          {ai.totals.calls === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("adminStats.aiNone")}
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <BarList
              title={t("adminStats.aiByPerson")}
              emptyLabel={t("adminStats.aiNone")}
              format={(value) => number.format(value)}
              rows={ai.by_user.map((row) => ({
                key: row.user_id ?? row.username,
                label: row.full_name || row.username || "—",
                hint:
                  row.full_name && row.username
                    ? `@${row.username}`
                    : undefined,
                value: row.tokens,
                detail: `· ${number.format(row.calls)} ${t("adminStats.colRequests").toLowerCase()}`,
              }))}
            />
            <BarList
              title={t("adminStats.aiByFeature")}
              emptyLabel={t("adminStats.aiNone")}
              tone="info"
              format={(value) => number.format(value)}
              rows={ai.by_feature.map((row) => ({
                key: row.feature,
                label: featureLabel(row.feature),
                value: row.tokens,
                detail: `· ${number.format(row.calls)} ${t("adminStats.colRequests").toLowerCase()}`,
              }))}
            />
          </div>
          {ai.tracked_since ? (
            <p className="text-muted-foreground text-xs">
              {t("adminStats.aiSince", {
                date: dateFormat.format(new Date(ai.tracked_since)),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "pages" ? (
        <div role="tabpanel">
          <TopTable kind="page" rankings={pages} />
        </div>
      ) : null}
      {tab === "spaces" ? (
        <div role="tabpanel">
          <TopTable kind="space" rankings={spaces} />
        </div>
      ) : null}
    </div>
  );
}
