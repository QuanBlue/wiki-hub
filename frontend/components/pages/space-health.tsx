"use client";

import {
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleMinus,
  CirclePlus,
  Copy,
  ExternalLink,
  FileText,
  GitCompare,
  HeartPulse,
  History,
  Link2,
  Link2Off,
  Loader2,
  Sparkles,
  Table2,
  Scale,
  TriangleAlert,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { toast } from "sonner";

import { IssueMarkdown } from "@/components/issues/issue-markdown";
import {
  DiffViewToggle,
  LineDiff,
  useLineDiff,
} from "@/components/pages/line-diff";
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
  checkConflict,
  checkStalePage,
  firstBusyTab,
  healthCounts,
  healthPageHref,
  issueTotal,
  loadPageContent,
  loadSpaceHealth,
  markPageReviewed,
  rowsToRevisionDiff,
  parseConflictTable,
  plainText,
  type ConflictTable,
  type HealthTab,
} from "@/lib/space-health";
import { cn } from "@/lib/utils";
import type {
  BrokenLink,
  ConflictCheck,
  ConflictPair,
  DuplicateGroup,
  HealthPage,
  OrphanPage,
  Space,
  SpaceHealth,
  StaleCheck,
  StalePage,
} from "@/types/api";

/*
 * Type scale, after the design system's 14px body: 14px (`text-sm`) for anything read -
 * page titles, findings, hints - and 12px (`text-xs`) for metadata beside it (dates,
 * counts, badges). Nothing smaller: the report is read, not glanced at.
 */

const TAB_ICONS: Record<HealthTab, LucideIcon> = {
  stale: History,
  broken: Link2Off,
  orphans: Unlink,
  duplicates: Copy,
  conflicts: Scale,
};

/** Each check's colour when it finds something: its count in the list of checks. */
const TAB_TONE: Record<HealthTab, string> = {
  stale: "bg-warning-bg text-warning",
  broken: "bg-danger-bg text-danger",
  orphans: "bg-info-bg text-info",
  duplicates: "bg-info-bg text-info",
  // Pairs to compare, not problems found: informational, like the duplicates' tone.
  conflicts: "bg-info-bg text-info",
};

// content-visibility: a long list paints only the rows near the screen, so opening a tab with
// hundreds of rows does not freeze the dialog for a moment.
const ROW =
  "hover:bg-surface-hover flex flex-col gap-3 px-4 py-3.5 transition-colors duration-150 " +
  "[contain-intrinsic-size:auto_7rem] [content-visibility:auto]";
/** Rows drawn at first in a long list; the rest follow on request. */
const FIRST_ROWS = 30;
const LIST =
  "border-border divide-border bg-surface divide-y overflow-hidden rounded-lg border";
const PAGE_LINK =
  "text-foreground hover:text-primary focus-visible:ring-ring rounded-sm text-sm font-medium " +
  "underline-offset-4 transition-colors duration-150 hover:underline focus-visible:ring-2 " +
  "focus-visible:ring-offset-2 focus-visible:outline-none active:text-primary-hover";
const ALERT = "text-danger bg-danger-bg rounded-md px-3 py-2 text-sm";

/** Opens a page of the report in a preview modal, so the report stays where it is. */
const PreviewContext = createContext<(page: HealthPage) => void>(() => {});
/** Opens two pages of the report in a modal that sets them side by side. */
const CompareContext = createContext<(pair: [HealthPage, HealthPage]) => void>(
  () => {},
);

