"use client";

import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckSquare,
  ClipboardList,
  FileCode2,
  FileText,
  GitBranch,
  Layers,
  LayoutTemplate,
  Lightbulb,
  type LucideIcon,
  RefreshCw,
  Rocket,
  Shield,
  Sparkles,
  Target,
  Users,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";

const LUCIDE_TEMPLATE_ICONS: Record<string, LucideIcon> = {
  "clipboard-list": ClipboardList,
  "book-open": BookOpen,
  calendar: Calendar,
  "git-branch": GitBranch,
  "alert-triangle": AlertTriangle,
  users: Users,
  "file-text": FileText,
  "file-code": FileCode2,
  layers: Layers,
  "layout-template": LayoutTemplate,
  "check-square": CheckSquare,
  lightbulb: Lightbulb,
  "refresh-cw": RefreshCw,
  rocket: Rocket,
  shield: Shield,
  sparkles: Sparkles,
  target: Target,
  wrench: Wrench,
};

const ASCII_SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,}$/i;

export function TemplateIcon({
  icon,
  className,
}: {
  icon?: string | null;
  className?: string;
}) {
  const trimmed = (icon ?? "").trim();
  if (!trimmed) {
    return (
      <FileText
        className={cn("text-muted-foreground size-4 shrink-0", className)}
        aria-hidden
      />
    );
  }

  const key = trimmed.toLowerCase();
  const LucideComponent = LUCIDE_TEMPLATE_ICONS[key];
  if (LucideComponent) {
    return (
      <LucideComponent
        className={cn("text-muted-foreground size-4 shrink-0", className)}
        aria-hidden
      />
    );
  }

  // Never render raw icon slugs (e.g. unknown lucide names) as overflowing text.
  if (ASCII_SLUG_RE.test(trimmed)) {
    return (
      <FileText
        className={cn("text-muted-foreground size-4 shrink-0", className)}
        aria-hidden
      />
    );
  }

  return (
    <span className="leading-none select-none" aria-hidden>
      {trimmed}
    </span>
  );
}
