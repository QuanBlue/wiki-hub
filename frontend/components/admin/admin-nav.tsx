"use client";

import { Database, ScrollText, SlidersHorizontal, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: SlidersHorizontal },
  { href: "/admin/backup", label: "Backup", icon: Database },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Administration"
      className="border-border -mb-px flex gap-1 border-b"
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm",
              "transition-[color,background-color,border-color] duration-150",
              "focus-visible:ring-ring rounded-t-md focus-visible:ring-2 focus-visible:outline-none",
              active
                ? "border-primary text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-hover border-transparent",
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
