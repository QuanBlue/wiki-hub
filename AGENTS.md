# WikiHub agent guidance

## Product UI contract

All interface work must follow the **Wiki Workspace** theme defined in
[`docs/design-system.md`](docs/design-system.md). It is WikiHub's own visual
language for a focused, enterprise documentation product. It draws on familiar
wiki interaction patterns, including persistent navigation, a reading-first
content column, page context, and restrained collaboration controls.

Do not copy Confluence/Atlassian branding, assets, layouts pixel-for-pixel,
text, or proprietary component names. Use the experience principles in the
design-system document, not external product CSS or screenshots, as the source
of truth.

Before creating or changing UI, agents must:

1. Read `docs/design-system.md`.
2. Reuse semantic tokens from `frontend/app/globals.css` and the primitives in
   `frontend/components/ui/`; never introduce raw brand colours in a component.
3. Preserve the standard shell: 56px top bar, contextual left navigation, and
   a comfortable reading measure for page content.
4. Make the task's primary knowledge action prominent; system or administrative
   information belongs in settings or secondary regions.
5. Provide hover, active, keyboard-focus, responsive, and dark-mode behaviour
   for every new interactive element.

When a request conflicts with this contract, ask for clarification before
creating a one-off visual style.

## Confluence import rules

When modifying the Confluence import and file upload component (`frontend/components/admin/backup-panel.tsx`):

1. **Upload resume functionality**: Always preserve the ability to resume scans and uploads. Scanned archives (status `"scanned"`) must be restored by fetching from the backend and loading the space selection UI, rather than clearing the upload state or forcing the user to re-upload.
2. **Page unload warnings**: Always preserve navigation warnings when `confluencePending` is true. Ensure that `uploadActiveRef.current` is set to `confluencePending` to warn users when refreshing or leaving the page during hashing, uploading, or scan finalization.
3. **Upload hash performance**: Hashing is performed using native `window.crypto.subtle.digest` with standard incremental fallback to keep large archive finger-printing fast. Do not introduce custom JS hashing algorithms that block the UI thread.

## Button hover rules

All buttons and interactive action icons MUST have a hover effect. Always verify and add hover states (e.g., `hover:bg-accent`, `hover:text-accent-foreground`, or opacity changes) for all clickable elements across all pages.

## Scrollbar consistency

All scrollable surfaces use the global scrollbar treatment in
`frontend/app/globals.css`: a compact neutral-grey thumb, transparent track,
no arrow buttons, and token-based light/dark colours. Do not add component-level
scrollbar colours, dimensions, or browser-specific scrollbar rules. If the
shared treatment needs to change, update it globally and retain parity for
Firefox (`scrollbar-width`/`scrollbar-color`) and WebKit browsers
(`::-webkit-scrollbar`).

## In-app notifications and confirmations

Use WikiHub modal components for user-facing notifications, confirmations, and
leave-without-saving prompts. Do not use `window.alert()` or `window.confirm()`
for application interactions. The browser's native `beforeunload` dialog is
allowed only as an unavoidable fallback for browser refresh controls, closing
tabs/windows, or other unload actions that browsers do not permit web apps to
replace with custom modals.

## Docker dev volume rules (`docker-compose.dev.yml`)

**Never** add `/app/.next` as an anonymous volume in the frontend dev service.

### Why this causes 404s after code changes

In dev mode (`./scripts/run.sh --dev`), the host `./frontend` directory is
bind-mounted into the container at `/app`. When `/app/.next` is also declared as
an anonymous Docker volume, Docker creates a volume-backed directory that
**shadows** the bind-mount for that sub-path. The anonymous volume persists
between container restarts (even after `--build`) because only `--fresh` (`down
-v`) deletes volumes. If the volume was seeded from an older image or an
earlier run, the Next.js dev server starts with a stale route manifest that does
not match the current source, causing every page route to return 404.

### The correct setup

Only `/app/node_modules` should be an anonymous volume (to preserve the
Linux-built packages from the image and prevent Windows host artifacts from
shadowing them). The `.next` directory must **not** be an anonymous volume so
that `next dev` always compiles from the live bind-mounted source:

```yaml
volumes:
  - ./frontend:/app      # host source
  - /app/node_modules    # Linux node_modules (anonymous, correct)
  # /app/.next must NOT appear here
```

### When you still see 404 after this fix

If you inherited a stale volume from a previous run, destroy it once:

```bash
./scripts/run.sh --dev --fresh
```

`--fresh` runs `docker compose down -v`, which removes all anonymous volumes
including any leftover `.next` volume. Your database and MinIO data are also
wiped, so only run it when a clean slate is acceptable.
