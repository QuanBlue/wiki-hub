"use client";

import { GreetingDoodle, greetingStops } from "@/components/seasonal/seasonal-greeting-doodle";
import { useThemeSettings } from "@/components/theme-color-provider";
import type { SeasonalEffectPresetId } from "@/types/api";

/** The holiday pack shown right now, or null outside a holiday. */
export function useHolidayPreset(): Exclude<SeasonalEffectPresetId, "none"> | null {
  const { effectiveSeasonalPreset } = useThemeSettings();
  return effectiveSeasonalPreset && effectiveSeasonalPreset !== "none"
    ? effectiveSeasonalPreset
    : null;
}

/**
 * Page-loading indicator for a holiday: a wash in the holiday colours sweeps
 * across the top bar itself (the strip under the bar carries the holiday band,
 * so the plain bar is left out), led by a bright line, a trail of sparkles and
 * the pack's own doodle. Every page-loading bar in the app renders this during
 * a holiday, so a second bar can never show under the header.
 */
export function HolidayLoader({
  preset,
  pending,
}: {
  preset: Exclude<SeasonalEffectPresetId, "none">;
  pending: boolean;
}) {
  const stops = greetingStops(preset);
  const glow = stops[Math.floor(stops.length / 2)];
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      aria-hidden={!pending}
      data-holiday-progress=""
      className={
        "pointer-events-none fixed inset-x-0 top-0 z-[70] h-(--wh-topbar-height) overflow-hidden transition-opacity duration-200 " +
        (pending ? "opacity-100" : "opacity-0")
      }
    >
      <div className="nav-progress-bar absolute inset-y-0 w-1/2">
        {/* A soft wash in the holiday colours that sweeps across the header. */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(90deg, transparent, ${stops
              .map((c) => `color-mix(in srgb, ${c} 34%, transparent)`)
              .join(", ")}, transparent)`,
            maskImage: "linear-gradient(180deg, #000, transparent 90%)",
            WebkitMaskImage: "linear-gradient(180deg, #000, transparent 90%)",
          }}
        />
        {/* Bright leading line along the top edge, brightest at the head. */}
        <div
          className="absolute inset-x-0 top-0 h-[3px] rounded-full"
          style={{
            backgroundImage: `linear-gradient(90deg, transparent, ${stops.join(", ")}, transparent)`,
            boxShadow: `0 0 12px 2px ${glow}`,
          }}
        />
        {/* Trail of sparkles behind the runner. */}
        {[
          { right: 30, top: 14, size: 5, delay: "0s" },
          { right: 52, top: 30, size: 4, delay: "-0.5s" },
          { right: 74, top: 18, size: 3, delay: "-1s" },
          { right: 98, top: 34, size: 3, delay: "-1.5s" },
        ].map((d) => (
          <span
            key={d.right}
            className="wh-seasonal-pulse wh-anim absolute rounded-full"
            style={{
              right: d.right,
              top: d.top,
              width: d.size,
              height: d.size,
              backgroundColor: glow,
              boxShadow: `0 0 6px 1px ${glow}`,
              animationDelay: d.delay,
            }}
          />
        ))}
        {/* The holiday's own doodle runs at the head, a little larger. */}
        <span className="absolute top-2 right-[16%] flex scale-[1.5] drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]">
          <GreetingDoodle preset={preset} side="lead" />
        </span>
      </div>
    </div>
  );
}
