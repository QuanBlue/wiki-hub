import { cn } from "@/lib/utils";

export interface BarListRow {
  key: string;
  label: string;
  /** Secondary text under the label (a username next to a full name). */
  hint?: string;
  value: number;
  /** Second figure shown after the value, e.g. a request count. */
  detail?: string;
}

const BAR_TONES = {
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
} as const;

/**
 * A ranked list with a proportional bar behind each value - the plain way to
 * compare a handful of categories (per person, per feature, per model). The
 * numbers are always printed, so the bar is decoration and never the only encoding.
 */
export function BarList({
  title,
  rows,
  format,
  emptyLabel,
  tone = "primary",
  showShare = false,
}: {
  title: string;
  rows: BarListRow[];
  format: (value: number) => string;
  emptyLabel: string;
  tone?: keyof typeof BAR_TONES;
  showShare?: boolean;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <section className="border-border bg-surface flex min-w-0 flex-col rounded-xl border p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {rows.length > 0 ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {rows.length}
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row, index) => {
            const pct = total > 0 ? Math.round((row.value / total) * 100) : 0;
            return (
              <li key={row.key} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-baseline gap-2 truncate">
                    <span className="text-muted-foreground w-4 shrink-0 text-xs tabular-nums">
                      {index + 1}
                    </span>
                    <span className="truncate font-medium">{row.label}</span>
                    {row.hint ? (
                      <span className="text-muted-foreground truncate text-xs">
                        {row.hint}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {format(row.value)}
                    {showShare && total > 0 ? (
                      <span className="text-muted-foreground ml-1 text-xs font-normal">
                        ({pct}%)
                      </span>
                    ) : null}
                    {row.detail ? (
                      <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                        {row.detail}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="bg-surface-sunken mt-1.5 h-1.5 overflow-hidden rounded-full">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-150",
                      BAR_TONES[tone],
                    )}
                    style={{
                      width: `${row.value > 0 ? Math.max(2, (row.value / max) * 100) : 0}%`,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
