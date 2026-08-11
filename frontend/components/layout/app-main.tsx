"use client";

import type { CSSProperties } from "react";

import { useSidebar } from "@/components/layout/sidebar-context";
import { cn } from "@/lib/utils";

/**
 * The content column. It is a client component solely because its left padding
 * has to track the sidebar width — the rest of the page stays server-rendered
 * and is passed straight through as `children`.
 */
export function AppMain({
  children,
  hasBanner = false,
  contentClassName,
  disableSidebarOffset = false,
}: {
  children: React.ReactNode;
  /** Reserve room for the fixed impersonation bar so it covers no content. */
  hasBanner?: boolean;
  contentClassName?: string;
  disableSidebarOffset?: boolean;
}) {
  const { collapsed, sidebarWidth } = useSidebar();

  return (
    <main
      className={cn(
        "pt-topbar transition-[padding] duration-200 motion-reduce:transition-none",
        // No left padding below md: there the sidebar is an overlay, not a rail.
        !disableSidebarOffset &&
          (collapsed ? "md:pl-14" : "md:pl-(--app-sidebar-width)"),
      )}
      style={
        {
          "--app-sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <div
        className={cn(
          "max-w-content mx-auto w-full px-5 py-8 sm:px-8 sm:py-10",
          hasBanner && "pb-24",
          contentClassName,
        )}
      >
        {children}
      </div>
    </main>
  );
}
