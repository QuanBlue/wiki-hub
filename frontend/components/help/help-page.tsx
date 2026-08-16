"use client";

import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  FileText,
  FolderKanban,
  KeyRound,
  Search,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type HelpCategory =
  "Workspace" | "Writing" | "Account" | "Administration";

type HelpSection = {
  id: string;
  title: string;
  category: HelpCategory;
  description: string;
  keywords: string[];
  body: ReactNode;
};

type CategoryDefinition = {
  title: HelpCategory;
  description: string;
  icon: LucideIcon;
};

const categories: CategoryDefinition[] = [
  {
    title: "Workspace",
    description: "Find and organise team knowledge.",
    icon: FolderKanban,
  },
  {
    title: "Writing",
    description: "Create, share, and maintain pages.",
    icon: FileText,
  },
  {
    title: "Account",
    description: "Manage your profile and sign-in security.",
    icon: KeyRound,
  },
  {
    title: "Administration",
    description: "Operate the workspace safely at scale.",
    icon: Settings2,
  },
];

const sections: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    category: "Workspace",
    description:
      "Sign in, navigate WikiHub, and find the knowledge you can access.",
    keywords: ["login", "search", "navigation", "home"],
    body: (
      <>
        <p>
          Sign in with your username or email address and password. If your
          account is disabled, contact a workspace administrator to reactivate
          it. Single sign-on is shown in account settings as an upcoming
          capability; email and password are the current sign-in method.
        </p>
        <p>
          Use the left navigation to open Home, Spaces, and Help. The top-bar
          search finds spaces and pages that you are allowed to view. You can
          collapse the application sidebar; your preference is remembered in
          this browser.
        </p>
      </>
    ),
  },
  {
    id: "spaces",
    title: "Spaces",
    category: "Workspace",
    description: "Browse, favourite, create, and manage a space.",
    keywords: ["favourite", "favorite", "members", "visibility", "archive"],
    body: (
      <>
        <p>
          A space is a home for a team, project, or knowledge area. Open{" "}
          <strong>Spaces</strong> to browse, search, filter, and favourite
          spaces you use often. Spaces can be active or archived, and can be
          open or restricted according to their access rules.
        </p>
        <p>
          Users with permission can create a space with a unique key, name,
          description, icon, and visibility. Space managers can add members,
          assign roles, grant permissions to people or groups, archive a space,
          or permanently delete it when it is no longer needed.
        </p>
      </>
    ),
  },
  {
    id: "pages",
    title: "Pages and editing",
    category: "Writing",
    description: "Create pages, work with drafts, and structure a page tree.",
    keywords: ["editor", "draft", "markdown", "html", "move", "delete"],
    body: (
      <>
        <p>
          Pages form a hierarchy inside a space. Use the page tree to open a
          page, expand a branch, or create a child page. When editing, you can
          use the rich-text editor or work with Markdown and HTML source when
          that better suits the content.
        </p>
        <p>
          Create, rename, move, or delete pages only when your space permissions
          allow it. Deleting a page moves its children up the tree instead of
          silently deleting their content. Drafts are kept locally and can also
          be saved on the server, so discard a draft explicitly when you do not
          want to continue it.
        </p>
      </>
    ),
  },
  {
    id: "collaboration",
    title: "Reading and collaboration",
    category: "Writing",
    description:
      "Save useful pages, share knowledge, and protect sensitive content.",
    keywords: ["saved", "like", "restrictions", "share", "recent"],
    body: (
      <>
        <p>
          Favourite spaces for quick access, save pages to your personal Saved
          list, and like useful pages. Use the page link to share a page with
          colleagues who already have access. Recent activity helps you return
          to recently opened or updated knowledge.
        </p>
        <p>
          A page can have user or group restrictions in addition to its space
          permissions. Apply restrictions carefully: test them with a normal
          account when protecting sensitive content.
        </p>
      </>
    ),
  },
  {
    id: "history-and-export",
    title: "History and PDF export",
    category: "Writing",
    description:
      "Compare revisions, restore earlier work, and export a readable PDF.",
    keywords: ["revision", "history", "compare", "restore", "pdf"],
    body: (
      <>
        <p>
          Every saved page change creates a revision. Open page history to
          inspect previous versions, compare two versions with a visual diff, or
          restore content from an earlier revision. A restore is itself recorded
          as a new change, so the original history remains available.
        </p>
        <p>
          Use <strong>Export PDF</strong> from the page actions when you need a
          readable, shareable copy of the current page.
        </p>
      </>
    ),
  },
  {
    id: "your-account",
    title: "Profile, password, and sessions",
    category: "Account",
    description:
      "Update your identity, secure your password, and review signed-in devices.",
    keywords: ["avatar", "password", "authentication", "session", "profile"],
    body: (
      <>
        <p>
          Open <strong>Your account</strong> from the account menu. Profile
          starts in read-only mode; choose <strong>Edit profile</strong> to
          update your display name, email, avatar, bio, pronouns, company,
          website, and up to two social links. Field validation appears as you
          leave each input. Cancel discards unsaved edits.
        </p>
        <p>
          In Password &amp; authentication, change your password after
          satisfying every displayed rule. You can generate a strong password in
          the form. In Sessions, review active browsers and sign out all other
          sessions if you see activity you do not recognise.
        </p>
      </>
    ),
  },
  {
    id: "administration",
    title: "Users, groups, and access",
    category: "Administration",
    description:
      "Manage people, groups, permissions, and administrator account switching.",
    keywords: [
      "users",
      "groups",
      "permissions",
      "roles",
      "impersonation",
      "switch",
    ],
    body: (
      <>
        <p>
          Administrators manage users, groups, spaces, workspace settings,
          backups, and object storage. The Users directory supports search,
          filtering, pagination, account activation, role changes, password
          resets, and account deletion. The protected bootstrap account is
          deliberately not editable through normal administrative actions.
        </p>
        <p>
          Groups make permissions easier to manage at scale. Give groups global
          permissions such as creating spaces or managing users, then use those
          groups when assigning access to spaces and pages. Administrators can
          also switch into another active account for support; a banner remains
          visible and the administrator is retained in the audit trail.
        </p>
      </>
    ),
  },
  {
    id: "settings-and-storage",
    title: "Settings and object storage",
    category: "Administration",
    description: "Control workspace defaults and safely locate stored objects.",
    keywords: ["settings", "storage", "objects", "attachment", "download"],
    body: (
      <>
        <p>
          Workspace settings control the site name, session lifetime, upload and
          archive limits, allowed attachment types, and which roles can see
          navigation areas. Leaving an override empty uses its
          environment-provided default.
        </p>
        <p>
          Storage lets administrators filter the object bucket by type, space,
          page, or path. They can request a safe download link, preview
          compatible files, or delete an object. Deletion is permanent and can
          remove the associated attachment record, so confirm that a file is no
          longer needed first.
        </p>
      </>
    ),
  },
  {
    id: "backup-and-restore",
    title: "Backup and restore",
    category: "Administration",
    description:
      "Create full workspace backups, preview archives, and resolve space conflicts.",
    keywords: ["zip", "restore", "overwrite", "checksum", "archive"],
    body: (
      <>
        <p>
          Administrators can create a full WikiHub ZIP backup containing
          workspace data, pages, revisions, permissions, attachments, and
          internal avatars. Password hashes are excluded by default; include
          them only for a secure migration, because the archive becomes
          sensitive.
        </p>
        <p>
          Restore accepts legacy JSON backups and full ZIP backups. Always
          preview changes first. Existing users and spaces are skipped by
          default. For a conflicting space in a full ZIP, an administrator can
          explicitly overwrite page content, revisions, restrictions, and
          attachments while retaining the destination space metadata, members,
          and permissions.
        </p>
      </>
    ),
  },
  {
    id: "confluence-import",
    title: "Confluence import and Data Center export",
    category: "Administration",
    description:
      "Bring in a Confluence archive or create a Data Center-compatible export.",
    keywords: ["confluence", "import", "export", "data center", "xml"],
    body: (
      <>
        <p>
          Import a Confluence export ZIP from Administration &gt; Backup.
          Uploads use resumable multipart transfer. After the archive is
          scanned, choose spaces to import, review conflicts, then monitor the
          background job, logs, retry controls, or cancellation state.
        </p>
        <p>
          WikiHub can also produce a separate Confluence Data Center XML export.
          Select the target compatibility profile (Data Center 8.x or 9.x)
          before creating it. This artifact contains space content and
          attachments, not WikiHub users, groups, or workspace settings.
        </p>
      </>
    ),
  },
  {
    id: "safe-operation",
    title: "Safe operation and troubleshooting",
    category: "Administration",
    description:
      "Avoid destructive mistakes and resolve common access and upload issues.",
    keywords: ["security", "troubleshooting", "failed", "upload", "access"],
    body: (
      <>
        <p>
          Treat password-hash backups and pre-signed storage URLs as sensitive.
          Preview a restore, especially before overwriting a space. Archive a
          space before permanent deletion when a review period is useful, and
          use groups instead of large sets of direct permissions.
        </p>
        <p>
          If sign-in fails, verify the account is active. If a page or space is
          missing, check both space permissions and page restrictions. Upload
          failures usually indicate an unsupported type or a configured size
          limit. For a failed import, return to Backup to resume a scanned
          archive or retry its job after checking worker, Redis, and
          object-storage health.
        </p>
      </>
    ),
  },
];

