import { describe, expect, it } from "vitest";

import { findPageByRouteSlug } from "@/lib/pages";
import type { WikiPage } from "@/types/api";

function page(slug: string): WikiPage {
  return {
    id: slug,
    space_id: "space-1",
    parent_id: null,
    title: slug,
    slug,
    content: "",
    content_format: "html",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by_username: null,
    updated_by_username: null,
  };
}

describe("findPageByRouteSlug", () => {
  it("finds an exact match", () => {
    const target = page("getting-started");
    expect(findPageByRouteSlug([page("other"), target], "getting-started")).toBe(target);
  });

  it("is case-insensitive", () => {
    const target = page("Getting-Started");
    expect(findPageByRouteSlug([target], "getting-started")).toBe(target);
  });

  it("decodes a percent-encoded route segment before matching", () => {
    const target = page("Kế hoạch");
    expect(findPageByRouteSlug([target], encodeURIComponent("Kế hoạch"))).toBe(target);
  });

  it("falls back to the raw segment when it is not valid URI encoding", () => {
    // "%" not followed by two hex digits makes decodeURIComponent throw.
    const target = page("100%-done");
    expect(findPageByRouteSlug([target], "100%-done")).toBe(target);
  });

  it("trims whitespace before comparing", () => {
    const target = page(" spaced ");
    expect(findPageByRouteSlug([target], "spaced")).toBe(target);
  });

  it("returns undefined when nothing matches", () => {
    expect(findPageByRouteSlug([page("a")], "b")).toBeUndefined();
  });
});
