"use client";

import { useThemeSettings } from "@/components/theme-color-provider";
import {
  getSeasonalGreeting,
  getSeasonalPresetMeta,
} from "@/components/seasonal/seasonal-presets";
import { TopBarScene } from "@/components/seasonal/seasonal-scenes";
import { GreetingDoodle } from "@/components/seasonal/seasonal-greeting-doodle";
import { ScatterPatternLayer } from "@/components/seasonal/seasonal-patterns";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { SeasonalEffectPresetId } from "@/types/api";

/**
 * Holiday greeting placed directly to the right of the app icon & name on
 * the TopBar, dressed like a holiday doodle: a small motif on each side.
 */
export function SeasonalTopBarGreeting({
  preset: presetOverride,
  alwaysVisible = false,
}: {
  /** Render this pack instead of the workspace's active one (settings preview). */
  preset?: SeasonalEffectPresetId;
  /** Skip the "large screens only" rule; the preview is a scaled desktop. */
  alwaysVisible?: boolean;
} = {}) {
  const { effectiveSeasonalPreset } = useThemeSettings();
  const preset = presetOverride ?? effectiveSeasonalPreset;
  const text = useSeasonalGreetingText(presetOverride);
  if (!text || !preset) return null;

  return (
    <div
      title={text}
      data-seasonal-greeting=""
      className={cn(
        "text-foreground max-w-68 shrink-0 items-center gap-1.5 select-none xl:max-w-[24rem]",
        alwaysVisible ? "inline-flex" : "hidden lg:inline-flex",
      )}
    >
      <GreetingDoodle preset={preset} side="lead" />
      <span className="min-w-0 truncate text-xs font-semibold tracking-tight">
        {text}
      </span>
      <GreetingDoodle preset={preset} side="trail" />
    </div>
  );
}

/**
 * The holiday greeting for the shown pack. The live event's own name is used
 * only when the pack shown is the live one (not a preview or an override).
 */
export function useSeasonalGreetingText(
  presetOverride?: SeasonalEffectPresetId,
): string {
  const { locale } = useTranslation();
  const { seasonalTheme, previewSeasonalPreset, effectiveSeasonalPreset } =
    useThemeSettings();
  const preset = presetOverride ?? effectiveSeasonalPreset;
  if (!preset || preset === "none") return "";

  const isLive = !previewSeasonalPreset && preset === seasonalTheme.preset;
  return getSeasonalGreeting({
    eventId: isLive ? seasonalTheme.event_id : null,
    preset,
    eventNameEn: isLive ? seasonalTheme.event_name_en : null,
    eventNameVi: isLive ? seasonalTheme.event_name_vi : null,
    locale,
  });
}

/**
 * Watermark fade: full strength at both ends of the bar, thinning out toward
 * the centred search field and gone just before it (the field is at most
 * 28rem wide, so it spans 50% ± 14rem).
 */
const WATERMARK_MASK =
  "linear-gradient(90deg, #000 0%, #000 6%, transparent calc(50% - 16rem), transparent calc(50% + 16rem), #000 94%, #000 100%)";

/**
 * Decorative overlay anchored inside the fixed 56px TopBar.
 * Strictly pointer-events-none and aria-hidden so navigation, search, and user
 * controls remain 100% unobstructed. Art rests on the bar's lower edge.
 */
export function SeasonalTopBarOverlay({
  preset: presetOverride,
}: {
  preset?: SeasonalEffectPresetId;
} = {}) {
  const { effectiveSeasonalPreset } = useThemeSettings();
  const preset = presetOverride ?? effectiveSeasonalPreset;
  if (!preset || preset === "none") return null;

  const meta = getSeasonalPresetMeta(preset);
  if (!meta) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-visible select-none"
    >
      {/* Sunken line-art watermark across the bar, behind its controls
          (negative z inside the header's stacking context). Drawn in the
          bar's own foreground colour so it reads on any theme colour, and
          strongest at the edges, fading out before the search field. */}
      <div
        data-topbar-watermark=""
        className="absolute inset-0 -z-10 overflow-hidden"
        style={{
          WebkitMaskImage: WATERMARK_MASK,
          maskImage: WATERMARK_MASK,
        }}
      >
        <ScatterPatternLayer
          preset={preset}
          stroke="var(--tb-fg, currentColor)"
          drift={meta.solemn ? "none" : "x"}
          className="opacity-[0.18] dark:opacity-[0.2]"
        />
      </div>

      {/* Edge-resting strip: sits on the bar's lower edge, never dangles */}
      <TopBarScene preset={preset} />
    </div>
  );
}
