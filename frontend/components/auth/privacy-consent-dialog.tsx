"use client";

import { Loader2, ScrollText } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { PrivacyPolicy } from "@/components/legal/privacy-policy";
import { useTranslation } from "@/lib/i18n/context";

/** Pixels of slack so sub-pixel rounding never leaves the end unreachable. */
const END_TOLERANCE = 6;

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
  const [reachedEnd, setReachedEnd] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const check = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - END_TOLERANCE) {
      // Latches: scrolling back up must not re-lock the button.
      setReachedEnd(true);
    }
  }, []);

  /**
   * The policy's contents list uses `#section` links. Left alone, the router
   * treats each click as a navigation (loading bar, URL becomes `/login#...`),
   * so scroll the section into view inside this box instead.
   */
  function handleContentsClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    const scroller = scrollerRef.current;
    if (!link || !scroller) return;
    event.preventDefault();
    const target = scroller.querySelector<HTMLElement>(
      `#${CSS.escape(link.getAttribute("href")!.slice(1))}`,
    );
    if (!target) return;
    const top =
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top, behavior: "smooth" });
  }

  // Each time the dialog opens, require a fresh read-through. A short policy
  // that fits without scrolling counts as already read.
  useEffect(() => {
    if (!open) {
      setReachedEnd(false);
      return;
    }
    const frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [open, check]);

  return (
    <Dialog open={open}>
      <DialogContent
        title={t("auth.privacyConsentTitle")}
        description={t("auth.privacyConsentIntro", { siteName })}
        hideClose
        className="flex max-w-5xl flex-col"
        // Focus the dialog frame, not the scroll region, so no focus ring is
        // drawn on open. Keyboard users still Tab into the region to scroll it.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div
          ref={scrollerRef}
          onScroll={check}
          onClick={handleContentsClick}
          tabIndex={0}
          role="region"
          aria-label={t("auth.privacyConsentTitle")}
          data-testid="privacy-consent-scroll"
          className="border-border bg-surface-sunken focus-visible:ring-ring max-h-[50vh] overflow-y-auto rounded-md border focus-visible:ring-2 focus-visible:outline-none"
        >
          <PrivacyPolicy locale={locale} siteName={siteName} signedIn={false} />
        </div>

        <p
          className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs"
          aria-live="polite"
        >
          <ScrollText className="size-3.5 shrink-0" aria-hidden="true" />
          {reachedEnd
            ? t("auth.privacyConsentReady")
            : t("auth.privacyConsentScrollHint")}
        </p>

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
