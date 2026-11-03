import Link from "next/link";

import { ChevronDown } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/core";

import {
  POLICY_UPDATED,
  privacyPolicyCopy,
  type PolicySection,
} from "./privacy-policy-content";

/** "01", "02"... so the contents column lines up like a printed document. */
function clause(index: number): string {
  return String(index + 1).padStart(2, "0");
}

const tocLinkClass =
  "text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring " +
  "active:bg-surface-selected flex gap-3 rounded-md px-2.5 py-1.5 text-[0.8125rem] leading-5 " +
  "transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none";

function Contents({ sections }: { sections: PolicySection[] }) {
  return (
    <ol className="space-y-0.5">
      {sections.map((section, index) => (
        <li key={section.id}>
          <a href={`#${section.id}`} className={tocLinkClass}>
            <span className="text-muted-foreground/70 shrink-0 tabular-nums">
              {clause(index)}
            </span>
            {section.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** The personal-data notice, set as a formal document; the same signed in or out. */
export function PrivacyPolicy({
  locale,
  siteName,
  signedIn,
}: {
  locale: Locale;
  siteName: string;
  /** Account settings only exist for someone signed in. */
  signedIn: boolean;
}) {
  const copy = privacyPolicyCopy(locale, siteName);
  const updated = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${POLICY_UPDATED}T00:00:00Z`));

  return (
    <article className="mx-auto w-full max-w-6xl px-4 pt-10 pb-16 sm:px-8 sm:pt-14">
      <header className="max-w-[var(--wh-content-max)]">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
          {copy.eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-[2.125rem] sm:leading-tight">
          {copy.title}
        </h1>
        <p className="text-muted-foreground mt-3 text-[0.9375rem] leading-7 text-pretty">
          {copy.summary}
        </p>
      </header>

      <dl className="border-border sm:divide-border mt-8 grid border-y sm:grid-cols-2 sm:divide-x">
        <div className="py-3.5 sm:pr-6">
          <dt className="text-muted-foreground text-xs">{copy.updatedLabel}</dt>
          <dd className="mt-0.5 text-sm font-medium">
            <time dateTime={POLICY_UPDATED}>{updated}</time>
          </dd>
        </div>
        <div className="border-border border-t py-3.5 sm:border-t-0 sm:pl-6">
          <dt className="text-muted-foreground text-xs">{copy.appliesLabel}</dt>
          <dd className="mt-0.5 text-sm font-medium">{copy.appliesTo}</dd>
        </div>
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-14">
        <nav
          aria-label={copy.tocLabel}
          className="lg:sticky lg:top-[calc(var(--wh-topbar-height)+1.5rem)] lg:self-start"
        >
          {/* Narrow screens: folded away so the document starts straight after the title. */}
          <details className="border-border group rounded-lg border lg:hidden">
            <summary className="hover:bg-surface-hover focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              {copy.tocLabel}
              <ChevronDown
                className="text-muted-foreground size-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </summary>
            <div className="border-border border-t p-1.5">
              <Contents sections={copy.sections} />
            </div>
          </details>
          <div className="hidden lg:block">
            <p className="text-muted-foreground mb-2 px-2.5 text-xs font-semibold tracking-[0.14em] uppercase">
              {copy.tocLabel}
            </p>
            <Contents sections={copy.sections} />
          </div>
        </nav>

        <div className="max-w-[var(--wh-content-max)] min-w-0">
          <section
            aria-labelledby="summary-title"
            className="border-border bg-surface-sunken/60 rounded-lg border"
          >
            <h2
              id="summary-title"
              className="border-border border-b px-5 py-3 text-xs font-semibold tracking-[0.14em] uppercase"
            >
              {copy.summaryLabel}
            </h2>
            <dl className="divide-border divide-y">
              {copy.highlights.map((highlight) => (
                <div
                  key={highlight.title}
                  className="grid gap-1 px-5 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4"
                >
                  <dt className="text-sm font-medium">{highlight.title}</dt>
                  <dd className="text-muted-foreground text-sm leading-6">
                    {highlight.text}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {copy.sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className="border-border mt-10 scroll-mt-[calc(var(--wh-topbar-height)+1.5rem)] border-t pt-8"
            >
              <h2
                id={`${section.id}-title`}
                className="flex items-baseline gap-3 text-lg font-semibold tracking-tight"
              >
                <span
                  className="text-muted-foreground text-sm font-medium tabular-nums"
                  aria-hidden="true"
                >
                  {clause(index)}
                </span>
                {section.title}
              </h2>

              <div className="text-foreground/90 mt-4 space-y-3.5 text-[0.9375rem] leading-7">
                {section.paragraphs?.map((text) => (
                  <p key={text}>{text}</p>
                ))}
                {section.items ? (
                  <ul className="space-y-2">
                    {section.items.map((item) => (
                      <li
                        key={item}
                        className="before:text-muted-foreground relative pl-5 before:absolute before:left-0 before:content-['–']"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {section.closing?.map((text) => (
                  <p
                    key={text}
                    className="border-primary text-foreground border-l-2 pl-4 font-medium"
                  >
                    {text}
                  </p>
                ))}
              </div>

              {section.id === "rights" ? (
                <div className="mt-6 flex flex-wrap gap-2">
                  <Link
                    href="/login?view=contact"
                    className={buttonVariants({ variant: "primary" })}
                  >
                    {copy.contactAction}
                  </Link>
                  {signedIn ? (
                    <Link
                      href="/account"
                      className={buttonVariants({ variant: "secondary" })}
                    >
                      {copy.accountAction}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </section>
          ))}

          <footer className="border-border text-muted-foreground mt-12 border-t pt-6 text-xs leading-6">
            <p>{copy.legalBasis}</p>
            <p>
              {copy.updatedLabel}:{" "}
              <time dateTime={POLICY_UPDATED}>{updated}</time>
            </p>
          </footer>
        </div>
      </div>
    </article>
  );
}