function jumpToSection(id: string) {
  window.requestAnimationFrame(() =>
    document.getElementById(`${id}-heading`)?.focus(),
  );
}

const topicSlugs: Record<HelpCategory, string> = {
  Workspace: "workspace",
  Writing: "writing",
  Account: "account",
  Administration: "administration",
};

export function HelpPage() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const matchingTopics = useMemo(
    () =>
      normalizedQuery
        ? categories.filter((category) =>
            [
              category.title,
              category.description,
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
    [normalizedQuery],
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
              WikiHub Help Center
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">
              How can we help?
            </h1>
            <p className="text-muted-foreground mx-auto mt-2 max-w-xl text-base leading-7">
              Browse practical guides for working with knowledge and managing
              your workspace.
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
                placeholder="Search a help topic..."
                aria-label="Search Help topics"
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
                <h2 className="font-semibold">{topic.title}</h2>
                <p className="text-muted-foreground mt-1 text-sm leading-5">
                  {topic.description}
                </p>
              </div>
              <p className="text-primary mt-auto pt-4 text-xs font-medium">
                {guideCount} {guideCount === 1 ? "guide" : "guides"}
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
          No help topic matches “{query}”.
        </p>
      ) : null}
    </div>
  );
}

export function HelpDetailPage({ topic }: { topic: HelpCategory }) {
  const topicDefinition = categories.find(
    (category) => category.title === topic,
  )!;
  const TopicIcon = topicDefinition.icon;
  const topicSections = useMemo(
    () => sections.filter((section) => section.category === topic),
    [topic],
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
              WikiHub Help Center
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">
              How can we help?
            </h1>
            <p className="text-muted-foreground mx-auto mt-2 max-w-xl text-base leading-7">
              Browse practical guides for working with knowledge and managing
              your workspace.
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
                placeholder="Search guides, features, and tasks..."
                aria-label="Search Help guides"
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
              Browse guides
            </p>
            <h2
              id="browse-guides"
              className="mt-1 text-2xl font-semibold tracking-tight"
            >
              Find the right topic
            </h2>
          </div>
          {normalizedQuery ? (
            <p className="text-muted-foreground text-sm" role="status">
              {matchingSections.length}{" "}
              {matchingSections.length === 1 ? "result" : "results"}
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
                      {category.title}
                    </h3>
                  </div>
                  <p className="text-muted-foreground mt-2 text-sm leading-5">
                    {category.description}
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
            <p className="font-medium">No guides found for “{query}”</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Try a broader term such as “backup”, “spaces”, or “password”.
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
                Help
              </Link>
            </li>
            <li className="flex min-w-0 items-center">
              <span className="text-muted-foreground mx-2 shrink-0" aria-hidden>
                /
              </span>
              <span className="text-muted-foreground truncate">{topic}</span>
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
                {topic} guide
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">
                {topic}
              </h1>
              <p className="text-muted-foreground mt-2 max-w-2xl text-base leading-7">
                {topicDefinition.description}
              </p>
            </div>
          </div>
          <p className="text-muted-foreground shrink-0 pt-1 text-sm">
            {topicSections.length}{" "}
            {topicSections.length === 1 ? "guide" : "guides"}
          </p>
        </header>
        <aside className="min-w-0">
          <nav
            className="border-border xl:sticky xl:top-20 xl:border-r xl:pr-5"
            aria-label="Guide navigation"
          >
            <p className="text-primary text-[11px] font-semibold tracking-wide uppercase">
              In this guide
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
                <h3 className="font-semibold">Need more technical detail?</h3>
                <p className="text-muted-foreground mt-1 text-sm leading-6">
                  Administrators can use the API documentation at{" "}
                  <code>/docs</code> and <code>/redoc</code>.
                </p>
              </div>
            </div>
          </aside>
          <div className="text-muted-foreground mt-6 flex gap-2 text-xs leading-5">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              Features depend on your workspace permissions and administrator
              settings.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}
