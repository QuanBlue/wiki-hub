"use client";

import { useThemeSettings } from "@/components/theme-color-provider";
import {
  getSeasonalGreeting,
  getSeasonalPresetMeta,
} from "@/components/seasonal/seasonal-presets";
import { RAIL } from "@/components/seasonal/seasonal-sidebar-overlay";
import { TopBarScene } from "@/components/seasonal/seasonal-scenes";
import { useTranslation } from "@/lib/i18n/context";

/**
 * Minimal editorial holiday note placed directly to the right of the app
 * icon & name on the TopBar — separated by a hairline divider with no pill
 * border or generic sparkle icon.
 */
export function SeasonalTopBarGreeting() {
  const { locale } = useTranslation();
  const {
    seasonalTheme,
    previewSeasonalPreset,
    effectiveSeasonalPreset: preset,
  } = useThemeSettings();

  if (!preset || preset === "none") return null;

  const text = getSeasonalGreeting({
    eventId: previewSeasonalPreset ? null : seasonalTheme.event_id,
    preset,
    eventNameEn: previewSeasonalPreset ? null : seasonalTheme.event_name_en,
    eventNameVi: previewSeasonalPreset ? null : seasonalTheme.event_name_vi,
    locale,
  });

  if (!text) return null;

  return (
    <div
      title={text}
      className="text-foreground/90 hidden max-w-[15rem] shrink-0 items-center gap-2.5 select-none lg:inline-flex xl:max-w-[21rem]"
    >
      <span aria-hidden className="h-4 w-px shrink-0 bg-current opacity-30" />
      <span className="truncate text-xs font-medium tracking-tight">
        {text}
      </span>
    </div>
  );
}

/**
 * Decorative overlay anchored inside the fixed 56px TopBar.
 * Strictly pointer-events-none and aria-hidden so navigation, search, and user
 * controls remain 100% unobstructed. Art rests on the bar's lower edge.
 */
export function SeasonalTopBarOverlay() {
  const { effectiveSeasonalPreset: preset } = useThemeSettings();
  if (!preset || preset === "none") return null;

  const meta = getSeasonalPresetMeta(preset);
  if (!meta) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-visible select-none"
    >
      {/* Light mode: a soft glow of the theme colour just under the bar, so the
          page does not look washed out next to the tinted sidebar. */}
      {RAIL[preset] ? (
        <div
          className="absolute inset-x-0 top-full h-16 dark:hidden"
          style={{
            background: `linear-gradient(180deg, rgba(${RAIL[preset].tint}, 0.2), transparent)`,
          }}
        />
      ) : null}

      {/* Edge-resting strip: sits on the bar's lower edge, never dangles */}
      <TopBarScene preset={preset} />
    </div>
  );
}
