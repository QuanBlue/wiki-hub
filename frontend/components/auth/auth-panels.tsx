"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ContactAdminForm } from "@/components/auth/contact-admin-form";
import { LoginForm } from "@/components/auth/login-form";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export type AuthView = "login" | "contact";

/** How long the slide takes; the contact form is reset once it is off screen. */
const SLIDE_MS = 300;

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
    <div className="mb-7 flex flex-col items-center text-center lg:items-start lg:text-left">
      <div className="bg-primary-subtle text-primary hidden size-10 items-center justify-center rounded-lg lg:flex">
        <LogoMark className="size-5" />
      </div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-2xl font-semibold tracking-tight outline-none"
      >
        {title}
      </h2>
      <p className="text-muted-foreground mt-1.5 text-sm">{description}</p>
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
        "col-start-1 row-start-1 transition-[translate,opacity,visibility] duration-300 ease-out motion-reduce:transition-none",
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
}: {
  siteName: string;
  initialView?: AuthView;
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
    <div className="grid overflow-x-clip">
      <Pane active={view === "login"} offscreen="left">
        <PaneHeader
          headingRef={loginHeading}
          title={t("auth.welcomeBack")}
          description={t("auth.signInToContinue", { siteName })}
        />
        <LoginForm />
        <p className="text-muted-foreground mt-8 text-center text-xs">
          {t("auth.troubleSigningIn")}{" "}
          <button
            type="button"
            onClick={() => show("contact")}
            className="text-primary hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring cursor-pointer rounded px-1 py-0.5 font-medium transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {t("auth.contactAdminLink")}
          </button>
        </p>
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
          <div className="mt-6 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              className="text-primary"
              onClick={() => show("login")}
            >
              <ArrowLeft aria-hidden />
              {t("contactAdmin.backToSignIn")}
            </Button>
          </div>
        )}
      </Pane>
    </div>
  );
}
