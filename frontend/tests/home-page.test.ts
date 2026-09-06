import { describe, expect, it } from "vitest";

import { findHomePage } from "@/lib/home-page";
import type { WikiPage } from "@/types/api";

function page(overrides: Partial<WikiPage> & { id: string; slug: string }): WikiPage {
  return {
    space_id: "space-1",
    title: overrides.title ?? overrides.slug,
    content: "",
    content_format: "html",
    parent_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by_username: null,
    updated_by_username: null,
    ...overrides,
  };
}

describe("findHomePage", () => {
  it("prefers a page whose slug matches the space key", () => {
    const home = page({ id: "1", slug: "eng", title: "Overview" });
    const other = page({ id: "2", slug: "roadmap" });

    expect(findHomePage([other, home], "ENG")).toBe(home);
  });

  it("falls back to a page titled after the space key or name", () => {
    const home = page({ id: "1", slug: "welcome", title: "Engineering" });
    const other = page({ id: "2", slug: "roadmap" });

    expect(findHomePage([other, home], "ENG", "Engineering")).toBe(home);
  });

  it("falls back to the root page with the most children when nothing is named for the space", () => {
    const root = page({ id: "root", slug: "root", parent_id: null });
    const child1 = page({ id: "c1", slug: "c1", parent_id: "root" });
    const child2 = page({ id: "c2", slug: "c2", parent_id: "root" });
    const otherRoot = page({ id: "root2", slug: "root2", parent_id: null });

    expect(findHomePage([otherRoot, root, child1, child2], "ENG")).toBe(root);
  });

  it("treats a page whose parent no longer exists as a root", () => {
    const orphan = page({ id: "orphan", slug: "orphan", parent_id: "deleted-page" });

    expect(findHomePage([orphan], "ENG")).toBe(orphan);
  });

  it("falls back to the first page when there are no roots at all", () => {
    // Pathological input (every page points at another page in the same
    // list) - still must not throw or return undefined.
    const a = page({ id: "a", slug: "a", parent_id: "b" });
    const b = page({ id: "b", slug: "b", parent_id: "a" });

    expect(findHomePage([a, b], "ENG")).toBe(a);
  });

  it("returns undefined for an empty space", () => {
    expect(findHomePage([], "ENG")).toBeUndefined();
  });

  it("is case- and whitespace-insensitive when matching the slug", () => {
    const home = page({ id: "1", slug: " Eng " });

    expect(findHomePage([home], "eng")).toBe(home);
  });
});
