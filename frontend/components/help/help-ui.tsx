import {
  AlertTriangle,
  Info,
  Lightbulb,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type HelpCategory =
  | "Workspace"
  | "Writing"
  | "Attachments & Media"
  | "Account"
  | "Administration";

export type HelpSection = {
  id: string;
  title: string;
  category: HelpCategory;
  description: string;
  keywords: string[];
  body: ReactNode;
};

export type CategoryDefinition = {
  title: HelpCategory;
  icon: LucideIcon;
};

// ---------------------------------------------------------------------------
// Help UI Formatting Helper Components
// ---------------------------------------------------------------------------

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="border-border/60 bg-surface-sunken text-primary font-mono rounded border px-1.5 py-0.5 text-[12px] font-semibold">
      {children}
    </code>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-border bg-surface text-foreground shadow-xs font-mono rounded border px-1.5 py-0.5 text-[11px] font-semibold">
      {children}
    </kbd>
  );
}

export function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="border-primary/60 bg-primary-subtle/30 text-foreground my-3 rounded-r-lg border-l-4 py-3 pr-4 pl-4 text-sm italic shadow-xs">
      {children}
    </blockquote>
  );
}

/** A real screenshot of the feature being described, so a reader can
 * recognise it on screen instead of building a mental picture from text
 * alone. Every image under `/public/help` was captured against disposable
 * demo users/spaces created and deleted purely for this purpose - never
 * against this workspace's real data - so nothing here can go stale into
 * someone's real name or content. `alt` carries the actual description for
 * screen readers; the caption below repeats it visually for sighted users
 * scanning past the image. */
export function Screenshot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className="my-4">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="border-border w-full rounded-lg border shadow-xs"
      />
      <figcaption className="text-muted-foreground mt-1.5 text-center text-xs">
        {caption}
      </figcaption>
    </figure>
  );
}

export function Callout({
  variant = "note",
  title,
  children,
}: {
  variant?: "note" | "tip" | "important" | "warning";
  title?: string;
  children: ReactNode;
}) {
  const config = {
    note: {
      border: "border-info/40 bg-info-subtle/20 text-info-foreground",
      icon: Info,
      iconColor: "text-info",
      defaultTitle: "NOTE",
    },
    tip: {
      border: "border-success/40 bg-success-subtle/20 text-success-foreground",
      icon: Lightbulb,
      iconColor: "text-success",
      defaultTitle: "PRO TIP",
    },
    important: {
      border: "border-primary/40 bg-primary-subtle/20 text-primary-foreground",
      icon: Sparkles,
      iconColor: "text-primary",
      defaultTitle: "IMPORTANT",
    },
    warning: {
      border: "border-warning/40 bg-warning-subtle/20 text-warning-foreground",
      icon: AlertTriangle,
      iconColor: "text-warning",
      defaultTitle: "WARNING",
    },
  }[variant];

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "my-4 rounded-lg border p-4 text-sm leading-6 shadow-xs",
        config.border,
      )}
    >
      <div className="flex items-center gap-2 font-semibold">
        <Icon className={cn("size-4 shrink-0", config.iconColor)} aria-hidden />
        <span className="text-xs font-bold tracking-wider uppercase">
          {title || config.defaultTitle}
        </span>
      </div>
      <div className="mt-2 text-foreground/90 space-y-2">{children}</div>
    </div>
  );
}
