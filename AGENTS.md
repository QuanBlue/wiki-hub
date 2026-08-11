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
