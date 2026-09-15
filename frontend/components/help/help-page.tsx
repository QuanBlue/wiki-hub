"use client";

import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  FileText,
  FolderKanban,
  KeyRound,
  Paperclip,
  Search,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

import { sectionsEn } from "./help-content.en";
import { sectionsVi } from "./help-content.vi";
import type { CategoryDefinition, HelpCategory } from "./help-ui";

export type { HelpCategory };

const categories: CategoryDefinition[] = [
  { title: "Workspace", icon: FolderKanban },
  { title: "Writing", icon: FileText },
  { title: "Attachments & Media", icon: Paperclip },
  { title: "Account", icon: KeyRound },
  { title: "Administration", icon: Settings2 },
];

/** Maps the fixed, English internal category key (also the routing/filter
 * key - see app/help/[topic]/page.tsx) to its dictionary key segment. Only
 * the displayed label/description are localized; the key itself never
 * changes, so URLs and section-to-category filtering stay stable across
 * languages. */
const CATEGORY_DICT_KEY: Record<HelpCategory, string> = {
  Workspace: "categoryWorkspace",
  Writing: "categoryWriting",
  "Attachments & Media": "categoryAttachments",
  Account: "categoryAccount",
  Administration: "categoryAdministration",
};

function jumpToSection(id: string) {
  window.requestAnimationFrame(() =>
    document.getElementById(`${id}-heading`)?.focus(),
  );
}

const topicSlugs: Record<HelpCategory, string> = {
  Workspace: "workspace",
  Writing: "writing",
  "Attachments & Media": "attachments",
  Account: "account",
  Administration: "administration",
};

export function HelpPage() {
  const { t, locale } = useTranslation();
  const sections = locale === "vi" ? sectionsVi : sectionsEn;
  const categoryLabel = (title: HelpCategory) =>
    t(`help.${CATEGORY_DICT_KEY[title]}Title`);
  const categoryDescription = (title: HelpCategory) =>
    t(`help.${CATEGORY_DICT_KEY[title]}Description`);

  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const matchingTopics = useMemo(
    () =>
      normalizedQuery
        ? categories.filter((category) =>
            [
              categoryLabel(category.title),
              categoryDescription(category.title),
              ...sections
                .filter((section) => section.category === category.title)
                .flatMap((section) => [
                  section.title,
                  section.description,
                  ...section.keywords,
                ]),
            ]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : categories,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalizedQuery, locale],
  );

  return (
    <div className="pb-12">
      <section className="border-border bg-surface-sunken border-b">
        <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
          <div className="mx-auto max-w-2xl text-center">
            <div className="bg-primary-subtle text-primary mx-auto flex size-11 items-center justify-center rounded-lg">
              <BookOpen className="size-5" aria-hidden />
            </div>
            <p className="text-primary mt-3 text-xs font-semibold tracking-[0.12em] uppercase">
              {t("help.eyebrow")}
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">
              {t("help.heroTitle")}
            </h1>
            <p className="text-muted-foreground mx-auto mt-2 max-w-xl text-base leading-7">
              {t("help.heroSubtitleIndex")}
            </p>
            <div className="relative mx-auto mt-5 max-w-xl">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("help.searchPlaceholderIndex")}
                aria-label={t("help.searchAriaIndex")}
                className="bg-surface h-12 rounded-full pr-5 pl-12 text-base shadow-sm"
              />
            </div>
          </div>
        </div>
      </section>

      <nav
        className="grid w-full gap-3 py-8 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Help topics"
      >
        {matchingTopics.map((topic) => {
          const Icon = topic.icon;
          const guideCount = sections.filter(
            (section) => section.category === topic.title,
          ).length;
          return (
            <Link
              key={topic.title}
              href={`/help/${topicSlugs[topic.title]}`}
              className="border-border bg-surface hover:bg-surface-hover hover:border-border-strong focus-visible:ring-ring group flex min-h-44 flex-col rounded-lg border p-5 transition-[color,background-color,border-color,box-shadow] duration-150 hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <div className="flex w-full items-center justify-between gap-3">
                <span className="bg-primary-subtle text-primary flex size-10 shrink-0 items-center justify-center rounded-md">
                  <Icon className="size-5" aria-hidden />
                </span>
                <ChevronRight
                  className="text-muted-foreground group-hover:text-primary size-4 transition-[color,transform] duration-150 motion-safe:group-hover:translate-x-0.5"
                  aria-hidden
                />
              </div>
              <div className="mt-4 w-full">
                <h2 className="font-semibold">{categoryLabel(topic.title)}</h2>
                <p className="text-muted-foreground mt-1 text-sm leading-5">
                  {categoryDescription(topic.title)}
                </p>
              </div>
              <p className="text-primary mt-auto pt-4 text-xs font-medium">
                {t(guideCount === 1 ? "help.guideCountOne" : "help.guideCountOther", {
                  count: guideCount,
                })}
              </p>
            </Link>
          );
        })}
      </nav>

      {matchingTopics.length === 0 ? (
        <p
          className="text-muted-foreground mx-auto max-w-6xl px-5 text-center text-sm sm:px-8"
          role="status"
        >
          {t("help.noTopicMatch", { query })}
        </p>
      ) : null}
    </div>
  );
}

