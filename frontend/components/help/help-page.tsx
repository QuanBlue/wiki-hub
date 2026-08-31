"use client";

import {
  AlertTriangle,
  BookOpen,
  ChevronRight,
  CircleAlert,
  FileText,
  FolderKanban,
  Info,
  KeyRound,
  Lightbulb,
  Paperclip,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
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
  | "Attachments & Media"
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

// ---------------------------------------------------------------------------
// Help UI Formatting Helper Components
// ---------------------------------------------------------------------------

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="border-border/60 bg-surface-sunken text-primary font-mono rounded border px-1.5 py-0.5 text-[12px] font-semibold">
      {children}
    </code>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-border bg-surface text-foreground shadow-xs font-mono rounded border px-1.5 py-0.5 text-[11px] font-semibold">
      {children}
    </kbd>
  );
}

function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="border-primary/60 bg-primary-subtle/30 text-foreground my-3 rounded-r-lg border-l-4 py-3 pr-4 pl-4 text-sm italic shadow-xs">
      {children}
    </blockquote>
  );
}

function Callout({
  variant = "note",
  title,
  children,
}: {
  variant?: "note" | "tip" | "important" | "warning";
  title?: string;
  children: ReactNode;
}) {
  const config = {
    note: {
      border: "border-info/40 bg-info-subtle/20 text-info-foreground",
      icon: Info,
      iconColor: "text-info",
      defaultTitle: "NOTE",
    },
    tip: {
      border: "border-success/40 bg-success-subtle/20 text-success-foreground",
      icon: Lightbulb,
      iconColor: "text-success",
      defaultTitle: "PRO TIP",
    },
    important: {
      border: "border-primary/40 bg-primary-subtle/20 text-primary-foreground",
      icon: Sparkles,
      iconColor: "text-primary",
      defaultTitle: "IMPORTANT",
    },
    warning: {
      border: "border-warning/40 bg-warning-subtle/20 text-warning-foreground",
      icon: AlertTriangle,
      iconColor: "text-warning",
      defaultTitle: "WARNING",
    },
  }[variant];

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "my-4 rounded-lg border p-4 text-sm leading-6 shadow-xs",
        config.border,
      )}
    >
      <div className="flex items-center gap-2 font-semibold">
        <Icon className={cn("size-4 shrink-0", config.iconColor)} aria-hidden />
        <span className="text-xs font-bold tracking-wider uppercase">
          {title || config.defaultTitle}
        </span>
      </div>
      <div className="mt-2 text-foreground/90 space-y-2">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories & Sections Data
