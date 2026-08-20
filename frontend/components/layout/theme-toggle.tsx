"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();

  // Strictly toggle between "light" and "dark" mode.
  const currentMode = (resolvedTheme || theme) === "dark" ? "dark" : "light";
  const current: "light" | "dark" = hydrated ? currentMode : "light";
  const Icon = current === "dark" ? Moon : Sun;
  const nextTheme = current === "light" ? "dark" : "light";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${current}. Click to change.`}
      title={`Theme: ${current}`}
      onClick={() => setTheme(nextTheme)}
    >
      <Icon className="size-4" aria-hidden />
    </Button>
  );
}