/** A page of the report, as a button that previews it in a modal. */
function PageLink({
  page,
  showSpace,
  className,
}: {
  page: HealthPage;
  showSpace?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const preview = useContext(PreviewContext);
  return (
    <button
      type="button"
      onClick={() => preview(page)}
      className={cn(PAGE_LINK, "cursor-pointer text-left", className)}
    >
      {page.title}
      {showSpace ? (
        <span className="text-muted-foreground font-normal">
          {" "}
          {t("graph.inSpace", { space: page.space_name })}
        </span>
      ) : null}
    </button>
  );
}

/** When a page was last edited: relative, with the exact date on hover. */
function Edited({ page }: { page: HealthPage }) {
  const { t, locale } = useTranslation();
  return (
    <span
      className="text-muted-foreground shrink-0 text-xs"
      title={formatDate(page.updated_at, locale)}
    >
      {t("health.lastEdited", {
        when: formatRelative(page.updated_at, locale),
      })}
    </span>
  );
}

/**
 * The pages a finding is about (a pair, or a group of copies): one line each, set off by a
 * rule on the left rather than boxed, so a row reads as one finding, not a card in a card.
 */
function PageLines({
  pages,
  showSpace,
  aside = (page) => <Edited page={page} />,
}: {
  pages: HealthPage[];
  showSpace: (page: HealthPage) => boolean;
  aside?: (page: HealthPage) => ReactNode;
}) {
  return (
    <ul className="border-border space-y-1.5 border-l-2 pl-3">
      {pages.map((page) => (
        <li
          key={page.id}
          className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <FileText
              className="text-muted-foreground size-3.5 shrink-0 translate-y-0.5"
              aria-hidden
            />
            <PageLink page={page} showSpace={showSpace(page)} />
          </span>
          {aside(page)}
        </li>
      ))}
    </ul>
  );
}

/** A row's first line: what the finding is on the left, what to do about it on the right. */
function RowHead({
  icon: Icon,
  iconClassName = "text-muted-foreground",
  children,
  actions,
}: {
  icon: LucideIcon;
  /** The icon's colour: a warning sign is amber, like warnings everywhere in the app. */
  iconClassName?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="text-foreground flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
        <Icon className={cn("size-4 shrink-0", iconClassName)} aria-hidden />
        {children}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Text the AI wrote, in the app's rich Markdown: coloured **bold**, _italics_, `code`, lists,
 * quotes and ``> [!WARNING]`` callouts. ``inline`` is for a table cell: no paragraph spacing.
 */
function AiMarkdown({ source, inline }: { source: string; inline?: boolean }) {
  return (
    <IssueMarkdown
      source={source}
      rich
      autolink
      className={cn(
        "text-foreground text-sm leading-6",
        inline && "[&_p]:my-0 [&>*]:my-0",
      )}
    />
  );
}

const CALLOUT_TONE = {
  primary: { box: "border-l-primary bg-primary-subtle", text: "text-primary" },
  warning: { box: "border-l-warning bg-warning-bg", text: "text-warning" },
  success: { box: "border-l-success bg-success-bg", text: "text-success" },
  info: { box: "border-l-info bg-info-bg", text: "text-info" },
} as const;

/**
 * What the AI said about a finding, in the app's callout form: a tinted panel with a coloured
 * edge, an icon and a heading (colour is never the only signal), the answer, and a reminder
 * that it is the AI's reading.
 */
function ResultCallout({
  tone,
  icon: Icon,
  title,
  aside,
  children,
}: {
  tone: keyof typeof CALLOUT_TONE;
  icon: LucideIcon;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const colours = CALLOUT_TONE[tone];
  return (
    <div
      className={cn("rounded-md border-l-4 px-4 py-2", colours.box)}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            colours.text,
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {title}
        </p>
        <div className="flex items-center gap-2">
          {aside}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
            className="text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected focus-visible:ring-ring flex h-7 cursor-pointer items-center gap-1 rounded px-2 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            {open ? (
              <ChevronUp className="size-3.5" aria-hidden />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden />
            )}
            {open ? t("health.collapseResult") : t("health.expandResult")}
          </button>
        </div>
      </div>
      {open ? (
        <div id={bodyId} className="mt-1.5 pb-1">
          {children}
          <p className="text-muted-foreground mt-2 text-xs">
            {t("health.checkNote")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** A small label beside a finding: why a link is broken, how two pages are tied. */
function Badge({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

// The reader is heavy and only needed once a page is opened.
const PageReader = dynamic(
  () =>
    import("@/components/pages/rich-text-editor").then(
      (mod) => mod.RichTextContent,
    ),
  { ssr: false },
);

/** A page of the report shown in a modal over it, so looking at one does not leave the report. */
function PagePreviewDialog({
  page,
  onClose,
  onNavigate,
}: {
  page: HealthPage | null;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<{
    id: string;
    html: string | null;
  } | null>(null);

  useEffect(() => {
    if (!page) return;
    let live = true;
    loadPageContent(page.space_key, page.slug)
      .then((html) => live && setLoaded({ id: page.id, html }))
      .catch(() => live && setLoaded({ id: page.id, html: null }));
    return () => {
      live = false;
    };
  }, [page]);

  const current = page && loaded?.id === page.id ? loaded : null;
  return (
    <Dialog open={page !== null} onOpenChange={(next) => !next && onClose()}>
      {page ? (
        <DialogContent
          className="max-w-5xl"
          title={page.title}
          description={t("health.previewDescription", {
            space: page.space_name,
          })}
        >
          <div // A wide table scrolls with the page, so the horizontal bar sits at the foot of this
            // box where it can be reached, not under the table, far down a long page.
            className="border-border max-h-[min(70vh,44rem)] overflow-auto border-y py-4 [&_div.tableWrapper]:overflow-visible"
          >
            {current === null ? (
              <p className="text-muted-foreground text-sm">
                {t("health.previewLoading")}
              </p>
            ) : current.html === null ? (
              <p className={ALERT} role="alert">
                {t("health.previewError")}
              </p>
            ) : current.html.trim() === "" ? (
              <p className="text-muted-foreground text-sm">
                {t("health.previewEmpty")}
              </p>
            ) : (
              <PageReader content={current.html} />
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <Button asChild variant="primary" size="md">
              <Link href={healthPageHref(page)} onClick={onNavigate}>
                <ExternalLink />
                {t("health.previewOpen")}
              </Link>
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/** A check that found nothing: says so, and why that is good. */
function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="border-border bg-surface flex grow flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center">
      <span className="bg-success-bg text-success mx-auto grid size-10 place-items-center rounded-full">
        <CheckCircle2 className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm leading-6">
        {hint}
      </p>
    </div>
  );
}

/** A note under a list: what it leaves out, or what to turn on to see more. */
function ListNote({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

/** "Showing 200 of 340": the report lists the first ones of a long list. */
function Capped({ shown, total }: { shown: number; total: number }) {
  const { t } = useTranslation();
  if (total <= shown) return null;
  return <ListNote>{t("health.capped", { shown, total })}</ListNote>;
}

/** Why the AI could not answer, in words a reader can act on. */
function useCheckError() {
  const { t } = useTranslation();
  return (error: unknown) =>
    error instanceof ApiError && error.status === 429
      ? t("health.checkLimited")
      : error instanceof ApiError && error.status === 503
        ? t("health.checkOff")
        : t("health.checkError");
}

function StaleRow({
  item,
  space,
  aiOn,
  onReviewed,
}: {
  item: StalePage;
  space: Space;
  aiOn: boolean;
  onReviewed: (id: string) => void;
}) {
  const { t, locale } = useTranslation();
  const describe = useCheckError();
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
      setCheckError(describe(error));
    } finally {
      setChecking(false);
    }
  }

  return (
    <li className={ROW}>
      <RowHead
        icon={History}
        iconClassName="text-warning"
        actions={
          <>
            {aiOn ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
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
              size="md"
              disabled={reviewing}
              title={t("health.markReviewedHint")}
              onClick={() => void review()}
            >
              {reviewing ? (
                <Loader2 className="animate-spin" />
              ) : (
                <BadgeCheck />
              )}
              {t("health.markReviewed")}
            </Button>
          </>
        }
      >
        <PageLink page={item.page} />
        <span
          className="text-muted-foreground text-xs"
          title={formatDate(item.page.updated_at, locale)}
        >
          {t("health.lastEdited", {
            when: formatRelative(item.page.updated_at, locale),
          })}
          {item.reviewed_at
            ? ` · ${t("health.reviewedAt", { when: formatRelative(item.reviewed_at, locale) })}`
            : null}
        </span>
      </RowHead>
      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs font-medium">
          {t(item.newer_count === 1 ? "health.newerOne" : "health.newer", {
            count: item.newer_count,
          })}
        </p>
        <PageLines
          pages={item.newer}
          showSpace={(page) => page.space_key !== space.key}
        />
      </div>
      {checkError ? (
        <p className={ALERT} role="alert">
          {checkError}
        </p>
      ) : null}
      {check ? (
        <ResultCallout
          tone="primary"
          icon={Sparkles}
          title={t("health.checkTitle")}
        >
          {check.result ? (
            <AiMarkdown source={check.result} />
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("health.checkNothingNewer")}
            </p>
          )}
        </ResultCallout>
      ) : null}
    </li>
  );
}

const REASON_TONE: Record<BrokenLink["reason"], string> = {
  missing: "bg-danger-bg text-danger",
  trashed: "bg-warning-bg text-warning",
  archived_space: "bg-surface-sunken text-muted-foreground",
};

function BrokenRowImpl({ link }: { link: BrokenLink }) {
  const { t } = useTranslation();
  return (
    <li className={ROW}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <PageLink page={link.page} />
        <Badge className={REASON_TONE[link.reason]}>
          {t(`health.reason_${link.reason}`)}
        </Badge>
      </div>
      <p className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
        <Link2Off className="size-4 shrink-0" aria-hidden />
        <code className="bg-surface-sunken min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-xs">
          {link.href}
        </code>
        {link.target_title ? (
          <span className="truncate">→ {link.target_title}</span>
        ) : null}
      </p>
    </li>
  );
}

/**
 * An orphan, with what to do about it: the pages a link to it would fit in (the closest in
 * content, then its parent) - open one, paste the copied link - and its link, ready to paste.
 */
function OrphanRowImpl({ page }: { page: OrphanPage }) {
  const { t } = useTranslation();
  const suggestions = page.link_from ?? [];
  const byId = new Map(suggestions.map((s) => [s.page.id, s]));

  async function copyLink() {
    const url = new URL(healthPageHref(page), window.location.origin).href;
    try {
      // As a link with its title where the editor reads HTML, and as the address elsewhere.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        const html = `<a href="${url}">${escapeHtml(page.title)}</a>`;
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([url], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(url);
      }
      toast.success(t("health.linkCopied", { title: page.title }));
    } catch {
      toast.error(t("health.linkCopyError"));
    }
  }

  return (
    <li className={ROW}>
      <RowHead
        icon={Unlink}
        iconClassName="text-info"
        actions={
          <Button
            type="button"
            variant="secondary"
            size="md"
            title={t("health.copyLinkHint")}
            onClick={() => void copyLink()}
          >
            <Link2 />
            {t("health.copyLink")}
          </Button>
        }
      >
        <PageLink page={page} />
        <Edited page={page} />
      </RowHead>
      {suggestions.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">
            {t("health.linkFrom")}
          </p>
          <PageLines
            pages={suggestions.map((s) => s.page)}
            showSpace={() => false}
            aside={(other) => {
              const suggestion = byId.get(other.id);
              return suggestion?.reason === "similar" &&
                suggestion.similarity != null ? (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t("health.linkFromSimilar", {
                    percent: Math.round(suggestion.similarity * 100),
                  })}
                </span>
              ) : (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t("health.linkFromParent")}
                </span>
              );
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** How alike two pages are, as a filled bar with the percentage beside it. */
function SimilarityBar({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "warning" | "info";
}) {
  const percent = Math.min(100, Math.max(0, Math.round(value * 100)));
  return (
    <span className="inline-flex items-center gap-2">
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="bg-border-strong/40 ring-border-strong/60 block h-1.5 w-32 overflow-hidden rounded-full ring-1 ring-inset"
      >
        <span
          className={cn(
            "block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300",
            tone === "warning" ? "bg-warning" : "bg-info",
          )}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "warning" ? "text-warning" : "text-info",
        )}
      >
        {percent}%
      </span>
    </span>
  );
}

function DuplicateRowImpl({ group }: { group: DuplicateGroup }) {
  const { t } = useTranslation();
  const [first, second] = group.pages;
  const compare = useContext(CompareContext);

  return (
    <li className={ROW}>
      <RowHead
        icon={Copy}
        iconClassName="text-warning"
        actions={
          first && second ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => compare([first, second])}
            >
              <GitCompare />
              {t("health.compare")}
            </Button>
          ) : null
        }
      >
        {group.kind === "title" ? (
          <span className="font-medium">
            {t("health.sameTitle", { count: group.pages.length })}
          </span>
        ) : (
          <>
            <SimilarityBar
              value={group.similarity ?? 0}
              label={t("health.sameContentLabel")}
              tone="warning"
            />
            <span className="text-muted-foreground">
              {t("health.sameContentLabel")}
            </span>
          </>
        )}
      </RowHead>
      <PageLines pages={group.pages} showSpace={() => true} />
    </li>
  );
}

type ConflictVerdict = "conflict" | "consistent" | "duplicate";

/** How each verdict reads: a conflict to settle, nothing to do, or two pages to merge. */
const VERDICT_LOOK: Record<
  ConflictVerdict,
  {
    tone: keyof typeof CALLOUT_TONE;
    icon: LucideIcon;
    iconClassName: string;
    label: string;
  }
> = {
  conflict: {
    tone: "warning",
    icon: TriangleAlert,
    iconClassName: "text-warning",
    label: "health.conflictDetected",
  },
  consistent: {
    tone: "success",
    icon: CheckCircle2,
    iconClassName: "text-success",
    label: "health.conflictNone",
  },
  duplicate: {
    tone: "info",
    icon: Copy,
    iconClassName: "text-info",
    label: "health.conflictDuplicate",
  },
};

function ConflictRowImpl({
  item,
  space,
  aiOn,
}: {
  item: ConflictPair;
  space: Space;
  aiOn: boolean;
}) {
  const { t, locale } = useTranslation();
  const describe = useCheckError();
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ConflictCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const compare = useContext(CompareContext);
  const verdict: ConflictVerdict | null = check
    ? (check.verdict ?? (check.has_conflict ? "conflict" : "consistent"))
    : null;
  const table =
    verdict === "conflict" && check ? parseConflictTable(check.result) : null;
  const look = verdict ? VERDICT_LOOK[verdict] : null;

  async function runCheck() {
    setChecking(true);
    setCheckError(null);
    try {
      setCheck(
        await checkConflict(
          space.key,
          item.page_a.slug,
          item.page_b.slug,
          item.page_b.space_key !== space.key
            ? item.page_b.space_key
            : undefined,
          locale,
        ),
      );
    } catch (error) {
      setCheckError(describe(error));
    } finally {
      setChecking(false);
    }
  }

  const relationLabel =
    item.relation === "similar"
      ? t("health.conflictRelation_similar")
      : item.relation === "link"
        ? t("health.conflictRelation_link")
        : t("health.conflictRelation_mention");

  return (
    <li className={ROW}>
      <RowHead
        icon={look ? look.icon : Scale}
        iconClassName={look ? look.iconClassName : "text-muted-foreground"}
        actions={
          aiOn ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={checking}
              onClick={() => void runCheck()}
            >
              {checking ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {checking
                ? t("health.checkingConflict")
                : t("health.checkConflict")}
            </Button>
          ) : null
        }
      >
        {item.relation === "similar" ? (
          <>
            <SimilarityBar
              value={item.similarity ?? 0.7}
              label={relationLabel}
              tone="warning"
            />
            <span className="text-muted-foreground">{relationLabel}</span>
          </>
        ) : (
          <Badge className="bg-surface-sunken text-muted-foreground">
            {relationLabel}
          </Badge>
        )}
      </RowHead>
      <PageLines
        pages={[item.page_a, item.page_b]}
        showSpace={(page) => page.space_key !== space.key}
      />
      {checkError ? (
        <p className={ALERT} role="alert">
          {checkError}
        </p>
      ) : null}
      {check && verdict && look ? (
        <ResultCallout
          tone={look.tone}
          icon={look.icon}
          title={
            <>
              {t("health.conflictCheckTitle")}
              <span aria-hidden>·</span>
              {t(look.label)}
            </>
          }
          aside={
            check.cached ? (
              <span className="text-muted-foreground text-xs">
                {t("health.cachedResult")}
              </span>
            ) : null
          }
        >
          {table ? (
            <div className="space-y-2.5">
              <p className="text-foreground text-sm">
                {t("health.conflictFound", { count: table.rows.length })}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {table.rows.map((row, index) => (
                  <li
                    key={index}
                    className="bg-surface border-border text-foreground rounded-md border px-2 py-0.5 text-sm"
                  >
                    {plainText(row[0])}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setDetailOpen(true)}
              >
                <Table2 />
                {t("health.conflictDetails")}
              </Button>
              {table.rest ? <AiMarkdown source={table.rest} /> : null}
            </div>
          ) : (
            <div className="space-y-2.5">
              <AiMarkdown source={check.result} />
              {verdict === "duplicate" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => compare([item.page_a, item.page_b])}
                >
                  <GitCompare />
                  {t("health.compare")}
                </Button>
              ) : null}
            </div>
          )}
        </ResultCallout>
      ) : null}
      {table ? (
        <ConflictDetailDialog
          item={item}
          table={table}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      ) : null}
    </li>
  );
}

/** Each contradiction the AI found as a row: what differs, what each page says, what to settle. */
function ConflictDetailDialog({
  item,
  table,
  open,
  onOpenChange,
}: {
  item: ConflictPair;
  table: ConflictTable;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const head = "text-muted-foreground px-4 py-2.5 text-xs font-semibold";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-6xl"
        title={t("health.conflictDetailsTitle")}
        description={t("health.conflictDetailsHint", {
          a: item.page_a.title,
          b: item.page_b.title,
        })}
      >
        <div className="border-border max-h-[min(70vh,44rem)] overflow-auto rounded-lg border">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm leading-6">
            <thead className="bg-surface-sunken sticky top-0">
              <tr className="border-border border-b">
                <th scope="col" className={cn(head, "w-[18%]")}>
                  {t("health.conflictColSubject")}
                </th>
                <th scope="col" className={cn(head, "w-[27%]")}>
                  <PageLink page={item.page_a} />
                </th>
                <th scope="col" className={cn(head, "w-[27%]")}>
                  <PageLink page={item.page_b} />
                </th>
                <th scope="col" className={head}>
                  {t("health.conflictColNote")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {table.rows.map((row, index) => (
                <tr
                  key={index}
                  className="hover:bg-surface-hover align-top transition-colors duration-150"
                >
                  <th scope="row" className="px-4 py-3 font-normal">
                    <AiMarkdown source={row[0]} inline />
                  </th>
                  <td className="bg-warning-bg/50 px-4 py-3">
                    <AiMarkdown source={row[1]} inline />
                  </td>
                  <td className="bg-warning-bg/50 px-4 py-3">
                    <AiMarkdown source={row[2]} inline />
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    <AiMarkdown source={row[3]} inline />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {table.rest ? (
          <div className="mt-4">
            <AiMarkdown source={table.rest} />
          </div>
        ) : null}
        <p className="text-muted-foreground mt-3 text-xs">
          {t("health.checkNote")}
        </p>
      </DialogContent>
    </Dialog>
  );
}

// The page history's highlighter and reader: heavy, and only needed once two pages are compared.
const HighlightedDiffContent = dynamic(
  () =>
    import("@/components/pages/page-history-modal").then(
      (mod) => mod.HighlightedDiffContent,
    ),
  { ssr: false },
);

/**
 * Two pages compared. "Line by line" (the default) sets them out as numbered, aligned lines,
 * what differs in red on the left and green on the right; "As pages" shows each page as it
 * reads, the way the page history compares versions, the two columns scrolling together.
 */
function ComparePagesDialog({
  pair,
  onClose,
}: {
  pair: [HealthPage, HealthPage] | null;
  onClose: () => void;
}) {
  const { t, locale } = useTranslation();
  const [loaded, setLoaded] = useState<{
    key: string;
    pages: [string, string] | null;
  } | null>(null);
  const [view, setView] = useState<"lines" | "pages">("pages");
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const key = pair ? `${pair[0].id}:${pair[1].id}` : null;

  useEffect(() => {
    if (!pair || !key) return;
    let live = true;
    Promise.all([
      loadPageContent(pair[0].space_key, pair[0].slug),
      loadPageContent(pair[1].space_key, pair[1].slug),
    ])
      .then(([a, b]) => live && setLoaded({ key, pages: [a, b] }))
      .catch(() => live && setLoaded({ key, pages: null }));
    return () => {
      live = false;
    };
  }, [pair, key]);

  const current = loaded?.key === key ? loaded : null;
  const pages = current?.pages ?? null;
  const lines = useLineDiff(pages?.[0] ?? null, pages?.[1] ?? null);
  const revision = useMemo(
    () =>
      lines && pair
        ? rowsToRevisionDiff(lines.rows, [pair[0].title, pair[1].title])
        : null,
    [lines, pair],
  );

  // In the page view the two columns move together, as in the page history.
  const sync = (from: "left" | "right", event: UIEvent<HTMLDivElement>) => {
    const source = event.currentTarget;
    const target = from === "left" ? rightRef.current : leftRef.current;
    if (syncing.current || !target) return;
    const sourceMax = source.scrollHeight - source.clientHeight;
    const targetMax = target.scrollHeight - target.clientHeight;
    syncing.current = true;
    target.scrollTop =
      (sourceMax > 0 ? source.scrollTop / sourceMax : 0) *
      Math.max(targetMax, 0);
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  return (
    <Dialog
      open={pair !== null}
      onOpenChange={(next) => {
        if (!next) {
          setView("pages");
          onClose();
        }
      }}
    >
      {pair ? (
        <DialogContent
          className="flex h-[min(90vh,60rem)] max-w-[min(100vw-2rem,96rem)] flex-col"
          title={t("health.compareTitle")}
          description={t("health.compareHint")}
        >
          {current === null ? (
            <p className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
              <Loader2
                className="text-primary size-5 animate-spin"
                aria-hidden
              />
              {t("health.compareLoading")}
            </p>
          ) : pages === null || lines === null || revision === null ? (
            <p className={ALERT} role="alert">
              {t("health.compareError")}
            </p>
          ) : (
            <div
              className="flex min-h-0 flex-1 flex-col gap-3"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="text-success flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="size-4" aria-hidden />
                    {t("health.compareBoth", { count: lines.same })}
                  </span>
                  <span className="text-warning font-medium">
                    {t("health.compareDiffs", {
                      count: lines.onlyOld + lines.onlyNew,
                    })}
                  </span>
                </p>
                <DiffViewToggle value={view} onChange={setView} />
              </div>

              {view === "lines" ? (
                <LineDiff
                  diff={lines}
                  counts={[
                    t("health.compareOnlyHere", { count: lines.onlyOld }),
                    t("health.compareOnlyHere", { count: lines.onlyNew }),
                  ]}
                  headings={[
                    <PageLink key="a" page={pair[0]} showSpace />,
                    <PageLink key="b" page={pair[1]} showSpace />,
                  ]}
                />
              ) : (
                <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2">
                  {pair.map((page, index) => {
                    const left = index === 0;
                    return (
                      <section
                        key={page.id}
                        aria-label={page.title}
                        className="border-border bg-surface-sunken flex min-h-0 flex-col overflow-hidden rounded-lg border p-3"
                      >
                        <header className="border-border mb-3 border-b pb-2">
                          <div className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <PageLink page={page} showSpace />
                            </span>
                            <span
                              className={cn(
                                "flex shrink-0 items-center gap-1.5 text-sm font-semibold",
                                left ? "text-danger" : "text-success",
                              )}
                            >
                              {left ? (
                                <CircleMinus className="size-4" aria-hidden />
                              ) : (
                                <CirclePlus className="size-4" aria-hidden />
                              )}
                              {t("health.compareOnlyHere", {
                                count: left ? lines.onlyOld : lines.onlyNew,
                              })}
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {t("health.lastEdited", {
                              when: formatRelative(page.updated_at, locale),
                            })}
                          </p>
                        </header>
                        <div
                          ref={left ? leftRef : rightRef}
                          onScroll={(event) =>
                            sync(left ? "left" : "right", event)
                          }
                          className="bg-surface min-h-0 flex-1 overflow-auto rounded-md p-4 text-sm leading-relaxed"
                        >
                          <HighlightedDiffContent
                            content={pages[index]}
                            comparisonContent={pages[left ? 1 : 0]}
                            diff={revision}
                            side={left ? "old" : "new"}
                          />
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

const BrokenRow = memo(BrokenRowImpl);
const OrphanRow = memo(OrphanRowImpl);
const DuplicateRow = memo(DuplicateRowImpl);
const ConflictRow = memo(ConflictRowImpl);

/** "Show 30 more": the rest of a long list, drawn when asked for. */
function ShowMore({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  if (shown >= total) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      size="md"
      className="self-center"
      onClick={onMore}
    >
      {t("health.showMore", { count: Math.min(FIRST_ROWS, total - shown) })}
    </Button>
  );
}

/** The skeleton of a list while the report is being made. */
function Loading() {
  const { t } = useTranslation();
  return (
    <ul className={LIST} aria-hidden>
      {[0, 1, 2, 3].map((row) => (
        <li key={row} className="space-y-2.5 px-4 py-4">
          <span className="bg-surface-sunken block h-3.5 w-1/2 animate-pulse rounded" />
          <span className="bg-surface-sunken block h-3 w-3/4 animate-pulse rounded" />
        </li>
      ))}
      <span className="sr-only">{t("health.loading")}</span>
    </ul>
  );
}

/**
 * A space's content health, as a dialog over the space: pages that may be out of date,
 * links that lead nowhere, pages nothing points to, pages that repeat each other and pairs
 * worth comparing for contradictions. For the space's administrators; opened from the space
 * sidebar. The checks are listed on the left with what each found, and the one chosen is
 * shown on the right.
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
  const [previewPage, setPreviewPage] = useState<HealthPage | null>(null);
  const [comparePair, setComparePair] = useState<
    [HealthPage, HealthPage] | null
  >(null);
  const [rowsShown, setRowsShown] = useState({
    orphans: FIRST_ROWS,
    conflicts: FIRST_ROWS,
  });
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
  const total = health ? issueTotal(health) : null;

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
    conflicts: t("health.tabConflicts"),
  };

  return (
    <PreviewContext.Provider value={setPreviewPage}>
      <CompareContext.Provider value={setComparePair}>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!next) {
              setTab(null);
              setPreviewPage(null);
              setComparePair(null);
            }
            onOpenChange(next);
          }}
        >
          <DialogContent
            className="max-w-6xl p-6"
            title={
              <span className="flex items-center gap-2.5">
                <span className="bg-primary-subtle text-primary grid size-8 place-items-center rounded-md">
                  <HeartPulse className="size-4" aria-hidden />
                </span>
                <span className="text-lg">{t("health.title")}</span>
              </span>
            }
            description={t("health.description", { space: space.name })}
          >
            {failed ? (
              <div
                className="border-border rounded-lg border p-8 text-center"
                role="alert"
              >
                <p className="text-sm font-semibold">{t("health.loadError")}</p>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  {t("health.retry")}
                </Button>
              </div>
            ) : (
              // One height for every list, set by the screen rather than by what a list holds, so
              // moving between them does not make the dialog jump.
              <div className="border-border grid gap-5 border-t pt-5 sm:h-[min(44rem,calc(100vh-12rem))] sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-6">
                <aside className="sm:border-border min-w-0 sm:border-r sm:pr-5">
                  <p className="text-muted-foreground px-2.5 text-xs font-semibold tracking-[0.06em] uppercase">
                    {t("health.sectionsTitle")}
                  </p>
                  <div
                    role="tablist"
                    aria-label={t("health.sections")}
                    aria-orientation="vertical"
                    className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-col sm:overflow-visible sm:px-0 sm:pb-0"
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
                          title={t(`health.short_${id}`)}
                          onClick={() => setTab(id)}
                          className={cn(
                            "focus-visible:ring-ring flex h-9 shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none sm:w-full",
                            selected
                              ? "bg-surface-selected text-primary hover:bg-surface-hover font-semibold"
                              : "text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected font-medium",
                          )}
                        >
                          <Icon className="size-4 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">
                            {labels[id]}
                          </span>
                          {found === null ? (
                            <span className="bg-surface-sunken h-5 w-7 animate-pulse rounded-full" />
                          ) : (
                            <span
                              className={cn(
                                "min-w-7 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums",
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
                  <p className="border-border text-muted-foreground mt-4 hidden border-t px-2.5 pt-4 text-sm leading-6 sm:block">
                    {total === null
                      ? null
                      : total > 0
                        ? `${total} ${t("health.summaryIssues")}`
                        : t("health.summaryClear")}
                  </p>
                </aside>

                <div
                  role="tabpanel"
                  aria-label={labels[shownTab]}
                  className="flex min-h-0 min-w-0 flex-col gap-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0 flex-1 basis-80">
                      <h3 className="text-base font-semibold">
                        {labels[shownTab]}
                      </h3>
                      {health ? (
                        <p className="text-muted-foreground mt-1 max-w-3xl text-sm leading-6">
                          {t(`health.hint_${shownTab}`, {
                            months: Math.round(health.stale_days / 30),
                            recent: Math.round(health.recent_days / 30),
                          })}
                        </p>
                      ) : null}
                    </div>
                    {shownTab === "stale" ? (
                      <div
                        className="flex items-center gap-2.5"
                        role="group"
                        aria-label={t("health.staleFor")}
                      >
                        <span className="text-muted-foreground text-sm whitespace-nowrap">
                          {t("health.staleFor")}
                        </span>
                        <div className="bg-surface-sunken border-border flex gap-0.5 rounded-md border p-0.5">
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
                                "focus-visible:ring-ring h-7 cursor-pointer rounded px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                                staleDays === days
                                  ? "bg-surface text-primary shadow-sm"
                                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                              )}
                            >
                              {t("health.months", {
                                count: Math.round(days / 30),
                              })}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* The one part that scrolls: the panel keeps its height whatever the list holds. */}
                  <div
                    key={shownTab}
                    className="flex h-[60vh] min-h-0 flex-col gap-3 overflow-y-auto *:shrink-0 sm:h-auto sm:flex-1"
                  >
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
                                {health.orphans
                                  .slice(0, rowsShown.orphans)
                                  .map((page) => (
                                    <OrphanRow key={page.id} page={page} />
                                  ))}
                              </ul>
                              <ShowMore
                                shown={rowsShown.orphans}
                                total={health.orphans.length}
                                onMore={() =>
                                  setRowsShown((v) => ({
                                    ...v,
                                    orphans: v.orphans + FIRST_ROWS,
                                  }))
                                }
                              />
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
                                  />
                                ))}
                              </ul>
                            )}
                            {health.semantic ? null : (
                              <ListNote>{t("health.noSemantic")}</ListNote>
                            )}
                            <Capped
                              shown={health.duplicates.length}
                              total={health.duplicates_total}
                            />
                          </>
                        ) : null}

                        {shownTab === "conflicts" ? (
                          <>
                            {aiOn ? null : (
                              <ListNote>
                                {t("health.aiDisabledConflictNote")}
                              </ListNote>
                            )}
                            {health.conflicts.length === 0 ? (
                              <Empty
                                title={t("health.emptyConflicts")}
                                hint={t("health.emptyConflictsHint")}
                              />
                            ) : (
                              <ul className={LIST}>
                                {health.conflicts
                                  .slice(0, rowsShown.conflicts)
                                  .map((item) => (
                                    <ConflictRow
                                      key={item.id}
                                      item={item}
                                      space={space}
                                      aiOn={aiOn}
                                    />
                                  ))}
                              </ul>
                            )}
                            <ShowMore
                              shown={rowsShown.conflicts}
                              total={health.conflicts.length}
                              onMore={() =>
                                setRowsShown((v) => ({
                                  ...v,
                                  conflicts: v.conflicts + FIRST_ROWS,
                                }))
                              }
                            />
                            <Capped
                              shown={health.conflicts.length}
                              total={health.conflicts_total}
                            />
                          </>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            <ComparePagesDialog
              pair={comparePair}
              onClose={() => setComparePair(null)}
            />
            <PagePreviewDialog
              page={previewPage}
              onClose={() => setPreviewPage(null)}
              onNavigate={() => {
                setPreviewPage(null);
                onOpenChange(false);
              }}
            />
          </DialogContent>
        </Dialog>
      </CompareContext.Provider>
    </PreviewContext.Provider>
  );
}
