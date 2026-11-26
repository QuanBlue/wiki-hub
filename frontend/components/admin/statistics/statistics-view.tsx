"use client";

import {
  ArrowRight,
  BookOpen,
  Calendar,
  Clock,
  Cpu,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Sparkles,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { BarList } from "@/components/admin/statistics/bar-list";
import { HeroKpiCard } from "@/components/admin/statistics/hero-kpi-card";
import { MultiTrendChart } from "@/components/admin/statistics/multi-trend-chart";
import { StackedBarChart } from "@/components/admin/statistics/stacked-bar-chart";
import { StatCards } from "@/components/admin/statistics/stat-cards";
import { TopTable } from "@/components/admin/statistics/top-table";
import { TrendChart } from "@/components/admin/statistics/trend-chart";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  buildCsv,
  downloadCsv,
  fetchAdminStatsBundle,
  percentDelta,
  type AdminStatsBundle,
} from "@/lib/admin-stats-client";
import { describeApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  StatsAi,
  StatsDateQuery,
  StatsOverview,
  StatsRange,
  StatsTopContent,
  StatsTopContributors,
} from "@/types/api";

export type StatsTab = "overview" | "content" | "ai";

const RANGES: StatsRange[] = ["7d", "30d", "90d"];
const MAX_CUSTOM_DAYS = 365;

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
  initialTab?: StatsTab;
  initialStart?: string;
  initialEnd?: string;
  overview: StatsOverview;
  ai: StatsAi;
  pages: Partial<Record<"views" | "stars" | "saves", StatsTopContent>>;
  spaces: Partial<Record<"views" | "stars", StatsTopContent>>;
  contributors?: StatsTopContributors;
}

