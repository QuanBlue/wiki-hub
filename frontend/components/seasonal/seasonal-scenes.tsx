"use client";

/**
 * Composed decorative scenes for the seasonal TopBar and Sidebar overlays.
 * Pure inline SVG, no external assets. Callers wrap these in
 * pointer-events-none / aria-hidden containers.
 */

import type { CSSProperties, ReactNode } from "react";

import {
  HollyG,
  MotifDefs,
  SnowflakeG,
  useSeasonalUid,
} from "@/components/seasonal/seasonal-motifs";
import { SidebarFoot, TopBarBand } from "@/components/seasonal/seasonal-edges";
import type { SeasonalEffectPresetId } from "@/types/api";

const SOFT_SHADOW: CSSProperties = {
  filter: "drop-shadow(0 1px 1.5px rgba(15, 23, 42, 0.28))",
  overflow: "visible",
};

/** Colour stops for the hairline "light" that runs along bar & rail edges. */
export const EDGE_STOPS: Record<string, string[]> = {
  christmas: ["#dc2626", "#16a34a", "#e0f2fe", "#16a34a", "#dc2626"],
  lunar_new_year: ["#b91c1c", "#f59e0b", "#fde047", "#f59e0b", "#b91c1c"],
  new_year: ["#c9a24a", "#f5e3a8", "#cbd5e1", "#f5e3a8", "#c9a24a"],
  national_red_gold: ["#b91c1c", "#ef4444", "#fde047", "#ef4444", "#b91c1c"],
  heritage_gold: ["#7c3f12", "#c2823a", "#f5c453", "#c2823a", "#7c3f12"],
  lotus_gold: ["#db2777", "#f9a8d4", "#f5b50a", "#f9a8d4", "#db2777"],
  floral_pink: ["#c97b84", "#f7c7bd", "#e8a0a0", "#f7c7bd", "#c97b84"],
  mid_autumn: ["#b45309", "#fbbf24", "#fff3b0", "#fbbf24", "#b45309"],
  halloween: ["#7e22ce", "#f97316", "#a855f7", "#f97316", "#7e22ce"],
  blue_neon: ["#0369a1", "#22d3ee", "#e0f7ff", "#22d3ee", "#0369a1"],
  memorial_candle: ["#92400e", "#d97706", "#b45309", "#d97706", "#92400e"],
  valentine: ["#9f1239", "#fb7185", "#fda4af", "#fb7185", "#9f1239"],
  spring_green: ["#14532d", "#22c55e", "#bbf7d0", "#22c55e", "#14532d"],
  easter: ["#7c3aed", "#a78bfa", "#6ee7b7", "#a78bfa", "#7c3aed"],
  kids_party: ["#f97316", "#facc15", "#38bdf8", "#ef4444", "#22c55e"],
  autumn_harvest: ["#7c2d12", "#c2410c", "#fbbf24", "#c2410c", "#7c2d12"],
};

export function edgeGradient(preset: SeasonalEffectPresetId, dir: string): string {
  const stops = EDGE_STOPS[preset] ?? EDGE_STOPS.blue_neon;
  const n = stops.length - 1;
  return `linear-gradient(${dir}, transparent 0%, ${stops
    .map((c, i) => `${c} ${Math.round(8 + (i / n) * 84)}%`)
    .join(", ")}, transparent 100%)`;
}

/* ----------------------------- shared helpers ---------------------------- */

/** Wraps part of a scene in a CSS-animated group (transform-box aware). */
function A({
  k,
  dur,
  delay,
  rev,
  origin = "c",
  children,
}: {
  k: "spin" | "pulse" | "bob" | "hop" | "drift-x" | "leaf" | "sway";
  dur?: string;
  delay?: string;
  rev?: boolean;
  origin?: "c" | "t" | "b";
  children: ReactNode;
}) {
  const o = origin === "t" ? "wh-anim-top" : origin === "b" ? "wh-anim-bottom" : "wh-anim";
  return (
    <g
      className={`wh-seasonal-${k} ${o}`}
      style={{
        animationDuration: dur,
        animationDelay: delay,
        animationDirection: rev ? "reverse" : undefined,
      }}
    >
      {children}
    </g>
  );
}

/* ------------------------------ TopBar scenes ---------------------------- */



