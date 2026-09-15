"use client";

import { Check, Globe } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";

const LOCALES: { value: Locale; labelKey: string; badge: string }[] = [
  { value: "en", labelKey: "language.english", badge: "EN" },
  { value: "vi", labelKey: "language.vietnamese", badge: "VI" },
];

/**
 * Interface-language switcher. The trigger is a bordered chip (icon + the
 * active language code) rather than bare text, so it reads as one deliberate
 * control next to the icon-only Theme/Help buttons instead of a stray label
 * sitting in the bar. The choice is per browser (cookie + localStorage),
 * applied instantly without a reload, so unsaved editor state survives
 * switching.
 */
export function LanguageToggle() {
  const { locale, setLocale, t } = useTranslation();
  const activeBadge =
    LOCALES.find((option) => option.value === locale)?.badge ?? "EN";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={t("language.changeLanguageAria")}
          title={t("language.changeLanguageAria")}
          className="h-8 gap-1.5 px-2 text-xs font-semibold"
        >
          <Globe className="size-3.5 shrink-0" aria-hidden />
          <span aria-hidden>{activeBadge}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
        {LOCALES.map((option) => {
          const active = option.value === locale;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => setLocale(option.value)}
              className={cn(active && "bg-primary-subtle text-foreground")}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-sunken text-muted-foreground",
                )}
              >
                {option.badge}
              </span>
              <span className="flex-1">{t(option.labelKey)}</span>
              {active ? <Check aria-hidden className="text-primary ml-auto size-4" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
