/**
 * Who uses how much of the server: the numbers behind the Server page's donut charts.
 *
 * Pure functions. Each container becomes a slice of the host's total (all its memory,
 * or all its CPU cores); what the containers do not use is shown as well, so a slice
 * is always read against the whole. Only the biggest few containers get a colour of
 * their own - past that a chart is no longer readable - and the rest are one slice.
 */

export type UsageItem = { key: string; label: string; value: number };

export type SliceKind = "container" | "others" | "system" | "free";

export type UsageSlice = {
  key: string;
  label: string;
  kind: SliceKind;
  value: number;
  /** Share of the host total, 0-1. */
  share: number;
  /** Colour slot (0-based) of a container slice; `null` for the grey ones. */
  slot: number | null;
  /** For an "others" slice, how many containers it holds. */
  count?: number;
};

export type UsageChart = {
  slices: UsageSlice[];
  /** What the containers use together. */
  used: number;
  total: number;
};

/** Colours of its own for this many containers; see `--chart-1..` in globals.css. */
export const NAMED_SLICES = 6;

/**
 * A slot per container, by its place in alphabetical order among those on the chart:
 * a container keeps its colour as others overtake it, and only a change in *which*
 * containers are on the chart moves colours. Nothing is remembered between readings.
 */
export function assignSlots(
  items: { key: string; label: string }[],
): Record<string, number> {
  const slots: Record<string, number> = {};
  [...items]
    .sort(
      (a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
    )
    .forEach((item, index) => {
      slots[item.key] = index;
    });
  return slots;
}

export function buildUsage({
  items,
  total,
  hostUsed,
  systemLabel,
  freeLabel,
  othersLabel,
}: {
  items: UsageItem[];
  total: number;
  /**
   * What the whole host uses, containers or not. When given, what the containers
   * do not account for is a "system" slice; without it all of that counts as free.
   */
  hostUsed?: number;
  systemLabel: string;
  freeLabel: string;
  othersLabel: (count: number) => string;
}): UsageChart {
  const live = items
    .filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const used = live.reduce((sum, item) => sum + item.value, 0);
  // A reading can put the containers above the host's own figure: the chart still
  // adds up to its whole, so that is the whole.
  const whole = Math.max(total, used, 1);
  const named = live.slice(0, NAMED_SLICES);
  const rest = live.slice(NAMED_SLICES);
  const slots = assignSlots(named);
  const share = (value: number) => value / whole;
  const slices: UsageSlice[] = named.map((item) => ({
    key: item.key,
    label: item.label,
    kind: "container",
    value: item.value,
    share: share(item.value),
    slot: slots[item.key] ?? null,
  }));
  if (rest.length) {
    const value = rest.reduce((sum, item) => sum + item.value, 0);
    slices.push({
      key: "__others",
      label: othersLabel(rest.length),
      kind: "others",
      value,
      share: share(value),
      slot: null,
      count: rest.length,
    });
  }
  const system = hostUsed === undefined ? 0 : Math.max(hostUsed - used, 0);
  if (system > 0) {
    slices.push({
      key: "__system",
      label: systemLabel,
      kind: "system",
      value: system,
      share: share(system),
      slot: null,
    });
  }
  const free = Math.max(whole - used - system, 0);
  if (free > 0) {
    slices.push({
      key: "__free",
      label: freeLabel,
      kind: "free",
      value: free,
      share: share(free),
      slot: null,
    });
  }
  return { slices, used, total: whole };
}

/** An arc of a ring, as an SVG path: angles in turns from 12 o'clock, clockwise. */
export function ringArc(
  radius: number,
  from: number,
  to: number,
  centre: number,
): string {
  const point = (turn: number) => {
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    return [
      centre + radius * Math.cos(angle),
      centre + radius * Math.sin(angle),
    ];
  };
  const [x0, y0] = point(from);
  const [x1, y1] = point(to);
  const large = to - from > 0.5 ? 1 : 0;
  return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${radius} ${radius} 0 ${large} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}
