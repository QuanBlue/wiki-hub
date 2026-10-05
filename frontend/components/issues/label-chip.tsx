"use client";

import { useTranslation } from "@/lib/i18n/context";
import { labelMeta } from "@/lib/issue-labels";
import { cn } from "@/lib/utils";

/** A round swatch in the label's colour. */
export function LabelDot({
  color,
  className,
}: {
  color: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-3 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/** A label as a small tinted pill: its colour dot, then its name. */
export function LabelChip({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const meta = labelMeta(slug);
  const color = meta?.color ?? "#6e7781";
  return (
    <span
      className={cn(
        "text-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
      }}
    >
      <LabelDot color={color} className="size-2" />
      {meta ? t(`issueLabels.${meta.key}`) : slug}
    </span>
  );
}
