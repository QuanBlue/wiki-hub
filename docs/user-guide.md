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
spaces and pages that you are allowed to access. The app sidebar can be
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

## Administration

Administrators can manage users, groups, spaces, workspace settings, backups,
and storage. They can create, activate, disable, update, reset passwords for,
or remove user accounts. The protected bootstrap administrator is intentionally
excluded from normal destructive actions.

Groups simplify access management. Grant global permissions to a group, then
use the group when assigning space/page permissions. Administrators can also
switch into an active user account for support; the application displays a
banner and records the administrator in the audit trail.

Workspace settings control the site name, session duration, upload/archive
limits, attachment types, and role visibility for sidebar areas. Storage lets
administrators filter bucket objects, obtain safe download links, preview
compatible files, and permanently delete unneeded objects.

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