/**
 * Christmas: a soft snow cap resting on the bar's lower edge, short icicles
 * beneath it, and a few frost glints on the snow. Everything sits on the bar
 * edge; nothing dangles into the page.
 */
function ChristmasTop({ u }: { u: string }) {
  const snowId = `${u}-snowcap`;
  const iceId = `${u}-icicles`;
  const iceGrad = `${u}-icegrad`;
  const icicles: Array<[number, number]> = [
    [12, 9],
    [31, 4],
    [47, 12],
    [70, 6],
    [93, 10],
    [110, 3.5],
    [126, 7],
  ];
  const glints = 16;
  return (
    <>
      {/* Icicles hanging just below the snow line */}
      <svg
        className="absolute inset-x-0 h-[14px] w-full"
        style={{ top: "calc(100% + 2px)" }}
      >
        <defs>
          <linearGradient id={iceGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#d6ecff" />
            <stop offset="1" stopColor="#b9dcff" stopOpacity="0.15" />
          </linearGradient>
          <pattern id={iceId} width="140" height="14" patternUnits="userSpaceOnUse">
            {icicles.map(([x, len]) => (
              <path
                key={x}
                d={`M${x - 2.2} 0Q${x - 0.9} ${len * 0.55} ${x} ${len}Q${x + 0.9} ${len * 0.55} ${x + 2.2} 0Z`}
                fill={`url(#${iceGrad})`}
                stroke="#8fbde6"
                strokeOpacity=".55"
                strokeWidth=".5"
              />
            ))}
          </pattern>
        </defs>
        <rect width="100%" height="14" fill={`url(#${iceId})`} />
      </svg>

      {/* Snow cap: tiled in real pixels so the drifts never stretch */}
      <svg
        className="absolute inset-x-0 h-[12px] w-full"
        style={{ bottom: -4, filter: "drop-shadow(0 1px 1px rgba(30, 64, 175, 0.22))" }}
      >
        <defs>
          <pattern id={snowId} width="140" height="12" patternUnits="userSpaceOnUse">
            <path
              d="M0 6.5C10 3.5 18 3.5 26 5.5C34 7.5 40 2.5 52 3.5C62 4.5 66 7.5 78 6.5C90 5.5 96 2.5 108 3.5C118 4.5 128 7.5 140 6.5V12H0Z"
              fill="#cfe3f7"
            />
            <path
              d="M0 5C10 2 18 2 26 4C34 6 40 1 52 2C62 3 66 6 78 5C90 4 96 1 108 2C118 3 128 6 140 5V10.5H0Z"
              fill="#ffffff"
            />
            <path d="M20 3.2C24 2.6 28 3.4 31 4.4M88 3.6C94 2.4 100 1.8 104 2.4" fill="none" stroke="#e8f3ff" strokeWidth="1" strokeLinecap="round" />
          </pattern>
        </defs>
        <rect width="100%" height="12" fill={`url(#${snowId})`} />
      </svg>

      {/* Frost glints catching the light on the snow */}
      <FrostGlints count={glints} bottom={4} />
    </>
  );
}

/** Sparse, out-of-phase ice glints laid along a snow line (percent spacing). */
function FrostGlints({ count, bottom }: { count: number; bottom: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const big = i % 3 === 0;
        const size = big ? 9 : 6;
        const jitter = ((i * 37) % 11) / 11 - 0.5;
        return (
          <svg
            key={i}
            width={size}
            height={size}
            viewBox="-6 -6 12 12"
            className="wh-seasonal-twinkle absolute"
            style={{
              left: `${((i + 0.5 + jitter * 0.6) / count) * 100}%`,
              bottom: bottom + ((i * 5) % 4),
              marginLeft: -size / 2,
              animationDelay: `${-((i * 0.83) % 3.2).toFixed(2)}s`,
              animationDuration: `${2.8 + (i % 3) * 0.7}s`,
              filter: "drop-shadow(0 0 1.5px rgba(96, 165, 250, 0.9))",
            }}
          >
            <path d="M0-6Q.7-.7 6 0Q.7.7 0 6Q-.7.7-6 0Q-.7-.7 0-6Z" fill="#ffffff" />
          </svg>
        );
      })}
    </>
  );
}

