# Design system

WikiHub's interface follows the layout conventions people expect from a team
wiki — a fixed top bar, a persistent navigation tree on the left, breadcrumbs
above the title, a table of contents on the right, and a comfortable reading
column. That structure is what makes documentation navigable, and readers coming
from other wikis should not have to relearn it.

## Wiki Workspace theme

WikiHub uses the **Wiki Workspace** theme: a calm, structured interface for
teams to find, read and maintain shared knowledge. It takes inspiration from
the _workflow_ of mature enterprise wikis — persistent navigation, a
reading-first canvas, obvious page context, and lightweight collaboration —
without reproducing any third-party brand or UI.

The intended feeling is trustworthy and focused, not a generic admin dashboard:

- **Navigation gives orientation.** The left rail is for spaces, page trees,
  recents and favourites. Keep it stable while a user reads or edits.
- **Content is the product.** A page title, breadcrumbs and the reading column
  have visual priority. Do not let metrics, empty chrome or large illustrations
  compete with knowledge.
- **Actions are contextual.** Put the main task (create, edit, publish, share)
  beside the page or section it affects. Keep global actions restrained.
- **Density is deliberate.** Compact controls and 14px body type let users
  scan documentation, while headings and whitespace establish hierarchy.
- **Collaboration is quiet.** Members, recency, comments and status are useful
  metadata; they should support the document rather than dominate it.

**Every visual value is WikiHub's own.** Do not copy third-party palettes,
typefaces, iconography, logos, component metrics, UI copy, or pixel-for-pixel
layouts. "Confluence" is referenced in this repository only as a supported
import format.

### Application patterns

| Surface     | Required pattern                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home        | A useful starting point: recently used or starred knowledge, a clear create/browse action, and brief orientation. Infrastructure diagnostics belong elsewhere. |
| Space       | Breadcrumbs, identity (icon/name), a page tree or empty state, then members and supporting metadata.                                                           |
| Page        | Breadcrumbs → title and metadata → readable document body. A right table of contents may appear only when it improves long-form reading.                       |
| Admin       | Dense, task-oriented forms and tables. Do not carry admin-dashboard styling into knowledge screens.                                                            |
| Empty state | State what is missing, why it matters, and provide one direct next action. Avoid decorative illustrations without information value.                           |

### Agent implementation rules

`AGENTS.md` makes this theme mandatory for every agent working in this
repository. UI changes must use the semantic tokens and shared primitives,
retain light/dark support, expose visible keyboard focus, and work on narrow
screens. Add a new token or primitive only when the existing system cannot
express the intended reusable behaviour.

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ ▦ WikiHub   [Spaces▾][Create]   ⌕ Search        ◍       │  56px
├──────────┬──────────────────────────┬───────────────────┤
│ Home     │ Engineering / Architec…  │ ON THIS PAGE      │
│ Recent   │                          │  · Introduction   │
│ Spaces   │ Backend Architecture     │  · Modules        │
│ ▾ ENG    │ ──────────────────────   │  · Data model     │
│  ▾ Arch  │ Lorem ipsum dolor sit…   │                   │
│    Back● │                          │                   │
│    Front │ ▸ code block             │                   │
│  ▸ Deploy│                          │                   │
└──────────┴──────────────────────────┴───────────────────┘
  256px          fluid, max 848px           224px
```

| Token                | Value           | Purpose                         |
| -------------------- | --------------- | ------------------------------- |
| `--wh-topbar-height` | `3.5rem` (56px) | Fixed header                    |
| `--wh-sidebar-width` | `16rem` (256px) | Navigation rail                 |
| `--wh-toc-width`     | `14rem` (224px) | On-this-page column             |
| `--wh-content-max`   | `53rem` (848px) | Reading measure, ~90 characters |
| `--radius`           | `0.375rem`      | Base corner radius              |

Spacing follows an 8px grid (Tailwind's default scale). Base font size is
**14px** — documentation UIs are dense, and 16px wastes vertical space in a
navigation tree.

## Colour

Tokens are defined once in `frontend/app/globals.css` and exposed to Tailwind
through `@theme inline`, so components use semantic utilities (`bg-surface`,
`text-muted-foreground`, `border-border`) and never raw hex values.

### Ramps

- **Neutral** — a slightly cool grey, 12 steps from `#ffffff` to `#0d1017`.
- **Brand** — WikiHub workspace blue, 9 steps centred on `#216fc0` (light) and
  `#59adf3` (dark). It signals links, creation and active navigation without
  borrowing another product's brand palette.
