"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  Loader2,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  Users,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from "react";

import {
  POLICY_UPDATED,
  privacyPolicyCopy,
  type PolicySection,
} from "@/components/legal/privacy-policy-content";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** Pixels of slack so sub-pixel rounding never leaves the end unreachable. */
const END_TOLERANCE = 6;

/** Icons paired with the four summary highlights in `privacy-policy-content.ts`. */
const HIGHLIGHT_ICONS: ComponentType<{ className?: string }>[] = [
  Database,
  ShieldOff,
  Clock,
  UserCheck,
];

function clause(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * Policy list items follow a "Label: explanation" convention in both locales.
 * Emphasising the lead-in phrase makes dense lists much faster to scan.
 */
function PolicyListItem({ text }: { text: string }) {
  const colonIdx = text.indexOf(":");
  const hasLeadIn = colonIdx > 0 && colonIdx <= 48;
  return (
    <li className="relative pl-4 before:bg-border-strong before:absolute before:top-[0.625rem] before:left-0 before:size-1.5 before:rounded-full">
      {hasLeadIn ? (
        <>
          <span className="text-foreground font-medium">
            {text.slice(0, colonIdx + 1)}
          </span>
          {text.slice(colonIdx + 1)}
        </>
      ) : (
        text
      )}
    </li>
  );
}

function TocLinks({
  sections,
  activeId,
  onNavigate,
}: {
  sections: PolicySection[];
  activeId: string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  return (
    <ol className="space-y-0.5">
      {sections.map((section, index) => {
        const active = section.id === activeId;
        return (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              onClick={(event) => onNavigate(event, section.id)}
              aria-current={active ? "location" : undefined}
              className={cn(
                "focus-visible:ring-ring flex items-start gap-2.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] leading-5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                active
                  ? "bg-surface-selected text-primary font-medium"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
              )}
            >
              <span
                className={cn(
                  "mt-px shrink-0 font-mono text-[0.6875rem] tabular-nums",
                  active ? "text-primary" : "text-muted-foreground/70",
                )}
              >
                {clause(index)}
              </span>
              <span className="min-w-0">{section.title}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Blocking consent step shown at sign-in to an account that has not yet accepted
 * the personal-data policy. It cannot be dismissed: the only ways out are
 * "Accept" (enabled once the whole policy has been scrolled through) and
 * "Decline", which the caller treats as a refused sign-in.
 */
export function PrivacyConsentDialog({
  open,
  siteName,
  pending,
  onAccept,
  onDecline,
}: {
  open: boolean;
  siteName: string;
  pending: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t, locale } = useTranslation();
  const copy = useMemo(() => privacyPolicyCopy(locale, siteName), [locale, siteName]);
  const updated = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(new Date(`${POLICY_UPDATED}T00:00:00Z`)),
    [locale],
  );

  const [reachedEnd, setReachedEnd] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState(copy.sections[0]?.id ?? "");
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const syncScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= END_TOLERANCE) {
      setProgress(100);
      setReachedEnd(true);
    } else {
      const pct = Math.min(100, Math.max(0, Math.round((el.scrollTop / maxScroll) * 100)));
      setProgress(pct);
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - END_TOLERANCE) {
        // Latches: scrolling back up must not re-lock the button.
        setReachedEnd(true);
      }
    }

    // Track whichever section heading has most recently crossed near the top of the viewport.
    const containerTop = el.getBoundingClientRect().top;
    let current = copy.sections[0]?.id ?? "";
    for (const section of copy.sections) {
      const node = el.querySelector<HTMLElement>(`#${CSS.escape(section.id)}`);
      if (!node) continue;
      if (node.getBoundingClientRect().top - containerTop <= 96) {
        current = section.id;
      } else {
        break;
      }
    }
    setActiveId(current);
  }, [copy.sections]);

  /**
   * The policy's contents list uses `#section` links. Left alone, the router
   * treats each click as a navigation (loading bar, URL becomes `/login#...`),
   * so scroll the section into view inside this box instead.
   */
  const scrollToSection = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, sectionId: string) => {
      event.preventDefault();
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const target = scroller.querySelector<HTMLElement>(`#${CSS.escape(sectionId)}`);
      if (!target) return;
      const top =
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        16;
      scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      setActiveId(sectionId);
    },
    [],
  );

  // Each time the dialog opens, require a fresh read-through. A short policy
  // that fits without scrolling counts as already read.
  useEffect(() => {
    if (!open) {
      setReachedEnd(false);
      setProgress(0);
      setActiveId(copy.sections[0]?.id ?? "");
      return;
    }
    const frame = requestAnimationFrame(syncScrollState);
    return () => cancelAnimationFrame(frame);
  }, [open, syncScrollState, copy.sections]);

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          // Focus the dialog frame, not the scroll region, so no focus ring is
          // drawn on open. Keyboard users still Tab into the region to scroll it.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            "border-border bg-surface fixed top-1/2 left-1/2 z-50 flex h-[min(86vh,46rem)] w-[calc(100vw-2rem)] max-w-4xl",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border shadow-2xl outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
        >
          {/* Header */}
          <header className="bg-surface shrink-0 px-5 pt-4 pb-3.5 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div
                  className="bg-primary-subtle text-primary mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg"
                  aria-hidden="true"
                >
                  <ShieldCheck className="size-5" />
                </div>
                <div className="min-w-0">
                  <DialogPrimitive.Title className="text-foreground text-base font-semibold tracking-tight">
                    {t("auth.privacyConsentTitle")}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-muted-foreground mt-0.5 text-[0.8125rem] leading-5">
                    {t("auth.privacyConsentIntro", { siteName })}
                  </DialogPrimitive.Description>
                </div>
              </div>

              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:shrink-0 sm:justify-end sm:pt-0.5">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {copy.updatedLabel}:{" "}
                    <time dateTime={POLICY_UPDATED} className="text-foreground font-medium">
                      {updated}
                    </time>
                  </span>
                </span>
                <span className="bg-border hidden h-3 w-px sm:inline-block" aria-hidden="true" />
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>{copy.appliesTo}</span>
                </span>
              </div>
            </div>
          </header>

          {/* Thin reading progress bar */}
          <div className="bg-border/70 h-0.5 w-full shrink-0 overflow-hidden" aria-hidden="true">
            <div
              className={cn(
                "h-full transition-[width,background-color] duration-150",
                reachedEnd ? "bg-success" : "bg-primary",
              )}
              style={{ width: `${reachedEnd ? 100 : progress}%` }}
            />
          </div>

          {/* Body: fixed TOC rail on desktop + scrollable document canvas */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <nav
              aria-label={copy.tocLabel}
              className="border-border bg-surface-sunken/50 hidden w-56 shrink-0 flex-col border-r md:flex"
            >
              <p className="text-muted-foreground px-4 pt-4 pb-2 text-[0.6875rem] font-semibold tracking-[0.12em] uppercase">
                {copy.tocLabel}
              </p>
              <div className="flex-1 overflow-y-auto px-2.5 pb-4">
                <TocLinks
                  sections={copy.sections}
                  activeId={activeId}
                  onNavigate={scrollToSection}
                />
              </div>
            </nav>

            <div
              ref={scrollerRef}
              onScroll={syncScrollState}
              tabIndex={0}
              role="region"
              aria-label={t("auth.privacyConsentTitle")}
              data-testid="privacy-consent-scroll"
              className="bg-surface focus-visible:ring-ring flex-1 overflow-y-auto px-5 py-5 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset sm:px-7 sm:py-6"
            >
              {/* Narrow screens: collapsible contents list */}
              <details className="border-border bg-surface-sunken/40 group mb-5 rounded-lg border md:hidden">
                <summary className="hover:bg-surface-hover focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between rounded-lg px-3.5 py-2 text-xs font-semibold tracking-[0.1em] uppercase transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                  {copy.tocLabel}
                  <ChevronDown
                    className="text-muted-foreground size-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </summary>
                <div className="border-border border-t p-2">
                  <TocLinks
                    sections={copy.sections}
                    activeId={activeId}
                    onNavigate={scrollToSection}
                  />
                </div>
              </details>

              {/* At-a-glance summary grid */}
              <section aria-labelledby="consent-summary-title">
                <h2
                  id="consent-summary-title"
                  className="text-muted-foreground mb-2.5 text-[0.6875rem] font-semibold tracking-[0.12em] uppercase"
                >
                  {copy.summaryLabel}
                </h2>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {copy.highlights.map((highlight, index) => {
                    const Icon = HIGHLIGHT_ICONS[index] ?? ShieldCheck;
                    return (
                      <div
                        key={highlight.title}
                        className="border-border bg-surface-sunken/60 rounded-lg border p-3.5"
                      >
                        <div className="flex items-center gap-2">
                          <Icon
                            className="text-primary size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <h3 className="text-foreground text-sm font-medium">
                            {highlight.title}
                          </h3>
                        </div>
                        <p className="text-muted-foreground mt-1 text-[0.8125rem] leading-5">
                          {highlight.text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Full numbered clauses */}
              <div className="mt-6">
                {copy.sections.map((section, index) => (
                  <section
                    key={section.id}
                    id={section.id}
                    aria-labelledby={`consent-${section.id}-title`}
                    className="border-border/80 border-t py-5 first:pt-5"
                  >
                    <h2
                      id={`consent-${section.id}-title`}
                      className="text-foreground flex items-center gap-2.5 text-[0.9375rem] font-semibold tracking-tight"
                    >
                      <span
                        className="bg-surface-sunken text-muted-foreground border-border rounded border px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium tabular-nums"
                        aria-hidden="true"
                      >
                        {clause(index)}
                      </span>
                      <span>{section.title}</span>
                    </h2>

                    <div className="text-foreground/85 mt-3 space-y-3 text-sm leading-6">
                      {section.paragraphs?.map((text) => (
                        <p key={text}>{text}</p>
                      ))}
                      {section.items ? (
                        <ul className="space-y-2">
                          {section.items.map((item) => (
                            <PolicyListItem key={item} text={item} />
                          ))}
                        </ul>
                      ) : null}
                      {section.closing?.map((text) => (
                        <p
                          key={text}
                          className="border-primary bg-primary-subtle/50 text-foreground rounded-r-md border-l-2 px-3.5 py-2.5 text-[0.8125rem] leading-5 font-medium"
                        >
                          {text}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              {/* Legal basis footer */}
              <footer className="border-border text-muted-foreground border-t pt-4 pb-1 text-xs leading-5">
                <p>{copy.legalBasis}</p>
              </footer>
            </div>
          </div>

          {/* Sticky action footer */}
          <footer className="border-border bg-surface-sunken/60 flex shrink-0 flex-col gap-3 border-t px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p
              className={cn(
                "flex items-center gap-1.5 text-xs transition-colors duration-150",
                reachedEnd ? "text-success font-medium" : "text-muted-foreground",
              )}
              aria-live="polite"
            >
              {reachedEnd ? (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <ScrollText className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>
                {reachedEnd
                  ? t("auth.privacyConsentReady")
                  : t("auth.privacyConsentScrollHint")}
              </span>
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <Button type="button" variant="secondary" onClick={onDecline} disabled={pending}>
                {t("auth.privacyConsentDecline")}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={onAccept}
                disabled={!reachedEnd || pending}
              >
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {t("auth.privacyConsentAccept")}
              </Button>
            </div>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
