"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ApiError, describeApiError } from "@/lib/api-client";

import {
  DEFAULT_LOCALE,
  isLocale,
  persistLocale,
  readStoredLocale,
  translate,
  type Locale,
} from "./core";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /**
   * Human-facing text for a caught error: translated network fallback,
   * backend-provided message otherwise, translated generic fallback when the
   * failure is not an API error at all.
   */
  apiErrorText: (
    error: unknown,
    fallbackKey: string,
    vars?: Record<string, string | number>,
  ) => string;
}

// Default is English so components rendered without a provider (unit tests,
// isolated mounts) keep producing the existing English strings.
const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
  apiErrorText: (error, fallbackKey, vars) =>
    translate(DEFAULT_LOCALE, fallbackKey, vars),
});

export function useTranslation() {
  return useContext(LocaleContext);
}

export function LocaleProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  // Initialised from the cookie the server read, so the first client render
  // matches the SSR HTML exactly. localStorage is only consulted after mount.
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    const stored = readStoredLocale();
    if (stored && stored !== DEFAULT_LOCALE) {
      setLocaleState((current) => (current === stored ? current : stored));
    }
  }, []);

  // Keep the document language attribute in step with the active locale.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    [locale],
  );

  const apiErrorText = useCallback(
    (
      error: unknown,
      fallbackKey: string,
      vars?: Record<string, string | number>,
    ) => {
      const fallback = translate(locale, fallbackKey, vars);
      if (error instanceof ApiError) {
        // Backend messages arrive in English; only the transport-level
        // fallback has a translated equivalent.
        if (error.code === "network_error") {
          return translate(locale, "errors.network");
        }
        return describeApiError(error, fallback);
      }
      return fallback;
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, apiErrorText }),
    [locale, setLocale, t, apiErrorText],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export { isLocale };
export type { Locale };
