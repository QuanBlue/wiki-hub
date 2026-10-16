"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { UserContributions } from "@/types/api";

/** Squares are sized for this many week columns whatever the range, so the height never changes. */
const WEEKS = 54;
const GAP = 1;
const MIN_CELL = 3;
const MAX_CELL = 20;
const FALLBACK_WIDTH = 280;
/** Room for the Mon / Wed / Fri labels left of the grid, including their gap. */
const LABEL_WIDTH = 22;
/** Rows (Sunday first) that carry a weekday label, as in GitHub's graph. */
const WEEKDAYS = [1, 3, 5] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The rolling window; calendar years follow it in the same list. */
const LAST_YEAR = "365";

/** Cell colour by activity, lightest to strongest; level 0 is an empty day. */
const LEVEL_CLASS = [
  "bg-surface-sunken border border-border/60",
  "bg-success/25",
  "bg-success/50",
  "bg-success/75",
  "bg-success",
] as const;

const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Cell = { date: string; count: number } | null;

/** Weeks as columns of seven days starting on Sunday; days outside the range are blank. */
function buildWeeks(data: UserContributions): Cell[][] {
  const counts = new Map(data.days.map((day) => [day.date, day.count]));
  const start = utc(data.start);
  const end = utc(data.end);
  const first = start - new Date(start).getUTCDay() * DAY_MS;
  const weeks: Cell[][] = [];
  for (let week = first; week <= end; week += 7 * DAY_MS) {
    weeks.push(
      Array.from({ length: 7 }, (_, offset) => {
        const ms = week + offset * DAY_MS;
        if (ms < start || ms > end) return null;
        const date = isoOf(ms);
        return { date, count: counts.get(date) ?? 0 };
      }),
    );
  }
  return weeks;
}

/** The first real day of a week column; every column has at least one. */
function firstDate(week: Cell[]) {
  return week.find((cell) => cell !== null)!.date;
}

function levelOf(count: number, max: number) {
  return count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4));
}

/**
 * A member's edits over the last 12 months or a calendar year, as a small
 * contribution graph for the profile sidebar: a square per day, a column per
 * week.
 */
