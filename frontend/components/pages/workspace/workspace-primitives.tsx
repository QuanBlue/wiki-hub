"use client";

import { Globe, Lock } from "lucide-react";
import Link from "next/link";
import { RichTextContent } from "@/components/pages/rich-text-editor";
import { useTranslation } from "@/lib/i18n/context";
import { markdownToHtml } from "@/lib/markdown-html";
import { cn } from "@/lib/utils";
import type { Space } from "@/types/api";
import type { PageAccess } from "./types";

export function PageAccessIcon({ access }: { access: PageAccess }) {
  const { t } = useTranslation();
  const label = t(access.labelKey);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      // No vertical nudge: with Inter, the middle of the line box lands between
      // the middle of the x-height and the middle of the capitals, which is
      // where mixed-case text reads as centred. (Measured at 14px: 1px above
      // the lowercase middle, 0.5px below the capital middle. An earlier
      // 0.16em nudge pushed it 1.2px / 2.7px below them, so it looked dropped.)
      // Both states share one colour: the padlock marks what a page is, not a
      // problem to be drawn to, and the shape already carries the difference.
      className="text-muted-foreground inline-flex shrink-0 items-center"
    >
      {access.restricted ? (
        <Lock className="size-3.5" aria-hidden />
      ) : (
        <Globe className="size-3.5" aria-hidden />
      )}
    </span>
  );
}

export function MarkdownContent({
  content,
  canEditAttachments = false,
}: {
  content: string;
  canEditAttachments?: boolean;
}) {
  return (
    <RichTextContent
      content={markdownToHtml(content)}
      canEditAttachments={canEditAttachments}
    />
  );
}

export function SpaceAvatar({ space }: { space: Space }) {
  return (
    <span
      aria-hidden
      className="bg-primary-subtle text-primary flex size-12 shrink-0 items-center justify-center rounded-md text-xl font-semibold"
    >
      {(space.icon || space.name.slice(0, 1)).toUpperCase()}
    </span>
  );
}

export function SidebarLink({
  href,
  active,
  children,
  className,
  onClick,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-visible:ring-ring flex min-h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-surface-selected text-primary font-medium"
          : "text-foreground hover:bg-surface-hover active:bg-surface-selected",
        className,
      )}
    >
      {children}
    </Link>
  );
}
