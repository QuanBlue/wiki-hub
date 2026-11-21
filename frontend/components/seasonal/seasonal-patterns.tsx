"use client";

/**
 * Tileable line-art watermarks ("hoa văn chìm") for the TopBar and Sidebar.
 * Pure inline SVG; drawn with strokes so one colour token themes the tile.
 */

import type { CSSProperties, ReactNode } from "react";

import { useSeasonalUid } from "@/components/seasonal/seasonal-motifs";
import { TEACHERS_PATTERN } from "@/components/seasonal/seasonal-teachers";
import type { SeasonalEffectPresetId } from "@/types/api";

interface Tile {
  w: number;
  h: number;
  draw: () => ReactNode;
}

const flake = (x: number, y: number, r: number) => {
  const arm = `M0 0V-${r}M0 -${r * 0.45}L-${r * 0.28} -${r * 0.7}M0 -${r * 0.45}L${r * 0.28} -${r * 0.7}`;
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <path key={a} d={arm} transform={`rotate(${a})`} />
      ))}
    </g>
  );
};

const star5 = (x: number, y: number, r: number) => {
  const pts = Array.from({ length: 10 })
    .map((_, i) => {
      const a = (-90 + i * 36) * (Math.PI / 180);
      const rr = i % 2 === 0 ? r : r * 0.4;
      return `${(x + Math.cos(a) * rr).toFixed(2)},${(y + Math.sin(a) * rr).toFixed(2)}`;
    })
    .join(" ");
  return <polygon points={pts} strokeLinejoin="round" />;
};

const sparkle = (x: number, y: number, r: number) => (
  <path
    transform={`translate(${x} ${y}) scale(${r / 6})`}
    d="M0-6Q.8-.8 6 0Q.8.8 0 6Q-.8.8-6 0Q-.8-.8 0-6Z"
  />
);

const heart = (x: number, y: number, s: number) => (
  <path
    transform={`translate(${x} ${y}) scale(${s})`}
    d="M0 7C-12-1-9-10-4.5-9C-2-8.6-.6-7 0-5.6C.6-7 2-8.6 4.5-9C9-10 12-1 0 7Z"
  />
);

const blossom = (x: number, y: number, r: number) => (
  <g transform={`translate(${x} ${y})`}>
    {[0, 72, 144, 216, 288].map((a) => (
      <circle key={a} cx={Math.sin((a * Math.PI) / 180) * r} cy={-Math.cos((a * Math.PI) / 180) * r} r={r * 0.72} />
    ))}
    <circle r={r * 0.28} />
  </g>
);

const lotus = (x: number, y: number, s: number) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    {[-48, -24, 0, 24, 48].map((a) => (
      <path key={a} transform={`rotate(${a})`} d="M0 0C-4-2-5-8 0-13C5-8 4-2 0 0Z" />
    ))}
  </g>
);

const cloud = (x: number, y: number, s: number) => (
  <path
    transform={`translate(${x} ${y}) scale(${s})`}
    d="M0 14C-4 14-6 10-3 8C-5 4 0 1 3 4C5 0 11 1 11 6C15 5 18 9 15 12C17 14 14 16 12 14Z"
  />
);

const leaf = (x: number, y: number, r: number, s = 1) => (
  <path
    transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}
    d="M0 0C4-5 11-5 16 0C11 5 4 5 0 0ZM2 0H14"
  />
);

