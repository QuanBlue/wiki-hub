/**
 * Fast search filter parsing and manipulation for the global Ctrl+K search dialog.
 *
 * Supports fast filter prefixes:
 * - space:<key>       (e.g. space:ENG)
 * - author:<name>     (e.g. author:alice)
 * - label:<name>      (e.g. label:runbook)
 * - type:<ext>        (e.g. type:pdf)
 * - updated:<range>   (e.g. updated:>2026-01)
 */

export interface ActiveFilter {
  key: "space" | "author" | "label" | "type" | "updated";
  value: string;
  rawToken: string;
}

const FILTER_REGEX =
  /(?:^|\s)(space|author|creator|label|tag|type|file|ext|updated|date):(?:"([^"]*)"|'([^']*)'|([^\s]+))/gi;

export function parseActiveFilters(query: string): {
  cleanQuery: string;
  filters: ActiveFilter[];
} {
  const filters: ActiveFilter[] = [];
  const matches = [...query.matchAll(FILTER_REGEX)];

  for (const match of matches) {
    const rawKey = match[1]!.toLowerCase();
    const val = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (!val) continue;

    let normalizedKey: ActiveFilter["key"] = "space";
    if (rawKey === "author" || rawKey === "creator") normalizedKey = "author";
    else if (rawKey === "label" || rawKey === "tag") normalizedKey = "label";
    else if (rawKey === "type" || rawKey === "file" || rawKey === "ext")
      normalizedKey = "type";
    else if (rawKey === "updated" || rawKey === "date")
      normalizedKey = "updated";
    else normalizedKey = "space";

    filters.push({
      key: normalizedKey,
      value: val,
      rawToken: match[0].trim(),
    });
  }

  const cleanQuery = query.replace(FILTER_REGEX, " ").replace(/\s+/g, " ").trim();
  return { cleanQuery, filters };
}

export function removeFilterFromQuery(query: string, rawToken: string): string {
  // Remove the exact token from the query
  const escaped = rawToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "gi");
  return query.replace(regex, " ").replace(/\s+/g, " ").trim();
}

export function appendFilterToQuery(query: string, filterPrefix: string): string {
  const trimmed = query.trim();
  if (!trimmed) return filterPrefix;
  return `${trimmed} ${filterPrefix}`;
}

export interface QuickFilterOption {
  key: string;
  prefix: string;
  example: string;
  labelKey: string;
}

export const QUICK_FILTER_OPTIONS: QuickFilterOption[] = [
  { key: "space", prefix: "space:", example: "space:ENG", labelKey: "search.filterSpace" },
  { key: "author", prefix: "author:", example: "author:alice", labelKey: "search.filterAuthor" },
  { key: "label", prefix: "label:", example: "label:runbook", labelKey: "search.filterLabel" },
  { key: "type", prefix: "type:pdf", example: "type:pdf", labelKey: "search.filterType" },
  { key: "updated", prefix: "updated:>2026-01", example: "updated:>2026-01", labelKey: "search.filterUpdated" },
];
