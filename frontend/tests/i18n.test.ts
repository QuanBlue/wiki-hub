import { describe, expect, it } from "vitest";

import { interpolate, isLocale, lookup, translate } from "@/lib/i18n/core";
import { en } from "@/lib/i18n/locales/en";
import { vi } from "@/lib/i18n/locales/vi";

/** Collect every leaf key path ("admin.users.title") of a dictionary. */
function flatten(dict: unknown, prefix = ""): string[] {
  return Object.entries(dict as Record<string, unknown>).flatMap(
    ([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === "string"
        ? [path]
        : flatten(value, path);
    },
  );
}

describe("i18n dictionaries", () => {
  it("en and vi have identical key sets", () => {
    expect(flatten(vi).sort()).toEqual(flatten(en).sort());
  });

  it("every vi value is a non-empty string", () => {
    for (const key of flatten(vi)) {
      const value = lookup(vi, key);
      expect(value, `vi.${key} is empty`).toBeTruthy();
      expect(typeof value).toBe("string");
    }
  });

  it("vi has no untranslated template that duplicates en placeholders mismatch", () => {
    // Placeholders must survive translation: {name} in en must exist in vi.
    for (const key of flatten(en)) {
      const enVars = lookup(en, key)!.match(/\{(\w+)\}/g) ?? [];
      const viVars = lookup(vi, key)!.match(/\{(\w+)\}/g) ?? [];
      expect(viVars.sort(), `vi.${key} placeholders`).toEqual(enVars.sort());
    }
  });
});

describe("translate", () => {
  it("resolves nested keys in both locales", () => {
    expect(translate("en", "userMenu.signOut")).toBe("Sign out");
    expect(translate("vi", "userMenu.signOut")).toBe("Đăng xuất");
  });

  it("interpolates variables", () => {
    expect(
      translate("vi", "topbar.searchPlaceholder", { siteName: "WikiHub" }),
    ).toBe("Tìm kiếm trong WikiHub");
  });

  it("falls back to English then the key itself", () => {
    expect(translate("vi", "nonexistent.key")).toBe("nonexistent.key");
  });
});

describe("interpolate", () => {
  it("leaves unknown placeholders untouched", () => {
    expect(interpolate("Hi {name}, {missing}", { name: "A" })).toBe(
      "Hi A, {missing}",
    );
  });
});

describe("isLocale", () => {
  it("accepts only en and vi", () => {
    expect(isLocale("vi")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
