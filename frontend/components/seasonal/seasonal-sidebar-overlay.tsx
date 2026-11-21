"use client";

import { useThemeSettings } from "@/components/theme-color-provider";
import { getSeasonalPresetMeta } from "@/components/seasonal/seasonal-presets";
import { navAccentImage } from "@/components/seasonal/seasonal-nav-accent";
import type { SeasonalEffectPresetId } from "@/types/api";

/**
 * Palette per preset: `tint` is the single hue used for the selected sidebar
 * row, hover and the TopBar glow; `edge` colours the login-page hairline;
 * `pattern` strokes the sunken watermark.
 */
export const RAIL: Record<
  Exclude<SeasonalEffectPresetId, "none">,
  { tint: string; edge: [string, string]; pattern: string }
> = {
  christmas: { tint: "96, 165, 235", edge: ["#bfdbfe", "#93c5fd"], pattern: "#5b9bd5" },
  lunar_new_year: { tint: "228, 70, 78", edge: ["#fca5a5", "#fbbf24"], pattern: "#d9465f" },
  new_year: { tint: "214, 168, 62", edge: ["#f5d27a", "#cbd5e1"], pattern: "#b8892e" },
  national_red_gold: { tint: "222, 44, 44", edge: ["#f87171", "#fbbf24"], pattern: "#dc2626" },
  heritage_gold: { tint: "190, 122, 46", edge: ["#e0a85a", "#b4651b"], pattern: "#a1601f" },
  lotus_gold: { tint: "232, 112, 160", edge: ["#f9a8d4", "#fcd34d"], pattern: "#d9579b" },
  floral_pink: { tint: "244, 104, 144", edge: ["#fbb6c1", "#9fd3aa"], pattern: "#d06a85" },
  mid_autumn: { tint: "240, 176, 40", edge: ["#fcd34d", "#f59e0b"], pattern: "#c2860c" },
  halloween: { tint: "146, 96, 220", edge: ["#c4b5fd", "#fb923c"], pattern: "#7e4bc4" },
  blue_neon: { tint: "24, 156, 232", edge: ["#67e8f9", "#38bdf8"], pattern: "#0ea5e9" },
  memorial_candle: { tint: "196, 136, 64", edge: ["#e8b778", "#d4a373"], pattern: "#a8742c" },
  valentine: { tint: "240, 72, 104", edge: ["#fda4af", "#fb7185"], pattern: "#e0476a" },
  spring_green: { tint: "44, 186, 104", edge: ["#86efac", "#4ade80"], pattern: "#2f9e5b" },
  easter: { tint: "156, 124, 240", edge: ["#c4b5fd", "#86efac"], pattern: "#8b6ce0" },
  kids_party: { tint: "64, 156, 242", edge: ["#fcd34d", "#7dd3fc"], pattern: "#4f8fd6" },
  teachers_day: { tint: "14, 148, 128", edge: ["#e3c26b", "#6fae8a"], pattern: "#0f766e" },
  autumn_harvest: { tint: "230, 116, 36", edge: ["#fdba74", "#f59e0b"], pattern: "#c2410c" },
};

/**
 * Mounted inside both the App Sidebar and the Space Sidebar. During a holiday
 * only the selected row (and hover) takes the theme colour; the rail itself
 * stays plain and the sunken watermark lives on the TopBar instead.
 * Strictly pointer-events-none and aria-hidden.
 */
export function SeasonalSidebarOverlay({
  collapsed = false,
  preset: presetOverride,
}: {
  collapsed?: boolean;
  /** Render this pack instead of the workspace's active one (settings preview). */
  preset?: SeasonalEffectPresetId;
}) {
  const { effectiveSeasonalPreset } = useThemeSettings();
  const preset = presetOverride ?? effectiveSeasonalPreset;
  if (!preset || preset === "none") return null;

  const meta = getSeasonalPresetMeta(preset);
  const rail = RAIL[preset];
  if (!meta || !rail) return null;
  const accent = collapsed ? null : navAccentImage(preset);
  const t = rail.tint;
  const mark = accent ?? "linear-gradient(transparent,transparent)";

  return (
    <div
      aria-hidden="true"
      data-wh-rail=""
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
    >
      <style
        dangerouslySetInnerHTML={{
          __html: [
            // Hover follows the theme instead of the neutral grey.
            `html:not(.dark) :has(> [data-wh-rail]) :is(a,button):hover:not([aria-current="page"]){background-color:color-mix(in srgb,rgb(${t}) 18%,transparent)}`,
            `html.dark :has(> [data-wh-rail]) :is(a,button):hover:not([aria-current="page"]){background-color:rgba(${t},.24)}`,
            // Selected row: filled with the theme colour, a matching border and a
            // soft glow, plus an edge bar, a small holiday mark and a light sweep.
            `html:not(.dark) :has(> [data-wh-rail]) [aria-current="page"]{background-color:color-mix(in srgb,rgb(${t}) 26%,white);color:color-mix(in srgb,rgb(${t}) 55%,#000);box-shadow:inset 3px 0 0 rgb(${t}),0 0 0 1px color-mix(in srgb,rgb(${t}) 75%,transparent),0 0 14px -1px color-mix(in srgb,rgb(${t}) 60%,transparent),0 4px 12px -4px color-mix(in srgb,rgb(${t}) 70%,transparent);background-image:${mark},linear-gradient(100deg,transparent 38%,rgba(255,255,255,.75) 50%,transparent 62%)}`,
            `html.dark :has(> [data-wh-rail]) [aria-current="page"]{background-color:color-mix(in srgb,rgb(${t}) 42%,#0b1220);color:color-mix(in srgb,rgb(${t}) 45%,#fff);box-shadow:inset 3px 0 0 color-mix(in srgb,rgb(${t}) 70%,#fff),0 0 0 1px color-mix(in srgb,rgb(${t}) 45%,transparent),0 3px 10px -3px rgba(${t},.5);background-image:${mark},linear-gradient(100deg,transparent 38%,rgba(255,255,255,.18) 50%,transparent 62%)}`,
            // Mark at the right end + a slow light sweep (still when reduced motion).
            `:has(> [data-wh-rail]) [aria-current="page"]{background-repeat:no-repeat;background-position:right 4px center,130% 0;background-size:auto 24px,260% 100%}`,
            `@media (prefers-reduced-motion:no-preference){:has(> [data-wh-rail]) [aria-current="page"]{animation:wh-nav-shimmer 5.5s ease-in-out infinite}}`,
          ].join(""),
        }}
      />
    </div>
  );
}
