import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";
import { LocaleProvider, useTranslation } from "@/lib/i18n/context";
import { LOCALE_STORAGE_KEY, persistLocale, readStoredLocale } from "@/lib/i18n/core";
import {
  formatDate,
  formatDateOrTime,
  formatDateShort,
  formatDateTime,
  formatTime,
} from "@/lib/i18n/format";

afterEach(() => {
  window.localStorage.clear();
  document.cookie = "wikihub_locale=; max-age=0; path=/";
  vi.useRealTimers();
});

describe("locale persistence", () => {
  it("writes the choice to the cookie and storage, and reads it back", () => {
    expect(readStoredLocale()).toBeNull();

    persistLocale("vi");

    expect(readStoredLocale()).toBe("vi");
    expect(document.cookie).toContain("wikihub_locale=vi");
  });

  it("ignores a stored value that is not a locale", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    expect(readStoredLocale()).toBeNull();
  });
});

function withProvider(initialLocale?: "en" | "vi") {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <LocaleProvider initialLocale={initialLocale}>{children}</LocaleProvider>;
  };
}

describe("LocaleProvider", () => {
  it("starts from the server's locale and keeps <html lang> in step", () => {
    const { result } = renderHook(() => useTranslation(), { wrapper: withProvider("vi") });

    expect(result.current.locale).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
  });

  it("switches to a locale saved in this browser after mount", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "vi");
    const { result } = renderHook(() => useTranslation(), { wrapper: withProvider() });

    expect(result.current.locale).toBe("vi");
  });

  it("persists a change and translates in the new locale", () => {
    const { result } = renderHook(() => useTranslation(), { wrapper: withProvider() });
    const english = result.current.t("errors.network");

    act(() => result.current.setLocale("vi"));

    expect(result.current.locale).toBe("vi");
    expect(readStoredLocale()).toBe("vi");
    expect(result.current.t("errors.network")).not.toBe(english);
  });

  it("explains errors: translated network failure, backend message, or the fallback", () => {
    const { result } = renderHook(() => useTranslation(), { wrapper: withProvider() });
    const { apiErrorText, t } = result.current;

    expect(apiErrorText(new ApiError(0, "network_error", "x"), "errors.network")).toBe(
      t("errors.network"),
    );
    expect(apiErrorText(new ApiError(400, "bad", "Name is taken."), "errors.network")).toBe(
      "Name is taken.",
    );
    expect(apiErrorText(new Error("boom"), "errors.network")).toBe(t("errors.network"));
  });

  it("falls back to English without a provider", () => {
    const { result } = renderHook(() => useTranslation());

    expect(result.current.locale).toBe("en");
    expect(result.current.apiErrorText(new Error("x"), "errors.network")).toBe(
      result.current.t("errors.network"),
    );
    expect(() => result.current.setLocale("vi")).not.toThrow();
  });
});

describe("date formatting", () => {
  const value = "2026-09-15T15:42:00";

  it("formats in each locale", () => {
    expect(formatDate(value, "en")).toBe("Sep 15, 2026");
    expect(formatDateTime(value, "en")).toMatch(/^Sep 15, 2026, 3:42\sPM$/);
    expect(formatTime(value, "vi")).toBe("15:42");
    expect(formatDateShort(new Date(value), "en")).toBe("Sep 15");
  });

  it("shows only the time for today and only the date otherwise", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T18:00:00"));

    expect(formatDateOrTime(value, "en")).toMatch(/^3:42\sPM$/);
    expect(formatDateOrTime("2026-09-14T15:42:00", "en")).toBe("Sep 14");
  });
});
