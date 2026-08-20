"use client";

import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileCode,
  FileText,
  FolderKanban,
  Info,
  KeyRound,
  Layers,
  Lightbulb,
  Palette,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
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

        <p className="mt-3">
          <strong>Key Interface Regions:</strong>
        </p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Top Navigation Bar (56px)</strong>: Hosts the global search
            box, quick notification alerts, active workspace title, and user
            profile menu.
          </li>
          <li>
            <strong>Left Sidebar Rail</strong>: Provides quick links to{" "}
            <strong>Home</strong>, <strong>Spaces Explorer</strong>, your pinned{" "}
            <strong>My Spaces</strong> list (using clean <Code>Layers</Code> icons),
            and <strong>Help Center</strong>.
          </li>
          <li>
            <strong>Sidebar Collapse</strong>: Click the sidebar collapse button or
            press <Kbd>Ctrl</Kbd> + <Kbd>\</Kbd> to maximize reading space. Your
            collapsed preference is preserved automatically.
          </li>
        </ul>
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
            <strong>Space Visibility Rules</strong>:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>
                <strong className="text-success">Public</strong>: Readable by anyone
                with access to WikiHub.
              </li>
              <li>
                <strong className="text-warning">Internal</strong>: Visible to all
                authenticated workspace members.
              </li>
              <li>
                <strong className="text-danger">Restricted / Private</strong>: Accessible
                only to explicitly invited users and assigned security groups.
              </li>
            </ul>
          </li>
          <li>
            <strong>Space Member Roles</strong>:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>
                <strong>Manager</strong>: Full control to edit space settings, assign
                members, archive, or delete the space.
              </li>
              <li>
                <strong>Contributor</strong>: Can create, edit, move, and comment on
                pages.
              </li>
              <li>
                <strong>Reader</strong>: Read-only access to published space pages.
              </li>
            </ul>
          </li>
          <li>
            <strong>Favourites / Pinning</strong>: Click the <Code>★ Star</Code> icon on
            any space header to pin it directly into your left sidebar under{" "}
            <strong>MY SPACES</strong>.
          </li>
        </ol>
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

        <p className="mt-4 font-semibold text-foreground">File Attachments &amp; Detail Modal:</p>
        <p className="text-sm">
          Upload PDF documents, archives (<Code>.zip</Code>, <Code>.tar.gz</Code>), or
          code files (<Code>.ts</Code>, <Code>.py</Code>, <Code>.json</Code>). Clicking an
          attachment opens an interactive <strong>File Detail Modal</strong> displaying
          file size, creation timestamp, download button, and a syntax-highlighted
          live preview for text/code attachments.
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
    title: "Revision History, Visual Diff & PDF Export",
    category: "Writing",
    description:
      "Compare document revisions, restore past versions safely, and export PDF.",
    keywords: ["revision", "history", "compare", "diff", "restore", "pdf", "export"],
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
            <strong>Export PDF</strong>: Click <strong>Export PDF</strong> in page actions
            to generate a clean, print-formatted PDF document complete with page headers,
            tables, and embedded images.
          </li>
        </ol>
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
            </tbody>
          </table>
        </div>
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
    id: "backup-and-restore",
    title: "Backup, Confluence Import & DC Export",
    category: "Administration",
    description:
      "Full ZIP backups, resumable Confluence space import, and Data Center XML export.",
    keywords: [
      "backup",
      "zip",
      "restore",
      "confluence",
      "import",
      "export",
      "xml",
      "datacenter",
    ],
    body: (
      <>
        <p>
          Protect workspace data and migrate from legacy systems under{" "}
          <strong>Administration &gt; Backup</strong>.
        </p>

        <Callout variant="warning" title="PASSWORD HASH BACKUPS">
          Full ZIP backups exclude password hashes by default. Include password hashes
          only for secure system migrations, as the archive becomes highly sensitive.
        </Callout>

        <ol className="list-decimal pl-5 space-y-2 text-sm mt-3">
          <li>
            <strong>Full Workspace ZIP Backups</strong>: Export complete workspace archives
            including pages, revisions, permissions, attachment files, and user avatars.
          </li>
          <li>
            <strong>Confluence Archive Import</strong>: Upload Confluence export ZIP archives.
            Uses resumable multipart transfer. Scans spaces, detects key conflicts, lets you
            select spaces to import, and monitors background import worker jobs with live log output.
          </li>
          <li>
            <strong>Confluence Data Center XML Export</strong>: Generate Confluence Data Center
            compatible XML export archives (select target profile: Data Center 8.x or 9.x).
          </li>
        </ol>
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
            <strong>Access &amp; Permission Issues</strong>: If a user cannot see a page or space,
            check both <em>Space Member Permissions</em> and <em>Page-Level Restrictions</em>.
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
