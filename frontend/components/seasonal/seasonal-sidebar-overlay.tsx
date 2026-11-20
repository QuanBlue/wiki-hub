"use client";

import { useThemeSettings } from "@/components/theme-color-provider";
import { getSeasonalPresetMeta } from "@/components/seasonal/seasonal-presets";
import { navAccentImage } from "@/components/seasonal/seasonal-nav-accent";
import { PatternLayer } from "@/components/seasonal/seasonal-patterns";
import { SidebarFootScene } from "@/components/seasonal/seasonal-scenes";
import type { SeasonalEffectPresetId } from "@/types/api";

/**
 * Rail palette per preset: `tint` is the single hue washed over the whole
 * rail (light at the top, deeper toward the foot), `edge` colours the 2px hairline on the right, `pattern` strokes
 * the sunken watermark and the selected-row wash.
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
 * Decoration mounted inside both the App Sidebar and the Space Sidebar: a
 * colour wash over the rail, a hairline right edge, a sunken
 * watermark, a full-width ground strip and an accent on the selected row.
 * Strictly pointer-events-none and aria-hidden.
 */
export function SeasonalSidebarOverlay({
  collapsed = false,
}: {
  collapsed?: boolean;
}) {
  const { effectiveSeasonalPreset: preset } = useThemeSettings();
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
      {/* The rail becomes its own stacking context so the wash can sit behind
          the nav. Inactive nav text is darkened (towards a shade of the
          hue) in light mode to keep contrast on the deeper colour; hover and the selected row follow the theme. */}
      <style
        dangerouslySetInnerHTML={{
          __html: [
            ":has(> [data-wh-rail]){isolation:isolate}",
            `html:not(.dark) :has(> [data-wh-rail]){--muted-foreground:color-mix(in srgb,rgb(${t}) 22%,#0f172a)}`,
            // Hover follows the theme instead of the neutral grey.
            `html:not(.dark) :has(> [data-wh-rail]) :is(a,button):hover:not([aria-current="page"]){background-color:color-mix(in srgb,rgb(${t}) 30%,transparent)}`,
            `html.dark :has(> [data-wh-rail]) :is(a,button):hover:not([aria-current="page"]){background-color:rgba(${t},.24)}`,
            // Selected row: filled with the theme colour, a matching border and a
            // soft glow (same recipe as dark mode), plus an edge bar. The border
            // and glow keep it distinct at every height of the rail.
            `html:not(.dark) :has(> [data-wh-rail]) [aria-current="page"]{background-color:color-mix(in srgb,rgb(${t}) 26%,white);color:color-mix(in srgb,rgb(${t}) 55%,#000);box-shadow:inset 3px 0 0 rgb(${t}),0 0 0 1px color-mix(in srgb,rgb(${t}) 75%,transparent),0 0 14px -1px color-mix(in srgb,rgb(${t}) 60%,transparent),0 4px 12px -4px color-mix(in srgb,rgb(${t}) 70%,transparent);background-image:${mark},linear-gradient(100deg,transparent 38%,rgba(255,255,255,.75) 50%,transparent 62%)}`,
            `html.dark :has(> [data-wh-rail]) [aria-current="page"]{background-color:color-mix(in srgb,rgb(${t}) 42%,#0b1220);color:color-mix(in srgb,rgb(${t}) 45%,#fff);box-shadow:inset 3px 0 0 color-mix(in srgb,rgb(${t}) 70%,#fff),0 0 0 1px color-mix(in srgb,rgb(${t}) 45%,transparent),0 3px 10px -3px rgba(${t},.5);background-image:${mark},linear-gradient(100deg,transparent 38%,rgba(255,255,255,.18) 50%,transparent 62%)}`,
            // Mark at the right end + a slow light sweep (still when reduced motion).
            `:has(> [data-wh-rail]) [aria-current="page"]{background-repeat:no-repeat;background-position:right 4px center,130% 0;background-size:auto 24px,260% 100%}`,
            `@media (prefers-reduced-motion:no-preference){:has(> [data-wh-rail]) [aria-current="page"]{animation:wh-nav-shimmer 5.5s ease-in-out infinite}}`,
          ].join(""),
        }}
      />
      {/* Single-hue wash over the whole rail, deeper toward the foot. */}
      <div
        className="absolute inset-0 -z-10 dark:hidden"
        style={{
          background: `linear-gradient(180deg, rgba(${rail.tint}, 0.3) 0%, rgba(${rail.tint}, 0.64) 100%)`,
        }}
      />
      <div
        className="absolute inset-0 -z-10 hidden dark:block"
        style={{
          background: `linear-gradient(180deg, rgba(${rail.tint}, 0.1) 0%, rgba(${rail.tint}, 0.28) 100%)`,
        }}
      />

      {/* Sunken line-art watermark */}
      {!collapsed ? (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            WebkitMaskImage:
              "linear-gradient(180deg, transparent 0%, #000 30%, #000 100%)",
            maskImage:
              "linear-gradient(180deg, transparent 0%, #000 30%, #000 100%)",
          }}
        >
          <PatternLayer
            preset={preset}
            stroke={rail.pattern}
            scale={1.15}
            drift={meta.solemn ? "none" : "y"}
            className="opacity-[0.15] dark:opacity-[0.22]"
          />
        </div>
      ) : null}

      {/* Hairline right edge */}
      <div
        className="absolute inset-y-0 right-0 w-0.5 opacity-90"
        style={{
          background: `linear-gradient(180deg, transparent 0%, ${rail.edge[0]} 35%, ${rail.edge[1]} 70%, transparent 100%)`,
        }}
      />

      <SidebarFootScene preset={preset} collapsed={collapsed} />
    </div>
  );
}
