# Using WikiHub

WikiHub is a self-hosted workspace for shared documentation. Knowledge lives in
**spaces** and **pages**, with access controls, revision history, attachments,
search, backup/restore, and administration tools.

The same guide is available to every signed-in user in the application at
**Help** (`/help`, the book icon in the top bar).

The Help centre opens on a search box. As you type it lists the guides that match (in either
language, accents optional, with the passage that matched); arrow keys and Enter open one. Ask a
whole question instead - press Enter or **Ask AI** - and, when the AI assistant is set up, it
answers from the guides themselves, in the language you asked in, with the guides to read next
and *Continue in the chat* to carry on. Under the search are suggested questions, the guides to
start with, and every topic with its first guides. A guide opens on its own page: the left
column lists every topic and guide (and the search again), the top shows where you are, and
*Previous* / *Next* at the bottom walk through all the guides in order.

## Getting started

Sign in with your username or email address and password. Contact an
administrator if your account has been disabled. Single sign-on is displayed as
an upcoming capability; local email/password sign-in is currently supported.

Use the left navigation for Home, Spaces, and Help. The top-bar search finds
spaces and pages that you are allowed to access. It ranks title matches
first, ignores accents and capitals, tolerates small typos in titles and accepts
whole questions. When an administrator turns on Semantic search in Administration
-> AI assistant, it also finds pages by meaning, not only by words. The app sidebar can be
collapsed, and that preference is remembered in your browser.

## Spaces

A space is a home for a team, project, or topic. Open **Spaces** to browse,
search, filter, and favourite spaces. A space can be active or archived, and
open or restricted according to its access rules.

Users with the appropriate permission can create spaces and give them a unique
key, name, description, icon, and visibility. Space managers can add members,
assign roles, grant person/group permissions, archive a space, or permanently
delete it.

## Pages and collaboration

Pages form a hierarchy in a space. Use the page tree to navigate, create child
pages, move pages, and expand branches. Content can be edited in rich text,
Markdown, or HTML source mode.

Drafts are kept locally and can also be saved on the server. You can favourite
spaces, save pages for later, like useful pages, and share a page link with
people who already have access. Page restrictions can add user/group access
rules beyond the parent space's permissions.

## AI assistant

When an administrator has connected an AI service (see Administration), the AI
features appear across WikiHub. Until then each control stays visible and explains
what is missing. Everything runs on demand against that service, only sees pages
you can already read, and has an hourly limit per person.

- **TL;DR** - the toolbar button summarizes a page, in its own language or
  switched to English or Vietnamese.
- **Create page with AI** - in *Create page*, describe the page. The AI looks for
  related pages, asks a few multiple-choice questions, and drafts the page with
  an "AI-written" notice on top. Nothing is saved until you create the page.
- **Explain or translate a selection** - select words in a page and click the small
  AI button.
- **In the editor** - on an empty line press `Ctrl+Space` to have the AI write
  something and insert it below, or select text to rewrite it, fix grammar,
  continue a sentence or make terms consistent with the wiki. Suggestions are only
  applied when you accept them, and earlier versions can be stepped back to.
- **Labels and related pages** - in a page's labels dialog, *Suggest labels and
  related pages* proposes labels to add and pages on the same topic.
- **Ask AI from search** - type a question in the search box and click *Ask AI*
  (or press `Ctrl+Enter`). The answer is written only from pages you can open, every
  statement carries a numbered mark that opens its source page, and passwords, tokens
  and keys are replaced with `[hidden]`. When the wiki has no answer it says so and
  lists pages that may help; an answer that cannot be tied to a page is never shown.
  Asking the same thing again while the pages are unchanged costs no model call.
