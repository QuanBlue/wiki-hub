import { en, type Dictionary } from "./locales/en";
import { vi } from "./locales/vi";

export type Locale = "en" | "vi";

export const LOCALE_COOKIE = "wikihub_locale";
export const LOCALE_STORAGE_KEY = "wikihub:locale";
export const DEFAULT_LOCALE: Locale = "en";

const DICTIONARIES: Record<Locale, Dictionary> = { en, vi };

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "vi";
}

/** Read a dot-path key ("admin.users.title") out of a nested dictionary. */
export function lookup(dict: Dictionary, key: string): string | undefined {
  let current: unknown = dict;
  for (const segment of key.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : undefined;
}

/** Replace `{name}` placeholders; unknown names are left untouched. */
export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const value = lookup(DICTIONARIES[locale], key) ?? lookup(en, key) ?? key;
  return interpolate(value, vars);
}

/** Persist the choice to both mirrors; client-only (uses document). */
export function persistLocale(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

export function readStoredLocale(): Locale | null {
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return isLocale(stored) ? stored : null;
}