export function HelpDetailPage({ topic }: { topic: HelpCategory }) {
  const { t, locale } = useTranslation();
  const sections = locale === "vi" ? sectionsVi : sectionsEn;
  const categoryLabel = (title: HelpCategory) =>
    t(`help.${CATEGORY_DICT_KEY[title]}Title`);
  const categoryDescription = (title: HelpCategory) =>
    t(`help.${CATEGORY_DICT_KEY[title]}Description`);

  const topicDefinition = categories.find(
    (category) => category.title === topic,
  )!;
  const TopicIcon = topicDefinition.icon;
  const topicSections = useMemo(
    () => sections.filter((section) => section.category === topic),
    [sections, topic],
  );
  const [activeId, setActiveId] = useState(topicSections[0]!.id);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const matchingSections = useMemo(
    () =>
      normalizedQuery
        ? topicSections.filter((section) =>
            [section.title, section.description, ...section.keywords]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : topicSections,
    [normalizedQuery, topicSections],
  );

  useEffect(() => setActiveId(topicSections[0]!.id), [topicSections]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (left, right) =>
              left.boundingClientRect.top - right.boundingClientRect.top,
          )[0];
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: "-18% 0px -72% 0px", threshold: 0 },
    );
    const targets = topicSections
      .map((section) => document.getElementById(section.id))
      .filter((target): target is HTMLElement => target !== null);
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [topicSections]);

  return (
    <div className="pb-12">
      <section className="border-border bg-surface-sunken hidden border-b">
        <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
          <div className="mx-auto max-w-2xl text-center">
            <div className="bg-primary-subtle text-primary mx-auto flex size-11 items-center justify-center rounded-lg">
              <BookOpen className="size-5" aria-hidden />
            </div>
            <p className="text-primary mt-3 text-xs font-semibold tracking-[0.12em] uppercase">
              {t("help.eyebrow")}
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">
              {t("help.heroTitle")}
            </h1>
            <p className="text-muted-foreground mx-auto mt-2 max-w-xl text-base leading-7">
              {t("help.heroSubtitleDetail")}
            </p>
            <div className="relative mx-auto mt-5 max-w-xl">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("help.searchPlaceholderDetail")}
                aria-label={t("help.searchAriaDetail")}
                className="bg-surface h-12 rounded-full pr-5 pl-12 text-base shadow-sm"
              />
            </div>
          </div>
        </div>
      </section>

      <section
        className="mx-auto hidden max-w-6xl px-5 py-10 sm:px-8 sm:py-12"
        aria-labelledby="browse-guides"
      >
        <div className="flex items-end justify-between gap-5">
          <div>
            <p className="text-primary text-xs font-semibold tracking-[0.12em] uppercase">
              {t("help.browseGuidesEyebrow")}
            </p>
            <h2
              id="browse-guides"
              className="mt-1 text-2xl font-semibold tracking-tight"
            >
              {t("help.browseGuidesTitle")}
            </h2>
          </div>
          {normalizedQuery ? (
            <p className="text-muted-foreground text-sm" role="status">
              {t(
                matchingSections.length === 1
                  ? "help.resultsCountOne"
                  : "help.resultsCountOther",
                { count: matchingSections.length },
              )}
            </p>
          ) : null}
        </div>
        {matchingSections.length ? (
          <div className="mt-7 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((category) => {
              const Icon = category.icon;
              const categorySections = matchingSections.filter(
                (section) => section.category === category.title,
              );
              if (!categorySections.length) return null;
              return (
                <section
                  key={category.title}
                  aria-labelledby={`${category.title}-guides`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="bg-primary-subtle text-primary flex size-8 items-center justify-center rounded-md">
                      <Icon className="size-4" aria-hidden />
                    </div>
                    <h3
                      id={`${category.title}-guides`}
                      className="font-semibold"
                    >
                      {categoryLabel(category.title)}
                    </h3>
                  </div>
                  <p className="text-muted-foreground mt-2 text-sm leading-5">
                    {categoryDescription(category.title)}
                  </p>
                  <ul className="mt-4 space-y-1">
                    {categorySections.map((section) => (
                      <li key={section.id}>
                        <a
                          href={`#${section.id}`}
                          onClick={() => jumpToSection(section.id)}
                          className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <ChevronRight
                            className="text-primary size-3.5 shrink-0"
                            aria-hidden
                          />
                          <span>{section.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="border-border bg-surface-sunken mt-7 rounded-lg border px-5 py-8 text-center">
            <p className="font-medium">{t("help.noGuidesFound", { query })}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("help.tryBroaderTerm")}
            </p>
          </div>
        )}
      </section>

      <section
        className="grid w-full gap-10 px-5 pt-4 pb-12 sm:px-8 xl:grid-cols-[13rem_minmax(0,var(--wh-content-max))]"
        aria-label="Help documentation"
      >
        <nav aria-label="Breadcrumb" className="text-sm xl:col-span-2">
          <ol className="flex min-w-0 items-center whitespace-nowrap">
            <li>
              <Link
                href="/help"
                className="text-primary focus-visible:ring-ring rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {t("help.breadcrumbHelp")}
              </Link>
            </li>
            <li className="flex min-w-0 items-center">
              <span className="text-muted-foreground mx-2 shrink-0" aria-hidden>
                /
              </span>
              <span className="text-muted-foreground truncate">
                {categoryLabel(topic)}
              </span>
            </li>
          </ol>
        </nav>
        <header className="border-border flex flex-col gap-5 border-b pb-8 sm:flex-row sm:items-start sm:justify-between xl:col-span-2">
          <div className="flex items-start gap-4">
            <span className="bg-primary-subtle text-primary flex size-11 shrink-0 items-center justify-center rounded-lg">
              <TopicIcon className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-primary text-xs font-semibold tracking-[0.12em] uppercase">
                {t("help.topicGuideLabel", { topic: categoryLabel(topic) })}
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">
                {categoryLabel(topic)}
              </h1>
              <p className="text-muted-foreground mt-2 max-w-2xl text-base leading-7">
                {categoryDescription(topic)}
              </p>
            </div>
          </div>
          <p className="text-muted-foreground shrink-0 pt-1 text-sm">
            {t(
              topicSections.length === 1
                ? "help.guideCountOne"
                : "help.guideCountOther",
              { count: topicSections.length },
            )}
          </p>
        </header>
        <aside className="min-w-0">
          <nav
            className="border-border xl:sticky xl:top-20 xl:border-r xl:pr-5"
            aria-label="Guide navigation"
          >
            <p className="text-primary text-[11px] font-semibold tracking-wide uppercase">
              {t("help.inThisGuide")}
            </p>
            <ul className="border-border mt-3 flex gap-1 overflow-x-auto border-l pb-1 pl-2 xl:block xl:space-y-1 xl:overflow-visible">
              {topicSections.map((section) => (
                <li key={section.id} className="shrink-0">
                  <a
                    href={`#${section.id}`}
                    onClick={() => jumpToSection(section.id)}
                    aria-current={
                      activeId === section.id ? "location" : undefined
                    }
                    className={cn(
                      "focus-visible:ring-ring flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                      activeId === section.id
                        ? "bg-surface-selected text-primary font-medium"
                        : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                    )}
                  >
                    <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                    <span className="whitespace-nowrap xl:whitespace-normal">
                      {section.title}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <article className="max-w-[var(--wh-content-max)] min-w-0">
          <div className="text-[15px] leading-7">
            {topicSections.map((section, index) => (
              <section
                id={section.id}
                key={section.id}
                aria-labelledby={`${section.id}-heading`}
                className={cn(
                  index > 0 && "border-border mt-10 border-t pt-10",
                )}
              >
                <h3
                  id={`${section.id}-heading`}
                  tabIndex={-1}
                  className="focus-visible:ring-ring scroll-mt-24 text-xl font-semibold tracking-tight outline-none focus-visible:ring-2"
                >
                  {section.title}
                </h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  {section.description}
                </p>
                <div className="text-muted-foreground mt-4 space-y-3">
                  {section.body}
                </div>
              </section>
            ))}
          </div>
          <aside
            className="border-border bg-surface-sunken mt-12 rounded-lg border p-5"
            aria-label="Safety reminder"
          >
            <div className="flex gap-3">
              <ShieldCheck
                className="text-primary mt-0.5 size-5 shrink-0"
                aria-hidden
              />
              <div>
                <h3 className="font-semibold">{t("help.needMoreDetailTitle")}</h3>
                <p className="text-muted-foreground mt-1 text-sm leading-6">
                  {t("help.needMoreDetailBody")}
                </p>
              </div>
            </div>
          </aside>
          <div className="text-muted-foreground mt-6 flex gap-2 text-xs leading-5">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>{t("help.permissionsFooterNote")}</p>
          </div>
        </article>
      </section>
    </div>
  );
}
