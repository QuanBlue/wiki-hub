"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { useSidebar } from "@/components/layout/sidebar-context";
import { Button } from "@/components/ui/button";

/**
 * One control, two behaviours by breakpoint: it opens the drawer on small
 * screens and collapses the rail on large ones. Rendering two separate buttons
 * and hiding one with `md:hidden` would put two "toggle navigation" controls in
 * the accessibility tree at once.
 */
export function SidebarToggle() {
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } =
    useSidebar();

  const isMobileViewport = () =>
    typeof window !== "undefined" &&
    !window.matchMedia("(min-width: 768px)").matches;

  const open = mobileOpen || !collapsed;
  const Icon = open ? PanelLeftClose : PanelLeftOpen;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() =>
        isMobileViewport() ? setMobileOpen(!mobileOpen) : toggleCollapsed()
      }
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      title={open ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={open}
      aria-controls="wikihub-sidebar"
    >
      <Icon />
    </Button>
  );
}
