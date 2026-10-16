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

/**
 * A ranked list with a proportional bar behind each value - the plain way to
 * compare a handful of categories (per person, per feature). The numbers are
 * always printed, so the bar is decoration and never the only encoding.
 */
export function BarList({
  title,
  rows,
  format,
  emptyLabel,
  tone = "primary",
}: {
  title: string;
  rows: BarListRow[];
  format: (value: number) => string;
  emptyLabel: string;
  tone?: "primary" | "info";
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <section className="border-border bg-surface min-w-0 rounded-xl border p-4 shadow-sm">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((row) => (
            <li key={row.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {row.label}
                  {row.hint ? (
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      {row.hint}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {format(row.value)}
                  {row.detail ? (
                    <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                      {row.detail}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="bg-surface-sunken mt-1 h-1.5 overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full rounded-full",
                    tone === "info" ? "bg-info" : "bg-primary",
                  )}
                  style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
