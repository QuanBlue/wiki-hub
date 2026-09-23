import { Code, Kbd, Quote, Screenshot, Callout, type HelpSection } from "./help-ui";

export const sectionsEn: HelpSection[] = [
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

        <Screenshot
          src="/help/getting-started-home.png"
          alt="The Home dashboard, with the left sidebar rail showing Home, Spaces, Favorite spaces, and Pinned pages"
          caption="Home, with the left sidebar rail underneath the search bar."
        />

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

        <Screenshot
          src="/help/spaces-directory.png"
          alt="The Spaces directory, filtered by a search query, showing each space's owner, creation date, visibility, member and group counts, and an Edit button"
          caption="The Spaces directory - search, tabs for All/Favorite/Own, and an Edit button per row."
        />

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
            <strong>Space Visibility</strong> (set from{" "}
            <strong>Edit space &gt; Access &amp; Permissions</strong>):
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>
                <strong className="text-success">Open</strong>: every signed-in user
                gets full read <em>and</em> write access automatically -{" "}
                <Code>View</Code>, <Code>Add/Edit</Code>, <Code>Delete</Code>,{" "}
                <Code>Delete own</Code> and <Code>Move</Code> - with no need to grant
                anyone anything individually. The two permissions that could
                reconfigure the space itself, <Code>Admin</Code> and{" "}
                <Code>Restrictions</Code>, are never handed out for free in either
                mode - only a space Owner or someone explicitly promoted holds them.
              </li>
              <li>
                <strong className="text-danger">Restricted</strong>: nobody has
                anything by default - the permission tables below become the sole
                source of who can view, edit, delete, or move anything.
              </li>
            </ul>
            Switching between the two is immediate and non-destructive: a
            Restricted space&apos;s permission tables stay exactly as configured while
            the space is Open, so flipping back and forth never means rebuilding
            them from scratch.
          </li>
          <li>
            <strong>Space Owner</strong>: every space always has at least one Owner
            (the creator, by default) - a protected Administrator that cannot be
            removed down to zero, so a space can never end up with nobody able to
            manage it no matter what happens to the permission tables below. Manage
            the list from <strong>Edit space &gt; General</strong>; only an existing
            Owner can add or remove another one. A space can have several Owners at
            once, and each one bypasses every page-level restriction the same way a{" "}
            <Code>Admin</Code> grant does.
          </li>
          <li>
            <strong>Per-user &amp; per-group permissions</strong>: instead of a fixed
            list of named roles, WikiHub grants specific capabilities directly to a
            user or a group - <Code>View</Code>, <Code>Add/Edit</Code>,{" "}
            <Code>Delete</Code>, <Code>Delete own</Code>, <Code>Restrictions</Code>,{" "}
            <Code>Move</Code>, and <Code>Admin</Code> - from a space&apos;s own{" "}
            <strong>Edit space &gt; Access &amp; Permissions</strong> tab, or from{" "}
            <strong>Administration &gt; Spaces</strong> (see{" "}
            <em>Space Access &amp; Effective Permissions</em> for the full picture,
            including how to check any one person&apos;s resolved access). Exporting a
            page follows <Code>View</Code> automatically, with no separate grant to
            hand out. While the space is Open, the tables show <Code>All</Code>{" "}
            instead of a checkbox for the five permissions Open already grants
            everyone - <Code>Admin</Code> and <Code>Restrictions</Code> stay live
            checkboxes regardless of mode, since those are the only way anyone
            becomes an Admin or narrows who can restrict a page.
          </li>
          <li>
            <strong>A direct grant overrides a group&apos;s, not adds to it</strong>:
            groups you belong to combine with each other as usual, but the moment a
            user has their <em>own</em> row on a space, that row alone decides
            everything for them - group membership stops contributing anything
            beyond it. This is how one member of an otherwise broad group (say,
            everyone with <Code>Add/Edit</Code>) can be narrowed to{" "}
            <Code>View</Code> only, by giving that person their own smaller row.
            <Code>Admin</Code> is the one exception: a group&apos;s{" "}
            <Code>Admin</Code> grant always still applies, so a space can never
            end up locked with no administrator reachable.
          </li>
          <li>
            <strong>Editing a space</strong>: click <strong>Edit space</strong>{" "}
            (pencil icon in the space sidebar footer, admins only) for three tabs:{" "}
            <strong>General</strong> (name, Space Owner, and an optional per-space
            attachment-size limit that overrides the workspace default),{" "}
            <strong>Access &amp; Permissions</strong> (General access plus the
            tables above), and <strong>Space settings &amp; Danger zone</strong>{" "}
            (Archive/Restore the space, or permanently Delete it - permanent
            deletion is only available from <strong>Administration &gt; Spaces</strong>,
            not here).
          </li>
          <li>
            <strong>Favouriting</strong>: Click the <Code>★ Star</Code> icon on a
            space&apos;s header to add it to your favourites. Favourited spaces show up
            under <strong>My favorite spaces</strong> on the Home page, and under the{" "}
            <strong>Favorite</strong> tab of the Spaces directory (
            <Code>/spaces?tab=starred</Code>). The directory&apos;s own{" "}
            <strong>Own</strong> tab is different - it lists spaces
            <em> you own</em> (see Space Owner above), not ones you have starred.
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

        <Screenshot
          src="/help/page-engagement-row.png"
          alt="The top of a page: breadcrumb, title, Create/Edit/Save for later/Pin page/Share buttons, and a Like button below the title"
          caption="Create/Edit/Save for later/Pin page/Share along the top, Like just below the title."
        />

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
            <Code>Page access</Code> to open its <strong>General access</strong> setting -{" "}
            <Code>Open</Code> or <Code>Restricted</Code> - plus the table underneath it,
            which looks different depending on which one is picked:
            <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
              <li>
                <strong>Open</strong> (the default) lists every person and group the
                space already grants access to, with their current View/Edit access to
                this page pre-checked - nothing to search for or add. Unchecking a box
                blocks just that person or group; everyone else is unaffected. Edit is
                greyed out for anyone whose space role does not include it, since a
                page restriction only ever narrows who edits among people the space
                already lets edit - it never grants editing beyond that. Both View and
                Edit are greyed out (and pre-checked) for a space Admin, since Admins
                bypass every page-level restriction - blocking one here would not
                actually do anything, so the box is locked instead of offering a
                control with no effect.
              </li>
              <li>
                <strong>Restricted</strong> instead starts from an empty allow-list you
                build up by searching and adding specific people or groups - view
                restrictions inherit down to child pages, and anyone not added
                cannot see the page at all, regardless of their space role.
              </li>
            </ul>
            <Callout variant="tip" title="Both tables open read-only">
              Neither table&apos;s checkboxes can be clicked until you press its own{" "}
              <Code>Edit</Code> button - a stray click cannot change anyone&apos;s
              access. Press <Code>Done</Code> when you are finished with that table to
              lock it again.
            </Callout>
            <Callout variant="tip" title="Switching modes never discards the other one's setup">
              Flip General access back and forth as much as you like - whatever
              Restricted allow-list or Open blocks you had configured comes right back
              each time, instead of being rebuilt from scratch. <Code>Reset to default</Code>{" "}
              (with a confirmation first) is the deliberate way to actually clear
              whichever mode is currently active: Restricted resets to an empty
              allow-list, Open clears every block.
            </Callout>
            <Callout variant="important" title="Restricted's picker only offers people already in the space">
              It only lets you search and pick people or groups the space itself has
              already granted access to - restricting a page to someone still locked
              out at the space door would do nothing but confuse. Anyone else you
              search for still shows up, greyed out and marked{" "}
              <Code>Not added to space</Code>; add them under the space&apos;s own{" "}
              <em>Access &amp; Permissions</em> first, then come back here. If someone
              is later removed from the space entirely, any page-level restriction or
              block naming them is cleaned up automatically.
            </Callout>
          </li>
        </ul>

        <p className="mt-3 text-sm text-muted-foreground">
          Real-world use cases: a space stays open to the whole team, but the one page
          documenting an incident postmortem or a compensation policy gets switched to{" "}
          <Code>Restricted</Code> and limited to just the people who need it. Or the
          opposite - a page stays <Code>Open</Code>, but one person should not see it
          (a manager reviewing feedback about themselves) - so just their own View is
          unchecked instead.
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

        <Screenshot
          src="/help/page-actions-menu.png"
          alt="The More page actions menu open, listing Move page, Page history, Labels, Attachments, View, Export, and Delete page"
          caption="Move page, Page history, Labels, Attachments, View, Export, Delete page."
        />

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
      "rename",
      "rename page",
      "title",
    ],
    body: (
      <>
        <p>
          WikiHub features a state-of-the-art document editor designed for fast,
          distraction-free writing.
        </p>

        <Screenshot
          src="/help/page-view.png"
          alt="A page with a heading, a bulleted list, a table, and a syntax-highlighted code block, with a page tree sidebar on the left"
          caption="A page once it has real content - headings, a list, a table, and a code block."
        />

        <Callout variant="important" title="STICKY SCROLL TOOLBAR">
          As you scroll down long documents in edit mode, the editor toolbar
          remains fixed at the top of your screen. You can format text, insert
          elements, or switch modes at any time without scrolling back up.
        </Callout>

        <p className="mt-4 font-semibold text-foreground">Editing Modes & Tools:</p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Rename a page</strong>: click <strong>Edit</strong>, then click the
            title itself at the top of the page - it becomes editable right there,
            no separate dialog. The page keeps its existing link when you save, so
            anything that already points to it keeps working.
          </li>
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
    keywords: ["image", "attachment", "resize", "align", "caption", "preview", "modal", "zoom", "lightbox", "expand"],
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
          <li>
            <strong>Click to Zoom</strong>: On a published page (not while editing),
            click any image to open it full-screen. Scroll or double-click to zoom in
            and out, drag to pan around once zoomed, and use the toolbar&apos;s{" "}
            <Code>+</Code>/<Code>-</Code> buttons or the reset icon for precise control.
            Click anywhere outside the image, press <Code>Esc</Code>, or use the{" "}
            <Code>X</Code> button to close it.
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
        <Screenshot
          src="/help/table-crop.png"
          alt="A rendered table with a header row and four data rows"
          caption="A table, rendered in a page."
        />
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
        <Screenshot
          src="/help/codeblock-crop.png"
          alt="A syntax-highlighted TypeScript code block with a language label"
          caption="A code block, syntax-highlighted by language."
        />
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

        <Screenshot
          src="/help/history-timeline.png"
          alt="The Revision History panel: a list of versions on the left, and a side-by-side diff comparing two revisions on the right with additions highlighted"
          caption="Revision History - a version list, and a side-by-side diff of any two revisions."
        />

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

        <Screenshot
          src="/help/attachment-preview.png"
          alt="The Attachment details modal, showing an image preview and a Download button"
          caption="Attachment details - preview panel on top, Download always available."
        />

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

        <Screenshot
          src="/help/import-dialog.png"
          alt="The Import pages from files dialog, with a drop zone reading 'Drop Word, PDF, HTML or Markdown files here' and a Choose files button"
          caption="Import pages from files - drag and drop, or browse, up to 20 at once."
        />

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
            The new page is named after the <strong>file name</strong>, extension
            dropped (<Code>Runbook-v2.docx</Code> becomes a page titled{" "}
            <Code>Runbook-v2</Code>) - not after a heading or title inside the
            document.
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

        <Screenshot
          src="/help/account-profile.png"
          alt="The Your account page: a left menu for Profile, Password & authentication, Sessions, and Keyboard shortcuts, with the Profile tab open showing name, email, and workspace role"
          caption="Your account - Profile, Password & authentication, Sessions, Keyboard shortcuts."
        />

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
    id: "language-switching",
    title: "Switching the Interface Language",
    category: "Account",
    description:
      "Switch the whole interface between English and Vietnamese from the top bar, applied instantly.",
    keywords: [
      "language",
      "locale",
      "translation",
      "vietnamese",
      "tiếng việt",
      "english",
      "i18n",
    ],
    body: (
      <>
        <p>
          Click the <strong>EN</strong>/<strong>VI</strong> badge in the top bar
          to open the language menu, then pick <strong>English</strong> or{" "}
          <strong>Tiếng Việt</strong>. The badge always shows the language
          currently active.
        </p>

        <Screenshot
          src="/help/language-toggle.png"
          alt="The language dropdown open in the top bar, showing English (checked) and Tiếng Việt"
          caption="Top bar - the EN/VI badge opens the language menu."
        />

        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            Every label, button, toast, and validation message across WikiHub comes
            from the chosen language - there is no partially-translated screen.
          </li>
          <li>
            The change applies immediately, with no page reload, so anything you
            were mid-edit in the page editor is left exactly as it was.
          </li>
          <li>
            The choice is remembered per browser (not tied to your account), so
            switching computers or signing in elsewhere starts from English again
            until you pick Vietnamese there too.
          </li>
        </ul>
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

        <Callout variant="tip" title="PRO TIP">
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

        <Screenshot
          src="/help/theme-branding.png"
          alt="The Theme & Branding settings page: brand color swatches, a custom hex input, and a grid of logo mark presets"
          caption="Theme & Branding - color presets, custom hex, and logo mark presets."
        />

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
      "office",
      "preview",
      "word",
      "excel",
      "powerpoint",
      "pdf",
      "docx",
      "xlsx",
      "pptx",
      "onlyoffice",
      "video",
      "audio",
      "syntax highlighting",
      "code preview",
      "quota",
      "quotas",
      "browse files",
    ],
    body: (
      <>
        <p>
          Administrators configure global workspace behavior under{" "}
          <strong>Administration &gt; Settings</strong>, and everything about the S3
          bucket - browsing it and setting its limits - under{" "}
          <strong>Administration &gt; Storage</strong>.
        </p>

        <p className="mt-3 font-semibold text-foreground">1. Global Instance Settings:</p>
        <Screenshot
          src="/help/admin-settings-general.png"
          alt="The General Workspace settings panel: Site Name and Session Lifetime fields, each marked inherited from environment until overridden"
          caption="General workspace - Site Name and Session Lifetime, inherited until overridden."
        />
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            <strong>Site Name</strong>: Custom site title displayed in browser tab and top bar.
          </li>
          <li>
            <strong>Session Lifetime (Hours)</strong>: Configure JWT session expiration (e.g. 24h, 72h, 168h).
          </li>
          <li>
            <strong>Sidebar Access Matrix</strong>: Select which navigation sections are visible per user role (<Code>member</Code>, <Code>admin</Code>).
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">2. Storage: Browse files & Quotas:</p>
        <p className="text-sm">
          <strong>Administration &gt; Storage</strong> splits into two sections, picked from
          its own left-hand list:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm mt-1">
          <li>
            <strong>Browse files</strong>: a clean S3 bucket tree browser. Filter objects by
            search query, file type, space, or page ID; generate secure pre-signed download
            URLs; preview images, video and audio files, code/text files (syntax-coloured by
            the file&apos;s extension), and Word, Excel, PowerPoint and PDF documents (opened
            read-only through the same document viewer pages use to edit attachments - see
            it, download it, nothing is ever saved back from here, and each preview scrolls
            in one place rather than in both the dialog and the content underneath it); and
            delete orphan objects, which also clears the matching database attachment and
            archive hash records automatically.
          </li>
          <li>
            <strong>Quotas</strong>: <strong>Max single attachment size</strong>,{" "}
            <strong>Max backup import size</strong>, and{" "}
            <strong>Allowed attachment extensions</strong> (a whitelist, e.g.{" "}
            <Code>png, pdf, zip, docx, *</Code>) - each shown as{" "}
            <Code>(inherited from environment)</Code> until you actually override it here.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "permissions-overview",
    title: "Permissions & Roles Reference",
    category: "Administration",
    description:
      "The full permission model in one place: account roles, the four global permissions, the seven per-space permissions, and how they combine.",
    keywords: [
      "permissions",
      "roles",
      "administrator",
      "member",
      "global access",
      "global permission",
      "space permission",
      "owner",
      "open",
      "restricted",
      "system administrator",
      "effective permissions",
      "access control",
    ],
    body: (
      <>
        <p>
          Three independent layers decide what any one person can do:{" "}
          <strong>Account role</strong> (Member or Administrator),{" "}
          <strong>Global permissions</strong> (workspace-wide abilities like
          creating spaces or managing users), and <strong>Space permissions</strong>{" "}
          (what someone can do inside one specific space). The sections below spell
          out each layer; <em>Managing Users &amp; Groups</em> and{" "}
          <em>Space Access &amp; Effective Permissions</em> (further down) cover the
          screens that actually set them.
        </p>

        <Screenshot
          src="/help/permissions-global-access.png"
          alt="The Global access tab of Edit user: a Currently granted summary, then four permission rows (Create spaces, Manage users, Manage groups, System administrator) each with an Active/Disabled badge and an Inherit from groups dropdown"
          caption="One account's Global access overrides - each of the four permissions, Active or Disabled, per-account."
        />

        <p className="mt-4 font-semibold text-foreground">1. Account roles:</p>
        <div className="border-border bg-surface mt-2 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-40">Role</th>
                <th className="p-2.5">What it means</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Member</Code></td>
                <td className="p-2.5">
                  The default role. What a Member can actually do beyond viewing/editing
                  the spaces they have access to comes entirely from the Global and Space
                  permissions below - a Member can hold any of the four global
                  permissions, or be a Space Owner/Admin, the same as anyone else.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Administrator</Code></td>
                <td className="p-2.5">
                  Unconditionally holds all four global permissions - <Code>Create
                  spaces</Code>, <Code>Manage users</Code>, <Code>Manage groups</Code>,{" "}
                  <Code>System administrator</Code> - regardless of group membership or
                  any override. An ordinary Administrator cannot Edit, Delete, Demote, or
                  reset the password of another Administrator account, or change anyone&apos;s
                  Role or Global access overrides for themselves - see{" "}
                  <em>peer-admin protection</em> below.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5">Protected bootstrap admin</td>
                <td className="p-2.5">
                  The one account WikiHub is initially set up with (or one explicitly
                  marked protected). It is always an Administrator, can never be edited,
                  deactivated, or deleted by anyone else, and is the <strong>only</strong>{" "}
                  account that can Edit, Delete, Demote, or reset the password of another
                  Administrator.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-4 font-semibold text-foreground">
          2. The four Global permissions:
        </p>
        <div className="border-border bg-surface mt-2 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-44">Permission</th>
                <th className="p-2.5">What it unlocks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Create spaces</Code></td>
                <td className="p-2.5">
                  Allows creating new documentation spaces from the regular{" "}
                  <strong>Spaces</strong> directory. It does <strong>not</strong> open{" "}
                  <strong>Administration &gt; Spaces</strong>, which stays{" "}
                  <Code>System administrator</Code>-only.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Manage users</Code></td>
                <td className="p-2.5">
                  Unlocks <strong>Administration &gt; Users</strong>: create, edit, reset
                  the password of, and deactivate <Code>Member</Code> accounts, and manage
                  their group memberships. It never promotes/demotes anyone, touches an
                  existing Administrator account, or opens the <strong>Global access</strong>{" "}
                  tab - those always require actually being a{" "}
                  <Code>System administrator</Code>.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Manage groups</Code></td>
                <td className="p-2.5">
                  Unlocks <strong>Administration &gt; Groups</strong>: create, update,
                  assign members to, and manage user groups.
                </td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>System administrator</Code></td>
                <td className="p-2.5">
                  Full administrative control - every other Administration section
                  (Users, Groups, Spaces, Settings, Backup, Storage), plus every
                  per-space <Code>Admin</Code> permission on every space regardless of
                  that space&apos;s own Owner/Access settings. Equivalent to the{" "}
                  <Code>Administrator</Code> role for every purpose that matters.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Callout variant="note" title="HOW A GLOBAL PERMISSION IS RESOLVED">
          Each of the four checks, in order: is the Role already{" "}
          <Code>Administrator</Code>? If so, granted outright. Otherwise, does a
          per-user <strong>Global access</strong> override force it{" "}
          <Code>enabled</Code> or <Code>disabled</Code>? An override always wins.
          Otherwise, does any group this person belongs to grant it? If none of the
          above, it is not granted. See <em>Managing Users &amp; Groups</em> below
          for where each of these is actually set.
        </Callout>

        <p className="mt-4 font-semibold text-foreground">
          3. The seven per-Space permissions:
        </p>
        <div className="border-border bg-surface mt-2 overflow-hidden rounded-lg border shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-border bg-surface-sunken border-b font-semibold">
                <th className="p-2.5 w-32">Permission</th>
                <th className="p-2.5">What it grants</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>View</Code></td>
                <td className="p-2.5">See this space and open its pages. Exporting pages
                  follows <Code>View</Code> automatically - it is not a separate grant.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Add/Edit</Code></td>
                <td className="p-2.5">Create new pages and edit any existing page in this space.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Delete</Code></td>
                <td className="p-2.5">Delete any page in this space, including ones created by others.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Delete own</Code></td>
                <td className="p-2.5">Delete only pages this person or group created themselves.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Restrictions</Code></td>
                <td className="p-2.5">Restrict individual pages to specific people or groups.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Move</Code></td>
                <td className="p-2.5">Move or reorder pages within this space&apos;s hierarchy.</td>
              </tr>
              <tr className="hover:bg-surface-hover">
                <td className="p-2.5"><Code>Admin</Code></td>
                <td className="p-2.5">Full control of this space&apos;s settings and permissions -
                  implies every other permission in this table.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-4 font-semibold text-foreground">
          4. Space Owner, Open vs Restricted, and effective access:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            <strong>Space Owner</strong> is a separate, protected tier above the table
            above - a space always keeps at least one, and only an Owner (not merely
            someone with the <Code>Admin</Code> permission) can flip a space between{" "}
            <Code>Open</Code> and <Code>Restricted</Code>, or change who the Owners are.
          </li>
          <li>
            <strong><Code>Open</Code> spaces</strong> grant every signed-in user{" "}
            <Code>View</Code>, <Code>Add/Edit</Code>, <Code>Delete</Code>,{" "}
            <Code>Delete own</Code>, and <Code>Move</Code> automatically - only{" "}
            <Code>Admin</Code> and <Code>Restrictions</Code> still need an explicit grant.{" "}
            <strong><Code>Restricted</Code> spaces</strong> grant nothing automatically -
            every permission for every person or group comes from the tables in that
            space&apos;s <strong>Access</strong> panel.
          </li>
          <li>
            For a given person and space, the resolution order is: Owner (everything,
            always) → a direct per-user grant if one exists (which overrides every
            group they belong to for that space, <Code>Admin</Code> aside) → otherwise
            every group they belong to, combined → otherwise whatever <Code>Open</Code>{" "}
            hands out automatically. The <strong>Effective permissions</strong> picker
            in a space&apos;s Access panel resolves all of this for you instead of
            cross-referencing it by hand - see <em>Space Access &amp; Effective
            Permissions</em> below.
          </li>
        </ul>

        <Callout variant="important" title="PEER-ADMIN PROTECTION">
          An ordinary Administrator can fully manage every <Code>Member</Code> account
          - including promoting one to Administrator - but cannot Edit, Delete,
          Demote, or reset the password of <strong>another</strong> Administrator
          account. Only the protected bootstrap admin account can touch another
          Administrator. This keeps any one administrator from locking out, demoting,
          or deleting every other administrator.
        </Callout>
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
      "global permission override",
      "administrators tab",
      "permission overrides",
      "permission overrides tab",
      "group directory",
      "global access tab",
      "bulk delete",
      "select multiple",
    ],
    body: (
      <>
        <Callout variant="important" title="THERE IS NO E-MAIL INVITE FLOW">
          WikiHub does not send invitation e-mails. An administrator creates every
          account directly under <strong>Administration &gt; Users &gt; Create
          user</strong> and shares the temporary password with that person out of band
          (chat, in person, etc.).
        </Callout>

        <Screenshot
          src="/help/admin-users-directory.png"
          alt="The People directory: summary tiles for Total/Administrators/Members/Active/Disabled, a search box, and a table of accounts with Edit and Delete actions"
          caption="The People directory - search, filters, and an Edit/Delete pair per row."
        />

        <p className="mt-3 font-semibold text-foreground">1. People directory:</p>
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
            Each row has an <strong>Edit</strong> button opening one dialog for
            everything about that account, across three tabs:{" "}
            <strong>General</strong> (<Code>Role</Code> Member/Administrator,{" "}
            <Code>Status</Code> Active/Disabled as a switch, an optional new password
            with a live requirements checklist - leave both password fields blank to
            keep the current one), <strong>Groups</strong> (below), and{" "}
            <strong>Global access</strong> (its <strong>Workspace Global Access</strong>{" "}
            overrides - see below). A separate, icon-only <strong>Delete</strong> button
            removes the account entirely. Your own account and the protected bootstrap
            admin account never show these controls, so you can never lock yourself out.
            The dialog fetches this account&apos;s current data fresh each time it
            opens, rather than reusing the directory row - reopening right after saving
            an override always shows what was actually saved, not what the row still
            happened to be showing.
          </li>
          <li>
            The <strong>Groups</strong> tab lists every group this account belongs to,
            each with a one-click <strong>Leave</strong> button - and the same{" "}
            <strong>Select</strong> / select-all pattern as the directory itself, for
            leaving several groups at once. Leaving takes effect immediately, it is not
            part of the dialog&apos;s own Save.
          </li>
          <li>
            An ordinary <Code>Administrator</Code> cannot Edit or Delete another{" "}
            <Code>Administrator</Code> account, or reset its password - only the
            protected bootstrap admin can. This keeps one administrator from
            demoting, deactivating or locking out another; an ordinary
            Administrator can still fully manage every <Code>Member</Code> account,
            including promoting one to <Code>Administrator</Code>.
          </li>
          <li>
            Holding <Code>Manage users</Code> without being a{" "}
            <Code>System administrator</Code> yourself (whether the account&apos;s{" "}
            <Code>Role</Code> already is one, or a group/override grants{" "}
            <Code>System administrator</Code>) is deliberately narrower: it creates,
            edits, resets the password of and deactivates <Code>Member</Code>{" "}
            accounts, and manages their group memberships, but the{" "}
            <strong>Role</strong> field and the entire <strong>Global access</strong>{" "}
            tab are disabled - it can never promote or demote anyone, grant a Global
            Access override (an override can hand out{" "}
            <Code>System administrator</Code> just as surely as Role can), or touch
            an existing <Code>Administrator</Code> account at all. The only way to
            gain any of that is to actually become a{" "}
            <Code>System administrator</Code>.
          </li>
          <li>
            <strong>Select</strong> (next to the search box) turns on a checkbox per
            row and a <strong>Delete selected</strong> bar for removing several
            accounts at once. A protected, your-own-account, or (unless you are
            the protected bootstrap admin) another <Code>Administrator</Code>&apos;s
            row has its checkbox disabled outright rather than left to fail
            partway through a batch.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">2. Workspace Global Access overrides:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            A <strong>Currently granted</strong> summary sits above the four
            permission rows, listing exactly what this account has right now (or{" "}
            <Code>All permissions (Administrator role)</Code> when its Role already
            covers everything) - the one place to check before deciding what, if
            anything, needs changing below. It, and each row&apos;s own{" "}
            <Code>Active</Code>/<Code>Disabled</Code> badge, update the instant you
            change Role or an override dropdown - no need to Save and reopen the
            dialog just to see whether a choice actually took effect.
          </li>
          <li>
            The four global permissions (<Code>Create spaces</Code>,{" "}
            <Code>Manage users</Code>, <Code>Manage groups</Code>,{" "}
            <Code>System administrator</Code>) normally come from a user&apos;s groups.
            The Edit dialog lets you set one of three states per permission, per
            person: <Code>Inherit from groups</Code> (the default), <Code>Force
            enabled</Code>, or <Code>Force disabled</Code> - the override always wins
            over whatever that person&apos;s groups say for that one permission.
          </li>
          <li>
            This has no effect on an account whose <Code>Role</Code> is already{" "}
            <Code>Administrator</Code>: that role unconditionally grants every
            permission, the same way it always has.
          </li>
          <li>
            <Code>Manage users</Code> unlocks <strong>Administration &gt; Users</strong>{" "}
            and <Code>Manage groups</Code> unlocks <strong>Administration &gt;
            Groups</strong> for that account, whether the permission came from a
            group or an override here - each opens only its own matching section,
            not the rest of Administration. <Code>Create spaces</Code> only unlocks
            the <strong>Create space</strong> button on the regular Spaces directory
            (see &ldquo;Creating a Space&rdquo; above); it does not open{" "}
            <strong>Administration &gt; Spaces</strong>, which stays a{" "}
            <Code>System administrator</Code>-only oversight view (archive or
            permanently delete any space) — same as Settings, Backup and Storage.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">3. Administrators tab:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            Lists every account that currently holds <Code>System administrator</Code>{" "}
            access however it got there - the <Code>Role</Code> switch, a group&apos;s
            global permission, or a per-user override - with a{" "}
            <strong>Granted via</strong> column saying which. The Role filter on the
            People directory only ever shows the first of these three.
          </li>
          <li>
            Under <strong>Granted via</strong>, a Role or override grant also names{" "}
            <strong>who</strong> did it - the account that flipped the switch or added
            the override, read off the audit log. A group grant instead names{" "}
            <strong>which group</strong>: group membership and a group&apos;s own
            permission grants aren&apos;t tracked per member, so there is no individual
            person to point to there. Either can read as unattributed for an account
            that has held its access since before this tracking existed.
          </li>
          <li>
            <strong>Demote to Member</strong> undoes whichever of those it was: it
            flips <Code>Role</Code> back to Member for a direct Administrator, or adds
            a force-disabled override for one granted through a group or an existing
            override. Disabled for the protected admin, your own account, or the last
            remaining administrator on the list - and, for a direct Administrator
            (Granted via: <Code>Administrator role</Code>), disabled for anyone except
            the protected bootstrap admin, same as Edit/Delete in the People directory.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">4. Permission overrides tab:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>
            Lists every account that has at least one <strong>Global access</strong>{" "}
            override set - <Code>Create spaces</Code>, <Code>Manage users</Code>,{" "}
            <Code>Manage groups</Code>, or <Code>System administrator</Code>, force
            <Code>Enabled</Code> or <Code>Disabled</Code> for that one account
            specifically. Before this tab existed, the only way to find out who had a
            customized permission was opening every single account&apos;s Edit dialog
            and checking its Global access tab one at a time - this tab exists
            precisely so that is never necessary.
          </li>
          <li>
            Each row&apos;s <strong>Overrides</strong> column names exactly which
            permissions are overridden and to what value - an account inheriting
            everything normally from its Role or groups never shows up here at all.
          </li>
          <li>
            The same <strong>Edit</strong>/<strong>Delete</strong> actions as the People
            directory are right there in the row, so acting on what you see - fixing or
            removing an override - never means switching back to a different tab first.
          </li>
        </ul>

        <p className="mt-4 font-semibold text-foreground">5. Groups:</p>
        <Screenshot
          src="/help/admin-groups-directory.png"
          alt="The Groups directory: group count and total members assigned, a search box, and a table listing each group's owner, member count, global access, and access grants"
          caption="The Groups directory - owner, members, global access, and access grants at a glance."
        />
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
            <strong>Group directory</strong> and <strong>Global access</strong> are two
            separate tabs above the table, the same split as Administration &gt; Users.
            Group directory lists every group; Global access narrows that down to only
            the (usually few) groups that actually grant one of the four global
            permissions above - the ones worth double-checking before adding someone to
            them, out of what is otherwise a much longer list of groups that exist
            purely for Space/Page access.
          </li>
          <li>
            The default system groups (<Code>administrators</Code>, <Code>users</Code>,{" "}
            <Code>confluence-administrators</Code>, <Code>confluence-users</Code>)
            cannot be deleted, only edited.
          </li>
          <li>
            A group still granting access to any Space or with a restriction on any
            Page cannot be deleted - <strong>&quot;Remove this group&apos;s permission
            assignments before deleting it&quot;</strong> means exactly that, and both
            have to be cleared first (its global permissions, under Edit &gt; Global
            access, don&apos;t count - only Space/Page grants do).
          </li>
          <li>
            The Directory table&apos;s <strong>Access grants</strong> column names how
            many Spaces and Pages a group is granted access to - <Code>Not used</Code>{" "}
            means it can be deleted outright. Clicking the count opens a quick-view
            listing every one of them by name, each linking straight to that Space or
            Page, with its own <strong>Remove</strong> button right there to clear the
            grant on the spot - no need to hunt through every Space&apos;s Access panel
            first. The same list, with the same Remove buttons, is also its own tab
            (<strong>Access grants</strong>) inside the full Edit Group dialog, right
            next to Members.
          </li>
          <li>
            The same <strong>Select</strong> / bulk-delete control as the People
            directory is available next to the group search box; a default system group
            stays excluded even when selected.
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
      "archived spaces",
      "archived spaces tab",
      "space directory",
    ],
    body: (
      <>
        <p>
          <strong>Administration &gt; Spaces</strong> lists every space with Total /
          Active / Archived tiles. Permanent space deletion is only available here (an
          individual space&apos;s own settings only offer Archive). Open a space&apos;s{" "}
          <strong>Access</strong> panel to manage exactly who can do what:
        </p>

        <Screenshot
          src="/help/admin-spaces-directory.png"
          alt="The Administration Spaces directory: Total/Active/Archived/Member assignments tiles, a search box, and a table of spaces with visibility, licensed user counts, status, and Edit/Delete actions"
          caption="Administration > Spaces - the full oversight view, with permanent deletion available only here."
        />

        <Callout variant="note" title="SPACE DIRECTORY VS. ARCHIVED SPACES">
          Two tabs above the table, the same split as Administration &gt; Users and
          Groups: <strong>Space directory</strong> lists every active space,{" "}
          <strong>Archived spaces</strong> lists only the ones hidden from normal
          navigation - restore one from its own <em>Edit space &gt; Space settings
          &amp; Danger zone</em>, or delete it permanently right from either tab.
        </Callout>

        <Screenshot
          src="/help/admin-spaces-access.png"
          alt="The Access & Permissions tab of Edit space: General access set to Restricted, a group permission table, and an individual user permission table with View/Add-Edit/Delete/Delete own/Restrictions/Move/Admin columns"
          caption="Access & Permissions - General access, a Group table, and an Individual user table."
        />

        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>General access</strong>: <Code>Open</Code> gives every signed-in
            user full read/write access automatically (everything except{" "}
            <Code>Admin</Code>/<Code>Restrictions</Code>) - a warning banner says so
            right above the tables. <Code>Restricted</Code> withdraws that, so only
            people explicitly granted access below can do anything.
          </li>
          <li>
            <strong>Space Owner</strong> (set from the space&apos;s own{" "}
            <strong>Edit space &gt; General</strong> tab, not here): a protected
            Administrator a space always keeps at least one of, so it can never end
            up unmanageable regardless of what happens to the tables below.
          </li>
          <li>
            A <strong>Groups</strong> permission table and an{" "}
            <strong>Individual users</strong> permission table, each with checkboxes for{" "}
            <Code>View</Code>, <Code>Add/Edit</Code>, <Code>Delete</Code>,{" "}
            <Code>Delete own</Code>, <Code>Restrictions</Code>, <Code>Move</Code>, and{" "}
            <Code>Admin</Code>. <Code>View</Code> grants reading only - editing needs{" "}
            <Code>Add/Edit</Code> too, and relocating a page needs{" "}
            <Code>Move</Code> as well. Exporting follows <Code>View</Code>{" "}
            automatically and isn&apos;t a separate checkbox. While the space is{" "}
            <Code>Open</Code>, the first five columns show <Code>All</Code> instead -
            Open already grants them to everyone, so a checkbox there would not
            actually change anything; <Code>Restrictions</Code>/<Code>Admin</Code>{" "}
            stay live regardless of mode. Changes are explicit - Edit, then Save or
            Cancel - with an unsaved-changes guard if you navigate away mid-edit.
          </li>
          <li>
            <strong>Effective permissions</strong>: pick any user and see their fully
            resolved permission set for that space - Open access, any direct grant
            (which overrides every group they belong to once they have one, Admin
            aside), or otherwise every group they belong to combined - instead of
            manually cross-referencing three sources by hand.
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

        <Screenshot
          src="/help/switch-account.png"
          alt="The account menu, showing the signed-in account's name and a Switch account icon button next to it"
          caption="The Switch account control, next to your own name in the account menu."
        />

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
      "Two distinct export formats, resumable multi-gigabyte uploads, a recurring schedule, and the safety checks that stop the wrong archive from landing in the wrong place.",
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
      "automatic",
      "automated",
      "scheduled",
      "schedule",
      "retention",
      "cron",
    ],
    body: (
      <>
        <p>
          <strong>Administration &gt; Backup</strong> has two sections:{" "}
          <strong>Export / Backup</strong> and <strong>Import / Restore</strong>.
        </p>

        <Screenshot
          src="/help/backup-panel.png"
          alt="The Export & Backup panel: Export WikiHub Backup and Export Confluence Backup side by side, and an Automatic backups section with a recurring schedule"
          caption="Export & Backup - the two export formats, and the automatic backup schedule below them."
        />

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
            A large Confluence archive can take hours to upload. The page keeps your
            browser session renewed automatically for as long as that tab stays open -
            you do not need to stay logged in manually, and other tabs keep working
            normally throughout.
          </li>
          <li>
            Restoring into an instance that already has spaces triggers a{" "}
            <strong>Replace existing spaces?</strong> conflict step for anything that
            would collide.
          </li>
          <li>
            Both upload paths reject a file above a configured size limit (shown on
            each card, 1024 MB by default) before uploading starts. A system
            administrator can raise it under{" "}
            <strong>Administration &gt; Object storage &gt; Quotas &gt; &ldquo;Max
            Confluence / Backup Archive (MB)&rdquo;</strong>.
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

        <p className="mt-4 font-semibold text-foreground">3. Automatic backups (scheduled):</p>
        <p>
          The <strong>Automatic backups</strong> panel, above{" "}
          <strong>Export / Backup</strong>, runs a recurring{" "}
          <strong>Export WikiHub Backup</strong> on a schedule with no one needing to
          click anything.
        </p>
        <ul className="list-disc pl-5 space-y-2 text-sm mt-2">
          <li>
            It writes each backup to a directory mounted into the server itself
            (<Code>WIKIHUB_AUTOMATED_BACKUP_HOST_DIRECTORY</Code> in the deployment&apos;s
            environment) rather than object storage - a separate copy on separate
            infrastructure, so a problem with the primary storage does not also take
            out its own backups. <strong>Enabled</strong> stays greyed out, and{" "}
            <strong>Run now</strong> stays disabled, until an operator has actually
            mounted that directory.
          </li>
          <li>
            <strong>Subfolder (optional)</strong> scopes backups to a folder under that
            mounted volume, e.g. <Code>team-a</Code> writes into <Code>&lt;mounted
            volume&gt;/team-a</Code> instead of the volume&apos;s root - useful for keeping
            more than one schedule&apos;s output apart. The folder must already exist on
            the host: <strong>Save schedule</strong> checks it against the real
            filesystem and refuses a path that is missing or that would resolve outside
            the mounted volume, with the reason shown right under the field.
          </li>
          <li>
            Configure <strong>Every N hours/days</strong>, a <strong>Start time</strong>{" "}
            and <strong>Timezone</strong> (an IANA zone name, e.g.{" "}
            <Code>Asia/Ho_Chi_Minh</Code>), and how many completed backups to{" "}
            <strong>Keep</strong> - older ones past that count are deleted automatically
            as newer ones land. Click <strong>Save schedule</strong> to apply; the panel
            then shows the computed <strong>Last run</strong> and{" "}
            <strong>Next run</strong> times.
          </li>
          <li>
            <strong>Run now</strong> queues one immediately without waiting for the
            schedule or disturbing it. The list below shows recent scheduled backups
            with <strong>Download</strong> and <strong>Delete</strong> for each.
          </li>
        </ul>

        <Callout variant="warning" title="ALWAYS INCLUDES PASSWORD HASHES">
          Unlike a manual <strong>Export WikiHub Backup</strong>, a scheduled backup
          always includes password hashes - there is no toggle for it, since nobody is
          present to opt in each time. Restrict access to the mounted directory the
          same way you would any other credential store.
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
