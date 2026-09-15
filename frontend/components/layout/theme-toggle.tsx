"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { useTranslation } from "@/lib/i18n/context";

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const { t } = useTranslation();

  // Strictly toggle between "light" and "dark" mode.
  const currentMode = (resolvedTheme || theme) === "dark" ? "dark" : "light";
  const current: "light" | "dark" = hydrated ? currentMode : "light";
  const Icon = current === "dark" ? Moon : Sun;
  const nextTheme = current === "light" ? "dark" : "light";
  const themeLabel = t(
    current === "dark" ? "topbar.themeDark" : "topbar.themeLight",
  );

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("topbar.themeAria", { mode: themeLabel })}
      title={themeLabel}
      onClick={() => setTheme(nextTheme)}
    >
      <Icon className="size-4" aria-hidden />
    </Button>
  );
}
