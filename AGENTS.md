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

## In-app notifications and confirmations

Use WikiHub modal components for user-facing notifications, confirmations, and
leave-without-saving prompts. Do not use `window.alert()` or `window.confirm()`
for application interactions. The browser's native `beforeunload` dialog is
allowed only as an unavoidable fallback for browser refresh controls, closing
tabs/windows, or other unload actions that browsers do not permit web apps to
replace with custom modals.