const TILES: Partial<Record<SeasonalEffectPresetId, Tile>> = {
  teachers_day: TEACHERS_PATTERN,
  christmas: {
    w: 56,
    h: 56,
    draw: () => (
      <>
        {flake(14, 16, 9)}
        {flake(42, 44, 6)}
        <circle cx="42" cy="12" r="1" />
        <circle cx="10" cy="46" r="1" />
      </>
    ),
  },
  lunar_new_year: {
    w: 64,
    h: 64,
    draw: () => (
      <>
        <circle cx="16" cy="16" r="8" />
        <circle cx="16" cy="16" r="5.8" />
        <rect x="13.4" y="13.4" width="5.2" height="5.2" />
        {blossom(48, 46, 3.6)}
        <path d="M34 10c3-3 7-2 7 1M30 14c4-4 10-2 9 3" />
        <path d="M6 52c3-3 7-2 7 1M2 56c4-4 10-2 9 3" />
      </>
    ),
  },
  new_year: {
    w: 56,
    h: 56,
    draw: () => (
      <>
        {sparkle(14, 14, 6)}
        {sparkle(42, 42, 4)}
        <circle cx="42" cy="12" r="1.2" />
        <circle cx="12" cy="44" r="1.2" />
        <path d="M28 24l4 4-4 4-4-4Z" />
      </>
    ),
  },
  national_red_gold: {
    w: 56,
    h: 56,
    draw: () => (
      <>
        {star5(14, 15, 7)}
        {star5(42, 43, 5)}
        <path d="M28 4v8M24 8h8M28 44v8M24 48h8" />
      </>
    ),
  },
  heritage_gold: {
    w: 60,
    h: 60,
    draw: () => (
      <>
        <circle cx="30" cy="30" r="4" />
        <circle cx="30" cy="30" r="8.5" />
        <circle cx="30" cy="30" r="13" strokeDasharray="1.6 2.4" />
        {Array.from({ length: 12 }).map((_, i) => (
          <path key={i} transform={`rotate(${i * 30} 30 30)`} d="M30 14.6l1.6 3.2h-3.2Z" />
        ))}
        <path d="M0 4h5V0M55 60v-5h5M0 56h5v4M60 4h-5V0" />
      </>
    ),
  },
  lotus_gold: {
    w: 60,
    h: 60,
    draw: () => (
      <>
        {lotus(18, 24, 1.1)}
        {lotus(46, 52, 0.7)}
        <circle cx="46" cy="12" r="1.2" />
        <path d="M6 50c8-4 16-4 24 0" />
      </>
    ),
  },
  floral_pink: {
    w: 60,
    h: 60,
    draw: () => (
      <>
        <circle cx="18" cy="18" r="8" />
        <path d="M18 18m-1.4 0a1.4 1.4 0 1 1 1.4 1.4a2.6 2.6 0 0 1-2.6-2.6a3.8 3.8 0 0 1 3.8-3.8" />
        {leaf(30, 36, 20, 0.9)}
        {leaf(52, 52, 200, 0.7)}
        <circle cx="46" cy="14" r="1.2" />
      </>
    ),
  },
  mid_autumn: {
    w: 64,
    h: 64,
    draw: () => (
      <>
        {cloud(6, 8, 1.1)}
        {star5(46, 18, 6)}
        <path d="M18 52a8 8 0 1 0 8-10 6 6 0 0 1-8 10Z" />
        <circle cx="52" cy="50" r="1.2" />
      </>
    ),
  },
  halloween: {
    w: 64,
    h: 64,
    draw: () => (
      <>
        <path d="M16 18c-2-3-4-5-6-4-2-4-6-4-8 0 2 0 3 2 4 4 2-1 3 0 4 1 2-1 4 1 6-1Z" transform="translate(4 4) scale(1.3)" />
        <path d="M64 0L32 0M64 0L64 32M64 0L40 26M64 0L52 36" transform="translate(-6 36) scale(.6)" />
        <path d="M44 52c3-6 9-6 12 0-2 5-10 5-12 0Z" />
        <circle cx="48" cy="12" r="1.2" />
      </>
    ),
  },
  blue_neon: {
    w: 48,
    h: 48,
    draw: () => (
      <>
        <path d="M12 2L22 8V20L12 26L2 20V8Z" />
        <path d="M2 8L12 14L22 8M12 14V26" />
        <circle cx="36" cy="36" r="2" />
        <path d="M30 6h12M36 0v12" />
      </>
    ),
  },
  memorial_candle: {
    w: 64,
    h: 64,
    draw: () => (
      <>
        <path d="M16 6c-4 6-4 10 0 12 4-2 4-6 0-12Z" />
        <path d="M13 18h6v12h-6Z" />
        {lotus(46, 50, 0.8)}
      </>
    ),
  },
  valentine: {
    w: 56,
    h: 56,
    draw: () => (
      <>
        {heart(14, 16, 1)}
        {heart(42, 44, 0.7)}
        <circle cx="44" cy="12" r="1.1" />
        <circle cx="10" cy="46" r="1.1" />
      </>
    ),
  },
  spring_green: {
    w: 56,
    h: 56,
    draw: () => (
      <>
        <g transform="translate(16 18)">
          {[45, 135, 225, 315].map((a) => (
            <path key={a} transform={`rotate(${a})`} d="M0 0C-6-1-8.4-7-4.4-8.8C-2.2-9.6 0-8.2 0-6.2C0-8.2 2.2-9.6 4.4-8.8C8.4-7 6-1 0 0Z" />
          ))}
        </g>
        {leaf(32, 40, -30, 0.9)}
        <circle cx="46" cy="12" r="1.1" />
      </>
    ),
  },
  easter: {
    w: 60,
    h: 60,
    draw: () => (
      <>
        <path d="M16 6C21 6 24 15 24 20C24 25 20.5 28 16 28C11.5 28 8 25 8 20C8 15 11 6 16 6Z" />
        <path d="M8.4 18l3-2.6 2.8 2.6 2.8-2.6 3 2.6" />
        <circle cx="46" cy="40" r="5" />
        <circle cx="46" cy="40" r="1.4" />
        <circle cx="46" cy="12" r="1.1" />
      </>
    ),
  },
  kids_party: {
    w: 60,
    h: 60,
    draw: () => (
      <>
        <circle cx="14" cy="14" r="5" />
        <path d="M40 8l8 13h-16Z" />
        <path d="M8 44c3-5 6 5 9 0s6 5 9 0" />
        {star5(46, 46, 6)}
      </>
    ),
  },
  autumn_harvest: {
    w: 60,
    h: 60,
    draw: () => (
      <>
        <path
          transform="translate(18 20) scale(.8)"
          d="M0-12L2-7L6-9L5-4L10-5L7 0L9 2L3 4L4 8L0 6.5L-4 8L-3 4L-9 2L-7 0L-10-5L-5-4L-6-9L-2-7ZM0 6.5V13"
        />
        <path d="M46 52V32M46 34l-4-4M46 34l4-4M46 40l-4-4M46 40l4-4M46 46l-4-4M46 46l4-4" />
      </>
    ),
  },
};

