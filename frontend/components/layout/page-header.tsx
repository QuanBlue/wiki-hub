import { cn } from "@/lib/utils";

/**
 * Shared heading treatment for knowledge and administration screens.
 *
 * The divider creates a clear hand-off from page context to its working area,
 * while the optional action slot keeps the next meaningful task beside the
 * title rather than floating elsewhere on the page.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "border-border flex flex-wrap items-end justify-between gap-4 border-b pb-5",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-primary mb-1 text-xs font-semibold tracking-[0.08em] uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <div className="text-muted-foreground mt-2 max-w-2xl text-sm">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
