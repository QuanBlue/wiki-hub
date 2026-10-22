"use client";

import {
  BadgeCheck,
  CheckCircle2,
  Copy,
  FileText,
  HeartPulse,
  History,
  Link2Off,
  Loader2,
  Sparkles,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import { aiStatus } from "@/lib/ai-summary";
import { formatDate } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/context";
import { formatRelative } from "@/lib/relative-time";
import {
  HEALTH_TABS,
  STALE_CHOICES,
  checkStalePage,
  firstBusyTab,
  healthCounts,
  healthPageHref,
  loadSpaceHealth,
  markPageReviewed,
  type HealthTab,
} from "@/lib/space-health";
import { cn } from "@/lib/utils";
import type {
  BrokenLink,
  DuplicateGroup,
  HealthPage,
  Space,
  SpaceHealth,
  StaleCheck,
  StalePage,
} from "@/types/api";

const TAB_ICONS: Record<HealthTab, LucideIcon> = {
  stale: History,
  broken: Link2Off,
  orphans: Unlink,
  duplicates: Copy,
};

/** Each check's colour when it finds something: an icon tile and its count. */
const TAB_TONE: Record<HealthTab, string> = {
  stale: "bg-warning-bg text-warning",
  broken: "bg-danger-bg text-danger",
  orphans: "bg-info-bg text-info",
  duplicates: "bg-info-bg text-info",
};

const ROW =
  "hover:bg-surface-hover flex flex-col gap-2 px-4 py-3 transition-colors duration-150";
const LIST =
  "border-border divide-border bg-surface divide-y rounded-xl border";
const PAGE_LINK =
  "text-foreground hover:text-primary focus-visible:ring-ring rounded-sm text-sm font-medium " +
  "underline-offset-4 transition-colors duration-150 hover:underline focus-visible:ring-2 " +
  "focus-visible:outline-none";

/** A page of the report, as a link that opens it (and closes the dialog). */
function PageLink({
  page,
  onOpen,
  showSpace,
  className,
}: {
  page: HealthPage;
  onOpen: () => void;
  showSpace?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Link
      href={healthPageHref(page)}
      onClick={onOpen}
      className={cn(PAGE_LINK, className)}
    >
      {page.title}
      {showSpace ? (
        <span className="text-muted-foreground font-normal">
          {" "}
          {t("graph.inSpace", { space: page.space_name })}
        </span>
      ) : null}
    </Link>
  );
}

/** A related page as a small chip: its title opens it, and when it was edited. */
function PageChip({
  page,
  onOpen,
  showSpace,
}: {
  page: HealthPage;
  onOpen: () => void;
  showSpace: boolean;
}) {
  const { locale } = useTranslation();
  return (
    <li
      className="border-border bg-surface hover:border-border-strong inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border py-0.5 pr-2 pl-1.5 transition-colors duration-150"
      title={formatDate(page.updated_at, locale)}
    >
      <FileText
        className="text-muted-foreground size-3.5 shrink-0"
        aria-hidden
      />
      <PageLink
        page={page}
        onOpen={onOpen}
        showSpace={showSpace}
        className="min-w-0 truncate text-xs"
      />
      <span className="text-muted-foreground shrink-0 text-[11px]">
        {formatRelative(page.updated_at, locale)}
      </span>
    </li>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="border-border bg-surface flex grow flex-col items-center justify-center rounded-xl border px-6 py-12 text-center">
      <span className="bg-success-bg text-success mx-auto grid size-11 place-items-center rounded-full">
        <CheckCircle2 className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-xs leading-5">
        {hint}
      </p>
    </div>
  );
}

/** "Showing 200 of 340": the report lists the first ones of a long list. */
function Capped({ shown, total }: { shown: number; total: number }) {
  const { t } = useTranslation();
  if (total <= shown) return null;
  return (
    <p className="text-muted-foreground text-xs">
      {t("health.capped", { shown, total })}
    </p>
  );
}

function StaleRow({
  item,
  space,
  aiOn,
  onOpen,
  onReviewed,
}: {
  item: StalePage;
  space: Space;
  aiOn: boolean;
  onOpen: () => void;
  onReviewed: (id: string) => void;
}) {
  const { t, locale } = useTranslation();
  const [reviewing, setReviewing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<StaleCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function review() {
    setReviewing(true);
    try {
      await markPageReviewed(space.key, item.page.slug);
      toast.success(t("health.reviewed", { title: item.page.title }));
      onReviewed(item.page.id);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("health.reviewError"),
      );
      setReviewing(false);
    }
  }

  async function runCheck() {
    setChecking(true);
    setCheckError(null);
    try {
      setCheck(await checkStalePage(space.key, item.page.slug, locale));
    } catch (error) {
      setCheckError(
        error instanceof ApiError && error.status === 429
          ? t("health.checkLimited")
          : error instanceof ApiError && error.status === 503
            ? t("health.checkOff")
            : t("health.checkError"),
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <li className={ROW}>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <PageLink page={item.page} onOpen={onOpen} />
            <p
              className="text-muted-foreground mt-0.5 text-xs"
              title={formatDate(item.page.updated_at, locale)}
            >
              {t("health.lastEdited", {
                when: formatRelative(item.page.updated_at, locale),
              })}
              {item.reviewed_at
                ? ` · ${t("health.reviewedAt", { when: formatRelative(item.reviewed_at, locale) })}`
                : null}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-[11px] font-medium">
              {t(item.newer_count === 1 ? "health.newerOne" : "health.newer", {
                count: item.newer_count,
              })}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {item.newer.map((newer) => (
                <PageChip
                  key={newer.id}
                  page={newer}
                  onOpen={onOpen}
                  showSpace={newer.space_key !== space.key}
                />
              ))}
            </ul>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {aiOn ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={checking}
              onClick={() => void runCheck()}
            >
              {checking ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {checking ? t("health.checking") : t("health.check")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={reviewing}
            onClick={() => void review()}
          >
            {reviewing ? <Loader2 className="animate-spin" /> : <BadgeCheck />}
            {t("health.markReviewed")}
          </Button>
        </div>
      </div>
      {checkError ? (
        <p
          className="text-danger bg-danger-bg rounded-md px-3 py-2 text-xs"
          role="alert"
        >
          {checkError}
        </p>
      ) : null}
      {check ? (
        <div
          className="border-primary/30 bg-primary-subtle rounded-lg border px-3 py-2.5"
          aria-live="polite"
        >
          <p className="text-primary mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
            <Sparkles className="size-3" aria-hidden />
            {t("health.checkTitle")}
          </p>
          {check.result ? (
            <IssueMarkdown
              source={check.result}
              className="text-foreground text-sm leading-6"
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("health.checkNothingNewer")}
            </p>
          )}
          <p className="text-muted-foreground mt-1.5 text-[11px]">
            {t("health.checkNote")}
          </p>
        </div>
      ) : null}
    </li>
  );
}

const REASON_TONE: Record<BrokenLink["reason"], string> = {
  missing: "bg-danger-bg text-danger",
  trashed: "bg-warning-bg text-warning",
  archived_space: "bg-surface-sunken text-muted-foreground",
};

function BrokenRow({ link, onOpen }: { link: BrokenLink; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <li className={ROW}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PageLink page={link.page} onOpen={onOpen} />
          <span
            className={cn(
              "rounded-full px-2 py-px text-[11px] font-medium",
              REASON_TONE[link.reason],
            )}
          >
            {t(`health.reason_${link.reason}`)}
          </span>
        </div>
        <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <Link2Off className="size-3.5 shrink-0" aria-hidden />
          <code className="bg-surface-sunken min-w-0 truncate rounded px-1 font-mono text-[11px]">
            {link.href}
          </code>
          {link.target_title ? (
            <span className="truncate">→ {link.target_title}</span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function OrphanRow({ page, onOpen }: { page: HealthPage; onOpen: () => void }) {
  const { t, locale } = useTranslation();
  return (
    <li className={ROW}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <PageLink page={page} onOpen={onOpen} />
        <span
          className="text-muted-foreground text-xs"
          title={formatDate(page.updated_at, locale)}
        >
          {t("health.lastEdited", {
            when: formatRelative(page.updated_at, locale),
          })}
        </span>
      </div>
    </li>
  );
}

function DuplicateRow({
  group,
  onOpen,
}: {
  group: DuplicateGroup;
  onOpen: () => void;
}) {
  const { t, locale } = useTranslation();
  return (
    <li className={ROW}>
      <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium">
        <Copy className="size-3.5" aria-hidden />
        {group.kind === "title"
          ? t("health.sameTitle", { count: group.pages.length })
          : t("health.sameContent", {
              percent: Math.round((group.similarity ?? 0) * 100),
            })}
      </p>
      <ul className="border-border divide-border divide-y rounded-lg border">
        {group.pages.map((page) => (
          <li
            key={page.id}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2"
          >
            <PageLink page={page} onOpen={onOpen} showSpace />
            <span className="text-muted-foreground text-xs">
              {t("health.lastEdited", {
                when: formatRelative(page.updated_at, locale),
              })}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** The skeleton of a list while the report is being made. */
function Loading() {
  const { t } = useTranslation();
  return (
    <ul
      className="border-border divide-border divide-y rounded-xl border"
      aria-hidden
    >
      {[0, 1, 2].map((row) => (
        <li key={row} className="space-y-2 px-4 py-3.5">
          <span className="bg-surface-sunken block h-3 w-1/2 animate-pulse rounded" />
          <span className="bg-surface-sunken block h-2.5 w-3/4 animate-pulse rounded" />
        </li>
      ))}
      <span className="sr-only">{t("health.loading")}</span>
    </ul>
  );
}

/**
 * A space's content health, as a dialog over the space: pages that may be out of date,
 * links that lead nowhere, pages nothing points to and pages that repeat each other. For the
 * space's administrators; opened from the space sidebar. The checks are listed on the left with
 * what each found, and the one chosen is shown on the right.
 */
export function SpaceHealthDialog({
  space,
  open,
  onOpenChange,
}: {
  space: Space;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [staleDays, setStaleDays] = useState<number>(STALE_CHOICES[0]);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    request: string;
    health: SpaceHealth | null;
  } | null>(null);
  const [tab, setTab] = useState<HealthTab | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const request = `${staleDays}:${attempt}`;

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadSpaceHealth(space.key, staleDays)
      .then((health) => {
        if (live) setLoaded({ request: `${staleDays}:${attempt}`, health });
      })
      .catch(() => {
        if (live)
          setLoaded({ request: `${staleDays}:${attempt}`, health: null });
      });
    return () => {
      live = false;
    };
  }, [open, space.key, staleDays, attempt]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void aiStatus().then((status) => {
      if (live) setAiOn(status.enabled);
    });
    return () => {
      live = false;
    };
  }, [open]);

  const current = loaded && loaded.request === request ? loaded : null;
  const health = current?.health ?? null;
  const failed = current !== null && health === null;
  const shownTab: HealthTab = tab ?? (health ? firstBusyTab(health) : "stale");
  const counts = health ? healthCounts(health) : null;
  const total = counts
    ? HEALTH_TABS.reduce((sum, id) => sum + counts[id], 0)
    : null;
  const close = () => onOpenChange(false);

  // Acting in a list keeps it shown, even once it is empty.
  const dropStale = (id: string) => {
    setTab((value) => value ?? "stale");
    setLoaded((value) => {
      if (!value?.health) return value;
      const { health } = value;
      return {
        ...value,
        health: {
          ...health,
          stale: health.stale.filter((item) => item.page.id !== id),
          stale_total: Math.max(0, health.stale_total - 1),
        },
      };
    });
  };

  const labels: Record<HealthTab, string> = {
    stale: t("health.tabStale"),
    broken: t("health.tabBroken"),
    orphans: t("health.tabOrphans"),
    duplicates: t("health.tabDuplicates"),
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTab(null);
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-5xl"
        title={
          <span className="flex items-center gap-2">
            <span className="bg-primary-subtle text-primary grid size-7 place-items-center rounded-md">
              <HeartPulse className="size-4" aria-hidden />
            </span>
            {t("health.title")}
          </span>
        }
        description={t("health.description", { space: space.name })}
      >
        {failed ? (
          <div
            className="border-border rounded-xl border p-6 text-center"
            role="alert"
          >
            <p className="text-sm font-medium">{t("health.loadError")}</p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={() => setAttempt((n) => n + 1)}
            >
              {t("health.retry")}
            </Button>
          </div>
        ) : (
          // One height for every list, set by the screen rather than by what a list holds, so
          // moving between them does not make the dialog jump.
          <div className="grid gap-4 sm:h-[min(34rem,calc(100vh-13rem))] sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-5">
            <div className="min-w-0 space-y-2">
              {/* How much there is to look at, in all: the reason to open the lists at all. */}
              <div
                className={cn(
                  "hidden items-center gap-2.5 rounded-lg px-3 py-2.5 sm:flex",
                  total === null
                    ? "bg-surface-sunken"
                    : total > 0
                      ? "bg-warning-bg"
                      : "bg-success-bg",
                )}
              >
                {total === null ? (
                  <span
                    className="bg-surface h-4 w-24 animate-pulse rounded"
                    aria-hidden
                  />
                ) : (
                  <>
                    <span
                      className={cn(
                        "text-xl leading-none font-semibold tabular-nums",
                        total > 0 ? "text-warning" : "text-success",
                      )}
                    >
                      {total}
                    </span>
                    <span className="text-foreground text-xs leading-4">
                      {total > 0
                        ? t("health.summaryIssues")
                        : t("health.summaryClear")}
                    </span>
                  </>
                )}
              </div>
              <div
                role="tablist"
                aria-label={t("health.sections")}
                aria-orientation="vertical"
                className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-col sm:overflow-visible sm:px-0 sm:pb-0"
              >
                {HEALTH_TABS.map((id) => {
                  const Icon = TAB_ICONS[id];
                  const selected = shownTab === id;
                  const found = counts ? counts[id] : null;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setTab(id)}
                      className={cn(
                        "focus-visible:ring-ring flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none sm:w-full",
                        selected
                          ? "border-primary/30 bg-primary-subtle"
                          : "hover:bg-surface-hover active:bg-surface-selected border-transparent",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-md",
                          found
                            ? TAB_TONE[id]
                            : "bg-surface-sunken text-muted-foreground",
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-sm font-medium whitespace-nowrap",
                            selected ? "text-primary" : "text-foreground",
                          )}
                        >
                          {labels[id]}
                        </span>
                        <span className="text-muted-foreground hidden truncate text-[11px] sm:block">
                          {t(`health.short_${id}`)}
                        </span>
                      </span>
                      {found === null ? (
                        <span className="bg-surface-sunken h-4 w-5 animate-pulse rounded" />
                      ) : (
                        <span
                          className={cn(
                            "min-w-6 rounded-full px-1.5 py-px text-center text-[11px] font-semibold tabular-nums",
                            found ? TAB_TONE[id] : "text-muted-foreground",
                          )}
                        >
                          {found}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              role="tabpanel"
              aria-label={labels[shownTab]}
              className="flex min-h-0 min-w-0 flex-col gap-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-64">
                  <h3 className="text-sm font-semibold">{labels[shownTab]}</h3>
                  {health ? (
                    <p className="text-muted-foreground mt-0.5 text-xs leading-5">
                      {t(`health.hint_${shownTab}`, {
                        months: Math.round(health.stale_days / 30),
                        recent: Math.round(health.recent_days / 30),
                      })}
                    </p>
                  ) : null}
                </div>
                {shownTab === "stale" ? (
                  <div
                    className="flex items-center gap-2"
                    role="group"
                    aria-label={t("health.staleFor")}
                  >
                    <span className="text-muted-foreground text-xs whitespace-nowrap">
                      {t("health.staleFor")}
                    </span>
                    <div className="bg-surface-sunken flex gap-0.5 rounded-lg p-0.5">
                      {STALE_CHOICES.map((days) => (
                        <button
                          key={days}
                          type="button"
                          aria-pressed={staleDays === days}
                          onClick={() => {
                            setTab("stale");
                            setStaleDays(days);
                          }}
                          className={cn(
                            "focus-visible:ring-ring cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                            staleDays === days
                              ? "bg-surface text-primary shadow-sm"
                              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                          )}
                        >
                          {t("health.months", { count: Math.round(days / 30) })}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* The one part that scrolls: the panel keeps its height whatever the list holds. */}
              <div className="flex h-[55vh] min-h-0 flex-col gap-2 overflow-y-auto *:shrink-0 sm:h-auto sm:flex-1">
                {health === null ? (
                  <Loading />
                ) : (
                  <>
                    {shownTab === "stale" ? (
                      <>
                        {health.stale.length === 0 ? (
                          <Empty
                            title={t("health.emptyStale")}
                            hint={t("health.emptyStaleHint")}
                          />
                        ) : (
                          <ul className={LIST}>
                            {health.stale.map((item) => (
                              <StaleRow
                                key={item.page.id}
                                item={item}
                                space={space}
                                aiOn={aiOn}
                                onOpen={close}
                                onReviewed={dropStale}
                              />
                            ))}
                          </ul>
                        )}
                        <Capped
                          shown={health.stale.length}
                          total={health.stale_total}
                        />
                      </>
                    ) : null}

                    {shownTab === "broken" ? (
                      health.broken_links.length === 0 ? (
                        <Empty
                          title={t("health.emptyBroken")}
                          hint={t("health.emptyBrokenHint")}
                        />
                      ) : (
                        <>
                          <ul className={LIST}>
                            {health.broken_links.map((link, index) => (
                              <BrokenRow
                                key={`${link.page.id}:${link.href}:${index}`}
                                link={link}
                                onOpen={close}
                              />
                            ))}
                          </ul>
                          <Capped
                            shown={health.broken_links.length}
                            total={health.broken_total}
                          />
                        </>
                      )
                    ) : null}

                    {shownTab === "orphans" ? (
                      health.orphans.length === 0 ? (
                        <Empty
                          title={t("health.emptyOrphans")}
                          hint={t("health.emptyOrphansHint")}
                        />
                      ) : (
                        <>
                          <ul className={LIST}>
                            {health.orphans.map((page) => (
                              <OrphanRow
                                key={page.id}
                                page={page}
                                onOpen={close}
                              />
                            ))}
                          </ul>
                          <Capped
                            shown={health.orphans.length}
                            total={health.orphans_total}
                          />
                        </>
                      )
                    ) : null}

                    {shownTab === "duplicates" ? (
                      <>
                        {health.duplicates.length === 0 ? (
                          <Empty
                            title={t("health.emptyDuplicates")}
                            hint={t("health.emptyDuplicatesHint")}
                          />
                        ) : (
                          <ul className={LIST}>
                            {health.duplicates.map((group) => (
                              <DuplicateRow
                                key={group.pages
                                  .map((page) => page.id)
                                  .join(":")}
                                group={group}
                                onOpen={close}
                              />
                            ))}
                          </ul>
                        )}
                        {health.semantic ? null : (
                          <p className="text-muted-foreground text-xs">
                            {t("health.noSemantic")}
                          </p>
                        )}
                        <Capped
                          shown={health.duplicates.length}
                          total={health.duplicates_total}
                        />
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
