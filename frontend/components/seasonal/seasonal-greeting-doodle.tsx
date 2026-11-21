"use client";

/**
 * Small holiday doodles that flank the TopBar greeting, in the spirit of a
 * search-engine holiday doodle: one motif before the text and one after. Pure
 * inline SVG built from the shared motifs; every piece is aria-hidden and still when motion is reduced.
 */

import type { ReactNode } from "react";

import {
  BalloonG,
  BatG,
  BlossomG,
  CandleG,
  CloverG,
  DaisyG,
  DongSonG,
  EggG,
  FacetStarG,
  HeartG,
  HollyG,
  LotusG,
  MapleLeafG,
  MoonG,
  MotifDefs,
  PrismG,
  PumpkinG,
  RoseG,
  SnowflakeG,
  SparkleG,
  StarLanternG,
  StarburstG,
  WheatG,
  useSeasonalUid,
} from "@/components/seasonal/seasonal-motifs";
import { EDGE_STOPS } from "@/components/seasonal/seasonal-scenes";
import { RAIL } from "@/components/seasonal/seasonal-sidebar-overlay";
import { TEACHERS_NAV_ACCENT, TeachersCap } from "@/components/seasonal/seasonal-teachers";
import type { SeasonalEffectPresetId } from "@/types/api";

type Motion = "bob" | "sway" | "pulse" | "spin" | "none";

interface Doodle {
  /** SVG viewBox framing the motif (glows outside it are clipped). */
  vb: string;
  draw: (u: string) => ReactNode;
  motion: Motion;
}

type Pair = { lead: Doodle; trail: Doodle | null };

const D = (vb: string, motion: Motion, draw: (u: string) => ReactNode): Doodle => ({
  vb,
  motion,
  draw,
});

const DOODLES: Record<Exclude<SeasonalEffectPresetId, "none">, Pair> = {
  christmas: {
    lead: D("-17 -17 34 34", "sway", (u) => <HollyG u={u} />),
    trail: D("-15 -15 30 30", "spin", () => (
      <g stroke="#e0f2fe" strokeWidth="1.4">
        <SnowflakeG />
      </g>
    )),
  },
  lunar_new_year: {
    lead: D("-13 -13 26 26", "sway", (u) => <BlossomG u={u} kind="peach" />),
    trail: D("-13 -13 26 26", "sway", (u) => <BlossomG u={u} kind="apricot" />),
  },
  new_year: {
    lead: D("-22 -22 44 44", "pulse", () => <StarburstG color="#fcd34d" accent="#e2e8f0" />),
    trail: D("-22 -22 44 44", "pulse", () => <StarburstG color="#f5d27a" accent="#fda4af" />),
  },
  national_red_gold: {
    lead: D("-14 -14 28 28", "pulse", (u) => <FacetStarG u={u} R={13} />),
    trail: D("-14 -14 28 28", "pulse", (u) => <FacetStarG u={u} R={13} />),
  },
  heritage_gold: {
    lead: D("-27 -27 54 54", "spin", (u) => <DongSonG u={u} />),
    trail: D("-18 -18 36 21", "sway", (u) => <LotusG u={u} bronze />),
  },
  lotus_gold: {
    lead: D("-18 -18 36 21", "sway", (u) => <LotusG u={u} />),
    trail: D("-18 -18 36 21", "sway", (u) => <LotusG u={u} />),
  },
  floral_pink: {
    lead: D("-13 -13 26 26", "sway", (u) => <RoseG u={u} tint={0} />),
    trail: D("-13 -13 26 26", "sway", (u) => <RoseG u={u} tint={1} />),
  },
  mid_autumn: {
    lead: D("-16 -16 32 32", "none", (u) => <MoonG u={u} r={13} />),
    trail: D("-16 -1 32 33", "sway", (u) => <StarLanternG u={u} />),
  },
  halloween: {
    lead: D("-14 -18 28 31", "bob", (u) => <PumpkinG u={u} />),
    trail: D("-15 -10 30 16", "bob", () => <BatG />),
  },
  blue_neon: {
    lead: D("-15 -15 30 30", "bob", (u) => <PrismG u={u} compass={false} />),
    trail: D("-7 -7 14 14", "pulse", () => <SparkleG color="#67e8f9" />),
  },
  memorial_candle: {
    lead: D("-17 -44 34 64", "none", (u) => <CandleG u={u} />),
    trail: null,
  },
  valentine: {
    lead: D("-13 -11 26 20", "pulse", (u) => <HeartG u={u} />),
    trail: D("-13 -11 26 20", "pulse", (u) => <HeartG u={u} fill="#fda4af" />),
  },
  spring_green: {
    lead: D("-10 -10 20 22", "sway", (u) => <CloverG u={u} />),
    trail: D("-11 -11 22 22", "spin", () => <DaisyG />),
  },
  easter: {
    lead: D("-9 -11 18 22", "bob", () => <EggG tone={1} />),
    trail: D("-9 -11 18 22", "bob", () => <EggG tone={2} />),
  },
  kids_party: {
    lead: D("-9 -11 18 34", "bob", () => <BalloonG color="#ef4444" string={10} />),
    trail: D("-9 -11 18 34", "bob", () => <BalloonG color="#38bdf8" string={10} />),
  },
  teachers_day: {
    lead: D("0 3 52 33", "bob", () => <TeachersCap />),
    trail: D("8 6 40 16", "none", () => (
      <g dangerouslySetInnerHTML={{ __html: TEACHERS_NAV_ACCENT }} />
    )),
  },
  autumn_harvest: {
    lead: D("-11 -13 22 27", "sway", () => <MapleLeafG />),
    trail: D("-7 -36 14 37", "sway", () => <WheatG />),
  },
};

const MOTION_CLASS: Record<Motion, string> = {
  bob: "wh-seasonal-bob wh-anim",
  sway: "wh-seasonal-leaf wh-anim-bottom",
  pulse: "wh-seasonal-pulse wh-anim",
  spin: "wh-seasonal-spin wh-anim",
  none: "",
};

function DoodleSvg({ doodle, delay }: { doodle: Doodle; delay?: string }) {
  const u = useSeasonalUid();
  return (
    <svg
      aria-hidden="true"
      data-greeting-doodle=""
      viewBox={doodle.vb}
      // Big glow discs (lanterns) would show as a square once clipped to the
      // doodle's small box, so they are hidden here.
      className="size-5 shrink-0 drop-shadow-[0_1px_1px_rgba(15,23,42,0.35)] [&_circle[fill*='glow']]:hidden"
    >
      <defs>
        <MotifDefs u={u} />
      </defs>
      <g
        className={MOTION_CLASS[doodle.motion]}
        style={{
          animationDelay: delay,
          animationDuration: doodle.motion === "spin" ? "18s" : undefined,
        }}
      >
        {doodle.draw(u)}
      </g>
    </svg>
  );
}

export function GreetingDoodle({
  preset,
  side,
}: {
  preset: SeasonalEffectPresetId;
  side: "lead" | "trail";
}) {
  if (preset === "none") return null;
  const doodle = DOODLES[preset]?.[side];
  if (!doodle) return null;
  return <DoodleSvg doodle={doodle} delay={side === "trail" ? "-1.6s" : undefined} />;
}

/** Holiday colours, left to right (used by the page-loading bar). */
export function greetingStops(preset: SeasonalEffectPresetId): string[] {
  if (preset === "none") return [];
  const stops = EDGE_STOPS[preset];
  if (stops) return stops;
  const edge = RAIL[preset]?.edge;
  return edge ? [edge[0], edge[1], edge[0]] : [];
}