// ---------------------------------------------------------------------------

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
    title: "Attachments & Media",
    description: "Preview, edit, present, and import documents, video, and images.",
    icon: Paperclip,
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
    title: "Getting started & Navigation",
    category: "Workspace",
    description:
      "Sign in, master navigation rails, global search, and workspace shortcuts.",
    keywords: ["login", "search", "navigation", "home", "sidebar", "rail"],
    body: (
      <>
        <p>
          Welcome to <strong>WikiHub</strong> — the central documentation and team
          knowledge hub. To get started, sign in with your registered username or
          email address.
        </p>

        <Callout variant="tip" title="QUICK SEARCH SHORTCUT">
          Press <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd> (or <Kbd>⌘</Kbd> + <Kbd>K</Kbd> on
          macOS) anywhere in the application to instantly open <strong>Global Search</strong>.
          Type keywords, space names, or page titles to jump directly to any document.
        </Callout>

        <Callout variant="note" title="WHAT SEARCH ACTUALLY MATCHES">
          Search looks for your text inside space names/keys/descriptions and page
          titles/content - a plain substring match, not a ranked full-text search. It
          does not currently search attachment filenames or attachment content, and
          only ever shows results you have permission to see. There are no date, space,
          or author filters.
        </Callout>

        <p className="mt-3">
          <strong>Key Interface Regions:</strong>
        </p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Top Navigation Bar</strong>: the search pill (opens the same{" "}
            <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd> modal), a <strong>Help</strong> link (book
            icon, takes you here), the Light/Dark theme toggle, and your user menu.
            WikiHub has no notification bell - there is no push/alert system yet (see
            the note in <em>Safe Operation &amp; System Troubleshooting</em>).
          </li>
          <li>
            <strong>Left Sidebar Rail</strong>: <strong>Home</strong> and{" "}
            <strong>Spaces</strong>, then your <strong>Most visited</strong> spaces -
            an automatic, server-ranked list based on which spaces you actually open,
            not a manually pinned one - and, for admins, an{" "}
            <strong>Administration</strong> section.
          </li>
          <li>
            <strong>Sidebar Collapse</strong>: click the collapse/expand button, or
            drag the sidebar&apos;s right edge past its minimum width, to shrink it to
            icons-only. Your preference is remembered on this device.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "keyboard-shortcuts",
    title: "Keyboard Shortcuts Reference",
    category: "Workspace",
    description:
      "Every keyboard shortcut WikiHub actually recognises, in one place.",
    keywords: ["keyboard", "shortcut", "hotkey", "ctrl", "cmd", "escape"],
    body: (
      <>
        <p>
          There is no command palette beyond Search - just this set. The ones marked{" "}
          <strong>Rebindable</strong> are defaults you can change; see{" "}
          <em>Customising Keyboard Shortcuts</em> under <strong>Account</strong>.
        </p>

        <div className="border-border bg-surface mt-3 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-40">Shortcut</th>
                <th className="p-2.5">Where &amp; what it does</th>
                <th className="p-2.5 w-24">Rebindable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>K</Kbd></td>
                <td className="p-2.5">Anywhere - opens or closes Global Search. Then <Kbd>↑</Kbd>/<Kbd>↓</Kbd> to move the selection, <Kbd>Enter</Kbd> to open it, <Kbd>Esc</Kbd> to close.</td>
                <td className="p-2.5">Yes</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>F</Kbd></td>
                <td className="p-2.5">A second way to open Global Search, in place of the browser&apos;s own find bar. Inside a text or code attachment preview it focuses that preview&apos;s own <strong>Search content</strong> box instead, so you can search the file you are looking at.</td>
                <td className="p-2.5">Yes</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>S</Kbd></td>
                <td className="p-2.5">While editing a page - saves immediately, intercepting the browser&apos;s own Save-page dialog.</td>
                <td className="p-2.5">Yes</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>R</Kbd></td>
                <td className="p-2.5">While editing - intercepted to ask <em>&ldquo;Reload site?&rdquo;</em> instead of silently discarding unsaved changes.</td>
                <td className="p-2.5">Yes</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Space</Kbd></td>
                <td className="p-2.5">In a video attachment preview - plays or pauses, from anywhere in the preview rather than only while the player itself has focus. Ignored while a button or text field is focused, so it never steals the key from something else.</td>
                <td className="p-2.5">Yes</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>/</Kbd></td>
                <td className="p-2.5">Start of an empty line in the editor - opens the slash command menu (see <em>Slash Commands</em>).</td>
                <td className="p-2.5">No</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>←</Kbd> / <Kbd>→</Kbd></td>
                <td className="p-2.5">In a PowerPoint attachment preview - previous/next slide (works both inside and outside fullscreen Present mode).</td>
                <td className="p-2.5">No</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Kbd>Esc</Kbd></td>
                <td className="p-2.5">Closes the currently focused overlay - a dialog, the mobile sidebar drawer, or (checked first) just the PowerPoint slideshow without closing its parent attachment window.</td>
                <td className="p-2.5">No</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: "spaces",
    title: "Spaces, Access Rights & Roles",
    category: "Workspace",
    description:
      "Create team spaces, assign roles, manage visibility, and pin favorites.",
    keywords: [
      "favourite",
      "favorite",
      "members",
      "visibility",
      "archive",
      "layers",
      "permissions",
      "roles",
    ],
    body: (
      <>
        <p>
          A <strong>Space</strong> is a dedicated knowledge container for a specific
          team, department, or project. Every page in WikiHub belongs to a space.
        </p>

        <Quote>
          &ldquo;Spaces keep team documentation organized and isolated with custom
          access rules, member permissions, and unique space keys.&rdquo;
        </Quote>

        <p className="mt-4 font-semibold text-foreground">
          Space Management Capabilities:
        </p>
        <ol className="list-decimal pl-5 space-y-2 text-sm">
          <li>
            <strong>Creating a Space</strong>: Users with space-creation rights can
            click <strong>Create Space</strong> in the Spaces directory. Specify a
            unique <strong>Space Key</strong> (e.g., <Code>ENG</Code>,{" "}
            <Code>PRODUCT</Code>), space name, description, and custom emoji or
            vector icon.
          </li>
          <li>
            <strong>Space Visibility</strong>:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>
                <strong className="text-success">Open</strong>: any signed-in
                workspace member can read the space.
              </li>
              <li>
                <strong className="text-danger">Restricted</strong>: only the specific
                people and groups granted access can read it.
              </li>
            </ul>
          </li>
          <li>
            <strong>Per-user &amp; per-group permissions</strong>: instead of a fixed
            list of named roles, WikiHub grants specific capabilities directly to a
            user or a group - <Code>View</Code>, <Code>Add</Code>, <Code>Delete</Code>,{" "}
            <Code>Delete own</Code>, <Code>Restrictions</Code>, <Code>Export</Code>,
            and <Code>Admin</Code> - from a space&apos;s own{" "}
            <strong>Edit space &gt; Access &amp; Permissions</strong> tab, or from{" "}
            <strong>Administration &gt; Spaces</strong> (see{" "}
            <em>Space Access &amp; Effective Permissions</em> for the full picture,
            including how to check any one person&apos;s resolved access).
          </li>
          <li>
            <strong>Editing a space</strong>: click <strong>Edit space</strong>{" "}
            (pencil icon in the space sidebar footer, admins only) for three tabs:{" "}
            <strong>General</strong> (name, visibility, and an optional per-space
            attachment-size limit that overrides the workspace default),{" "}
            <strong>Access &amp; Permissions</strong> (the same tables as above), and{" "}
            <strong>Space settings &amp; Danger zone</strong> (Archive/Restore the
            space, or permanently Delete it - permanent deletion is only available
            from <strong>Administration &gt; Spaces</strong>, not here).
          </li>
          <li>
            <strong>Favouriting</strong>: Click the <Code>★ Star</Code> icon on a
            space&apos;s header to add it to your favourites. Favourited spaces show up
            under <strong>My favorite spaces</strong> on the Home page, and under the{" "}
            <strong>Starred</strong> tab of the Spaces directory (
            <Code>/spaces?tab=starred</Code>).
            <br />
            The sidebar&apos;s own <strong>Most visited</strong> list is separate and
            automatic - it ranks whichever spaces you actually open most, independent of
            what you&apos;ve starred.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: "my-work",
    title: "Finding pages you've visited, edited, or saved",
    category: "Workspace",
    description:
      "Three personal activity views for your own history - not in the sidebar yet, but one URL away.",
    keywords: [
      "recently visited",
      "recently worked on",
      "history",
      "my work",
      "saved",
      "activity",
    ],
    body: (
      <>
        <p>
          Beyond the workspace-wide activity feed on <strong>Home</strong>, WikiHub keeps
          three personal views of your own history:
        </p>

        <Callout variant="note" title="NOT LINKED FROM THE SIDEBAR YET">
          These pages exist and work today, but there is no menu item pointing at them
          yet - bookmark whichever ones you use.
        </Callout>

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>
              Recently visited <Code>/recent/visited</Code>
            </strong>
            : pages you&apos;ve opened on this device, most recent first. Stored in this
            browser only, like <Code>Save for later</Code> below.
          </li>
          <li>
            <strong>
              Recently worked on <Code>/recent/worked-on</Code>
            </strong>
            : pages you personally created or edited. This one is pulled from the
            server, so it is the same list on every device you sign in from.
          </li>
          <li>
            <strong>
              Saved for later <Code>/saved</Code>
            </strong>
            : everything you&apos;ve bookmarked with the <Code>Save for later</Code>{" "}
            button (see <em>Liking, saving &amp; sharing a page</em> below).
          </li>
        </ul>

        <p className="mt-3 text-sm">
          <strong>Home</strong> itself (the logo, or <strong>Home</strong> in the
          sidebar) shows a different, workspace-wide view: <strong>All updates</strong> -
          every page anyone has edited, grouped by author - alongside your favourite
          spaces in the right-hand panel.
        </p>
      </>
    ),
  },
  {
    id: "page-engagement",
    title: "Liking, saving & sharing a page",
    category: "Workspace",
    description:
      "Flag useful pages, bookmark ones you'll need again, and lock down a single sensitive page.",
    keywords: [
      "like",
      "save for later",
      "share",
      "bookmark",
      "page access",
      "restrict",
      "restriction",
    ],
    body: (
      <>
        <p>
          Below a page&apos;s title, the page toolbar carries a small set of actions
          separate from editing:
        </p>

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Like</strong>: click <Code>Like</Code> to flag a page as useful. The
            count is visible to everyone and the button switches to{" "}
            <Code>Liked</Code> for you - a lightweight signal for what actually gets
            read, not a moderation tool.
          </li>
          <li>
            <strong>Save for later</strong>: click the star{" "}
            <Code>Save for later</Code> button to bookmark a page.
            <Callout variant="important" title="THIS DEVICE ONLY">
              Saved-for-later status lives in this browser, not your account - saving on
              your laptop will not show up on your phone, and clearing browser data
              clears it too. Everything you&apos;ve saved is listed at{" "}
              <Code>/saved</Code>.
            </Callout>
          </li>
          <li>
            <strong>Share</strong>: click <Code>Share</Code> to copy the page&apos;s
            direct link to your clipboard, ready to paste into chat or email.
          </li>
          <li>
            <strong>Page access</strong>: on a page you can manage, click{" "}
            <Code>Page access</Code> to grant specific people or groups{" "}
            <Code>Can view</Code> or <Code>Can edit</Code> on that one page - tighter
            than its space&apos;s general member roles, and view restrictions inherit
            down to child pages. With no restrictions added, a page simply follows its
            space&apos;s access rules.
          </li>
        </ul>

        <p className="mt-3 text-sm text-muted-foreground">
          Real-world use case: a space stays open to the whole team, but the one page
          documenting an incident postmortem or a compensation policy gets{" "}
          <Code>Page access</Code> restricted to just the people who need it.
        </p>
      </>
    ),
  },
  {
    id: "page-actions-menu",
    title: "The “⋯” menu: move, view width, export & delete",
    category: "Workspace",
    description:
      "Every page action beyond editing text lives behind the ⋯ button next to a page's title.",
    keywords: [
      "move page",
      "full width",
      "delete page",
      "page tree",
      "reorganize",
      "more actions",
    ],
    body: (
      <>
        <p>
          Click the <Code>⋯</Code> (<strong>More page actions</strong>) icon next to{" "}
          <strong>Edit</strong> for everything that isn&apos;t inline editing:
        </p>

        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            <strong>Move page</strong>: pick a destination <strong>Space</strong> and a{" "}
            <strong>Parent page</strong> (searchable, or <Code>Top-level page</Code>) to
            relocate a page anywhere - even into a different space. Its child pages
            move with it, and the picker won&apos;t let you drop a page inside one of
            its own descendants.
          </li>
          <li>
            <strong>Page history</strong>: opens the revision timeline (see{" "}
            <em>Revision History, Visual Diff &amp; Export</em>).
          </li>
          <li>
            <strong>Import from file…</strong>: convert documents into new child pages
            (see <em>Importing documents as new pages</em> in Attachments &amp; Media).
          </li>
          <li>
            <strong>View</strong> → <strong>Full width</strong> /{" "}
            <strong>Normal width</strong>: widen the reading column, useful for pages
            dense with tables or screenshots.
          </li>
          <li>
            <strong>Export</strong> → <strong>HTML</strong> / <strong>PDF</strong> /{" "}
            <strong>Word</strong>: see <em>Revision History, Visual Diff &amp; Export</em>{" "}
            for exactly what each format preserves.
          </li>
          <li>
            <strong className="text-danger">Delete page</strong>: permanently removes
            the page.
          </li>
        </ul>

        <Callout variant="warning" title="DELETING NEVER ORPHANS CHILD PAGES">
          Deleting a page moves any of its child pages up one level rather than deleting
          them too - their content always stays reachable.
        </Callout>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // WRITING CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "pages",
    title: "Pages, Sticky Toolbar & Source Editing",
    category: "Writing",
    description:
      "Master the rich-text editor, sticky toolbar, source code editor, and drafts.",
    keywords: [
      "editor",
      "toolbar",
      "sticky",
      "markdown",
      "html",
      "source",
      "draft",
      "autosave",
    ],
    body: (
      <>
        <p>
          WikiHub features a state-of-the-art document editor designed for fast,
          distraction-free writing.
        </p>

        <Callout variant="important" title="STICKY SCROLL TOOLBAR">
          As you scroll down long documents in edit mode, the editor toolbar
          remains fixed at the top of your screen. You can format text, insert
          elements, or switch modes at any time without scrolling back up.
        </Callout>

        <p className="mt-4 font-semibold text-foreground">Editing Modes & Tools:</p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Rich-Text Mode</strong>: WYSIWYG editing with full inline
            formatting tools:
            <div className="mt-1 flex flex-wrap gap-1">
              <Kbd>Bold (Ctrl+B)</Kbd>
              <Kbd>Italic (Ctrl+I)</Kbd>
              <Kbd>Underline (Ctrl+U)</Kbd>
              <Kbd>Strikethrough</Kbd>
              <Kbd>Inline Code</Kbd>
              <Kbd>Link (Ctrl+K)</Kbd>
            </div>
          </li>
          <li>
            <strong>Markdown &amp; HTML Source Mode</strong>: Click{" "}
            <Code>&lt;Source /&gt;</Code> in the editor header to toggle into raw
            Markdown or HTML code view. Perfect for pasting technical documents,
            inspecting markup, or fine-tuning exact HTML elements.
          </li>
          <li>
            <strong>Automatic Local &amp; Server Drafts</strong>: Every keystroke
            is automatically saved to your browser&apos;s local storage and synced with
            the server. If you accidentally close your browser, your draft is
            restored seamlessly when you return.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "slash-commands",
    title: "Slash Commands (/) Quick Reference",
    category: "Writing",
    description:
      "Full interactive list of / slash commands for instant block insertion.",
    keywords: [
      "slash",
      "shortcut",
      "heading",
      "callout",
      "table",
      "code",
      "image",
      "todo",
      "toggle",
    ],
    body: (
      <>
        <p>
          Type <Code>/</Code> at the beginning of any empty paragraph to open the{" "}
          <strong>Slash Command Popup Menu</strong>. Keep typing to filter
          commands, or press <Kbd>Enter</Kbd> to insert.
        </p>

        <div className="border-border bg-surface mt-4 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-32">Command</th>
                <th className="p-2.5 w-40">Name</th>
                <th className="p-2.5">Description &amp; Behavior</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/h1</Code>, <Code>/h2</Code>, <Code>/h3</Code></td>
                <td className="p-2.5 font-medium">Headings</td>
                <td className="p-2.5">Insert Section Heading 1, 2, or 3.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/bullet</Code></td>
                <td className="p-2.5 font-medium">Bulleted List</td>
                <td className="p-2.5">Create an unordered bulleted list item.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/numbered</Code></td>
                <td className="p-2.5 font-medium">Numbered List</td>
                <td className="p-2.5">Create a ordered sequential list item.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/todo</Code></td>
                <td className="p-2.5 font-medium">To-Do List</td>
                <td className="p-2.5">Interactive checkbox item; state persists on save.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/quote</Code></td>
                <td className="p-2.5 font-medium">Blockquote</td>
                <td className="p-2.5">Border-accented blockquote container.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/callout</Code></td>
                <td className="p-2.5 font-medium">Callout Alert</td>
                <td className="p-2.5">Highlighted alert callout box with icon.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/toggle</Code></td>
                <td className="p-2.5 font-medium">Toggle Collapsible</td>
                <td className="p-2.5">Accordion container with expandable/collapsible body.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/table</Code></td>
                <td className="p-2.5 font-medium">Data Table</td>
                <td className="p-2.5">Insert a multi-column data table matrix.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/code</Code></td>
                <td className="p-2.5 font-medium">Code Block</td>
                <td className="p-2.5">Syntax-highlighted code block with language picker.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/image</Code></td>
                <td className="p-2.5 font-medium">Image Upload</td>
                <td className="p-2.5">Upload image with corner resize handles &amp; captions.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/attachment</Code></td>
                <td className="p-2.5 font-medium">File Attachment</td>
                <td className="p-2.5">Upload file with detail modal &amp; code preview.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/divider</Code></td>
                <td className="p-2.5 font-medium">Divider Rule</td>
                <td className="p-2.5">Horizontal line separator (<Code>---</Code>).</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/link-to-page</Code></td>
                <td className="p-2.5 font-medium">Page Picker Link</td>
                <td className="p-2.5">Search and insert an inline link to another wiki page.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>/subpage</Code></td>
                <td className="p-2.5 font-medium">Create Sub-page</td>
                <td className="p-2.5">Spawn a new child page under this one, without leaving the editor.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: "images-and-attachments",
    title: "Images, Resizing & File Attachments",
    category: "Writing",
    description:
      "Upload images, drag resize handles, set alignment, captions, and preview files.",
    keywords: ["image", "attachment", "resize", "align", "caption", "preview", "modal"],
    body: (
      <>
        <p>
          WikiHub makes media integration seamless for technical documentation.
        </p>

        <Callout variant="tip" title="DRAG-AND-DROP UPLOADS">
          You can drag images directly from your computer into the editor surface to upload them instantly.
        </Callout>

        <p className="mt-3 font-semibold text-foreground">Image Features:</p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Corner Resize Handles</strong>: Click any image in edit mode to
            display visual corner handles. Click and drag the handle to resize the
            pixel width dynamically.
          </li>
          <li>
            <strong>Floating Image Toolbar</strong>: Hover over any image to access
            quick positioning controls: <Code>Align Left</Code>, <Code>Center</Code>,{" "}
            <Code>Align Right</Code>, and <Code>Edit Caption</Code>.
          </li>
          <li>
            <strong>Captions</strong>: Add descriptive captions below images; captions
            are formatted with subtle text for clean presentation.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">File Attachments:</p>
        <p className="text-sm">
          Upload PDF documents, archives (<Code>.zip</Code>, <Code>.tar.gz</Code>), code
          files, video, or Office documents the same way. Clicking any attachment opens
          the same interactive preview modal - see the{" "}
          <strong>Attachments &amp; Media</strong> guide for what each file type can do
          once it&apos;s uploaded, including in-place Office editing, PowerPoint
          slideshows, and video Picture-in-Picture.
        </p>
      </>
    ),
  },
  {
    id: "tables-and-codeblocks",
    title: "Tables, Code Blocks & Interactive Components",
    category: "Writing",
    description:
      "Manage multi-column tables, syntax highlighting, 1-click copy, and checkable tasks.",
    keywords: [
      "table",
      "codeblock",
      "syntax",
      "toggle",
      "collapsible",
      "todo",
      "copy",
    ],
    body: (
      <>
        <p>
          Present structured information using advanced interactive blocks.
        </p>

        <p className="mt-3 font-semibold text-foreground">1. Data Tables:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            Hover over table cells to reveal action chevrons for inserting/deleting
            rows and columns.
          </li>
          <li>Toggle header row formatting to highlight column titles.</li>
          <li>Cells support rich inline formatting (links, bold, inline code).</li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">
          2. Syntax-Highlighted Code Blocks:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            Automatic syntax highlighting powered by Prism/HLJS for over 40
            languages (Python, TypeScript, Go, Rust, SQL, Bash, Dockerfile, etc.).
          </li>
          <li>
            <strong>Options Bar</strong>: Click the top-right options icon on any code
            block to open the <strong>Code Block Details Modal</strong> to set a language,
            title, or line numbers.
          </li>
          <li>
            <strong>1-Click Copy</strong>: Readers can click the <Code>Copy</Code>{" "}
            button to copy raw code to their clipboard instantly.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">
          3. Collapsible Toggles &amp; To-Do Lists:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            <strong>Toggle Blocks</strong>: Collapse lengthy secondary content (such as
            changelogs or raw payloads) under an expandable chevron.
          </li>
          <li>
            <strong>Checkable To-Do Lists</strong>: Create task checklists. Clicking a
            checkbox toggles its completed state and persists when saved.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "history-and-export",
    title: "Revision History, Visual Diff & Export",
    category: "Writing",
    description:
      "Compare document revisions, restore past versions safely, and export to PDF, HTML, or Word.",
    keywords: [
      "revision",
      "history",
      "compare",
      "diff",
      "restore",
      "pdf",
      "html",
      "word",
      "docx",
      "export",
    ],
    body: (
      <>
        <p>
          WikiHub keeps a complete, immutable audit trail of every change saved to a
          page.
        </p>

        <Callout variant="tip" title="REVISION RESTORE SAFETY">
          Restoring an old revision never deletes history! Restoring creates a brand
          new revision with the older content, so all intermediate revisions remain
          intact forever.
        </Callout>

        <p className="mt-3 font-semibold text-foreground">History Features:</p>
        <ol className="list-decimal pl-5 space-y-2 text-sm">
          <li>
            <strong>Page History Timeline</strong>: Click <strong>History</strong> in the
            page action bar to view a chronological list of revisions with author,
            timestamp, and change summary.
          </li>
          <li>
            <strong>Visual Diff Comparison</strong>: Select any two revisions to compare
            changes side-by-side or inline. Additions are highlighted in green,
            and deletions are highlighted in red.
          </li>
          <li>
            <strong>Export</strong>: Open <strong>Export</strong> in page actions to
            download the page as PDF, HTML, or Word. PDF and HTML are rendered from
            the exact page you see on screen, so colors, fonts, code highlighting,
            callouts, and tables come out looking identical to the live page - not a
            re-formatted approximation of it.
          </li>
        </ol>

        <Callout variant="note" title="WHAT LOOKS DIFFERENT IN AN EXPORT">
          A collapsed toggle section exports fully expanded, since a static file has
          no way to click it open. Word is the one format with a real ceiling: its
          .docx format has no equivalent of a CSS rounded corner, shadow, or
          gradient, so a callout or code block comes out as a square shaded
          paragraph - faithful in color and text, not in exact shape. PDF and HTML
          have no such limit.
        </Callout>
      </>
    ),
  },
  {
    id: "drafts-and-autosave",
    title: "Draft Auto-save & Recovery",
    category: "Writing",
    description:
      "Every edit is safeguarded by a server-synced draft, with a recovery banner if you never actually published it.",
    keywords: [
      "draft",
      "autosave",
      "auto-save",
      "recovery",
      "discard",
      "unsaved",
      "conflict",
    ],
    body: (
      <>
        <p>
          Publishing a page (clicking <Code>Save</Code>) and merely having unsaved
          changes are two different things in WikiHub - a dedicated draft system sits
          between them so a closed tab or a crashed browser never costs you real work.
        </p>

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Auto-save toggle</strong>: while editing, switch on{" "}
            <Code>Auto-save</Code> (in the editor toolbar) to save your in-progress edit
            to the server every 30 seconds - separately from actually publishing the
            page. A local copy is also kept in your browser as a fallback.
          </li>
          <li>
            <strong>Recovering a draft</strong>: if you navigate away (or your browser
            closes) with an unpublished draft still pending, coming back to that page
            shows a <Code>Draft not released</Code> banner - &ldquo;This draft was last
            saved on {"{date}"} and has not been saved to the page.&rdquo; Click{" "}
            <strong>Open editor</strong> to resume exactly where you left off, or{" "}
            <strong>Discard draft</strong> to throw it away.
          </li>
          <li>
            <strong>Conflict warning</strong>: if someone else published changes to the
            page after your draft was created, the banner adds{" "}
            <em>&ldquo;The page has changed since this draft was created.&rdquo;</em> so
            you know to check for overlap before resuming.
          </li>
        </ul>

        <Callout variant="tip" title="DISCARDING IS SAFE, NOT SILENT">
          <strong>Discard draft</strong> asks &ldquo;Discard unreleased draft?&rdquo;
          before doing anything - it only ever removes the saved draft and restores the
          page to its current, already-published content.
        </Callout>
      </>
    ),
  },
  {
    id: "format-conversion",
    title: "Switching Between Rich Text, Markdown & HTML",
    category: "Writing",
    description:
      "Convert a page's underlying format on the fly, with an explicit warning about what a lossy conversion changes.",
    keywords: [
      "markdown",
      "html",
      "convert",
      "live preview",
      "split",
      "source",
      "lossy",
    ],
    body: (
      <>
        <p>
          Switching a page&apos;s edit mode between <strong>Rich text</strong> and{" "}
          <strong>Markdown</strong> source is not just a different view of the same
          data - the underlying content format actually changes, so WikiHub confirms it
          first.
        </p>

        <Callout variant="warning" title="CONVERT TO MARKDOWN IS LOSSY-AWARE">
          Markdown cannot represent every rich-text feature - text colors, cell
          backgrounds, and merged table cells have no Markdown syntax. To preserve them
          anyway, WikiHub embeds their raw HTML directly inside the Markdown source
          rather than silently dropping them. Converting back to HTML is always
          lossless.
        </Callout>

        <p className="mt-3 font-semibold text-foreground">
          While editing in Markdown source:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            <strong>Live preview</strong>: toggle a rendered preview of your Markdown
            alongside the raw source.
          </li>
          <li>
            <strong>Split / Full layout</strong>: choose side-by-side source-and-preview,
            or a preview-only view for proofreading before you save.
          </li>
        </ul>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // ATTACHMENTS & MEDIA CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "attachment-previews",
    title: "Previewing Files Without Leaving the Page",
    category: "Attachments & Media",
    description:
      "Open any uploaded file - image, PDF, video, code, or Office document - in a live preview modal, no download required.",
    keywords: [
      "attachment",
      "preview",
      "modal",
      "pdf",
      "zoom",
      "rotate",
      "download",
      "code",
      "search",
    ],
    body: (
      <>
        <p>
          Click any attachment in a page to open the <strong>Attachment details</strong>{" "}
          modal - the same modal for every file type, with a preview panel that adapts
          to what the file actually is:
        </p>

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Images</strong>: zoom and pan.
          </li>
          <li>
            <strong>PDFs</strong>: continuous multi-page viewer with zoom out / actual
            size / zoom in, a <strong>Rotate pages</strong> button (90° steps), and an
            expand-to-full-size toggle.
          </li>
          <li>
            <strong>Video</strong>: full playback controls plus subtitles, audio-track
            switching, and Picture-in-Picture - see{" "}
            <em>Video: Subtitles, Audio Tracks &amp; Picture-in-Picture</em> below.
          </li>
          <li>
            <strong>Word, Excel &amp; PowerPoint</strong>: a faithful rendered preview
            (with its own zoom controls) and, while you are editing the page, an{" "}
            <strong>Edit</strong> button - see <em>Editing Word, Excel &amp; PowerPoint
            in Place</em> below.
          </li>
          <li>
            <strong>Code &amp; text files</strong> (<Code>.py</Code>, <Code>.ts</Code>,{" "}
            <Code>.json</Code>, <Code>.md</Code>, <Code>.log</Code>, etc.):
            syntax-highlighted with line numbers, a <strong>Search content…</strong> box
            with a match counter and Previous/Next-match navigation (
            <Kbd>Enter</Kbd> / <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> to cycle matches), and a
            word-wrap toggle.
          </li>
          <li>
            <strong>Everything else</strong> (archives, binaries, unrecognized types):
            file details and a <strong>Download</strong> button.
          </li>
        </ul>

        <Callout variant="tip" title="FILE DETAILS AT A GLANCE">
          Hover the <Code>ⓘ</Code> icon next to the &ldquo;Attachment details&rdquo;
          title for filename, size, MIME type, and upload date - without opening
          Download.
        </Callout>

        <p className="mt-3 text-sm text-muted-foreground">
          Real-world use case: checking the exact contents of a teammate&apos;s{" "}
          <Code>config.json</Code>, reviewing a signed PDF contract, or eyeballing a
          design PNG - all without ever leaving the wiki page it&apos;s attached to.
        </p>
      </>
    ),
  },
  {
    id: "office-editing",
    title: "Editing Word, Excel & PowerPoint in Place",
    category: "Attachments & Media",
    description:
      "Open the built-in document editor directly from an attachment preview - no download, edit, and re-upload cycle.",
    keywords: [
      "onlyoffice",
      "word",
      "excel",
      "powerpoint",
      "docx",
      "xlsx",
      "pptx",
      "edit",
      "autosave",
    ],
    body: (
      <>
        <p>
          WikiHub can embed a full <strong>ONLYOFFICE</strong> document editor directly
          inside the attachment preview modal for <Code>.docx</Code>,{" "}
          <Code>.xlsx</Code>, and <Code>.pptx</Code> files - the same ribbon, formulas,
          formatting, and slide layouts as the desktop apps, running in the browser.
        </p>

        <ol className="list-decimal pl-5 space-y-2 text-sm">
          <li>
            While <strong>editing</strong> the page (the Edit button only appears in
            edit mode, not for someone just reading the page), open the attachment and
            click <strong>Edit</strong> (pencil icon) next to Download.
          </li>
          <li>
            Changes <strong>autosave</strong> as you type - there is no manual Save
            button, and the toolbar shows <Code>Saving changes…</Code> or{" "}
            <Code>{"{filename}"} · Changes save automatically</Code>. Every save bumps
            the attachment&apos;s revision, so it stays accounted for in the page&apos;s
            activity.
          </li>
          <li>
            Click <strong>Back to preview</strong> to return to the read-only render at
            any time.
          </li>
        </ol>

        <Callout variant="note" title="ONLY .DOCX / .XLSX / .PPTX ARE EDITABLE">
          Other Office formats - <Code>.doc</Code>, <Code>.ppt</Code>,{" "}
          <Code>.xls</Code>, <Code>.odp</Code>, <Code>.ods</Code>, and template variants
          like <Code>.dotx</Code>/<Code>.potx</Code>/<Code>.xltx</Code> - preview
          correctly but must be edited elsewhere and re-uploaded.
        </Callout>

        <Callout variant="warning" title="REQUIRES AN ADMIN-CONNECTED DOCUMENT SERVER">
          The Edit button only appears when an administrator has configured and
          connected an ONLYOFFICE Document Server. If it&apos;s missing entirely, or
          shows &ldquo;The workspace document editor is not configured,&rdquo; ask your
          administrator.
        </Callout>

        <p className="mt-3 text-sm text-muted-foreground">
          Real-world use case: fixing a typo in a shared spec <Code>.docx</Code> or
          updating a budget <Code>.xlsx</Code> without leaving the wiki or e-mailing a
          new copy back and forth.
        </p>
      </>
    ),
  },
  {
    id: "video-playback",
    title: "Video: Subtitles, Audio Tracks & Picture-in-Picture",
    category: "Attachments & Media",
    description:
      "Play uploaded videos with subtitle and audio-track switching, and keep watching in a floating window while you work elsewhere.",
    keywords: [
      "video",
      "subtitle",
      "caption",
      "audio track",
      "picture-in-picture",
      "pip",
      "mp4",
    ],
    body: (
      <>
        <p>
          Click a video attachment to open the standard HTML5 player with play/pause,
          seek, volume, and fullscreen.
        </p>

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Subtitles</strong>: if the video has caption tracks, a{" "}
            <strong>Subtitles</strong> button appears in the preview toolbar - pick a
            track, or <Code>Off</Code>.
          </li>
          <li>
            <strong>Audio tracks</strong>: for videos with more than one audio track, an{" "}
            <strong>Audio track</strong> picker lets you switch between them (only where
            the browser itself exposes multiple tracks - not every format supports
            this).
          </li>
          <li>
            <strong>Picture-in-Picture</strong>: use the PiP icon in the player&apos;s
            own controls (or right-click → <em>Picture in Picture</em>) to pop the video
            into a small floating window that stays on top of every other window and
            tab.
          </li>
        </ul>

        <Callout variant="tip" title="PIP KEEPS PLAYING THROUGH A CLOSED MODAL">
          Closing the attachment preview while a video is floating in Picture-in-Picture
          does <strong>not</strong> stop it - exactly like closing a browser tab
          doesn&apos;t stop a PiP video elsewhere on the web. Leaving PiP (its own
          &ldquo;back to tab&rdquo; or close control) reopens the preview automatically,
          resuming right where you left off. Only closing that reopened preview actually
          stops playback.
        </Callout>

        <p className="mt-3 text-sm text-muted-foreground">
          Real-world use case: watching a recorded demo or training clip in the corner
          of your screen while you take notes or reply in chat in another tab.
        </p>
      </>
    ),
  },
  {
    id: "pptx-slideshow",
    title: "Presenting a PowerPoint Deck: Fullscreen Slideshow",
    category: "Attachments & Media",
    description:
      "Run a PowerPoint attachment as a real fullscreen slideshow, straight from its preview.",
    keywords: [
      "powerpoint",
      "pptx",
      "slideshow",
      "present",
      "presentation",
      "fullscreen",
    ],
    body: (
      <>
        <p>
          Open any <Code>.pptx</Code> attachment - it renders as a paginated deck with a
          thumbnail rail on the left and the current slide on the right. Use the
          on-screen <Code>‹ ›</Code> arrows, or <Kbd>←</Kbd>/<Kbd>→</Kbd>, to move
          between slides at any time.
        </p>

        <ol className="list-decimal pl-5 space-y-2 text-sm">
          <li>
            Click <strong>Present</strong> (the small monitor icon in the toolbar) to
            start a fullscreen slideshow: the deck fills the entire screen,
            letterboxed to the slide&apos;s own aspect ratio, with no browser chrome or
            thumbnail rail in the way.
          </li>
          <li>
            Press <Kbd>Esc</Kbd>, or click the <Code>✕</Code> in the top-right corner,
            to exit - back to the normal preview, not the whole attachment window.
          </li>
        </ol>

        <p className="mt-3 text-sm text-muted-foreground">
          Real-world use case: presenting a slide deck straight from the wiki page
          it&apos;s attached to during a meeting, with no extra software and no
          re-downloading the file first.
        </p>
      </>
    ),
  },
  {
    id: "importing-documents",
    title: "Importing Documents as New Pages",
    category: "Attachments & Media",
    description:
      "Turn existing Word, PDF, Markdown, and other documents into wiki pages in bulk - no copy-pasting.",
    keywords: [
      "import",
      "docx",
      "pdf",
      "markdown",
      "epub",
      "convert",
      "bulk",
      "drag and drop",
    ],
    body: (
      <>
        <p>
          From any page, open the <Code>⋯</Code> menu and choose{" "}
          <strong>Import from file…</strong>.
        </p>

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            Drag and drop, or browse for, up to <strong>20 files</strong> at once.
            Supported formats: Word (<Code>.docx</Code>), OpenDocument Text (
            <Code>.odt</Code>), Rich Text (<Code>.rtf</Code>), EPUB (
            <Code>.epub</Code>), HTML (<Code>.html</Code>/<Code>.htm</Code>), Markdown (
            <Code>.md</Code>/<Code>.markdown</Code>), and PDF (<Code>.pdf</Code>).
          </li>
          <li>
            Each file becomes a new <strong>child page</strong> under the page you
            started from (or at the top level of the space, from Home) - headings,
            formatting, and images carry over automatically.
          </li>
          <li>
            Import runs as a background job with a live per-file progress indicator
            (queued / running / complete / failed), each finished file linking straight
            to its new page, so you can keep working while a large batch converts.
          </li>
        </ul>

        <Callout variant="note" title="NOT THE SAME AS CONFLUENCE IMPORT">
          This is different from <strong>Confluence Archive Import</strong> under{" "}
          <strong>Administration &gt; Backup</strong>: that one restores a whole
          exported Confluence <em>space</em>, including permissions and history, and is
          admin-only. <strong>Import from file…</strong> converts individual documents
          into fresh pages, and is available to anyone who can edit the space.
        </Callout>

        <p className="mt-3 text-sm text-muted-foreground">
          Real-world use case: migrating a folder of existing Word or PDF runbooks into
          the wiki as a properly organized page tree, in one pass.
        </p>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // ACCOUNT CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "your-account",
    title: "Profile, Password Security & Active Sessions",
    category: "Account",
    description:
      "Update profile identity, enforce password security, and manage active sessions.",
    keywords: ["avatar", "password", "authentication", "session", "profile", "logout"],
    body: (
      <>
        <p>
          Manage your personal account preferences under <strong>Your account</strong>{" "}
          from the profile menu.
        </p>

        <p className="mt-3 font-semibold text-foreground">1. User Profile Settings:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            Click <strong>Edit profile</strong> to update display name, email, avatar
            image, bio, pronouns, company, and social links.
          </li>
          <li>Field validation provides instant feedback on format or requirement errors.</li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">
          2. Password Security &amp; Rules:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            Update your password in <strong>Password &amp; authentication</strong>.
          </li>
          <li>
            Password strength meters check length, numbers, symbols, and uppercase
            character rules. Click <strong>Generate password</strong> to create a strong
            random password.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">3. Active Sessions Management:</p>
        <p className="text-sm">
          In <strong>Sessions</strong>, view active browsers and sign out all other
          sessions if you see activity you do not recognise. You can revoke specific
          devices or click <strong>Revoke all sessions</strong> to invalidate
          all remote tokens immediately.
        </p>
      </>
    ),
  },
  {
    id: "keyboard-shortcut-settings",
    title: "Customising Keyboard Shortcuts",
    category: "Account",
    description:
      "Rebind WikiHub's shortcuts to keys that suit you, add second bindings, and reset to defaults.",
    keywords: [
      "keyboard",
      "shortcut",
      "hotkey",
      "rebind",
      "remap",
      "customize",
      "customise",
      "keybinding",
      "ctrl",
      "cmd",
    ],
    body: (
      <>
        <p>
          WikiHub&apos;s shortcuts are defaults, not fixed rules. Open{" "}
          <strong>Your account</strong> from the profile menu and choose{" "}
          <strong>Keyboard shortcuts</strong> to change any of them.
        </p>

        <p className="mt-3 font-semibold text-foreground">1. Rebinding a shortcut:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            Click the key badge next to the action you want to change - it switches to{" "}
            <em>Press keys…</em>
          </li>
          <li>
            Press the combination you want. It is captured and saved the moment you press
            it; there is no separate Save button.
          </li>
          <li>
            Press <Kbd>Esc</Kbd> to back out without changing anything.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">
          2. Several keys for one action:
        </p>
        <p className="text-sm">
          Click <Code>+</Code> to give an action a second (or third) combination - handy
          when you want both an old habit and a new one to work. Global search ships this
          way, answering to both <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd> and <Kbd>Ctrl</Kbd>+
          <Kbd>F</Kbd>. Remove one with the <Code>✕</Code> beside it; the last remaining
          binding cannot be removed, so an action is never left unreachable by accident.
        </p>

        <p className="mt-4 font-semibold text-foreground">3. Getting back to normal:</p>
        <p className="text-sm">
          A circular arrow appears beside any action you have changed - click it to
          restore just that one. <strong>Reset all to defaults</strong> at the top
          restores every shortcut at once.
        </p>

        <p className="mt-4 font-semibold text-foreground">4. Where each shortcut applies:</p>
        <p className="text-sm">
          Each action lists the context it works in - anywhere in the app, while editing a
          page, or while an attachment preview is open. Two actions in{" "}
          <em>different</em> contexts may safely share a combination, and the narrower one
          wins while it is active. That is exactly how <Kbd>Ctrl</Kbd>+<Kbd>F</Kbd> works
          by default: normally it opens global search, but while you have a text file
          preview open it searches inside that file instead.
        </p>

        <Callout variant="note" title="CONFLICT WARNINGS">
          <p>
            If you assign one combination to two actions in the <em>same</em> context, a
            warning appears at the top and both badges turn amber. Whichever action
            handles the key first wins, so the other may not fire. Nothing stops you
            saving it - the warning is there so a shortcut that has quietly stopped
            working is never a mystery.
          </p>
        </Callout>

        <Callout variant="tip">
          <p>
            The hint on the search bar in the top bar follows whatever you have bound, so
            it always shows the combination that actually works.
          </p>
        </Callout>

        <Callout variant="warning" title="WHAT CANNOT BE REBOUND">
          <p>
            Some combinations are reserved by the browser itself - <Kbd>Ctrl</Kbd>+
            <Kbd>W</Kbd>, <Kbd>Ctrl</Kbd>+<Kbd>T</Kbd>, <Kbd>Ctrl</Kbd>+<Kbd>N</Kbd> and
            similar. They never reach the page, so WikiHub cannot capture them.
          </p>
          <p>
            Text formatting keys inside the editor (<Kbd>Ctrl</Kbd>+<Kbd>B</Kbd> for bold
            and friends), <Kbd>/</Kbd> for the slash menu, and <Kbd>Esc</Kbd> for closing
            overlays are also fixed and do not appear in this list.
          </p>
          <p>
            Your shortcuts are stored in the browser you set them in, so they do not
            follow you to another computer or survive clearing site data.
          </p>
        </Callout>
      </>
    ),
  },

  // ---------------------------------------------------------------------------
  // ADMINISTRATION CATEGORY
  // ---------------------------------------------------------------------------
  {
    id: "theme-and-branding",
    title: "Theme & Branding Customization",
    category: "Administration",
    description:
      "Customize brand colors, preset & custom logo icons, dark mode, and dynamic tab favicons.",
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
      "ssr",
    ],
    body: (
      <>
        <p>
          Administrators can fully customize WikiHub&apos;s visual identity under{" "}
          <strong>Administration &gt; Settings &gt; Theme &amp; Branding</strong>.
        </p>

        <Callout variant="important" title="DRAFT MODE & PREVIEW MODAL">
          Theme modifications stay in draft mode until you explicitly click{" "}
          <strong>Save settings</strong>! Click <strong>Preview Theme</strong> to open an
          interactive sandbox modal where you can test colors, search, navigation tabs,
          buttons, and Light/Dark mode.
        </Callout>

        <div className="border-border bg-surface mt-4 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-44">Setting</th>
                <th className="p-2.5">Description &amp; Options</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Brand Color Presets</td>
                <td className="p-2.5">
                  Choose from 8 curated palettes: <Code>Blue</Code>, <Code>Emerald</Code>,{" "}
                  <Code>Indigo</Code>, <Code>Violet</Code>, <Code>Rose</Code>,{" "}
                  <Code>Amber</Code>, <Code>Teal</Code>, <Code>Slate</Code>.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Custom Hex Picker</td>
                <td className="p-2.5">
                  Enter any custom primary hex color code (e.g., <Code>#216fc0</Code>).
                  Generates a full 10-shade HSL palette automatically.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Logo Mark Presets</td>
                <td className="p-2.5">
                  Select from 9 built-in vector icons: <Code>Hub</Code>, <Code>Book</Code>,{" "}
                  <Code>Layers</Code>, <Code>Compass</Code>, <Code>Sparkles</Code>,{" "}
                  <Code>Feather</Code>, <Code>Graduation</Code>, <Code>CPU</Code>,{" "}
                  <Code>Shield</Code>.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Custom Logo Upload</td>
                <td className="p-2.5">
                  Upload your organization&apos;s custom PNG or SVG image (under 2MB).
                  Automatically scales and renders across header and favicon.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Dynamic Tab Favicon</td>
                <td className="p-2.5">
                  HTML5 Canvas converts preset SVGs or uploaded logos into rasterized
                  64x64 PNG data URLs, updating the browser tab strip instantly.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Zero-Flicker SSR</td>
                <td className="p-2.5">
                  CSS theme variables are preloaded in <Code>&lt;head&gt;</Code> on frame 0,
                  preventing white/blue flash during page refreshes.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5 font-semibold">Font Picker</td>
                <td className="p-2.5">
                  Clicking a font in the list opens a <strong>Font Specimen</strong>{" "}
                  modal - an interactive type tester with a free-text sample input, four
                  preset sample sentences, five size presets (14–36px), a full
                  document-hierarchy mockup, and a glyph/character-set matrix - before
                  you commit with <strong>Apply This Font</strong>.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Callout variant="tip" title="LIGHT/DARK PREVIEW WITHOUT SAVING">
          The <strong>Preview Theme</strong> sandbox has its own{" "}
          <strong>Light Preview</strong> / <strong>Dark Preview</strong> toggle, so you
          can check a brand color against a mock document in both modes before a single
          real user sees it.
        </Callout>
      </>
    ),
  },
  {
    id: "settings-and-storage",
    title: "Instance Settings & Object Storage Explorer",
    category: "Administration",
    description:
      "Configure global site parameters, upload limits, role matrix, and S3 object storage.",
    keywords: [
      "settings",
      "storage",
      "objects",
      "attachment",
      "limits",
      "matrix",
      "download",
      "s3",
    ],
    body: (
      <>
        <p>
          Administrators configure global workspace behavior under{" "}
          <strong>Administration &gt; Settings</strong> and manage raw S3 storage under{" "}
          <strong>Storage</strong>.
        </p>

        <p className="mt-3 font-semibold text-foreground">1. Global Instance Settings:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            <strong>Site Name</strong>: Custom site title displayed in browser tab and top bar.
          </li>
          <li>
            <strong>Session Lifetime (Hours)</strong>: Configure JWT session expiration (e.g. 24h, 72h, 168h).
          </li>
          <li>
            <strong>Max Single Attachment Size (MB)</strong>: Enforce upload size limits (e.g. 25MB, 50MB, 100MB).
          </li>
          <li>
            <strong>Max Backup Import Size (MB)</strong>: Set upper limit for ZIP backup imports (e.g. 500MB, 2000MB).
          </li>
          <li>
            <strong>Allowed Attachment Extensions</strong>: Whitelist file extensions (e.g. <Code>png, pdf, zip, docx, *</Code>).
          </li>
          <li>
            <strong>Sidebar Access Matrix</strong>: Select which navigation sections are visible per user role (<Code>member</Code>, <Code>admin</Code>).
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">2. Object Storage Explorer:</p>
        <p className="text-sm">
          The <strong>Storage</strong> panel provides a clean S3 bucket tree browser:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm mt-1">
          <li>Clean tree formatting with regular text font styling for folders and files.</li>
          <li>Filter objects by search query, file type, space, or page ID.</li>
          <li>Generate secure pre-signed download URLs.</li>
          <li>Preview images and code/text files inline.</li>
          <li>Delete orphan objects with automatic database attachment and archive hash clearance.</li>
        </ul>
      </>
    ),
  },
  {
    id: "admin-users-groups",
    title: "Managing Users & Groups",
    category: "Administration",
    description:
      "Create accounts directly (there is no e-mail invite flow), assign roles, and bundle people into groups for reusable permission grants.",
    keywords: [
      "users",
      "groups",
      "create user",
      "invite",
      "password",
      "deactivate",
      "delete user",
      "role",
    ],
    body: (
      <>
        <Callout variant="important" title="THERE IS NO E-MAIL INVITE FLOW">
          WikiHub does not send invitation e-mails. An administrator creates every
          account directly under <strong>Administration &gt; Users &gt; Create
          user</strong> and shares the temporary password with that person out of band
          (chat, in person, etc.).
        </Callout>

        <p className="mt-3 font-semibold text-foreground">1. Users:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            The directory shows summary tiles (Total / Administrators / Members /
            Active / Disabled), with search and Status/Role filters.
          </li>
          <li>
            <strong>Create user</strong>: first/last name, username (checked for
            availability as you type), e-mail, a password with a live strength
            checklist (8+ characters, upper &amp; lower case, a number or symbol), and a
            role of <Code>Member</Code> or <Code>Administrator</Code>.
          </li>
          <li>
            Per-user actions: <strong>Reset password</strong>,{" "}
            <strong>Deactivate</strong>/<strong>Activate account</strong>, and{" "}
            <strong>Delete user…</strong>. Your own account and the protected bootstrap
            admin account are excluded from these destructive actions, so you can never
            lock yourself out.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">2. Groups:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            Groups bundle users for reusable space-permission grants - assign a group
            once in a space&apos;s <strong>Access</strong> panel instead of adding every
            member individually.
          </li>
          <li>
            Each group can also carry <strong>global permissions</strong>: Create
            spaces, Manage users, Manage groups, System admin.
          </li>
          <li>
            The default system groups (<Code>administrators</Code>, <Code>users</Code>,{" "}
            <Code>confluence-administrators</Code>, <Code>confluence-users</Code>)
            cannot be deleted, only edited.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "admin-spaces-access",
    title: "Space Access & Effective Permissions",
    category: "Administration",
    description:
      "Grant per-space permissions to users or groups, and check exactly what any one person can do in a space.",
    keywords: [
      "space access",
      "permissions",
      "effective permissions",
      "groups",
      "restrict",
    ],
    body: (
      <>
        <p>
          <strong>Administration &gt; Spaces</strong> lists every space with Total /
          Active / Archived tiles. Permanent space deletion is only available here (an
          individual space&apos;s own settings only offer Archive). Open a space&apos;s{" "}
          <strong>Access</strong> panel to manage exactly who can do what:
        </p>

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>General access</strong>: <Code>Open</Code> (any workspace member can
            read) or <Code>Restricted</Code> (only people explicitly granted access).
          </li>
          <li>
            A <strong>Groups</strong> permission table and an{" "}
            <strong>Individual users</strong> permission table, each with checkboxes for{" "}
            <Code>View</Code>, <Code>Add</Code>, <Code>Delete</Code>,{" "}
            <Code>Delete own</Code>, <Code>Restrictions</Code>, <Code>Export</Code>, and{" "}
            <Code>Admin</Code>. Changes are explicit - Edit, then Save or Cancel - with
            an unsaved-changes guard if you navigate away mid-edit.
          </li>
          <li>
            <strong>Effective permissions</strong>: pick any user and see their fully
            resolved permission set for that space - combining Open access, any direct
            grant, and every group they belong to - instead of manually cross-referencing
            three sources by hand.
          </li>
        </ul>

        <p className="mt-3 text-sm text-muted-foreground">
          Real-world use case: before turning a space Restricted, use{" "}
          <strong>Effective permissions</strong> to confirm the one contractor account
          that still needs read access actually keeps it.
        </p>
      </>
    ),
  },
  {
    id: "switch-account",
    title: "Switch Account (Impersonation)",
    category: "Administration",
    description:
      "Superusers can view WikiHub exactly as another user sees it, to debug a permission problem or reproduce a bug report.",
    keywords: ["impersonate", "switch account", "debug", "superuser", "view as"],
    body: (
      <>
        <p>
          Superusers who are not already impersonating someone see a{" "}
          <strong>Switch account</strong> control (people icon) in the account menu,
          listing other active accounts. Picking one signs you in as them with no
          password exchange - useful for confirming &ldquo;why can&apos;t this person
          see that page&rdquo; without asking them to screen-share.
        </p>

        <Callout variant="warning" title="EVERY ACTION IS ATTRIBUTED AND VISIBLE">
          While impersonating, a permanent banner is pinned to the bottom of every
          screen: &ldquo;Viewing WikiHub as <strong>{"{name}"}</strong>. Your actions
          are recorded against {"{impersonator}"}.&rdquo; The account menu also shows{" "}
          <Code>Signed in as {"{impersonator}"}</Code>. Click{" "}
          <strong>Return to my account</strong> (in the banner or the menu) to end the
          session.
        </Callout>

        <p className="mt-3 text-sm text-muted-foreground">
          The protected bootstrap admin account and your own account are excluded from
          the switch list.
        </p>
      </>
    ),
  },
  {
    id: "backup-and-restore",
    title: "Backup, Confluence Import & DC Export",
    category: "Administration",
    description:
      "Two distinct export formats, resumable multi-gigabyte uploads, and the safety checks that stop the wrong archive from landing in the wrong place.",
    keywords: [
      "backup",
      "zip",
      "restore",
      "confluence",
      "import",
      "export",
      "xml",
      "datacenter",
      "resume",
      "sha-256",
    ],
    body: (
      <>
        <p>
          <strong>Administration &gt; Backup</strong> has two sections:{" "}
          <strong>Export / Backup</strong> and <strong>Import / Restore</strong>.
        </p>

        <p className="mt-3 font-semibold text-foreground">
          1. Two export formats - not interchangeable:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Export WikiHub Backup</strong>: a native, restorable{" "}
            <Code>.zip</Code> of spaces, pages, revisions, attachments, users, and
            groups - scoped to <strong>All spaces</strong> or a picked subset via{" "}
            <strong>Select spaces to export</strong>.
          </li>
          <li>
            <strong>Export Confluence Backup</strong>: an XML archive for Atlassian
            Confluence Data Center&apos;s own restore tooling, targeting{" "}
            <strong>Data Center 8.x</strong> or <strong>9.x</strong>. This one is a
            one-way hand-off - it cannot be used to restore WikiHub itself.
          </li>
        </ul>

        <Callout variant="warning" title="INCLUDE PASSWORD HASHES = HANDLE WITH CARE">
          The WikiHub backup&apos;s <strong>Include password hashes</strong> checkbox is
          off by default and explicitly warned as enabling offline password cracking if
          the archive leaks - only enable it for an actual migration, and store the file
          securely.
        </Callout>

        <p className="mt-4 font-semibold text-foreground">2. Restoring / importing:</p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            Both a WikiHub backup restore and a <strong>Confluence Archive
            Import</strong> upload as resumable, chunked, multi-gigabyte transfers with{" "}
            <strong>Pause upload</strong> / <strong>Resume upload</strong> controls -
            safe to start, pause, and pick back up later without re-sending what already
            made it through.
          </li>
          <li>
            Confluence import scans the archive for spaces, flags key conflicts, lets
            you pick which spaces to bring in, and runs as a background job with live
            log output.
          </li>
          <li>
            Restoring into an instance that already has spaces triggers a{" "}
            <strong>Replace existing spaces?</strong> conflict step for anything that
            would collide.
          </li>
        </ul>

        <Callout variant="tip" title="TWO SAFETY NETS AGAINST THE WRONG FILE">
          A client-side check catches an obviously wrong upload immediately - e.g.
          picking a Confluence export under WikiHub restore surfaces{" "}
          <em>
            &ldquo;This is a Confluence export, not a WikiHub backup. Upload it under
            &lsquo;Import Confluence Backup&rsquo; instead.&rdquo;
          </em>{" "}
          before anything even starts uploading. Separately, resuming an interrupted
          upload with a <em>different</em> file than the one partially uploaded shows a{" "}
          <strong>&ldquo;That is a different file&rdquo;</strong> dialog, comparing what
          was being uploaded against what you just chose (name, size, how much is
          already stored) and asking you to either{" "}
          <strong>Discard and upload this</strong> or <strong>Choose the original</strong>.
        </Callout>
      </>
    ),
  },
  {
    id: "safe-operation",
    title: "Safe Operation & System Troubleshooting",
    category: "Administration",
    description:
      "Prevent data loss, troubleshoot upload errors, and monitor background workers.",
    keywords: ["security", "troubleshooting", "failed", "upload", "access", "redis", "minio"],
    body: (
      <>
        <p>
          Best practices for maintaining workspace stability and resolving technical issues:
        </p>

        <ul className="list-disc pl-5 space-y-2 text-sm mt-2">
          <li>
            <strong>Access &amp; Permission Issues</strong>: If a user cannot see a page
            or space, check <em>Space access</em>, <em>Page access</em> restrictions,
            and group membership - or just open <strong>Effective permissions</strong>{" "}
            in the space&apos;s Access panel for that user and see the resolved answer
            directly instead of cross-referencing all three by hand.
          </li>
          <li>
            <strong>Upload Failures</strong>: Verify file size limits and allowed extensions under
            <strong>Settings</strong>. Ensure MinIO/S3 object storage is healthy and responsive.
          </li>
          <li>
            <strong>Import Worker Failures</strong>: Check background worker task logs, Redis queue
            connectivity, and available disk space. Scanned archives can be resumed from the Backup panel.
          </li>
          <li>
            <strong>API Documentation</strong>: Administrators can access interactive OpenAPI / Swagger
            documentation at <Code>/docs</Code> and ReDoc at <Code>/redoc</Code>.
          </li>
        </ul>

        <Callout variant="note" title="SET EXPECTATIONS: WHAT WIKIHUB DOESN'T DO YET">
          Three things people often go looking for don&apos;t exist in this build, so
          it&apos;s worth knowing before you go hunting: there is no e-mail invite flow
          (accounts are created directly - see <em>Managing Users &amp; Groups</em>), no
          notification system (no bell icon, no page-watch/@-mention alerts - the
          closest things are the Home activity feed and Recently visited/worked on), and
          no in-app audit-log viewer (admin actions and impersonation are logged
          server-side, but there is nowhere in the UI to browse that log yet).
        </Callout>
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
  "Attachments & Media": "attachments",
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