function MemorialTop() {
  return (
    <>
      <div
        className="absolute inset-x-0 top-full h-[1px]"
        style={{ background: edgeGradient("memorial_candle", "90deg"), opacity: 0.9, marginTop: 3 }}
      />
      <div
        className="absolute inset-x-0 top-full h-[14px]"
        style={{
          background:
            "linear-gradient(to bottom, rgba(217,119,6,0.16), transparent)",
        }}
      />
    </>
  );
}

export function TopBarScene({ preset }: { preset: SeasonalEffectPresetId }) {
  const u = useSeasonalUid();
  switch (preset) {
    case "christmas":
      return <ChristmasTop u={u} />;
    case "memorial_candle":
      return <MemorialTop />;
    default:
      return <TopBarBand preset={preset} u={u} />;
  }
}

/* ----------------------------- Sidebar scenes ---------------------------- */

/** Christmas rail foot: a tiled snow drift with holly anchored to the corners. */
function ChristmasSidebarFoot({ u, collapsed }: { u: string; collapsed: boolean }) {
  const driftId = `${u}-drift`;
  return (
    <div className="absolute inset-x-0 bottom-0 h-[96px]">
      {/* Gradient defs shared by the corner sprigs below */}
      <svg width="0" height="0" className="absolute">
        <MotifDefs u={u} />
      </svg>

      {!collapsed ? (
        <>
          {/* A few small flakes drifting above the snow, placed by percent */}
          {[
            [7, 58, 0.55, "34s", false],
            [36, 74, 0.42, "26s", true],
            [63, 52, 0.5, "40s", false],
            [86, 70, 0.4, "30s", true],
          ].map(([left, bottom, s, dur, rev], i) => (
            <svg
              key={i}
              width="24"
              height="24"
              viewBox="-12 -12 24 24"
              className="absolute"
              style={{ left: `${left}%`, bottom: Number(bottom), marginLeft: -12, opacity: 0.7 }}
            >
              <A k="spin" dur={String(dur)} rev={Boolean(rev)}>
                <SnowflakeG s={Number(s)} />
              </A>
            </svg>
          ))}
        </>
      ) : null}

      {/* Snow drift: tiled in real pixels so it stretches with the rail */}
      <svg
        className="absolute inset-x-0 bottom-0 h-[26px] w-full"
        style={{ filter: "drop-shadow(0 -1px 2px rgba(30, 64, 175, 0.22))" }}
      >
        <defs>
          <pattern id={driftId} width="180" height="26" patternUnits="userSpaceOnUse">
            <path
              d="M0 12C18 7 34 8 50 11C68 14 80 6 102 7C122 8 132 13 150 12C162 11 172 10 180 12V26H0Z"
              fill="#c4daf1"
              stroke="#9cc4ea"
              strokeWidth=".8"
            />
            <path
              d="M0 16C20 12 36 13 54 15C72 17 86 11 106 12C126 13 140 17 158 16C168 15.5 175 15 180 16V26H0Z"
              fill="#ffffff"
              stroke="#b9d5f0"
              strokeWidth=".8"
            />
            <path
              d="M24 13.4C32 12.6 40 13 46 13.8M112 12.6C120 12.2 128 12.8 134 13.8"
              fill="none"
              stroke="#eaf4ff"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </pattern>
        </defs>
        <rect width="100%" height="26" fill={`url(#${driftId})`} />
      </svg>
      <FrostGlints count={collapsed ? 2 : 6} bottom={8} />

      {!collapsed ? (
        <>
          {/* Holly resting in the snow, pinned to both corners */}
          <svg width="58" height="40" viewBox="0 0 58 40" className="absolute right-1 bottom-[8px]" style={SOFT_SHADOW}>
            <HollyG u={u} x={34} y={24} s={1.25} r={-24} />
            <HollyG u={u} x={14} y={30} s={0.8} r={18} />
          </svg>
        </>
      ) : null}
    </div>
  );
}

/** Full-width rail foot; follows the sidebar when it is resized. */
export function SidebarFootScene({
  preset,
  collapsed = false,
}: {
  preset: SeasonalEffectPresetId;
  collapsed?: boolean;
}) {
  const u = useSeasonalUid();
  switch (preset) {
    case "christmas":
      return <ChristmasSidebarFoot u={u} collapsed={collapsed} />;
    default:
      return <SidebarFoot preset={preset} u={u} collapsed={collapsed} />;
  }
}