export function ContributionChart({ username }: { username: string }) {
  const { t, locale } = useTranslation();
  const [range, setRange] = useState(LAST_YEAR);
  const [data, setData] = useState<UserContributions | null>(null);
  const [failed, setFailed] = useState(false);
  const [years, setYears] = useState<number[]>([]);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);

  // Squares are sized to fit the card, so the width has to be known.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setFrameWidth(frame.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [data]);

  useEffect(() => {
    let active = true;
    const query = range === LAST_YEAR ? "days=365" : `year=${range.slice(1)}`;
    api
      .get<UserContributions>(
        `/api/v1/users/${encodeURIComponent(username)}/contributions?${query}`,
      )
      .then((result) => {
        if (!active) return;
        // Anything that is not a chart counts as a failed load.
        if (!Array.isArray(result?.days)) throw new Error("unexpected answer");
        setData(result);
        setYears(result.years);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [username, range]);

  const weeks = useMemo(() => (data ? buildWeeks(data) : []), [data]);
  const max = useMemo(
    () => Math.max(1, ...(data?.days.map((day) => day.count) ?? [])),
    [data],
  );

  const formatDate = (iso: string) =>
    new Date(utc(iso)).toLocaleDateString(locale, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const monthOf = (iso: string) =>
    new Date(utc(iso)).toLocaleDateString(locale, {
      month: "short",
      timeZone: "UTC",
    });
  // 2024-01-07 was a Sunday, so day 0 is Sunday.
  const weekdayName = (day: number) =>
    new Date(Date.UTC(2024, 0, 7 + day)).toLocaleDateString(locale, {
      weekday: "short",
      timeZone: "UTC",
    });
  const describe = (count: number, when: string) =>
    t(
      count === 0
        ? "userProfile.contributionsNone"
        : count === 1
          ? "userProfile.contributionsOne"
          : "userProfile.contributionsMany",
      { count, date: when },
    );

  if (failed && !data) {
    return (
      <p role="alert" className="text-danger text-sm">
        {t("userProfile.contributionsLoadError")}
      </p>
    );
  }
  if (!data)
    return (
      <div
        className="bg-surface-sunken h-40 animate-pulse rounded-lg"
        aria-hidden
      />
    );

  const heading = t("userProfile.contributionsTotal", { count: data.total });
  // A square as large as the weeks allow across the card, never more than MAX_CELL.
  const cell = Math.max(
    MIN_CELL,
    Math.min(
      MAX_CELL,
      ((frameWidth || FALLBACK_WIDTH) - LABEL_WIDTH) / WEEKS - GAP,
    ),
  );
  const columns = {
    gridTemplateColumns: `repeat(${weeks.length}, ${cell}px)`,
    gap: GAP,
  };

  return (
    <section
      className="border-border bg-surface rounded-lg border p-3.5"
      aria-label={heading}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{heading}</h3>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger
            aria-label={t("userProfile.contributionsRange")}
            className="h-7 w-40 text-xs"
          >
            <SelectValue>
              {range === LAST_YEAR
                ? t("userProfile.contributionsRangeYear")
                : range.slice(1)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-72 w-auto min-w-44 whitespace-nowrap">
            <SelectItem value={LAST_YEAR}>
              {t("userProfile.contributionsRangeYear")}
            </SelectItem>
            {years.map((year) => (
              <SelectItem key={year} value={`y${year}`}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div ref={frameRef} className="mt-3">
        <div
          role="img"
          aria-label={t("userProfile.contributionsChartAria", {
            count: data.total,
          })}
          className="flex w-full items-start gap-1"
        >
          <div
            aria-hidden
            className="text-muted-foreground grid shrink-0 grid-rows-7 pt-4 text-[9px] leading-none"
            style={{
              gap: GAP,
              width: LABEL_WIDTH - 4,
              height: 7 * cell + 6 * GAP + 16,
            }}
          >
            {Array.from({ length: 7 }, (_, day) => (
              <span key={day} className="flex items-center">
                {(WEEKDAYS as readonly number[]).includes(day)
                  ? weekdayName(day)
                  : null}
              </span>
            ))}
          </div>
          <div className="flex flex-col items-start">
            <div
              className="text-muted-foreground mb-1 grid text-[9px] leading-3"
              style={columns}
            >
              {weeks.map((week, index) => {
                const month = monthOf(firstDate(week));
                const startsMonth =
                  index === 0 ||
                  month !== monthOf(firstDate(weeks[index - 1]!));
                return (
                  <span key={index} className="relative block h-3">
                    {startsMonth ? (
                      <span className="absolute left-0 whitespace-nowrap">
                        {month}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
            <div className="grid" style={columns}>
              {weeks.map((week, index) => (
                <div
                  key={index}
                  className="grid grid-rows-7"
                  style={{ gap: GAP, height: 7 * cell + 6 * GAP }}
                >
                  {week.map((day, row) =>
                    day ? (
                      <span
                        key={day.date}
                        data-level={levelOf(day.count, max)}
                        title={describe(day.count, formatDate(day.date))}
                        className={cn(
                          "size-full rounded-[2px]",
                          LEVEL_CLASS[levelOf(day.count, max)],
                        )}
                      />
                    ) : (
                      <span key={row} />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="text-muted-foreground mt-2 flex items-center justify-end gap-1.5 text-[10px]">
        {t("userProfile.contributionsLess")}
        {LEVEL_CLASS.map((level) => (
          <span
            key={level}
            aria-hidden
            className={cn("size-2.5 rounded-[2px]", level)}
          />
        ))}
        {t("userProfile.contributionsMore")}
      </div>
    </section>
  );
}
