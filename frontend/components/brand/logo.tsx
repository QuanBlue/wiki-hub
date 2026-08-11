import { cn } from "@/lib/utils";

/**
 * The WikiHub mark: three stacked knowledge layers converging on a hub.
 * Original artwork - no third-party brand assets are used anywhere in this app.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <rect width="24" height="24" rx="5" fill="var(--primary)" />
      <path
        d="M6 8.5 12 5.5l6 3-6 3-6-3Z"
        fill="var(--primary-foreground)"
        fillOpacity="0.95"
      />
      <path
        d="m6 12 6 3 6-3"
        stroke="var(--primary-foreground)"
        strokeOpacity="0.75"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m6 15.5 6 3 6-3"
        stroke="var(--primary-foreground)"
        strokeOpacity="0.5"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({
  siteName,
  className,
}: {
  siteName: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight",
        className,
      )}
    >
      <LogoMark />
      {siteName}
    </span>
  );
}