- **Chat with the AI assistant** - the sparkle button in the top bar of every page
  opens a panel where you can ask and follow up (`Enter` sends, `Shift+Enter` adds a
  line). Answers stream in and cite wiki pages as in search. The panel can be dragged
  wider or narrower by its left edge, expanded to the whole page, and put away by
  clicking outside it; the conversation is kept only in your browser and is removed when you sign out or switch account. If an
  administrator turns on *Web search* (Administration > AI assistant), a public technical
  question the wiki does not cover may be looked up on the internet - you see the query,
  and the web pages used are listed under *From the web*; only that short query, stripped
  of addresses, e-mails and internal host names, leaves WikiHub. Otherwise the AI may
  answer from its own knowledge, always marked as not checked. Facts about your own
  systems, accounts and people are answered from the wiki only.
  Selecting words in the chat shows the same small AI button as on a page, to explain or
  translate them.
  Under your own questions are *Copy* and *Edit*: an edited question keeps its earlier
  versions, and `‹ 1 / 2 ›` switches between them, each with the answers that followed it.
  Earlier messages count as context for a follow-up; the assistant asks when something it
  depends on (such as a city) is missing, reads real weather measurements for a named place, and
  reads the text of the top web pages (public addresses only) so it can quote figures from them.
  Where to look is decided before an answer is written: asking for the internet, or a question
  about now or the news, goes to the web first; a question your wiki clearly holds is answered
  from it. When the configured search finds nothing (or only pages about something else),
  free sources that need no key are tried - the open web, news headlines and Wikipedia - with
  the same short query.
  The chat also knows **your account and WikiHub**: ask *which spaces can I open?*, *what is
  my role in OPS?*, *how do I change my password?* or *can it back up on a schedule?* and it
  answers from your own spaces, roles and permissions and from the Help page, with buttons that
  open the page you need (Administration pages only if you may open them).
  It can also **do things for you, once you confirm**: *create a space abc and write a
  Prometheus guide in it* shows a plan - create a space, write a page drafted by AI, add
  someone to a space with a role, star a space - with *Confirm and run* and *Cancel*.
  Nothing changes before that, it runs with your own permissions (a step you may not take is
  listed as not offered), it stops at the first step that fails, and each finished step has an
  *Open* link.
  Under the box, *Detail* sets the length of answers: *Brief* (the key point), *Balanced* or
  *Detailed* (steps, values, examples, limits). `Up` and `Down` in the box bring back the questions
  you asked before; the caret goes to the end so you can edit and send. *Answer again* (under a
  question) asks once more and keeps the earlier answer as a version. *Stop* keeps the question,
  with what was written and a note that you cancelled it, and *Try again* asks it once more. The
  panel stays open when you go to another page. Answers are laid out to be scanned - a bold first
  sentence, numbered steps, tables, `code`, italics, quotes, and coloured Tip, Warning, Important
  and Note boxes - and colour is kept for those.

## Importing documents

Open the **...** menu of a page (or Home) and choose *Import from file...* to turn up to 20 Word,
PDF, HTML, Markdown, EPUB, ODT or RTF files into pages. They are converted in the background with
a progress card, each finished file linking to its new page; each page is named after its file.

The dialog is a drop area (drag files in, or *Choose files*; the formats are listed under it), a
list of the chosen files with their type and size (a file the importer cannot take is marked in
red with the reason), and an **AI options** group with two rows: a switch for the review and a
language list for the translation. Each row has a one-line summary and an **i** button, which
explains it in full when you hover or focus it. The footer shows how many files are ready and
their total size.

*Review with AI after importing* (on by default, remembered) compares every page with the
original file once it is made, and mends what differs: text that went missing, a heading of
another level, a list, code or quote that became plain paragraphs, a table that fell apart,
repeated page headers and footers, lists that lost their nesting (Word indents a list by how far
in it sits, which the converter ignores, so the review reads the indents again and nests the
list as the file does), plus how it looks (table cells turned into quotes, unreadable text on
coloured cells, black forced on every run). What is certain is fixed at once; if the AI assistant is set
up it fixes the rest, in the editor's own formats. A change is kept only if the page then matches
the file better and lost no text, and the progress card says what was done per file, with a live
log of each step (reading the file, what differed, the fixes made, what the AI assistant proposed
and what was kept or dropped) that stays under the file as *Review log*. The page as
it was converted stays in its history. Word, HTML and PDF files are reviewed; other types are
imported as before.

*Translate with AI* turns each page into English or Tiếng Việt once it is made (by default the
document keeps its own language). The AI assistant translates paragraph by paragraph and each
piece goes back only if its tags, links, images and code are unchanged, so tables, lists, images
and colours stay as they were; code and product names are not translated. It runs after the
review, shows a live *Translation log* on the file, and the page in its own language stays in its
history. It needs the AI assistant to be set up; a document already in the chosen language is not
translated, and a very large one (over about 700,000 characters) is skipped. *Original language*
leaves the text as it is. A piece the model translates badly is left in its own language and
counted (*N pieces left in the original language*). The page title stays the file's name.

When the AI assistant is not set up (or an administrator has switched it off) the dialog says so: the review switch and the translation list are unavailable.

Both steps use the AI assistant's connection and are counted in its usage. The review has its own
hourly allowance, and translating (many small calls per file) has a larger one of its own,
`ai_translate_rate_limit` (1500 per hour by default); a whole batch can run for hours, so the
import job is allowed four. If a translation reports that it could not finish, import the file
again.

## History and PDF export

Every saved page change creates a revision. Open page history to inspect past
versions, compare revisions with a visual diff, or restore from an older
revision. Restoring a revision creates a new change and preserves the earlier
history.

Use **Export PDF** in page actions to download the current page as a readable
PDF.

## Your account

Open **Your account** from the account menu.

- **Profile** starts read-only. Select **Edit profile** to change display name,
  email, avatar, bio, pronouns, company, website, and up to two social links.
- **Password & authentication** lets you change your password after satisfying
  the displayed strength requirements. You can generate a strong password.
- **Sessions** lists active browsers. Sign out all other sessions if you do not
  recognise activity, then change your password.

A member's profile also shows a contribution chart - a square per day over the last year,
darker for busier days, with the other years one click away.