function updateUrlParams(params: {
  tab: StatsTab;
  range: StatsRange | "custom";
  start?: string;
  end?: string;
}) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", params.tab);
  if (params.range === "custom" && params.start && params.end) {
    url.searchParams.delete("range");
    url.searchParams.set("start", params.start);
    url.searchParams.set("end", params.end);
  } else {
    url.searchParams.set("range", params.range === "custom" ? "30d" : params.range);
    url.searchParams.delete("start");
    url.searchParams.delete("end");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function StatisticsView({
  range: initialRange,
  initialTab = "overview",
  initialStart,
  initialEnd,
  overview: initialOverview,
  ai: initialAi,
  pages: initialPages,
  spaces: initialSpaces,
  contributors: initialContributors,
}: StatisticsViewProps) {
  const { t, locale } = useTranslation();

  const [tab, setTab] = useState<StatsTab>(initialTab);
  const [activeRange, setActiveRange] = useState<StatsRange | "custom">(
    initialStart && initialEnd ? "custom" : initialRange,
  );
  const [customStart, setCustomStart] = useState(
    initialStart ?? initialOverview.start_date ?? "",
  );
  const [customEnd, setCustomEnd] = useState(
    initialEnd ?? initialOverview.end_date ?? "",
  );
  const [customOpen, setCustomOpen] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const [override, setOverride] = useState<{
    source: StatsOverview;
    bundle: AdminStatsBundle;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<string>("all");

  const activeBundle =
    override && override.source === initialOverview ? override.bundle : null;
  const overview = activeBundle?.overview ?? initialOverview;
  const ai = activeBundle?.ai ?? initialAi;
  const pages = activeBundle?.pages ?? initialPages;
  const spaces = activeBundle?.spaces ?? initialSpaces;
  const contributors = activeBundle?.contributors ??
    initialContributors ?? {
      range_days: initialOverview.range_days,
      items: [],
    };

  const intlLocale = locale === "vi" ? "vi-VN" : "en-US";
  const number = useMemo(() => new Intl.NumberFormat(intlLocale), [intlLocale]);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" }),
    [intlLocale],
  );
  const dateTime = useMemo(
    () =>
      new Intl.DateTimeFormat(intlLocale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [intlLocale],
  );

  const tabs: Array<{ id: StatsTab; label: string; icon: LucideIcon }> = [
    { id: "overview", label: t("adminStats.tabOverview"), icon: Users },
    { id: "content", label: t("adminStats.tabContent"), icon: FileText },
    { id: "ai", label: t("adminStats.tabAi"), icon: Sparkles },
  ];

  const rangeLabels: Record<StatsRange, string> = {
    "7d": t("adminStats.range7d"),
    "30d": t("adminStats.range30d"),
    "90d": t("adminStats.range90d"),
  };

  const featureLabel = (feature: string) =>
    FEATURE_KEYS[feature] ? t(FEATURE_KEYS[feature]) : feature;

  const { totals, previous } = overview;
  const days = Math.max(1, overview.range_days);
  const fixed = (value: number) => number.format(Math.round(value * 10) / 10);
  const whole = (value: number) => number.format(Math.round(value));
  const share = (part: number, total: number) =>
    total ? Math.round((part / total) * 100) : 0;
  const ratio = (part: number, total: number) => (total ? part / total : 0);
  const unitOf = (one: string, many: string) => (count: number) =>
    t(count === 1 ? one : many);

  const duration = (minutes: number) => {
    if (minutes <= 0) return t("adminStats.durationMinutes", { count: "0" });
    if (minutes < 1) return t("adminStats.durationUnderMinute");
    const rounded = Math.round(minutes);
    if (rounded < 60) {
      return t("adminStats.durationMinutes", { count: number.format(rounded) });
    }
    const hours = Math.floor(rounded / 60);
    const rest = rounded % 60;
    return rest
      ? t("adminStats.durationHours", {
          hours: number.format(hours),
          minutes: number.format(rest),
        })
      : t("adminStats.durationHoursOnly", { hours: number.format(hours) });
  };

  const dayLabel = (day: string) =>
    dateFormat.format(new Date(`${day}T00:00:00`));

  async function loadRange(
    nextMode: StatsRange | "custom",
    query: StatsDateQuery,
  ) {
    setLoading(true);
    setFetchError(null);
    try {
      const bundle = await fetchAdminStatsBundle(query);
      setOverride({ source: initialOverview, bundle });
      setActiveRange(nextMode);
      if (bundle.overview.start_date) setCustomStart(bundle.overview.start_date);
      if (bundle.overview.end_date) setCustomEnd(bundle.overview.end_date);
      updateUrlParams({
        tab,
        range: nextMode,
        start: query.start,
        end: query.end,
      });
    } catch (err) {
      setFetchError(describeApiError(err, t("adminStats.loadError")));
    } finally {
      setLoading(false);
    }
  }

  function handleTabChange(nextTab: StatsTab) {
    setTab(nextTab);
    updateUrlParams({
      tab: nextTab,
      range: activeRange,
      start: activeRange === "custom" ? customStart : undefined,
      end: activeRange === "custom" ? customEnd : undefined,
    });
  }

  function handleApplyCustomRange(event: React.FormEvent) {
    event.preventDefault();
    if (!customStart || !customEnd) {
      setCustomError(t("adminStats.customRangeRequired"));
      return;
    }
    if (customStart > customEnd) {
      setCustomError(t("adminStats.customRangeInvalidOrder"));
      return;
    }
    const diffMs =
      new Date(`${customEnd}T00:00:00Z`).getTime() -
      new Date(`${customStart}T00:00:00Z`).getTime();
    const spanDays = Math.floor(diffMs / 86_400_000) + 1;
    if (spanDays > MAX_CUSTOM_DAYS) {
      setCustomError(
        t("adminStats.customRangeTooLong", { max: String(MAX_CUSTOM_DAYS) }),
      );
      return;
    }
    setCustomError(null);
    setCustomOpen(false);
    void loadRange("custom", { start: customStart, end: customEnd });
  }

  // CSV export handlers
  const periodSlug =
    activeRange === "custom" && customStart && customEnd
      ? `${customStart}_to_${customEnd}`
      : activeRange;

  function exportOverviewDaily() {
    const csv = buildCsv(
      [
        "Day",
        "Views",
        "Edits",
        "Active Users",
        "Avg Active Seconds",
        "New Users",
      ],
      overview.daily.map((d) => [
        d.day,
        d.views,
        d.edits,
        d.active_users,
        d.active_seconds,
        d.new_users,
      ]),
    );
    downloadCsv(`wikihub-overview-${periodSlug}.csv`, csv);
  }

  function exportTopPages() {
    const items = pages.views?.items ?? [];
    const csv = buildCsv(
      ["Rank", "Title", "Space", "Space Key", "Views", "Stars", "Saves"],
      items.map((item, idx) => [
        idx + 1,
        item.title,
        item.space_name,
        item.space_key,
        item.views,
        item.stars,
        item.saves ?? 0,
      ]),
    );
    downloadCsv(`wikihub-top-pages-${periodSlug}.csv`, csv);
  }

  function exportTopSpaces() {
    const items = spaces.views?.items ?? [];
    const csv = buildCsv(
      ["Rank", "Space", "Space Key", "Pages", "Views", "Stars"],
      items.map((item, idx) => [
        idx + 1,
        item.title,
        item.space_key,
        item.page_count ?? "",
        item.views,
        item.stars,
      ]),
    );
    downloadCsv(`wikihub-top-spaces-${periodSlug}.csv`, csv);
  }

  function exportContributors() {
    const csv = buildCsv(
      ["Rank", "Name", "Username", "Edits", "Pages Created"],
      contributors.items.map((item, idx) => [
        idx + 1,
        item.full_name ?? "",
        item.username,
        item.edits,
        item.pages_created,
      ]),
    );
    downloadCsv(`wikihub-contributors-${periodSlug}.csv`, csv);
  }

  function exportAiDaily() {
    const csv = buildCsv(
      ["Day", "Total Tokens", "Prompt Tokens", "Completion Tokens", "Requests"],
      ai.daily.map((d) => [
        d.day,
        d.tokens,
        d.prompt_tokens ?? "",
        d.completion_tokens ?? "",
        d.calls,
      ]),
    );
    downloadCsv(`wikihub-ai-daily-${periodSlug}.csv`, csv);
  }

  function exportAiBreakdown() {
    const rows: Array<Array<string | number>> = [
      ...ai.by_user.map((u) => [
        "user",
        u.full_name || u.username || "unknown",
        u.tokens,
        u.calls,
      ]),
      ...ai.by_feature.map((f) => [
        "feature",
        featureLabel(f.feature),
        f.tokens,
        f.calls,
      ]),
      ...(ai.by_model ?? []).map((m) => ["model", m.model, m.tokens, m.calls]),
    ];
    const csv = buildCsv(["Dimension", "Name", "Tokens", "Requests"], rows);
    downloadCsv(`wikihub-ai-breakdown-${periodSlug}.csv`, csv);
  }

  // Activity filter options
  const activityActions = useMemo(() => {
    const unique = new Set<string>();
    for (const item of overview.recent_activity) {
      unique.add(item.action);
    }
    return Array.from(unique).sort();
  }, [overview.recent_activity]);

  const filteredActivity = useMemo(() => {
    if (activityFilter === "all") return overview.recent_activity;
    return overview.recent_activity.filter(
      (item) => item.action === activityFilter,
    );
  }, [overview.recent_activity, activityFilter]);

  // Derived deltas
  const activeUsersDelta = percentDelta(
    totals.active_users,
    previous?.active_users,
  );
  const viewsDelta = percentDelta(totals.views, previous?.views);
  const editsDelta = percentDelta(totals.edits, previous?.edits);
  const activeTimeDelta = percentDelta(
    totals.active_seconds,
    previous?.active_seconds,
  );
  const newUsersDelta = percentDelta(totals.new_users, previous?.new_users);
  const newPagesDelta = percentDelta(
    totals.new_pages ?? 0,
    previous?.new_pages,
  );
  const newSpacesDelta = percentDelta(
    totals.new_spaces ?? 0,
    previous?.new_spaces,
  );
  const aiTokensDelta = percentDelta(ai.totals.tokens, ai.previous?.tokens);
  const aiCallsDelta = percentDelta(ai.totals.calls, ai.previous?.calls);
  const aiUsersDelta = percentDelta(ai.totals.users, ai.previous?.users);
  const avgTokensPerCall = ratio(ai.totals.tokens, ai.totals.calls);
  const prevAvgTokensPerCall = ai.previous
    ? ratio(ai.previous.tokens, ai.previous.calls)
    : undefined;
  const aiAvgTokensDelta = percentDelta(avgTokensPerCall, prevAvgTokensPerCall);

  const promptShare = share(ai.totals.prompt_tokens, ai.totals.tokens);
  const completionShare = share(ai.totals.completion_tokens, ai.totals.tokens);

  const customButtonLabel =
    activeRange === "custom" && customStart && customEnd
      ? `${dayLabel(customStart)} – ${dayLabel(customEnd)}`
      : t("adminStats.rangeCustom");

  return (
    <div className="space-y-5">
      {/* Toolbar: 3 Tabs + Date Range Controls + Export CSV */}
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
              onClick={() => handleTabChange(id)}
              className={cn(
                "focus-visible:ring-ring flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                tab === id
                  ? "bg-surface text-primary font-semibold shadow-sm"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <span
              role="status"
              aria-label={t("adminStats.loading")}
              className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              <span className="hidden sm:inline">{t("adminStats.loading")}</span>
            </span>
          ) : null}

          <div
            role="group"
            aria-label={t("adminStats.rangeLabel")}
            className="bg-surface-sunken flex items-center gap-1 rounded-lg p-1"
          >
            {RANGES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={activeRange === option}
                disabled={loading}
                onClick={() => void loadRange(option, { range: option })}
                className={cn(
                  "focus-visible:ring-ring cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60",
                  activeRange === option
                    ? "bg-surface text-primary font-semibold shadow-sm"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {rangeLabels[option]}
              </button>
            ))}

            <Popover open={customOpen} onOpenChange={setCustomOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-pressed={activeRange === "custom"}
                  disabled={loading}
                  className={cn(
                    "focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60",
                    activeRange === "custom"
                      ? "bg-surface text-primary font-semibold shadow-sm"
                      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-44 truncate">{customButtonLabel}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-3.5">
                <form onSubmit={handleApplyCustomRange} className="space-y-3">
                  <p className="text-foreground text-xs font-semibold">
                    {t("adminStats.customRangeTitle")}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-muted-foreground block text-[11px] font-medium">
                        {t("adminStats.dateFrom")}
                      </span>
                      <input
                        type="date"
                        value={customStart}
                        onChange={(e) => {
                          setCustomStart(e.target.value);
                          setCustomError(null);
                        }}
                        className="border-border bg-background text-foreground hover:border-border-strong focus-visible:ring-ring h-8 w-full rounded-md border px-2 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-muted-foreground block text-[11px] font-medium">
                        {t("adminStats.dateTo")}
                      </span>
                      <input
                        type="date"
                        value={customEnd}
                        onChange={(e) => {
                          setCustomEnd(e.target.value);
                          setCustomError(null);
                        }}
                        className="border-border bg-background text-foreground hover:border-border-strong focus-visible:ring-ring h-8 w-full rounded-md border px-2 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                      />
                    </label>
                  </div>
                  {customError ? (
                    <p className="text-danger text-xs" role="alert">
                      {customError}
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setCustomOpen(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button type="submit" size="sm">
                      {t("adminStats.applyRange")}
                    </Button>
                  </div>
                </form>
              </PopoverContent>
            </Popover>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-1.5">
                <Download className="size-3.5" aria-hidden="true" />
                {t("adminStats.exportCsv")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                {t("adminStats.exportMenuTitle")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={exportOverviewDaily}>
                {t("adminStats.exportOverviewDaily")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={exportTopPages}>
                {t("adminStats.exportTopPages")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={exportTopSpaces}>
                {t("adminStats.exportTopSpaces")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={exportContributors}>
                {t("adminStats.exportContributors")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={exportAiDaily}>
                {t("adminStats.exportAiDaily")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={exportAiBreakdown}>
                {t("adminStats.exportAiBreakdown")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {fetchError ? (
        <div
          role="alert"
          className="border-danger/30 bg-danger-bg text-danger rounded-lg border px-4 py-2.5 text-sm"
        >
          {fetchError}
        </div>
      ) : null}

      {/* ===================== TAB 1: OVERVIEW ===================== */}
      {tab === "overview" ? (
        <div
          className={cn(
            "space-y-5 transition-opacity duration-150",
            loading && "opacity-60",
          )}
          role="tabpanel"
        >
          {/* 4 Hero KPI cards with sparklines & real % vs previous period */}
          <section
            aria-label={t("adminStats.metricsLabel")}
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <HeroKpiCard
              icon={UserCheck}
              label={t("adminStats.activeUsers")}
              value={number.format(totals.active_users)}
              hint={t("adminStats.hintActiveShare", {
                percent: number.format(
                  share(totals.active_users, totals.users),
                ),
              })}
              delta={activeUsersDelta}
              tone="success"
              sparkline={overview.daily.map((d) => d.active_users)}
            />
            <HeroKpiCard
              icon={BookOpen}
              label={t("adminStats.views")}
              value={number.format(totals.views)}
              hint={t("adminStats.hintPerDay", {
                count: fixed(totals.views / days),
              })}
              delta={viewsDelta}
              tone="primary"
              sparkline={overview.daily.map((d) => d.views)}
            />
            <HeroKpiCard
              icon={Pencil}
              label={t("adminStats.edits")}
              value={number.format(totals.edits)}
              hint={t("adminStats.hintPerDay", {
                count: fixed(totals.edits / days),
              })}
              delta={editsDelta}
              tone="warning"
              sparkline={overview.daily.map((d) => d.edits)}
            />
            <HeroKpiCard
              icon={Clock}
              label={t("adminStats.activeTime")}
              value={duration(totals.active_seconds / 60)}
              hint={t("adminStats.hintActivePerDay", {
                count: fixed(totals.daily_active_users),
              })}
              delta={activeTimeDelta}
              tone="info"
              sparkline={overview.daily.map((d) => d.active_seconds / 60)}
            />
          </section>

          {/* Compact workspace summary strip */}
          <section
            aria-label={t("adminStats.workspaceSummary")}
            className="border-border bg-surface grid grid-cols-2 divide-y rounded-xl border shadow-sm sm:grid-cols-4 sm:divide-x sm:divide-y-0"
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <Users
                className="text-muted-foreground size-4 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-muted-foreground truncate text-xs">
                  {t("adminStats.users")}
                </p>
                <p className="text-foreground text-sm font-semibold tabular-nums">
                  {number.format(totals.users)}
                  <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                    (+{number.format(totals.new_users)}{" "}
                    {t("adminStats.newShort")})
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-4 py-3">
              <FolderOpen
                className="text-muted-foreground size-4 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-muted-foreground truncate text-xs">
                  {t("adminStats.spaces")}
                </p>
                <p className="text-foreground text-sm font-semibold tabular-nums">
                  {number.format(totals.spaces)}
                  {totals.new_spaces ? (
                    <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                      (+{number.format(totals.new_spaces)}{" "}
                      {t("adminStats.newShort")})
                    </span>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-4 py-3">
              <FileText
                className="text-muted-foreground size-4 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-muted-foreground truncate text-xs">
                  {t("adminStats.pages")}
                </p>
                <p className="text-foreground text-sm font-semibold tabular-nums">
                  {number.format(totals.pages)}
                  <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                    ({t("adminStats.hintPerSpace", {
                      count: fixed(ratio(totals.pages, totals.spaces)),
                    })})
                  </span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleTabChange("ai")}
              className="hover:bg-surface-hover focus-visible:ring-ring flex cursor-pointer items-center justify-between gap-2 rounded-b-xl px-4 py-3 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none sm:rounded-r-xl sm:rounded-bl-none"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Sparkles
                  className="text-primary size-4 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-muted-foreground truncate text-xs">
                    {t("adminStats.aiTokens")}
                  </p>
                  <p className="text-foreground text-sm font-semibold tabular-nums">
                    {number.format(ai.totals.tokens)}
                  </p>
                </div>
              </div>
              <ArrowRight
                className="text-muted-foreground size-4 shrink-0"
                aria-hidden="true"
              />
            </button>
          </section>

          {/* 2 Unified Multi-Series Charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <MultiTrendChart
              title={t("adminStats.chartEngagement")}
              independentScale
              initialActiveKeys={["active_users"]}
              series={[
                {
                  key: "active_users",
                  label: t("adminStats.activeUsers"),
                  tone: "info",
                  format: fixed,
                  average: totals.daily_active_users,
                  delta: activeUsersDelta,
                  unit: unitOf(
                    "adminStats.unitActiveUser",
                    "adminStats.unitActiveUsers",
                  ),
                  points: overview.daily.map((d) => ({
                    day: d.day,
                    value: d.active_users,
                  })),
                },
                {
                  key: "active_time",
                  label: t("adminStats.activeTime"),
                  tone: "primary",
                  format: duration,
                  axisFormat: fixed,
                  average: totals.active_seconds / 60,
                  delta: activeTimeDelta,
                  points: overview.daily.map((d) => ({
                    day: d.day,
                    value: d.active_seconds / 60,
                  })),
                },
              ]}
            />

            <MultiTrendChart
              title={t("adminStats.chartActivity")}
              initialActiveKeys={["views", "edits"]}
              series={[
                {
                  key: "views",
                  label: t("adminStats.views"),
                  tone: "primary",
                  delta: viewsDelta,
                  unit: unitOf("adminStats.unitView", "adminStats.unitViews"),
                  points: overview.daily.map((d) => ({
                    day: d.day,
                    value: d.views,
                  })),
                },
                {
                  key: "edits",
                  label: t("adminStats.edits"),
                  tone: "warning",
                  delta: editsDelta,
                  unit: unitOf("adminStats.unitEdit", "adminStats.unitEdits"),
                  points: overview.daily.map((d) => ({
                    day: d.day,
                    value: d.edits,
                  })),
                },
                {
                  key: "new_users",
                  label: t("adminStats.newUsers"),
                  tone: "success",
                  delta: newUsersDelta,
                  unit: unitOf(
                    "adminStats.unitNewUser",
                    "adminStats.unitNewUsers",
                  ),
                  points: overview.daily.map((d) => ({
                    day: d.day,
                    value: d.new_users,
                  })),
                },
              ]}
            />
          </div>

          <p className="text-muted-foreground text-xs">
            {overview.views_tracked_since
              ? t("adminStats.viewsSince", {
                  date: dayLabel(overview.views_tracked_since),
                })
              : t("adminStats.viewsNone")}{" "}
            {overview.activity_tracked_since
              ? t("adminStats.activitySince", {
                  date: dayLabel(overview.activity_tracked_since),
                })
              : t("adminStats.activityNone")}
          </p>

          {/* Recent Activity with Action Filter */}
          <section className="border-border bg-surface rounded-xl border shadow-sm">
            <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <h3 className="text-sm font-semibold">
                {t("adminStats.recentActivity")}
              </h3>
              {activityActions.length > 1 ? (
                <div
                  role="group"
                  aria-label={t("adminStats.filterByAction")}
                  className="flex flex-wrap items-center gap-1"
                >
                  <button
                    type="button"
                    aria-pressed={activityFilter === "all"}
                    onClick={() => setActivityFilter("all")}
                    className={cn(
                      "focus-visible:ring-ring cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                      activityFilter === "all"
                        ? "bg-surface-selected text-primary hover:bg-surface-selected-hover"
                        : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                    )}
                  >
                    {t("adminStats.filterAll")}
                  </button>
                  {activityActions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      aria-pressed={activityFilter === action}
                      onClick={() => setActivityFilter(action)}
                      className={cn(
                        "focus-visible:ring-ring cursor-pointer rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                        activityFilter === action
                          ? "bg-surface-selected text-primary hover:bg-surface-selected-hover"
                          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      {action.replaceAll("_", " ")}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {filteredActivity.length === 0 ? (
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
                    {filteredActivity.map((item) => (
                      <tr
                        key={item.id}
                        className="border-border/70 hover:bg-surface-hover border-b transition-colors duration-150 last:border-b-0"
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

      {/* ===================== TAB 2: CONTENT ===================== */}
      {tab === "content" ? (
        <div
          className={cn(
            "space-y-5 transition-opacity duration-150",
            loading && "opacity-60",
          )}
          role="tabpanel"
        >
          <StatCards
            label={t("adminStats.contentMetricsLabel")}
            locale={locale}
            items={[
              {
                icon: FilePlus2,
                label: t("adminStats.newPages"),
                value: totals.new_pages ?? 0,
                delta: newPagesDelta,
                hint: t("adminStats.hintTotalPages", {
                  count: number.format(totals.pages),
                }),
                tone: "primary",
              },
              {
                icon: FolderPlus,
                label: t("adminStats.newSpaces"),
                value: totals.new_spaces ?? 0,
                delta: newSpacesDelta,
                hint: t("adminStats.hintTotalSpaces", {
                  count: number.format(totals.spaces),
                }),
                tone: "info",
              },
              {
                icon: BookOpen,
                label: t("adminStats.views"),
                value: totals.views,
                delta: viewsDelta,
                hint: t("adminStats.hintPerDay", {
                  count: fixed(totals.views / days),
                }),
                tone: "success",
              },
              {
                icon: Pencil,
                label: t("adminStats.edits"),
                value: totals.edits,
                delta: editsDelta,
                hint: t("adminStats.hintPerDay", {
                  count: fixed(totals.edits / days),
                }),
                tone: "warning",
              },
            ]}
          />

          <TopTable
            kind="page"
            title={t("adminStats.topPagesTitle")}
            searchable
            rankings={pages}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <TopTable
              kind="space"
              title={t("adminStats.topSpacesTitle")}
              rankings={spaces}
            />

            <BarList
              title={t("adminStats.topContributorsTitle")}
              emptyLabel={t("adminStats.contributorsNone")}
              tone="warning"
              format={(v) =>
                `${number.format(v)} ${t(
                  v === 1 ? "adminStats.unitEdit" : "adminStats.unitEdits",
                )}`
              }
              rows={contributors.items.map((row) => ({
                key: row.user_id ?? row.username,
                label: row.full_name || row.username || "—",
                hint:
                  row.full_name && row.username
                    ? `@${row.username}`
                    : undefined,
                value: row.edits,
                detail:
                  row.pages_created > 0
                    ? `· ${number.format(row.pages_created)} ${t("adminStats.pagesCreatedShort")}`
                    : undefined,
              }))}
            />
          </div>
        </div>
      ) : null}

      {/* ===================== TAB 3: AI USAGE ===================== */}
      {tab === "ai" ? (
        <div
          className={cn(
            "space-y-5 transition-opacity duration-150",
            loading && "opacity-60",
          )}
          role="tabpanel"
        >
          <section
            aria-label={t("adminStats.metricsLabel")}
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <HeroKpiCard
              icon={Sparkles}
              label={t("adminStats.aiTokens")}
              value={number.format(ai.totals.tokens)}
              hint={t("adminStats.hintPerDay", {
                count: whole(ai.totals.tokens / days),
              })}
              delta={aiTokensDelta}
              tone="primary"
              split={{
                leftLabel: t("adminStats.aiPromptShort"),
                leftPercent: promptShare,
                rightLabel: t("adminStats.aiCompletionShort"),
                rightPercent: completionShare,
              }}
            />
            <HeroKpiCard
              icon={BookOpen}
              label={t("adminStats.aiRequests")}
              value={number.format(ai.totals.calls)}
              hint={t("adminStats.hintPerDay", {
                count: fixed(ai.totals.calls / days),
              })}
              delta={aiCallsDelta}
              tone="warning"
              sparkline={ai.daily.map((d) => d.calls)}
            />
            <HeroKpiCard
              icon={Users}
              label={t("adminStats.aiPeople")}
              value={number.format(ai.totals.users)}
              hint={t("adminStats.hintPerPerson", {
                count: whole(ratio(ai.totals.tokens, ai.totals.users)),
              })}
              delta={aiUsersDelta}
              tone="info"
            />
            <HeroKpiCard
              icon={Cpu}
              label={t("adminStats.aiAvgTokensPerRequest")}
              value={whole(avgTokensPerCall)}
              hint={t("adminStats.hintPromptCompletion", {
                prompt: number.format(promptShare),
                completion: number.format(completionShare),
              })}
              delta={aiAvgTokensDelta}
              tone="success"
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <StackedBarChart
              title={t("adminStats.chartTokens")}
              primaryLabel={t("adminStats.aiPrompt")}
              secondaryLabel={t("adminStats.aiCompletion")}
              delta={aiTokensDelta}
              points={ai.daily.map((d) => ({
                day: d.day,
                primary: d.prompt_tokens ?? d.tokens,
                secondary: d.completion_tokens ?? 0,
              }))}
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

          <div className="grid gap-4 lg:grid-cols-3">
            <BarList
              title={t("adminStats.aiByPerson")}
              emptyLabel={t("adminStats.aiNone")}
              showShare
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
              showShare
              format={(value) => number.format(value)}
              rows={ai.by_feature.map((row) => ({
                key: row.feature,
                label: featureLabel(row.feature),
                value: row.tokens,
                detail: `· ${number.format(row.calls)} ${t("adminStats.colRequests").toLowerCase()}`,
              }))}
            />
            <BarList
              title={t("adminStats.aiByModel")}
              emptyLabel={t("adminStats.aiNone")}
              tone="success"
              showShare
              format={(value) => number.format(value)}
              rows={(ai.by_model ?? []).map((row) => ({
                key: row.model,
                label: row.model,
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
    </div>
  );
}
