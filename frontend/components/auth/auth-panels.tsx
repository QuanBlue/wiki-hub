"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ContactAdminForm } from "@/components/auth/contact-admin-form";
import { LoginForm } from "@/components/auth/login-form";
import { LogoMark } from "@/components/brand/logo";
import { SystemAnnouncementBanner } from "@/components/layout/system-announcement-banner";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { SystemAnnouncement } from "@/types/api";

export type AuthView = "login" | "contact";

/** How long the slide takes; the contact form is reset once it is off screen. */
const SLIDE_MS = 300;

function BrandHeader({ siteName }: { siteName: string }) {
  return (
    <div className="border-border/60 mb-4 sm:mb-4.5 flex w-full items-center justify-between border-b pb-3 sm:pb-3.5 [@media(max-height:800px)]:mb-3 [@media(max-height:800px)]:pb-2.5">
      <div className="flex items-center gap-2.5 sm:gap-3">
        <LogoMark className="size-8 sm:size-8.5 rounded-lg sm:rounded-xl shadow-xs" />
        <div className="min-w-0">
          <p className="text-foreground truncate text-sm font-semibold tracking-tight leading-tight">
            {siteName}
          </p>
          <p className="text-muted-foreground mt-0.5 text-[11px] font-medium leading-tight">
            Enterprise Workspace
          </p>
        </div>
      </div>
      <div className="border-border/80 bg-surface-sunken text-muted-foreground shadow-2xs inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 sm:py-1 text-[11px] font-medium">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        <span>Secure Access</span>
      </div>
    </div>
  );
}

function PaneHeader({
  title,
  description,
  headingRef,
}: {
  title: string;
  description: string;
  headingRef: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="mb-4 sm:mb-5 [@media(max-height:800px)]:mb-3 flex flex-col items-start text-left">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-foreground text-xl sm:text-2xl font-bold tracking-tight outline-none"
      >
        {title}
      </h2>
      <p className="text-muted-foreground mt-1 text-xs sm:text-sm leading-relaxed">{description}</p>
    </div>
  );
}

/**
 * One slot in the two-pane stack. Both panes share a single grid cell, so the
 * container is always as tall as the taller one and nothing jumps when they
 * swap. The hidden pane is `inert` (no focus, no clicks, not read out) and
 * `invisible` once it has slid away.
 */
function Pane({
  active,
  offscreen,
  children,
}: {
  active: boolean;
  /** Where the pane waits while it is not shown. */
  offscreen: "left" | "right";
  children: ReactNode;
}) {
  return (
    <div
      inert={!active}
      aria-hidden={!active}
      className={cn(
        "col-start-1 row-start-1 w-full transition-[translate,opacity,visibility] duration-300 ease-out motion-reduce:transition-none",
        active
          ? "visible translate-x-0 opacity-100"
          : cn(
              "invisible opacity-0",
              offscreen === "left" ? "-translate-x-full" : "translate-x-full",
            ),
      )}
    >
      {children}
    </div>
  );
}

/**
 * The right-hand side of the sign-in page: the sign-in form, and the "contact
 * an administrator" form that slides in over it (and back) instead of
 * navigating away.
 */
export function AuthPanels({
  siteName,
  initialView = "login",
  announcement = null,
}: {
  siteName: string;
  initialView?: AuthView;
  announcement?: SystemAnnouncement | null;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<AuthView>(initialView);
  // Bumped after the contact form has slid away, so it comes back empty.
  const [contactKey, setContactKey] = useState(0);
  // The contact form is showing its "Request sent" screen, which brings its own
  // heading and back button.
  const [sent, setSent] = useState(false);
  const loginHeading = useRef<HTMLHeadingElement>(null);
  const contactHeading = useRef<HTMLHeadingElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = useRef(false);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  // After a switch, move focus to the new pane's title so keyboard and screen
  // reader users land in it rather than on a control that has just left.
  useEffect(() => {
    if (!changed.current) return;
    (view === "contact" ? contactHeading : loginHeading).current?.focus({
      preventScroll: true,
    });
  }, [view]);

  const show = useCallback((next: AuthView) => {
    changed.current = true;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setView(next);
    // Keep the address shareable / reload-safe without adding history entries.
    try {
      const url = new URL(window.location.href);
      if (next === "contact") url.searchParams.set("view", "contact");
      else url.searchParams.delete("view");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // Not worth failing the switch over.
    }
    if (next === "login") {
      resetTimer.current = setTimeout(
        () => {
          setContactKey((key) => key + 1);
          setSent(false);
        },
        SLIDE_MS,
      );
    }
  }, []);

  return (
    <div>
      <BrandHeader siteName={siteName} />

      <div className="grid overflow-x-clip">
        <Pane active={view === "login"} offscreen="left">
          <div className="flex h-full flex-col justify-between">
            <div>
              <PaneHeader
                headingRef={loginHeading}
                title={t("auth.welcomeBack")}
                description={t("auth.signInToContinue", { siteName })}
              />
              <LoginForm />
              <div className="border-border/60 mt-4.5 border-t pt-3 sm:pt-3.5 text-center">
                <p className="text-muted-foreground text-xs">
                  {t("auth.troubleSigningIn")}{" "}
                  <button
                    type="button"
                    onClick={() => show("contact")}
                    className="text-primary hover:text-primary-hover focus-visible:ring-ring cursor-pointer rounded font-medium transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {t("auth.contactAdminLink")}
                  </button>
                </p>
              </div>
            </div>

            {announcement ? (
              <div className="mt-auto pt-3 [@media(max-height:800px)]:pt-2.5">
                <SystemAnnouncementBanner
                  announcement={announcement}
                  allowDismiss={false}
                  className="rounded-xl border shadow-2xs sm:px-4 py-2 sm:py-2.5 text-xs"
                />
              </div>
            ) : null}
          </div>
        </Pane>

        <Pane active={view === "contact"} offscreen="right">
          {sent ? null : (
            <PaneHeader
              headingRef={contactHeading}
              title={t("contactAdmin.title")}
              description={t("contactAdmin.description")}
            />
          )}
          <ContactAdminForm
            key={contactKey}
            onBackToSignIn={() => show("login")}
            onSentChange={setSent}
          />
          {sent ? null : (
            <div className="mt-3.5 flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-primary hover:text-primary-hover h-8 gap-1.5 text-xs font-medium"
                onClick={() => show("login")}
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                {t("contactAdmin.backToSignIn")}
              </Button>
            </div>
          )}
        </Pane>
      </div>
    </div>
  );
}