In the activity feed, repeated edits of one page fold into a single row ("Updated 6 times"); click it to list each edit.

## Administration

Administrators can manage users, groups, spaces, workspace settings, backups,
and storage. They can create, activate, disable, update, reset passwords for,
or remove user accounts. The protected bootstrap administrator is intentionally
excluded from normal destructive actions.

Groups simplify access management. Grant global permissions to a group, then
use the group when assigning space/page permissions. Administrators can also
switch into an active user account for support; the application displays a
banner and records the administrator in the audit trail.

Under **AI assistant**, system administrators connect any OpenAI-compatible service
(address, API key and a model chosen from what the service offers), keep several
connections with exactly one active, and edit the instructions ("skills") behind
each AI feature. Keys are stored encrypted and left out of backups. The page has
four tabs:

- **Key management** - the connections and their keys; one is active.
- **Semantic search** - where page text is turned into vectors so search can find
  pages by meaning. Choose the source (the active connection, another endpoint, or a
  self-hosted Ollama), then an embedding model from one dropdown. For Ollama, *Enable*
  installs it (a card shows each step, memory and CPU), models marked "not downloaded"
  are fetched with *Download & use*, and *Disable* removes the container (downloaded
  models stay until you delete them). *Performance & tuning* holds the numbers: pages
  indexed per minute, request size, timeouts, how close a match must be, and Ollama's
  memory, cores and keep-alive. A progress note shows how far indexing has got.
- **Web search** - off by default. Turn it on so the chat may look up public, technical
  questions on the internet, and choose the service: the AI gateway's own search (no
  extra key), Tavily, Brave Search or Serper (each needs its own key; the info buttons
  explain how they differ). *Test search* tries the service you chose on its own before you
  save. Only a short query, stripped of addresses, e-mails and internal names, leaves WikiHub.
  The free search behind a gateway is the least dependable: when it finds nothing, or pages about
  something else, the chat falls back to free sources that need no key (open web, news headlines,
  Wikipedia); a paid service is steadier.
- **Skill management** - the instructions behind each feature, with one-click reset.

Under **Server**, system administrators see the machine's load, memory, swap, disk and
uptime and WikiHub's own Docker containers (not other services on the same host) with
uptime, CPU, memory and health. Click a column header to sort; *Logs* shows a
container's last lines with credentials hidden. It refreshes every few seconds while
the page is open and is read-only.

Workspace settings control the site name, session duration, upload/archive
limits, attachment types, and role visibility for sidebar areas. Storage lets
administrators filter bucket objects, obtain safe download links, preview
compatible files, and permanently delete unneeded objects.

Under **Statistics**, system administrators see how the workspace is used over
the last 7, 30 or 90 days: users, edits, page views and recent activity; AI token
usage per person and per feature; and the most viewed, starred and saved pages
and spaces. Page views and AI tokens are counted from the day tracking was
introduced, and token counts depend on the AI service reporting its usage.

## Backup and restore

Administration → **Backup** offers separate operations:

1. **Full WikiHub backup ZIP** contains workspace data, pages, revisions,
   permissions, attachments, and internal avatar files. Password hashes are
   excluded by default and should only be included for a secure migration.
2. **Confluence Data Center XML export** requires an explicit Data Center 8.x
   or 9.x profile. It contains space content and attachments, but not WikiHub
   users, groups, or settings.
3. **Restore** accepts legacy JSON backups and full ZIP backups. Always preview
   first. Existing users and spaces are skipped by default. For a conflicting
   space in a full ZIP, an administrator can explicitly overwrite page content,
   revisions, restrictions, and attachments while retaining destination space
   metadata, members, and permissions.

Full ZIP archives are checked for safe paths, symlinks, duplicate entries,
compression limits, manifest integrity, and SHA-256 checksums before restore.

## Confluence import

Upload a Confluence export ZIP from Administration → Backup. WikiHub uses
resumable multipart upload and scans the archive before import. Select spaces,
review conflicts, then follow the background job and its logs. Scanned archives
can be resumed after returning to the Backup page.

## Safe operation and troubleshooting

- Treat password-hash backups and presigned storage URLs as sensitive.
- Preview a restore before applying it, especially before overwriting a space.
- Prefer groups over many direct permissions.
- Archive a space before permanent deletion when a review period is useful.
- If content is missing, check both space permissions and page restrictions.
- If an upload fails, check file type and configured size limits.
- For a failed import, resume/retry it in Backup after checking worker, Redis,
  and object-storage health.
- If an imported page was reviewed or translated and you prefer the version before, open the
  page history and restore the earlier revision ("Imported from...", "Review of the import...",
  "Translated into ... by AI ...").
- If a file's card says the review or translation was *skipped*, read its notes: the AI assistant
  is not set up, the document is already in the chosen language, or it is too large.

For API-level integration details, use Swagger at `/docs` or ReDoc at `/redoc`.
