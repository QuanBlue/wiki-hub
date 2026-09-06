/**
 * IANA time zone list and current UTC-offset labels, computed once from the
 * runtime rather than shipped as a hand-maintained dataset - offsets
 * (especially DST ones) go stale, the browser's own tz database never does.
 */

/** Every IANA zone the current runtime knows about, alphabetical. Empty in a
 * runtime old enough not to support `Intl.supportedValuesOf` (Safari < 16.4) -
 * callers fall back to treating time zones as free text in that case. */
export const TIMEZONE_IDS: readonly string[] = (() => {
  try {
    return [...Intl.supportedValuesOf("timeZone")].sort();
  } catch {
    return [];
  }
})();

function computeOffsetLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    // Intl reports "GMT+7"/"GMT" - "UTC" is the more familiar spelling for
    // anyone comparing this against a schedule's other displayed times.
    return raw ? raw.replace("GMT", "UTC") : "UTC+0";
  } catch {
    return "";
  }
}

//: Computed once at module load (a few hundred `Intl.DateTimeFormat`
//: constructions, done exactly once, not per render) rather than recomputed
//: for whatever subset a search happens to filter down to.
const TIMEZONE_OFFSETS: ReadonlyMap<string, string> = new Map(
  TIMEZONE_IDS.map((timeZone) => [timeZone, computeOffsetLabel(timeZone)]),
);

/** "UTC+7", or "" for a zone outside the precomputed table (freehand text
 * from before this picker existed, e.g.) - callers decide how to fall back. */
export function timezoneOffsetLabel(timeZone: string): string {
  return TIMEZONE_OFFSETS.get(timeZone) ?? computeOffsetLabel(timeZone);
}

/** "Asia/Ho Chi Minh (UTC+7)" - the underscore IANA uses in place of spaces
 * reads as a typo to anyone who didn't already know the convention. */
export function timezoneDisplayLabel(timeZone: string): string {
  const offset = timezoneOffsetLabel(timeZone);
  const name = timeZone.replaceAll("_", " ");
  return offset ? `${name} (${offset})` : name;
}

/** Zones whose id or offset match `query` (case-insensitive, "_"/" "
 * interchangeable), narrowest first. Empty query returns the full list. */
export function searchTimezones(
  query: string,
  zones: readonly string[] = TIMEZONE_IDS,
): string[] {
  const needle = query.trim().toLowerCase().replaceAll(" ", "_");
  if (!needle) return [...zones];
  return zones.filter(
    (timeZone) =>
      timeZone.toLowerCase().includes(needle) ||
      timezoneOffsetLabel(timeZone).toLowerCase().replaceAll(" ", "_").includes(needle),
  );
}
