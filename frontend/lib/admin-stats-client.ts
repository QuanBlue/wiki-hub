import { api } from "@/lib/api-client";
import type {
  StatsAi,
  StatsDateQuery,
  StatsOverview,
  StatsTopContent,
  StatsTopContributors,
} from "@/types/api";

export interface AdminStatsBundle {
  overview: StatsOverview;
  ai: StatsAi;
  pages: Partial<Record<"views" | "stars" | "saves", StatsTopContent>>;
  spaces: Partial<Record<"views" | "stars", StatsTopContent>>;
  contributors: StatsTopContributors;
}

export async function fetchAdminStatsBundle(
  dateQuery: StatsDateQuery,
): Promise<AdminStatsBundle> {
  const query = {
    range: dateQuery.start || dateQuery.end ? undefined : dateQuery.range,
    start: dateQuery.start,
    end: dateQuery.end,
  };
  const [
    overview,
    ai,
    pagesViews,
    pagesStars,
    pagesSaves,
    spacesViews,
    spacesStars,
    contributors,
  ] = await Promise.all([
    api.get<StatsOverview>("/api/v1/admin/statistics/overview", { query }),
    api.get<StatsAi>("/api/v1/admin/statistics/ai", { query }),
    api.get<StatsTopContent>("/api/v1/admin/statistics/top-pages", {
      query: { ...query, sort: "views" },
    }),
    api.get<StatsTopContent>("/api/v1/admin/statistics/top-pages", {
      query: { ...query, sort: "stars" },
    }),
    api.get<StatsTopContent>("/api/v1/admin/statistics/top-pages", {
      query: { ...query, sort: "saves" },
    }),
    api.get<StatsTopContent>("/api/v1/admin/statistics/top-spaces", {
      query: { ...query, sort: "views" },
    }),
    api.get<StatsTopContent>("/api/v1/admin/statistics/top-spaces", {
      query: { ...query, sort: "stars" },
    }),
    api.get<StatsTopContributors>("/api/v1/admin/statistics/top-contributors", {
      query,
    }),
  ]);
  return {
    overview,
    ai,
    pages: { views: pagesViews, stars: pagesStars, saves: pagesSaves },
    spaces: { views: spacesViews, stars: spacesStars },
    contributors,
  };
}

/**
 * Percentage change from `previous` to `current`, rounded to the nearest whole
 * percent. Returns `null` when `previous` is zero (no baseline to divide by).
 */
export function percentDelta(
  current: number,
  previous: number | undefined,
): number | null {
  if (previous === undefined || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

/** Build a UTF-8 BOM CSV string so Excel opens Vietnamese and Unicode cleanly. */
export function buildCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
