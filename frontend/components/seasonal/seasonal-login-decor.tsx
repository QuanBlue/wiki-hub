"use client";

import { SeasonalAmbientLayer } from "@/components/seasonal/seasonal-ambient-layer";
import { PatternLayer } from "@/components/seasonal/seasonal-patterns";
import { getSeasonalPresetMeta } from "@/components/seasonal/seasonal-presets";
import {
  TopBarScene,
  SidebarFootScene,
} from "@/components/seasonal/seasonal-scenes";
import { RAIL } from "@/components/seasonal/seasonal-sidebar-overlay";
import { useSeasonalGreetingText } from "@/components/seasonal/seasonal-topbar-overlay";
import { useThemeSettings } from "@/components/theme-color-provider";
import { cn } from "@/lib/utils";
import type { SeasonalEffectPresetId } from "@/types/api";

/*
 * The sign-in page's share of the seasonal effects. It has no top bar or
 * sidebar, so each piece of the in-app treatment has a counterpart here:
 *   - particles + a soft wash of the theme hue  -> SeasonalLoginAtmosphere
 *   - the header-edge band                      -> SeasonalLoginCardEdge (top of the card)
 *   - the sidebar foot scene                    -> SeasonalShowcaseFoot (foot of the brand panel)
 *   - the top-bar greeting                      -> SeasonalLoginGreeting (above the card)
 *   - the sunken line-art watermark             -> SeasonalLoginWatermark (right-side canvas)
 * Every piece is decorative: pointer-events-none and hidden from assistive tech.
 * `preset` overrides the workspace's active pack (used by the settings preview).
 */

function useShownPreset(
  override?: SeasonalEffectPresetId,
): Exclude<SeasonalEffectPresetId, "none"> | null {
  const { effectiveSeasonalPreset } = useThemeSettings();
  const preset = override ?? effectiveSeasonalPreset;
  if (!preset || preset === "none" || !getSeasonalPresetMeta(preset))
    return null;
  return preset;
}

/** Particles plus a soft wash of the theme hue at the top of the page. */
export function SeasonalLoginAtmosphere({
  preset: override,
  contained = false,
}: {
  preset?: SeasonalEffectPresetId;
  contained?: boolean;
}) {
  const preset = useShownPreset(override);
  if (!preset) return null;
  const tint = RAIL[preset]?.tint;

  return (
    <>
      {tint ? (
        <div
          aria-hidden="true"
          data-testid="seasonal-login-wash"
          className={cn(
            "pointer-events-none inset-x-0 top-0 h-56 select-none",
            contained ? "absolute" : "fixed z-[5]",
          )}
          style={{
            background: `linear-gradient(180deg, rgba(${tint}, 0.16), transparent)`,
          }}
        />
      ) : null}
      {/* Above the brand panel, below the sign-in card (z-10). */}
      <SeasonalAmbientLayer
        preset={preset}
        contained={contained}
        className={contained ? undefined : "z-[5]"}
      />
    </>
  );
}

/**
 * The header-edge band, straddling the top edge of the sign-in card. Mount it
 * inside a `relative` wrapper around the card, not inside the card itself
 * (the card clips its overflow).
 */
export function SeasonalLoginCardEdge({
  preset: override,
}: {
  preset?: SeasonalEffectPresetId;
}) {
  const preset = useShownPreset(override);
  if (!preset) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="seasonal-login-edge"
      className="pointer-events-none absolute inset-x-4 top-0 z-20 h-0 select-none"
    >
      <TopBarScene preset={preset} />
    </div>
  );
}

/** The sidebar foot scene, resting on the bottom of the brand panel. */
export function SeasonalShowcaseFoot({
  preset: override,
}: {
  preset?: SeasonalEffectPresetId;
}) {
  const preset = useShownPreset(override);
  if (!preset) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="seasonal-login-foot"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
    >
      <SidebarFootScene preset={preset} />
    </div>
  );
}

/** The holiday greeting as a small chip above the sign-in card. */
export function SeasonalLoginGreeting({
  preset: override,
  className,
}: {
  preset?: SeasonalEffectPresetId;
  className?: string;
}) {
  const preset = useShownPreset(override);
  const text = useSeasonalGreetingText(preset ?? "none");
  if (!preset || !text) return null;
  const tint = RAIL[preset]?.tint;
  return (
    <p
      data-testid="seasonal-login-greeting"
      className={cn(
        "border-border/70 bg-surface/85 text-foreground/90 mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium shadow-xs backdrop-blur-sm select-none",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: tint ? `rgb(${tint})` : "var(--primary)" }}
      />
      <span className="truncate">{text}</span>
    </p>
  );
}

/**
 * Sunken line-art watermark tiled across the right-side sign-in canvas,
 * behind the sign-in card. Still for solemn packs and under reduced motion.
 */
export function SeasonalLoginWatermark({
  preset: override,
}: {
  preset?: SeasonalEffectPresetId;
}) {
  const preset = useShownPreset(override);
  if (!preset) return null;
  const meta = getSeasonalPresetMeta(preset);
  const stroke = RAIL[preset]?.pattern ?? "var(--primary)";

  return (
    <div
      aria-hidden="true"
      data-testid="seasonal-login-watermark"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      style={{
        WebkitMaskImage:
          "radial-gradient(ellipse 90% 90% at 50% 50%, #000 55%, transparent 100%)",
        maskImage:
          "radial-gradient(ellipse 90% 90% at 50% 50%, #000 55%, transparent 100%)",
      }}
    >
      <PatternLayer
        preset={preset}
        stroke={stroke}
        scale={1.35}
        drift={meta?.solemn ? "none" : "y"}
        className="opacity-[0.13] dark:opacity-[0.16]"
      />
    </div>
  );
}
