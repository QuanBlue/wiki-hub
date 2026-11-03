import { describe, expect, it } from "vitest";

import {
  appendFilterToQuery,
  parseActiveFilters,
  removeFilterFromQuery,
} from "@/lib/search-filters";

describe("search-filters", () => {
  it("parses multiple active filters and isolates clean query", () => {
    const raw =
      "space:ENG author:alice label:runbook type:pdf updated:>2026-01 incident postmortem";
    const { cleanQuery, filters } = parseActiveFilters(raw);

    expect(cleanQuery).toBe("incident postmortem");
    expect(filters).toHaveLength(5);
    expect(filters[0]).toEqual({
      key: "space",
      value: "ENG",
      rawToken: "space:ENG",
    });
    expect(filters[1]).toEqual({
      key: "author",
      value: "alice",
      rawToken: "author:alice",
    });
    expect(filters[2]).toEqual({
      key: "label",
      value: "runbook",
      rawToken: "label:runbook",
    });
    expect(filters[3]).toEqual({
      key: "type",
      value: "pdf",
      rawToken: "type:pdf",
    });
    expect(filters[4]).toEqual({
      key: "updated",
      value: ">2026-01",
      rawToken: "updated:>2026-01",
    });
  });

  it("handles quotes and aliases (creator, tag, file, date)", () => {
    const raw =
      'space:"My Team" creator:"John Doe" tag:"hot-fix" file:docx date:2026-05';
    const { cleanQuery, filters } = parseActiveFilters(raw);

    expect(cleanQuery).toBe("");
    expect(filters).toEqual([
      { key: "space", value: "My Team", rawToken: 'space:"My Team"' },
      { key: "author", value: "John Doe", rawToken: 'creator:"John Doe"' },
      { key: "label", value: "hot-fix", rawToken: 'tag:"hot-fix"' },
      { key: "type", value: "docx", rawToken: "file:docx" },
      { key: "updated", value: "2026-05", rawToken: "date:2026-05" },
    ]);
  });

  it("removes a filter token from query cleanly", () => {
    const raw = "space:ENG label:runbook deployment";
    const withoutSpace = removeFilterFromQuery(raw, "space:ENG");
    expect(withoutSpace).toBe("label:runbook deployment");

    const withoutLabel = removeFilterFromQuery(withoutSpace, "label:runbook");
    expect(withoutLabel).toBe("deployment");
  });

  it("appends filter prefix to query", () => {
    expect(appendFilterToQuery("", "space:")).toBe("space:");
    expect(appendFilterToQuery("deployment", "space:")).toBe("deployment space:");
  });
});
