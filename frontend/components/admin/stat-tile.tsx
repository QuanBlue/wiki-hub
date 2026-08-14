import type { LucideIcon } from "lucide-react";

/**
 * A single glanceable count for a KPI row (see docs/design-system.md's
 * data-viz guidance: "a handful of headline numbers" is a stat-tile row, not
 * a chart). No colour-coding on the value itself - the number is information,
 * not a series, so it stays in the ordinary text tokens.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="border-border bg-surface rounded-xl border p-4 shadow-sm">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">
        {new Intl.NumberFormat("en-US").format(value)}
      </p>
    </div>
  );
}
