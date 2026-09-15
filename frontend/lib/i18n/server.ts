import { cookies } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  translate,
  type Locale,
} from "./core";

export interface ServerLocale {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/**
 * Locale for server components: read from the preference cookie the client
 * keeps in sync. Defaults to English when absent or unreadable.
 */
export async function getServerLocale(): Promise<ServerLocale> {
  let locale: Locale = DEFAULT_LOCALE;
  try {
    const store = await cookies();
    const value = store.get(LOCALE_COOKIE)?.value;
    if (isLocale(value)) locale = value;
  } catch {
    // Rendering outside a request scope falls back to the default locale.
  }

  return {
    locale,
    t: (key, vars) => translate(locale, key, vars),
  };
}

export type { Locale };