/**
 * Seamless tiled watermark. `drift` slowly slides the pattern (GPU transform)
 * one tile at a time so it loops without a visible seam.
 */
export function PatternLayer({
  preset,
  stroke,
  scale = 1,
  drift = "x",
  className = "",
}: {
  preset: SeasonalEffectPresetId;
  /** Any CSS colour, including `var(--token)`. */
  stroke: string;
  scale?: number;
  drift?: "x" | "y" | "none";
  className?: string;
}) {
  const uid = useSeasonalUid();
  const tile = TILES[preset];
  if (!tile) return null;
  const w = tile.w * scale;
  const h = tile.h * scale;
  const id = `${uid}-pat`;
  return (
    <svg
      aria-hidden="true"
      className={`absolute top-0 left-0 ${
        drift === "x"
          ? "wh-seasonal-tile-drift"
          : drift === "y"
            ? "wh-seasonal-tile-drift-y"
            : ""
      } ${className}`}
      style={
        {
          width: drift === "x" ? `calc(100% + ${w * 2}px)` : "100%",
          height: drift === "y" ? `calc(100% + ${h * 2}px)` : "100%",
          "--wh-tile": `${drift === "y" ? h : w}px`,
        } as CSSProperties
      }
    >
      <defs>
        <pattern id={id} width={w} height={h} patternUnits="userSpaceOnUse">
          <g
            transform={`scale(${scale})`}
            fill="none"
            strokeWidth="0.9"
            strokeLinecap="round"
            style={{ stroke }}
          >
            {tile.draw()}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * Sparse spots for the scattered watermark: position in a 420 x 56 strip and
 * the size of each copy of the tile (px). Mixed sizes and uneven gaps keep it
 * from reading as a grid.
 */
const SCATTER: Array<{ x: number; y: number; size: number; rot: number }> = [
  { x: 6, y: 4, size: 46, rot: -8 },
  { x: 96, y: 26, size: 22, rot: 12 },
  { x: 168, y: -6, size: 34, rot: 4 },
  { x: 262, y: 22, size: 28, rot: -14 },
  { x: 340, y: 2, size: 18, rot: 20 },
];
const SCATTER_W = 420;

/**
 * Like `PatternLayer`, but a few copies of the preset's tile are scattered at
 * different sizes with wide gaps, for a quieter watermark on a short bar.
 */
export function ScatterPatternLayer({
  preset,
  stroke,
  drift = "x",
  className = "",
}: {
  preset: SeasonalEffectPresetId;
  /** Any CSS colour, including `var(--token)`. */
  stroke: string;
  drift?: "x" | "none";
  className?: string;
}) {
  const uid = useSeasonalUid();
  const tile = TILES[preset];
  if (!tile) return null;
  const id = `${uid}-scatter`;
  return (
    <svg
      aria-hidden="true"
      data-scatter-pattern=""
      className={`absolute top-0 left-0 ${drift === "x" ? "wh-seasonal-tile-drift" : ""} ${className}`}
      style={
        {
          width: drift === "x" ? `calc(100% + ${SCATTER_W * 2}px)` : "100%",
          height: "100%",
          "--wh-tile": `${SCATTER_W}px`,
        } as CSSProperties
      }
    >
      <defs>
        <pattern id={id} width={SCATTER_W} height={56} patternUnits="userSpaceOnUse">
          {SCATTER.map((s, i) => (
            <svg
              key={i}
              x={s.x}
              y={s.y}
              width={s.size}
              height={s.size}
              viewBox={`0 0 ${tile.w} ${tile.h}`}
              overflow="visible"
            >
              <g
                transform={`rotate(${s.rot} ${tile.w / 2} ${tile.h / 2})`}
                fill="none"
                strokeWidth={tile.w / s.size}
                strokeLinecap="round"
                style={{ stroke }}
              >
                {tile.draw()}
              </g>
            </svg>
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
