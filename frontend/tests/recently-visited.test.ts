import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readRecentlyVisited,
  recordVisit,
  subscribeRecentlyVisited,
  type VisitedPage,
} from "@/lib/recently-visited";

const STORAGE_KEY = "wikihub:recently-visited";

function entry(overrides: Partial<VisitedPage> = {}): VisitedPage {
  return {
    spaceKey: "ENG",
    spaceName: "Engineering",
    slug: "runbook",
    title: "Runbook",
    visitedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("recently-visited", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts empty", () => {
    expect(readRecentlyVisited()).toEqual([]);
  });

  it("records a visit and reads it back, newest first", () => {
    recordVisit(entry({ slug: "a" }));
    recordVisit(entry({ slug: "b" }));

    expect(readRecentlyVisited().map((p) => p.slug)).toEqual(["b", "a"]);
  });

  it("moves a re-visited page to the front instead of duplicating it", () => {
    recordVisit(entry({ slug: "a" }));
    recordVisit(entry({ slug: "b" }));
    recordVisit(entry({ slug: "a", title: "Runbook (updated)" }));

    const visited = readRecentlyVisited();
    expect(visited.map((p) => p.slug)).toEqual(["a", "b"]);
    expect(visited[0].title).toBe("Runbook (updated)");
  });

  it("keeps the same page in two different spaces as separate entries", () => {
    recordVisit(entry({ spaceKey: "ENG", slug: "runbook" }));
    recordVisit(entry({ spaceKey: "SALES", slug: "runbook" }));

    expect(readRecentlyVisited()).toHaveLength(2);
  });

  it("caps history at 25 entries, dropping the oldest", () => {
    for (let i = 0; i < 30; i += 1) {
      recordVisit(entry({ slug: `page-${i}` }));
    }

    const visited = readRecentlyVisited();
    expect(visited).toHaveLength(25);
    expect(visited[0].slug).toBe("page-29");
    expect(visited.find((p) => p.slug === "page-0")).toBeUndefined();
  });

  it("dispatches a change event other tabs/components can subscribe to", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeRecentlyVisited(onChange);

    recordVisit(entry());

    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    recordVisit(entry({ slug: "another" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed JSON already sitting in storage rather than throwing", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readRecentlyVisited()).toEqual([]);
  });

  it("filters out entries that don't look like a VisitedPage", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([entry(), { spaceKey: "ENG" }, "garbage", 42]),
    );
    expect(readRecentlyVisited()).toHaveLength(1);
  });

  it("survives a full/blocked localStorage without throwing", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

    expect(() => recordVisit(entry())).not.toThrow();
    setItem.mockRestore();
  });
});
