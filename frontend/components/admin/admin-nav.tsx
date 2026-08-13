"use client";

import { Database, FolderCog, HardDrive, ScrollText, SlidersHorizontal, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/spaces", label: "Spaces", icon: FolderCog },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: SlidersHorizontal },
  { href: "/admin/backup", label: "Backup", icon: Database },
  { href: "/admin/storage", label: "Storage", icon: HardDrive },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Administration"
      className="border-border bg-surface-sunken -mb-px flex gap-1 overflow-x-auto rounded-lg border p-1"
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3.5 py-2 text-sm",
              "transition-[color,background-color,border-color] duration-150",
              "focus-visible:ring-ring rounded-t-md focus-visible:ring-2 focus-visible:outline-none",
              active
                ? "bg-surface text-primary font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-hover",
            )}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
