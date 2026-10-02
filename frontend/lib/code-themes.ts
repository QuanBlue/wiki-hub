/**
 * Colour themes a code block can be switched to. The palettes themselves live
 * in `app/globals.css` as `.wikihub-code[data-code-theme="<key>"]` rules that
 * override the `--wh-code-*` variables; this list only names them for the
 * picker. `DEFAULT_CODE_THEME` is the unmarked look (no attribute stored), so
 * existing pages keep rendering exactly as before.
 */
export const DEFAULT_CODE_THEME = "monokai-pro";

export type CodeThemeMode = "dark" | "light";

export const CODE_THEMES: ReadonlyArray<{
  key: string;
  label: string;
  mode: CodeThemeMode;
}> = [
  { key: "monokai-pro", label: "Monokai Pro", mode: "dark" },
  { key: "github-dark", label: "GitHub Dark", mode: "dark" },
  { key: "one-dark", label: "One Dark", mode: "dark" },
  { key: "dracula", label: "Dracula", mode: "dark" },
  { key: "nord", label: "Nord", mode: "dark" },
  { key: "solarized-dark", label: "Solarized Dark", mode: "dark" },
  { key: "github-light", label: "GitHub Light", mode: "light" },
  { key: "one-light", label: "One Light", mode: "light" },
  { key: "solarized-light", label: "Solarized Light", mode: "light" },
  { key: "gruvbox-light", label: "Gruvbox Light", mode: "light" },
];

const THEME_KEYS = new Set(CODE_THEMES.map((theme) => theme.key));

/** A stored theme key, or null for the default / anything unrecognised. */
export function normaliseCodeTheme(value: unknown): string | null {
  return typeof value === "string" &&
    value !== DEFAULT_CODE_THEME &&
    THEME_KEYS.has(value)
    ? value
    : null;
}
