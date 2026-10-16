# Using WikiHub

WikiHub is a self-hosted workspace for shared documentation. Knowledge lives in
**spaces** and **pages**, with access controls, revision history, attachments,
search, backup/restore, and administration tools.

The same guide is available to every signed-in user in the application at
**Help** (`/help`).

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
  clicking outside it; the conversation is kept only in your browser. If an
  administrator turns on *Web search* (Administration > AI assistant), a public technical
  question the wiki does not cover may be looked up on the internet - you see the query,
  and the web pages used are listed under *From the web*; only that short query, stripped
  of addresses, e-mails and internal host names, leaves WikiHub. Otherwise the AI may
  answer from its own knowledge, always marked as not checked. Facts about your own
  systems, accounts and people are answered from the wiki only.
  Selecting words in the chat shows the same small AI button as on a page, to explain or
  translate them.
  Earlier messages count as context for a follow-up; the assistant asks when something it
  depends on (such as a city) is missing, reads real weather measurements for a named place, and
  reads the text of the top web pages (public addresses only) so it can quote figures from them.

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
each AI feature. Keys are stored encrypted and left out of backups.

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

For API-level integration details, use Swagger at `/docs` or ReDoc at `/redoc`.