- **Status** — success green, warning amber, danger red, info blue, each with a
  paired background tint for callouts.

### Semantic tokens

| Token                                                                         | Role                |
| ----------------------------------------------------------------------------- | ------------------- |
| `--background` / `--foreground`                                               | Page base           |
| `--surface` / `--surface-sunken` / `--surface-raised`                         | Panel elevation     |
| `--surface-hover` / `--surface-selected`                                      | Interaction states  |
| `--border` / `--border-strong`                                                | Dividers and inputs |
| `--muted-foreground`                                                          | Secondary text      |
| `--primary` / `--primary-hover` / `--primary-foreground` / `--primary-subtle` | Actions             |
| `--ring`                                                                      | Focus indicator     |
| `--danger`                                                                    | Destructive actions |

### Dark mode

The `.dark` class redefines the semantic tokens only — never the ramps' meaning.
Dark surfaces get _lighter_ as they rise (`surface-sunken` → `surface` →
`surface-raised`), inverting the light-mode shadow model, because shadows do not
read on dark backgrounds. Brand and status colours shift one to two steps
lighter to hold contrast against dark surfaces.

Theme selection is three-state: light, dark, or follow the system. It is applied
by `next-themes` on the `<html>` element.

## Typography

- **Inter** for UI and body, **JetBrains Mono** for code.
- Both are self-hosted at build time via `next/font` — no runtime request to a
  font CDN, so WikiHub works on an air-gapped network.

## Accessibility

- Focus is always visible: a 2px `--ring` outline with a 2px offset, never
  removed.
- Interactive elements are at least 32px tall (`size="md"` on `Button`).
- Colour is never the sole signal — dependency status shows an icon _and_ a text
  label; callouts carry an icon and a heading.
- Navigation is a real `<nav aria-label>` with `aria-current="page"` on the
  active item.
- Body text meets WCAG AA contrast against its surface in both themes.

## Interaction states

**Rule: every interactive element gives explicit hover, active and focus
feedback.** A control that only reacts on click reads as dead. This applies to
buttons, inputs, links, navigation items, icon buttons and any card that behaves
as a link.

| State           | What changes                                                    |
| --------------- | --------------------------------------------------------------- |
| `hover`         | Background, border or text shifts one step via a semantic token |
| `active`        | A slightly stronger shift, so the press registers               |
| `focus-visible` | 2px `--ring` outline — never replaced by the hover styling      |
| `disabled`      | No hover feedback at all, and `pointer-events-none`             |

Guidelines:

- Transition the specific properties (`transition-colors`,
  `transition-[color,background-color,border-color,box-shadow]`) with
  `duration-150`. Never `transition-all` — it animates layout and paints work
  the browser cannot skip.
- Inputs shift their border on hover (`hover:border-border-strong`) and keep the
  focus ring on focus. The two are independent: a focused field that is also
  hovered must still show the ring.
- Hover is not available on touch devices, so it may only ever _reinforce_
  affordance, never be the sole indicator that something is interactive.
- Motion beyond a colour fade is wrapped in `motion-safe:` so it respects
  `prefers-reduced-motion`.

The shared primitives in `components/ui/` implement this; prefer them over a
bare `<button>` or `<input>` so the behaviour stays consistent.

## Components

`components/ui/` holds primitives in the shadcn/ui style: unstyled Radix
behaviour plus WikiHub tokens, copied into the repo rather than imported from a
package so they can be adapted freely.

Variants are declared with `class-variance-authority`; classes are merged with
`cn()` (`clsx` + `tailwind-merge`) so a caller's utility always wins over a
default.

## Brand

The mark is three stacked layers converging on a hub — knowledge accumulating
into one place. It is drawn inline as SVG using `var(--primary)`, so it recolours
with the theme automatically and needs no raster assets.
