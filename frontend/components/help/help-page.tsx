"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  LayoutGrid,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { openChat } from "@/lib/ai-chat";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

import { sectionsEn } from "./help-content.en";
import { sectionsVi } from "./help-content.vi";
import { HELP_CATEGORIES, START_HERE, categoryInfo, guideHref } from "./help-data";
import { HelpSearch } from "./help-search";
import type { HelpCategory, HelpSection } from "./help-ui";

export type { HelpCategory };

function useSections(): HelpSection[] {
  const { locale } = useTranslation();
  return locale === "vi" ? sectionsVi : sectionsEn;
}

/** Every guide, topic by topic, in the order the topics are listed: what "next" walks through. */
function inReadingOrder(sections: HelpSection[]): HelpSection[] {
  return HELP_CATEGORIES.flatMap((category) =>
    sections.filter((section) => section.category === category.key),
  );
}

function GuideCount({ count }: { count: number }) {
  const { t } = useTranslation();
  return <>{t(count === 1 ? "help.guideCountOne" : "help.guideCountOther", { count })}</>;
}

// ------------------------------------------------------------------------------ the home

export function HelpPage() {
  const { t } = useTranslation();
  const sections = useSections();
  const startHere = START_HERE.map((id) => sections.find((section) => section.id === id)).filter(
    (section): section is HelpSection => section !== undefined,
  );
  const suggestions = [1, 2, 3, 4].map((n) => t(`help.suggestion${n}`));

  return (
    <div className="pb-16">
      <section className="border-border bg-surface-sunken border-b">
        <div className="mx-auto max-w-3xl px-5 pt-12 pb-10 text-center sm:px-8 sm:pt-16">
          <p className="text-primary inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.12em] uppercase">
            <BookOpen className="size-4" aria-hidden />
            {t("help.eyebrow")}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("help.heroTitle")}
          </h1>
          <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-base leading-7">
            {t("help.heroSubtitle")}
          </p>
          <div className="mx-auto mt-7 max-w-2xl">
            <HelpSearch sections={sections} suggestions={suggestions} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-12 px-5 pt-10 sm:px-8">
        <section aria-labelledby="help-start-here">
          <h2 id="help-start-here" className="text-lg font-semibold tracking-tight">
            {t("help.startHereTitle")}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("help.startHereSubtitle")}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {startHere.map((section) => {
              const Icon = categoryInfo(section.category).icon;
              return (
                <Link
                  key={section.id}
                  href={guideHref(section)}
                  className="border-border bg-surface hover:border-primary/50 hover:bg-surface-hover focus-visible:ring-ring group flex flex-col rounded-xl border p-4 transition-[background-color,border-color,box-shadow] duration-150 hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="bg-primary-subtle text-primary grid size-9 place-items-center rounded-lg">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="mt-3 font-medium">{section.title}</span>
                  <span className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-5">
                    {section.description}
                  </span>
                  <span className="text-primary mt-auto inline-flex items-center gap-1 pt-3 text-xs font-medium">
                    {t("help.readGuide")}
                    <ArrowRight
                      className="size-3.5 transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="help-browse">
          <h2 id="help-browse" className="text-lg font-semibold tracking-tight">
            {t("help.browseTitle")}
          </h2>
          <nav
            aria-label="Help topics"
            className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {HELP_CATEGORIES.map((category) => {
              const Icon = category.icon;
              const guides = sections.filter((section) => section.category === category.key);
              return (
                <div
                  key={category.key}
                  className="border-border bg-surface flex flex-col rounded-xl border p-5"
                >
                  <Link
                    href={`/help/${category.slug}`}
                    className="focus-visible:ring-ring group -m-1 flex items-start gap-3 rounded-lg p-1 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span className="bg-primary-subtle text-primary grid size-10 shrink-0 place-items-center rounded-lg">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="group-hover:text-primary block font-semibold transition-colors duration-150">
                        {t(`help.${category.dict}Title`)}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        <GuideCount count={guides.length} />
                      </span>
                    </span>
                  </Link>
                  <p className="text-muted-foreground mt-3 text-sm leading-5">
                    {t(`help.${category.dict}Description`)}
                  </p>
                  <ul className="mt-3 space-y-0.5">
                    {guides.slice(0, 4).map((section) => (
                      <li key={section.id}>
                        <Link
                          href={guideHref(section)}
                          className="text-foreground/90 hover:bg-surface-hover hover:text-primary focus-visible:ring-ring -mx-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{section.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {guides.length > 4 ? (
                    <Link
                      href={`/help/${category.slug}`}
                      className="text-primary focus-visible:ring-ring mt-auto inline-flex items-center gap-1 self-start rounded pt-3 text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {t("help.viewAllGuides", { count: guides.length })}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </nav>
        </section>

        <StillStuck />
      </div>
    </div>
  );
}

function StillStuck() {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("help.stillStuckTitle")}
      className="border-border bg-surface-sunken flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center"
    >
      <span className="bg-primary text-primary-foreground grid size-10 shrink-0 place-items-center rounded-lg">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">{t("help.stillStuckTitle")}</h2>
        <p className="text-muted-foreground mt-0.5 text-sm leading-6">
          {t("help.stillStuckBody")}
        </p>
      </div>
      <Button type="button" variant="secondary" onClick={() => openChat()}>
        <MessageCircle />
        {t("help.openChat")}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------- a topic, a guide

function useGuideFromHash(guides: HelpSection[]): [string, (id: string) => void] {
  const [activeId, setActiveId] = useState(guides[0]?.id ?? "");
  useEffect(() => {
    const read = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      setActiveId(guides.some((guide) => guide.id === id) ? id : (guides[0]?.id ?? ""));
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [guides]);
  return [activeId, setActiveId];
}

export function HelpDetailPage({ topic }: { topic: HelpCategory }) {
  const { t } = useTranslation();
  const sections = useSections();
  const category = categoryInfo(topic);
  const TopicIcon = category.icon;
  const topicGuides = useMemo(
    () => sections.filter((section) => section.category === topic),
    [sections, topic],
  );
  const [activeId] = useGuideFromHash(topicGuides);
  const [navOpen, setNavOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([topic]));

  const guide = topicGuides.find((section) => section.id === activeId) ?? topicGuides[0]!;
  const ordered = inReadingOrder(sections);
  const at = ordered.findIndex((section) => section.id === guide.id);
  const previous = at > 0 ? ordered[at - 1] : undefined;
  const next = at >= 0 && at < ordered.length - 1 ? ordered[at + 1] : undefined;
  const position = topicGuides.findIndex((section) => section.id === guide.id) + 1;

  const article = useRef<HTMLElement>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    // A guide opened from the navigation starts at its top; the first one is where the page is.
    if (shown.current !== null && shown.current !== guide.id) {
      setNavOpen(false);
      article.current?.scrollIntoView?.({ block: "start" });
    }
    shown.current = guide.id;
  }, [guide.id]);

  const toggle = (key: string) =>
    setExpanded((current) => {
      const copy = new Set(current);
      if (copy.has(key)) copy.delete(key);
      else copy.add(key);
      return copy;
    });

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 pt-6 pb-16 sm:px-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="min-w-0">
        {/* Sticks exactly where it starts (top bar + the page's padding), so it never moves; only
            the list of guides scrolls, never the search, whose results must not be cut off. */}
        <div className="space-y-3 lg:sticky lg:top-[calc(var(--wh-topbar-height)+4rem)]">
          <HelpSearch sections={sections} variant="compact" />
          <button
            type="button"
            onClick={() => setNavOpen((open) => !open)}
            aria-expanded={navOpen}
            className="border-border hover:bg-surface-hover focus-visible:ring-ring flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none lg:hidden"
          >
            {t("help.browseGuides")}
            <ChevronDown
              className={cn("size-4 transition-transform duration-150", navOpen && "rotate-180")}
              aria-hidden
            />
          </button>
          <nav
            aria-label="Guide navigation"
            className={cn(
              "space-y-1 text-sm lg:max-h-[calc(100vh-var(--wh-topbar-height)-14rem)] lg:overflow-y-auto lg:pr-1",
              navOpen ? "block" : "hidden lg:block",
            )}
          >
            <Link
              href="/help"
              className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <LayoutGrid className="size-4" aria-hidden />
              {t("help.allTopics")}
            </Link>
            {HELP_CATEGORIES.map((item) => {
              const Icon = item.icon;
              const open = expanded.has(item.key);
              const guides = sections.filter((section) => section.category === item.key);
              return (
                <div key={item.key}>
                  <button
                    type="button"
                    onClick={() => toggle(item.key)}
                    aria-expanded={open}
                    className={cn(
                      "hover:bg-surface-hover focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                      item.key === topic ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{t(`help.${item.dict}Title`)}</span>
                    <ChevronRight
                      className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")}
                      aria-hidden
                    />
                  </button>
                  {open ? (
                    <ul className="border-border mt-0.5 mb-1 ml-4 space-y-0.5 border-l pl-2">
                      {guides.map((section) => {
                        const current = section.id === guide.id;
                        const className = cn(
                          "focus-visible:ring-ring block rounded-md px-2 py-1.5 leading-5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                          current
                            ? "bg-primary-subtle text-primary font-medium"
                            : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                        );
                        return (
                          <li key={section.id}>
                            {item.key === topic ? (
                              <a
                                href={`#${section.id}`}
                                aria-current={current ? "page" : undefined}
                                className={className}
                              >
                                {section.title}
                              </a>
                            ) : (
                              <Link href={guideHref(section)} className={className}>
                                {section.title}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </nav>
        </div>
      </aside>

      <article
        id={guide.id}
        ref={article}
        className="max-w-(--wh-content-max) min-w-0 scroll-mt-20"
      >
        <nav aria-label="Breadcrumb" className="text-sm">
          <ol className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-1.5">
            <li>
              <Link
                href="/help"
                className="text-primary focus-visible:ring-ring rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {t("help.breadcrumbHelp")}
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <a
                href={`#${topicGuides[0]!.id}`}
                className="hover:text-foreground focus-visible:ring-ring rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {t(`help.${category.dict}Title`)}
              </a>
            </li>
            <li aria-hidden>/</li>
            <li className="text-foreground min-w-0 truncate" aria-current="page">
              {guide.title}
            </li>
          </ol>
        </nav>

        <header className="border-border mt-5 border-b pb-6">
          <p className="text-primary flex items-center gap-1.5 text-xs font-semibold tracking-[0.12em] uppercase">
            <TopicIcon className="size-4" aria-hidden />
            {t(`help.${category.dict}Title`)}
            <span className="text-muted-foreground font-normal tracking-normal normal-case">
              · {t("help.guideOf", { n: position, total: topicGuides.length })}
            </span>
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{guide.title}</h1>
          <p className="text-muted-foreground mt-2 text-base leading-7">{guide.description}</p>
          <p className="text-muted-foreground sr-only">
            <GuideCount count={topicGuides.length} />
          </p>
        </header>

        <div className="text-foreground/85 mt-6 space-y-3 text-[15px] leading-7">{guide.body}</div>

        <nav
          aria-label={t("help.pagerAria")}
          className="border-border mt-10 flex flex-wrap items-stretch justify-between gap-3 border-t pt-5"
        >
          {previous ? (
            <Pager section={previous} direction="previous" sameTopic={previous.category === topic} />
          ) : (
            <span />
          )}
          {next ? (
            <Pager section={next} direction="next" sameTopic={next.category === topic} />
          ) : null}
        </nav>

        <div className="mt-8">
          <StillStuck />
        </div>
        <div className="text-muted-foreground mt-6 flex gap-2 text-xs leading-5">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p>
            {t("help.permissionsFooterNote")} {t("help.needMoreDetailBody")}
          </p>
        </div>
      </article>
    </div>
  );
}

function Pager({
  section,
  direction,
  sameTopic,
}: {
  section: HelpSection;
  direction: "previous" | "next";
  sameTopic: boolean;
}) {
  const { t } = useTranslation();
  const className = cn(
    "border-border hover:border-primary/50 hover:bg-surface-hover focus-visible:ring-ring group flex max-w-full flex-col rounded-lg border px-3 py-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none sm:max-w-[48%]",
    direction === "next" && "ml-auto items-end text-right",
  );
  const content = (
    <>
      <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
        {direction === "previous" ? <ArrowLeft className="size-3.5" aria-hidden /> : null}
        {t(direction === "previous" ? "help.previous" : "help.next")}
        {direction === "next" ? <ArrowRight className="size-3.5" aria-hidden /> : null}
      </span>
      <span className="group-hover:text-primary truncate text-sm font-medium transition-colors duration-150">
        {section.title}
      </span>
    </>
  );
  return sameTopic ? (
    <a href={`#${section.id}`} className={className}>
      {content}
    </a>
  ) : (
    <Link href={guideHref(section)} className={className}>
      {content}
    </Link>
  );
}
