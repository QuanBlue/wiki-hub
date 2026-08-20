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
  | "Workspace"
  | "Writing"
  | "Account"
  | "Administration";

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
    description: "Find, organise, and member-manage team knowledge.",
    icon: FolderKanban,
  },
  {
    title: "Writing",
    description: "Create, edit, format, and export pages with rich tools.",
    icon: FileText,
  },
  {
    title: "Account",
    description: "Manage your profile, password, and active sign-in sessions.",
    icon: KeyRound,
  },
  {
    title: "Administration",
    description: "Theme customization, storage limits, backups, and user access.",
    icon: Settings2,
  },
];

const sections: HelpSection[] = [
  // ---------------------------------------------------------------------------
  // WORKSPACE CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "getting-started",
    title: "Getting started",
    category: "Workspace",
    description:
      "Sign in, navigate WikiHub, and find the knowledge you can access.",
    keywords: ["login", "search", "navigation", "home", "sidebar"],
    body: (
      <>
        <p>
          Sign in with your registered username or email address and password.
          If your account is disabled, contact a workspace administrator to
          reactivate it.
        </p>
        <p>
          The primary navigation rail on the left gives fast access to{" "}
          <strong>Home</strong>, <strong>Spaces</strong>, and{" "}
          <strong>Help</strong>. Global search in the top bar instantly finds
          spaces and pages you have permission to view. You can collapse or
          expand the sidebar at any time; your preference is saved in your
          browser.
        </p>
      </>
    ),
  },
  {
    id: "spaces",
    title: "Spaces and permissions",
    category: "Workspace",
    description: "Browse, favourite, create, and manage team knowledge spaces.",
    keywords: ["favourite", "favorite", "members", "visibility", "archive", "layers"],
    body: (
      <>
        <p>
          A <strong>Space</strong> is a dedicated workspace for a team, project, or
          knowledge domain. Open <strong>Spaces</strong> to search, filter, and
          favourite spaces for one-click access in your left sidebar.
        </p>
        <p>
          Users with space creation rights can create a new space with a unique
          key (e.g. <code>ENG</code>), name, description, custom icon, and
          visibility rules. Space managers can assign members, grant role-based
          permissions, archive inactive spaces, or delete a space when no
          longer needed.
        </p>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // WRITING CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "pages",
    title: "Pages and rich-text editing",
    category: "Writing",
    description:
      "Create pages, use the sticky formatting toolbar, and toggle source mode.",
    keywords: ["editor", "toolbar", "sticky", "markdown", "html", "source", "draft"],
    body: (
      <>
        <p>
          Pages are organized hierarchically inside spaces. Create child pages
          under any existing page or directly from the space root. When editing a
          page, a <strong>sticky toolbar</strong> stays attached to the top of
          your viewport as you scroll down long documents, allowing quick access
          to formatting controls without scrolling back up.
        </p>
        <p>
          The rich-text editor supports inline formatting (bold, italic,
          underline, strikethrough, inline code, links). You can also click{" "}
          <strong>Source</strong> to switch to raw Markdown or HTML source code
          mode for advanced editing. Drafts are automatically saved locally and
          synchronized with the server.
        </p>
      </>
    ),
  },
  {
    id: "slash-commands",
    title: "Slash commands (/) and shortcuts",
    category: "Writing",
    description:
      "Type / on any empty line to quickly insert blocks, tables, and media.",
    keywords: [
      "slash",
      "shortcut",
      "heading",
      "callout",
      "table",
      "code",
      "image",
      "todo",
    ],
    body: (
      <>
        <p>
          Type <code>/</code> at the beginning of any empty line in the editor to
          open the interactive <strong>Slash Command Menu</strong>. Use your arrow
          keys or keep typing to filter available content blocks:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            <code>/h1</code>, <code>/h2</code>, <code>/h3</code> — Insert level
            1, 2, or 3 section headings.
          </li>
          <li>
            <code>/bullet</code>, <code>/numbered</code> — Create bulleted or
            numbered list items.
          </li>
          <li>
            <code>/quote</code>, <code>/callout</code> — Insert blockquotes or
            accented callout alert boxes.
          </li>
          <li>
            <code>/table</code> — Create a structured data table.
          </li>
          <li>
            <code>/code</code> — Insert a syntax-highlighted code block.
          </li>
          <li>
            <code>/image</code>, <code>/attachment</code> — Upload an inline image
            or file attachment.
          </li>
          <li>
            <code>/todo</code> — Create interactive checkable task lists.
          </li>
          <li>
            <code>/toggle</code> — Insert a collapsible toggle container.
          </li>
          <li>
            <code>/divider</code> — Insert a horizontal divider line.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "images-and-attachments",
    title: "Images, attachments, and media",
    category: "Writing",
    description:
      "Upload images, drag to resize, set alignment, and preview files.",
    keywords: ["image", "attachment", "resize", "align", "caption", "preview"],
    body: (
      <>
        <p>
          Drag and drop images directly into the editor or use the image upload
          button. Click any inserted image to reveal its hover toolbar: drag the
          corner handle to resize pixel width, set alignment (left, center,
          right), or add a descriptive caption.
        </p>
        <p>
          File attachments (such as PDF documents, code snippets, or ZIP archives)
          can be inserted into the text flow. Clicking an uploaded file opens a
          modal detail dialog with file metadata (filename, size, creation date)
          and a live preview for images or syntax-highlighted text files.
        </p>
      </>
    ),
  },
  {
    id: "tables-and-codeblocks",
    title: "Tables, code blocks, and toggle lists",
    category: "Writing",
    description:
      "Manage structured tables, syntax-highlighted code blocks, and collapsibles.",
    keywords: ["table", "codeblock", "syntax", "toggle", "collapsible", "todo"],
    body: (
      <>
        <p>
          Insert tables to present structured data. Hovering over table cells
          reveals action handles to add or delete rows and columns, toggle header
          rows, or format cell alignment.
        </p>
        <p>
          Code blocks feature automatic syntax highlighting for over 40
          programming languages (Python, TypeScript, Go, Rust, SQL, Bash, etc.).
          Click the code block options bar to choose a language, add a title or
          caption, or copy the entire block code with a single click.
        </p>
      </>
    ),
  },
  {
    id: "history-and-export",
    title: "History, visual diff, and PDF export",
    category: "Writing",
    description:
      "Inspect revision history, compare versions with visual diff, and export PDF.",
    keywords: ["revision", "history", "compare", "diff", "restore", "pdf"],
    body: (
      <>
        <p>
          Every saved page change creates a new revision. Open <strong>Page
          History</strong> to review past versions, compare two revisions using
          side-by-side or inline visual diff, or restore an earlier version.
          Restoring creates a new revision, preserving complete history.
        </p>
        <p>
          Click <strong>Export PDF</strong> in page actions to generate a clean,
          print-ready PDF document formatted for offline reading and sharing.
        </p>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // ACCOUNT CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "your-account",
    title: "Profile, password, and active sessions",
    category: "Account",
    description:
      "Update display identity, manage password security, and revoke sessions.",
    keywords: ["avatar", "password", "authentication", "session", "profile"],
    body: (
      <>
        <p>
          Access <strong>Your account</strong> from the top-right profile menu.
          Update your display name, email, avatar image, bio, pronouns, company,
          and website link.
        </p>
        <p>
          In <strong>Password &amp; authentication</strong>, change your password
          following workspace complexity rules. In <strong>Sessions</strong>,
          view active browsers and sign out all other sessions if you see
          activity you do not recognise.
        </p>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // ADMINISTRATION CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "theme-and-branding",
    title: "Theme & branding customization",
    category: "Administration",
    description:
      "Customize brand colors, preset/custom logo icons, dark mode, and tab favicon.",
    keywords: [
      "theme",
      "color",
      "hex",
      "palette",
      "icon",
      "logo",
      "favicon",
      "preview",
      "branding",
    ],
    body: (
      <>
        <p>
          Administrators can customize the workspace appearance under{" "}
          <strong>Administration &gt; Settings &gt; Theme &amp; Branding</strong>:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            <strong>Brand Theme Color</strong>: Select from 8 curated palettes
            (Blue, Emerald, Indigo, Violet, Rose, Amber, Teal, Slate) or use the
            Custom Hex picker (e.g. <code>#216fc0</code>).
          </li>
          <li>
            <strong>Application Logo &amp; Icon</strong>: Choose a built-in vector
            icon preset (Hub, Book, Layers, Compass, Sparkles, Feather,
            Graduation, CPU, Shield) or upload your team&apos;s custom PNG/SVG logo
            image (under 2MB).
          </li>
          <li>
            <strong>Theme Preview Modal</strong>: Click <strong>Preview Theme</strong>{" "}
            to open an interactive simulation of WikiHub. Test tabs, buttons, links,
            search, and toggle Light/Dark mode before applying changes.
          </li>
          <li>
            <strong>Draft Mode</strong>: Theme changes remain in draft form and
            only apply globally to the workspace when you click <strong>Save
            settings</strong>.
          </li>
          <li>
            <strong>Zero-Flicker SSR &amp; Dynamic Favicon</strong>: Theme CSS variables
            are preloaded server-side on frame 0, and browser tab bar favicons
            update instantly in real-time.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "settings-and-storage",
    title: "Settings and object storage",
    category: "Administration",
    description:
      "Configure instance parameters, file limits, access matrix, and object storage.",
    keywords: [
      "settings",
      "storage",
      "objects",
      "attachment",
      "limits",
      "matrix",
      "download",
    ],
    body: (
      <>
        <p>
          In <strong>Administration &gt; Settings</strong>, configure instance-wide
          parameters: Site Name, Session TTL (hours), Max single attachment size
          (MB), Max backup import size (MB), Allowed attachment file extensions
          (e.g. <code>png, pdf, zip, *</code>), and the Sidebar Access Matrix per
          user role (<code>member</code>, <code>admin</code>).
        </p>
        <p>
          In <strong>Storage</strong>, administrators can browse the S3 object
          bucket in a clean folder tree view (formatted with regular text). Filter
          objects by space, page, type, or file path; preview images and text;
          generate secure download links; or delete orphan objects with hash
          clearance.
        </p>
      </>
    ),
  },
  {
    id: "backup-and-restore",
    title: "Backup, Confluence import, and DC export",
    category: "Administration",
    description:
      "Create ZIP backups, import Confluence space archives, and export DC XML.",
    keywords: [
      "backup",
      "zip",
      "restore",
      "confluence",
      "import",
      "export",
      "xml",
    ],
    body: (
      <>
        <p>
          Create full workspace ZIP backups under <strong>Administration &gt;
          Backup</strong>, containing pages, revisions, attachments, avatars, and
          permissions.
        </p>
        <p>
          Import Confluence space ZIP exports with resumable upload support.
          Scan archives, review space key conflicts, choose specific spaces to
          import, and monitor background progress. You can also generate
          Confluence Data Center XML exports (Data Center 8.x / 9.x compatible).
        </p>
      </>
    ),
  },
  {
    id: "safe-operation",
    title: "Safe operation and troubleshooting",
    category: "Administration",
    description:
      "Avoid destructive errors, troubleshoot uploads, and manage background tasks.",
    keywords: ["security", "troubleshooting", "failed", "upload", "access"],
    body: (
      <>
        <p>
          Treat backup archives and pre-signed storage URLs securely. Preview
          restores before overwriting space content. Archive inactive spaces before
          permanent deletion. Use group permissions rather than large sets of
          individual user assignments.
        </p>
        <p>
          If sign-in fails, check if the account is active. If uploads fail,
          verify file extensions and size limits in Settings. If an import fails,
          check worker logs, Redis, and MinIO storage health.
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
              Browse practical guides for working with knowledge, page editing,
              theme customization, and managing your workspace.
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
                placeholder="Search a help topic (e.g. slash, theme, table, storage)..."
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
              Try a broader term such as “slash”, “theme”, “table”, or “storage”.
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
