"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";

const ORDER = ["light", "dark", "system"] as const;
type ThemeChoice = (typeof ORDER)[number];

const ICONS: Record<ThemeChoice, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  // The stored preference is only readable in the browser, so render the
  // neutral "system" state until hydration completes.
  const current: ThemeChoice = hydrated
    ? ((theme as ThemeChoice) ?? "system")
    : "system";
  const Icon = ICONS[current] ?? Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${current}. Click to change.`}
      title={`Theme: ${current}`}
      onClick={() =>
        setTheme(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length])
      }
    >
      <Icon />
    </Button>
  );
}
