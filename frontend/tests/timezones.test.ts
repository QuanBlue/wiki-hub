import { describe, expect, it } from "vitest";

import {
  searchTimezones,
  TIMEZONE_IDS,
  timezoneDisplayLabel,
  timezoneOffsetLabel,
} from "@/lib/timezones";

describe("TIMEZONE_IDS", () => {
  it("includes real IANA zones, sorted", () => {
    expect(TIMEZONE_IDS.length).toBeGreaterThan(100);
    // Not "Asia/Ho_Chi_Minh": `Intl.supportedValuesOf` returns only
    // *canonical* zone ids, and ICU's canonical name for that zone is the
    // older "Asia/Saigon" - "Ho_Chi_Minh" is a real, still-valid IANA alias
    // for the exact same zone (see timezoneOffsetLabel below), just not the
    // one this list itself contains.
    expect(TIMEZONE_IDS).toContain("Asia/Saigon");
    expect(TIMEZONE_IDS).toContain("Europe/London");
    expect([...TIMEZONE_IDS]).toEqual([...TIMEZONE_IDS].sort());
  });
});

describe("timezoneOffsetLabel", () => {
  it("reports Ho Chi Minh City as a fixed UTC+7, year-round (no DST there)", () => {
    expect(timezoneOffsetLabel("Asia/Ho_Chi_Minh")).toBe("UTC+7");
  });

  it("reports UTC itself as UTC+0", () => {
    expect(timezoneOffsetLabel("UTC")).toBe("UTC+0");
  });

  it("falls back to computing on the fly for a zone outside the table", () => {
    // Covers pre-existing freehand values saved before this picker existed -
    // "Etc/GMT+7" is a real IANA zone that just never made it into most
    // day-to-day timezone lists.
    expect(timezoneOffsetLabel("Etc/GMT+7")).toMatch(/^UTC-7$/);
  });
});

describe("timezoneDisplayLabel", () => {
  it("swaps the IANA underscore for a space and appends the offset", () => {
    expect(timezoneDisplayLabel("Asia/Ho_Chi_Minh")).toBe(
      "Asia/Ho Chi Minh (UTC+7)",
    );
  });
});

describe("searchTimezones", () => {
  it("returns every zone for an empty query", () => {
    expect(searchTimezones("")).toEqual([...TIMEZONE_IDS]);
  });

  it("matches a zone id case-insensitively, spaces and underscores interchangeable", () => {
    expect(searchTimezones("ho chi minh")).toEqual([]); // see TIMEZONE_IDS above
    expect(searchTimezones("saigon")).toContain("Asia/Saigon");
    expect(searchTimezones("SAIGON")).toContain("Asia/Saigon");
  });

  it("searches a caller-supplied zone list too, not just the full canonical one", () => {
    // How the combobox covers a saved legacy alias like "Asia/Ho_Chi_Minh"
    // that Intl's own canonical list omits: merge it in before searching.
    const withAlias = ["Asia/Ho_Chi_Minh", ...TIMEZONE_IDS];
    expect(searchTimezones("ho chi minh", withAlias)).toContain("Asia/Ho_Chi_Minh");
  });

  it("also matches by UTC offset, so \"+7\" finds every zone sharing it", () => {
    const results = searchTimezones("+7");
    expect(results).toContain("Asia/Saigon");
    expect(results).toContain("Asia/Bangkok");
    expect(results.every((zone) => timezoneOffsetLabel(zone) === "UTC+7")).toBe(true);
  });

  it("returns nothing for a query that matches no zone", () => {
    expect(searchTimezones("not-a-real-place-zzz")).toEqual([]);
  });
});
