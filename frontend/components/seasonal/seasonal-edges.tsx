"use client";

/**
 * Edge-resting decoration shared by every seasonal preset:
 *
 * - `TopBarBand`: a strip tiled in real pixels that sits on the TopBar's lower
 *   edge (half on the bar, half just below it) plus a few glints. Nothing
 *   dangles into the page, and nothing stretches on wide screens.
 * - `SidebarFoot`: a ground strip that spans the whole rail width (it follows
 *   the sidebar when it is resized) with one motif anchored to the corner and
 *   a few small floaters placed by percent.
 *
 * Christmas has its own hand-tuned versions in seasonal-scenes.tsx.
 */

import type { CSSProperties, ReactNode } from "react";

import {
  BalloonG,
  BatG,
  BlossomG,
  BudG,
  CandleG,
  CloudG,
  CloverG,
  DaisyG,
  DongSonG,
  EggG,
  FacetStarG,
  HeartG,
  LotusG,
  LotusLeafG,
  MapleLeafG,
  MoonG,
  MotifDefs,
  PrismG,
  PumpkinG,
  RoseG,
  SparkleG,
  StarburstG,
  WheatG,
} from "@/components/seasonal/seasonal-motifs";
import { BANDS } from "@/components/seasonal/seasonal-bands";
import {
  TEACHERS_BAND,
  TEACHERS_FOOT,
  TeachersCap,
} from "@/components/seasonal/seasonal-teachers";
import type { SeasonalEffectPresetId } from "@/types/api";

const SOFT_SHADOW: CSSProperties = {
  filter: "drop-shadow(0 1px 1.5px rgba(15, 23, 42, 0.28))",
  overflow: "visible",
};

/* --------------------------------------------------------------------- */
/* Small drawing helpers (tile-space, px)                                 */
/* --------------------------------------------------------------------- */

const blossom = (x: number, y: number, r: number, petal: string, core: string) => (
  <g key={`b${x}`} transform={`translate(${x} ${y})`}>
    {[0, 72, 144, 216, 288].map((a) => {
      const rad = (a * Math.PI) / 180;
      return <circle key={a} cx={Math.sin(rad) * r} cy={-Math.cos(rad) * r} r={r * 0.78} fill={petal} />;
    })}
    <circle r={r * 0.42} fill={core} />
  </g>
);

const star5 = (x: number, y: number, r: number, fill: string, stroke?: string) => {
  const pts = Array.from({ length: 10 })
    .map((_, i) => {
      const a = (-90 + i * 36) * (Math.PI / 180);
      const rr = i % 2 === 0 ? r : r * 0.42;
      return `${(x + Math.cos(a) * rr).toFixed(2)},${(y + Math.sin(a) * rr).toFixed(2)}`;
    })
    .join(" ");
  return <polygon key={`s${x}`} points={pts} fill={fill} stroke={stroke} strokeWidth={stroke ? 0.5 : 0} strokeLinejoin="round" />;
};

const miniHeart = (x: number, y: number, s: number, fill: string) => (
  <path
    key={`h${x}`}
    transform={`translate(${x} ${y}) scale(${s})`}
    d="M0 7C-12-1-9-10-4.5-9C-2-8.6-.6-7 0-5.6C.6-7 2-8.6 4.5-9C9-10 12-1 0 7Z"
    fill={fill}
  />
);

/** Wavy ground made of a back and a front layer, tiled every `w` px. */
const ground = (w: number, back: string, front: string, line: string): ReactNode => (
  <>
    <path
      d={`M0 12C${w * 0.1} 7 ${w * 0.19} 8 ${w * 0.28} 11C${w * 0.38} 14 ${w * 0.44} 6 ${w * 0.57} 7C${w * 0.68} 8 ${w * 0.73} 13 ${w * 0.83} 12C${w * 0.9} 11 ${w * 0.96} 10 ${w} 12V26H0Z`}
      fill={back}
      stroke={line}
      strokeWidth=".8"
    />
    <path
      d={`M0 16C${w * 0.11} 12 ${w * 0.2} 13 ${w * 0.3} 15C${w * 0.4} 17 ${w * 0.48} 11 ${w * 0.59} 12C${w * 0.7} 13 ${w * 0.78} 17 ${w * 0.88} 16C${w * 0.93} 15.5 ${w * 0.97} 15 ${w} 16V26H0Z`}
      fill={front}
      stroke={line}
      strokeOpacity=".7"
      strokeWidth=".8"
    />
  </>
);

/* --------------------------------------------------------------------- */
/* Config                                                                 */
/* --------------------------------------------------------------------- */

interface Tile {
  w: number;
  h: number;
  draw: (u: string) => ReactNode;
}

interface Floater {
  /** 0-100, mapped onto the right half of the rail (labels sit on the left) */
  left: number;
  /** px from the bottom of the rail */
  bottom: number;
  anim?: "spin" | "bob" | "pulse" | "leaf" | "drift-x";
  dur?: string;
  rev?: boolean;
  draw: (u: string) => ReactNode;
}

export interface EdgeConfig {
  /** TopBar strip, drawn in a `w x h` tile. */
  band?: Tile & { offset?: number };
  /** Glints along the TopBar edge. */
  glint?: { color: string; count?: number };
  /** Sidebar ground strip (h 26). */
  foot?: Tile;
  /** Corner motif drawn in a `w x h` box anchored bottom-right. */
  corner?: { w: number; h: number; draw: (u: string) => ReactNode };
  /** px above the rail bottom for the corner motif (default 8). */
  cornerBottom?: number;
  floaters?: Floater[];
}

const sp = (c: string, s = 0.5): Floater["draw"] =>
  function drawSparkle() {
    return <SparkleG s={s} color={c} />;
  };

/* Autumn vine: four cubic segments (S-curves) that tile every 240px. */
const VINE_SEGS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 9], [20, 5], [40, 13], [60, 9]],
  [[60, 9], [80, 5], [100, 5], [120, 9]],
  [[120, 9], [140, 13], [160, 13], [180, 9]],
  [[180, 9], [200, 5], [220, 5], [240, 9]],
];

/** Point and tangent angle (deg) at `t` along segment `seg` of the vine. */
function onVine(seg: number, t: number) {
  const [p0, p1, p2, p3] = VINE_SEGS[seg];
  const u = 1 - t;
  const x = u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0];
  const y = u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1];
  const dx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  return { x, y, a: (Math.atan2(dy, dx) * 180) / Math.PI };
}

const SMALL_LEAF = "M0 0C2-2.6 6-2.6 8 0C6 2.6 2 2.6 0 0Z";
const SMALL_LEAF_FILLS = ["#8a6a2a", "#a5522a", "#7a7a2e", "#b8742c"];

/** One tile of the autumn branch: vine, leaf clusters, an acorn and a tendril. */
function autumnBranch(): ReactNode {
  const vine = "M0 9C20 5 40 13 60 9S100 5 120 9S160 13 180 9S220 5 240 9";
  const a1 = onVine(1, 0.08);
  const b1 = onVine(3, 0.22);
  const acorn = onVine(2, 0.5);
  const curl = onVine(0, 0.55);
  return (
    <g transform="translate(0 5)">
      {/* cream halo keeps the thin vine legible on both the bar and the page */}
      <path d={vine} fill="none" stroke="#fbeed6" strokeWidth="3.6" strokeLinecap="round" opacity=".95" />
      <path d={vine} fill="none" stroke="#6b3f17" strokeWidth="1.4" strokeLinecap="round" />

      {/* small leaves along the vine, alternating sides */}
      {[0, 1, 2, 3].flatMap((seg) =>
        [0.22, 0.5, 0.78].map((t, i) => {
          const q = onVine(seg, t);
          const up = (seg + i) % 2 === 0;
          return (
            <path
              key={`${seg}-${i}`}
              d={SMALL_LEAF}
              transform={`translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) rotate(${(q.a + (up ? -52 : 52)).toFixed(0)}) scale(.75)`}
              fill={SMALL_LEAF_FILLS[(seg * 3 + i) % 4]}
              stroke="#5a3512"
              strokeOpacity=".45"
              strokeWidth=".4"
            />
          );
        }),
      )}

      {/* cluster A (above): two maples and berries */}
      <MapleLeafG x={a1.x + 1} y={a1.y - 6} s={0.74} r={-25} fill="#d9531e" />
      <MapleLeafG x={a1.x + 11} y={a1.y - 3} s={0.5} r={25} fill="#e8a317" />
      {[[-5, 0.6], [2.5, 1.4], [6, 0.2]].map(([dx, dy]) => (
        <circle key={dx} cx={a1.x + dx} cy={a1.y + dy} r="1.7" fill="#b45309" stroke="#7c2d12" strokeOpacity=".55" strokeWidth=".4" />
      ))}

      {/* cluster B (below): gold and rust maples */}
      <MapleLeafG x={b1.x} y={b1.y + 7} s={0.7} r={150} fill="#e8a317" />
      <MapleLeafG x={b1.x - 9} y={b1.y + 5} s={0.48} r={115} fill="#b8421a" />

      {/* acorn hanging from the vine */}
      <g transform={`translate(${acorn.x.toFixed(1)} ${acorn.y.toFixed(1)})`}>
        <path d="M0 0V3" stroke="#6b3f17" strokeWidth=".8" />
        <ellipse cy="8.4" rx="2.7" ry="3.5" fill="#c0803a" stroke="#6b3f17" strokeWidth=".5" />
        <path d="M-3.4 6.6C-3.2 3.6 3.2 3.6 3.4 6.6Z" fill="#6b3f17" />
        <path d="M-1 7.8C-1.4 9.2-1 10.4 0 11" fill="none" stroke="#f3d4a0" strokeOpacity=".7" strokeWidth=".6" strokeLinecap="round" />
      </g>

      {/* tendril curl */}
      <path
        transform={`translate(${curl.x.toFixed(1)} ${curl.y.toFixed(1)})`}
        d="M0 0C2-4 8-5 8-1C8 2 4 2.6 3.6-.2"
        fill="none"
        stroke="#6b3f17"
        strokeWidth=".8"
        strokeLinecap="round"
      />
    </g>
  );
}

export const EDGES: Partial<Record<SeasonalEffectPresetId, EdgeConfig>> = {
  lunar_new_year: {
    band: BANDS.lunar_new_year,
    glint: { color: "#fde68a" },
    foot: { w: 180, h: 26, draw: () => ground(180, "#fbd5e2", "#fff1f5", "#f4a7c1") },
    corner: {
      w: 76,
      h: 52,
      draw: (u) => (
        <>
          <path d="M80 50C66 44 54 40 40 30C32 24 24 22 14 22" fill="none" stroke="#6b4226" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M52 38C54 30 58 26 64 24M34 27C32 20 28 16 22 14" fill="none" stroke="#6b4226" strokeWidth="1.1" strokeLinecap="round" />
          <BlossomG u={u} kind="peach" x={54} y={36} s={0.85} r={10} />
          <BlossomG u={u} kind="apricot" x={34} y={24} s={0.75} r={-16} />
          <BlossomG u={u} kind="peach" x={64} y={22} s={0.6} r={30} />
          <BudG u={u} kind="apricot" x={18} y={20} s={0.8} r={-60} />
        </>
      ),
    },
    floaters: [
      { left: 10, bottom: 62, anim: "bob", dur: "5s", draw: () => blossom(0, 0, 3.2, "#f9a8c9", "#f59e0b") },
      { left: 42, bottom: 78, anim: "bob", dur: "6s", draw: () => blossom(0, 0, 2.6, "#fde047", "#d97706") },
      { left: 68, bottom: 56, anim: "bob", dur: "5.4s", draw: () => blossom(0, 0, 2.4, "#f9a8c9", "#f59e0b") },
    ],
  },

  new_year: {
    band: BANDS.new_year,
    glint: { color: "#fde68a", count: 18 },
    foot: { w: 180, h: 26, draw: () => ground(180, "#f2e2b8", "#fbf4e2", "#e0c27a") },
    corner: {
      w: 60,
      h: 52,
      draw: () => (
        <>
          <StarburstG x={36} y={24} s={0.95} r={6} />
          <SparkleG x={12} y={36} s={0.6} color="#94a3b8" cls="wh-seasonal-twinkle" />
        </>
      ),
    },
    floaters: [
      { left: 12, bottom: 64, anim: "pulse", dur: "3s", draw: sp("#d9a032", 0.7) },
      { left: 40, bottom: 80, anim: "pulse", dur: "3.6s", draw: sp("#94a3b8", 0.55) },
      { left: 70, bottom: 58, anim: "pulse", dur: "3.2s", draw: sp("#d9a032", 0.5) },
    ],
  },

  national_red_gold: {
    band: BANDS.national_red_gold,
    glint: { color: "#fde047" },
    foot: {
      w: 180,
      h: 26,
      draw: () => (
        <>
          {ground(180, "#fecaca", "#fff1f1", "#f5b50a")}
          <path d="M0 21C40 18 80 23 120 20S160 19 180 21" fill="none" stroke="#dc2626" strokeOpacity=".35" strokeWidth="1" />
        </>
      ),
    },
    corner: {
      w: 56,
      h: 48,
      draw: (u) => (
        <>
          <FacetStarG u={u} x={34} y={26} R={13} />
          <FacetStarG u={u} x={12} y={14} R={5} r={14} />
        </>
      ),
    },
    floaters: [
      { left: 14, bottom: 66, anim: "pulse", dur: "3.2s", draw: () => star5(0, 0, 4, "#f5b50a", "#b45309") },
      { left: 60, bottom: 80, anim: "pulse", dur: "3.8s", draw: () => star5(0, 0, 3, "#ef4444") },
    ],
  },

  heritage_gold: {
    band: BANDS.heritage_gold,
    glint: { color: "#fde68a", count: 10 },
    foot: {
      w: 16,
      h: 26,
      draw: () => (
        <>
          <rect x="0" y="12" width="16" height="14" fill="#f3e2c7" />
          <rect x="0" y="12" width="16" height="1" fill="#b4651b" />
          <path d="M1 22V15H11V19.6H5V17.4H8" fill="none" stroke="#b4651b" strokeOpacity=".7" strokeWidth=".9" strokeLinejoin="round" />
        </>
      ),
    },
    corner: {
      w: 50,
      h: 50,
      draw: (u) => (
        <g className="wh-seasonal-spin wh-anim" style={{ animationDuration: "160s" }}>
          <DongSonG u={u} x={25} y={25} s={0.82} />
        </g>
      ),
    },
  },

  lotus_gold: {
    band: BANDS.lotus_gold,
    glint: { color: "#fde68a", count: 10 },
    foot: { w: 180, h: 26, draw: () => ground(180, "#c9ece4", "#e9f8f4", "#8fd3c7") },
    corner: {
      w: 72,
      h: 48,
      draw: (u) => (
        <>
          <LotusLeafG u={u} x={22} y={42} s={0.85} r={-6} />
          <LotusG u={u} x={48} y={36} s={0.95} />
        </>
      ),
    },
    floaters: [{ left: 30, bottom: 64, anim: "pulse", dur: "4s", draw: sp("#f59e0b", 0.5) }],
  },

  floral_pink: {
    band: BANDS.floral_pink,
    glint: { color: "#fff1f2", count: 10 },
    foot: { w: 180, h: 26, draw: () => ground(180, "#cfe9d4", "#ecf8ee", "#9fd3aa") },
    corner: {
      w: 70,
      h: 50,
      draw: (u) => (
        <>
          <path d="M72 50C60 42 50 38 36 36" fill="none" stroke="#2f6b3e" strokeWidth="1.6" strokeLinecap="round" />
          <RoseG u={u} tint={0} x={44} y={34} s={0.95} r={-8} />
          <RoseG u={u} tint={1} x={22} y={30} s={0.7} r={14} />
        </>
      ),
    },
    floaters: [
      { left: 16, bottom: 70, anim: "leaf", dur: "6s", draw: () => miniHeart(0, 0, 0.3, "#fda4af") },
      { left: 56, bottom: 60, anim: "leaf", dur: "7s", draw: () => miniHeart(0, 0, 0.26, "#fb7185") },
    ],
  },

  mid_autumn: {
    band: BANDS.mid_autumn,
    glint: { color: "#fde68a" },
    foot: { w: 180, h: 26, draw: () => ground(180, "#f6e3b0", "#fdf6e0", "#e8c46a") },
    corner: {
      w: 72,
      h: 54,
      draw: (u) => (
        <>
          <MoonG u={u} x={46} y={22} r={14} />
          <CloudG u={u} x={20} y={30} s={1} />
        </>
      ),
    },
    floaters: [
      { left: 12, bottom: 68, anim: "pulse", dur: "3.6s", draw: sp("#d99a10", 0.55) },
      { left: 46, bottom: 82, anim: "pulse", dur: "4.2s", draw: sp("#f59e0b", 0.45) },
    ],
  },

  halloween: {
    band: BANDS.halloween,
    glint: { color: "#fdba74", count: 10 },
    foot: { w: 180, h: 26, draw: () => ground(180, "#e4d4fb", "#f4ecfe", "#c4b5fd") },
    corner: {
      w: 56,
      h: 46,
      draw: (u) => <PumpkinG u={u} x={30} y={30} s={1} />,
    },
    floaters: [
      { left: 18, bottom: 74, anim: "drift-x", dur: "5.5s", draw: () => <BatG s={0.7} /> },
      { left: 62, bottom: 60, anim: "drift-x", dur: "6.5s", rev: true, draw: () => <BatG s={0.55} r={10} /> },
    ],
  },

  blue_neon: {
    band: BANDS.blue_neon,
    glint: { color: "#a5f3fc", count: 12 },
    foot: {
      w: 24,
      h: 26,
      draw: () => (
        <>
          <rect x="0" y="14" width="24" height="12" fill="#e0f2fe" opacity=".7" />
          <rect x="0" y="14" width="24" height="1" fill="#22d3ee" />
          <path d="M.5 15V19M12.5 15V17" stroke="#0ea5e9" strokeWidth=".8" opacity=".6" />
        </>
      ),
    },
    corner: {
      w: 50,
      h: 50,
      draw: (u) => (
        <g className="wh-seasonal-bob wh-anim" style={{ animationDuration: "6s" }}>
          <PrismG u={u} x={26} y={24} s={0.6} compass={false} />
        </g>
      ),
    },
    floaters: [
      { left: 14, bottom: 70, anim: "pulse", dur: "3s", draw: () => <circle r="1.6" fill="#22d3ee" /> },
      { left: 50, bottom: 84, anim: "pulse", dur: "3.6s", draw: () => <circle r="1.2" fill="#38bdf8" /> },
    ],
  },

  valentine: {
    band: BANDS.valentine,
    glint: { color: "#ffe4e6", count: 10 },
    foot: { w: 180, h: 26, draw: () => ground(180, "#fecdd3", "#fff1f2", "#fda4af") },
    corner: {
      w: 62,
      h: 50,
      draw: (u) => (
        <>
          <g className="wh-seasonal-pulse wh-anim" style={{ animationDuration: "2.4s" }}>
            <HeartG u={u} x={38} y={24} s={1.5} r={-8} />
          </g>
          <RoseG u={u} tint={0} x={18} y={38} s={0.7} />
        </>
      ),
    },
    floaters: [
      { left: 12, bottom: 66, anim: "bob", dur: "4.4s", draw: () => miniHeart(0, 0, 0.42, "#fb7185") },
      { left: 48, bottom: 84, anim: "bob", dur: "5s", draw: () => miniHeart(0, 0, 0.32, "#e11d48") },
      { left: 74, bottom: 60, anim: "bob", dur: "4.8s", draw: () => miniHeart(0, 0, 0.28, "#fda4af") },
    ],
  },

  spring_green: {
    band: BANDS.spring_green,
    glint: { color: "#dcfce7", count: 10 },
    foot: { w: 180, h: 26, draw: () => ground(180, "#bbf7d0", "#ecfdf3", "#86efac") },
    corner: {
      w: 52,
      h: 48,
      draw: (u) => (
        <g className="wh-seasonal-bob wh-anim" style={{ animationDuration: "5s" }}>
          <CloverG u={u} x={28} y={26} s={1.15} r={8} />
        </g>
      ),
    },
    floaters: [
      { left: 16, bottom: 70, anim: "leaf", dur: "6s", draw: (u) => <CloverG u={u} stem={false} s={0.45} /> },
      { left: 58, bottom: 62, anim: "leaf", dur: "7s", draw: (u) => <CloverG u={u} stem={false} s={0.35} r={30} /> },
    ],
  },

  easter: {
    band: BANDS.easter,
    glint: { color: "#fef9c3", count: 10 },
    foot: { w: 180, h: 26, draw: () => ground(180, "#bbf7d0", "#f0fdf4", "#86efac") },
    corner: {
      w: 64,
      h: 46,
      draw: () => (
        <>
          <EggG tone={1} x={40} y={30} s={1.05} r={-6} />
          <EggG tone={2} x={20} y={34} s={0.8} r={10} />
          <DaisyG x={54} y={14} s={0.8} />
        </>
      ),
    },
    floaters: [
      { left: 14, bottom: 66, anim: "pulse", dur: "3.6s", draw: sp("#8b5cf6", 0.5) },
      { left: 52, bottom: 80, draw: () => <DaisyG s={0.5} /> },
    ],
  },

  kids_party: {
    band: BANDS.kids_party,
    foot: {
      w: 90,
      h: 26,
      draw: () => (
        <>
          {ground(90, "#dbeafe", "#f0f7ff", "#93c5fd")}
          {[[12, 20, "#ef4444", 20], [34, 22, "#facc15", -30], [58, 19, "#22c55e", 40], [76, 22, "#a855f7", -10]].map(([x, y, c, r]) => (
            <rect key={String(x)} x={Number(x)} y={Number(y)} width="4" height="2" rx=".5" fill={String(c)} transform={`rotate(${r} ${x} ${y})`} />
          ))}
        </>
      ),
    },
    corner: {
      w: 58,
      h: 64,
      draw: () => (
        <g className="wh-seasonal-sway wh-anim-bottom" style={{ animationDuration: "5s" }}>
          <BalloonG color="#ef4444" x={22} y={18} s={0.9} r={-10} string={30} />
          <BalloonG color="#38bdf8" x={40} y={14} s={1} r={8} string={34} />
        </g>
      ),
    },
    floaters: [
      { left: 14, bottom: 70, anim: "leaf", dur: "5s", draw: () => <rect x="-2" y="-1" width="4" height="2" rx=".5" fill="#facc15" /> },
      { left: 46, bottom: 84, anim: "leaf", dur: "6s", draw: () => <rect x="-2" y="-1" width="4" height="2" rx=".5" fill="#ec4899" /> },
      { left: 72, bottom: 62, anim: "leaf", dur: "5.6s", draw: () => <rect x="-2" y="-1" width="4" height="2" rx=".5" fill="#38bdf8" /> },
    ],
  },

  autumn_harvest: {
    band: { w: 240, h: 28, draw: autumnBranch },
    glint: { color: "#fde68a", count: 10 },
    foot: { w: 180, h: 26, draw: () => ground(180, "#fed7aa", "#fff4e6", "#fdba74") },
    corner: {
      w: 60,
      h: 56,
      draw: () => (
        <>
          <WheatG x={38} y={52} s={0.9} r={-8} />
          <WheatG x={48} y={54} s={0.8} r={10} />
          <MapleLeafG x={20} y={40} s={1} r={-20} fill="#dc3c14" />
        </>
      ),
    },
    floaters: [
      { left: 12, bottom: 72, anim: "leaf", dur: "5s", draw: () => <MapleLeafG s={0.7} r={30} fill="#f59e0b" /> },
      { left: 50, bottom: 60, anim: "leaf", dur: "6s", draw: () => <MapleLeafG s={0.6} r={-40} fill="#c2410c" /> },
    ],
  },

  teachers_day: {
    band: TEACHERS_BAND,
    glint: { color: "#f5e3a8", count: 12 },
    foot: TEACHERS_FOOT,
    corner: { w: 52, h: 36, draw: () => <TeachersCap /> },
    cornerBottom: 14,
    floaters: [
      { left: 14, bottom: 70, anim: "bob", dur: "6s", draw: sp("#c9993a", 0.5) },
      { left: 50, bottom: 86, anim: "bob", dur: "7s", draw: sp("#e8c46a", 0.4) },
      { left: 78, bottom: 64, anim: "bob", dur: "6.5s", draw: sp("#c9993a", 0.35) },
    ],
  },

  memorial_candle: {
    corner: {
      w: 44,
      h: 56,
      draw: (u) => <CandleG u={u} x={22} y={30} s={0.85} />,
    },
  },
};

/* --------------------------------------------------------------------- */
/* Renderers                                                              */
/* --------------------------------------------------------------------- */

/** Sparse, out-of-phase glints laid along an edge (percent spacing). */
export function EdgeGlints({
  count,
  bottom,
  color = "#ffffff",
}: {
  count: number;
  bottom: number;
  color?: string;
}) {
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
              filter: "drop-shadow(0 0 1.5px rgba(255, 255, 255, 0.85))",
            }}
          >
            <path d="M0-6Q.7-.7 6 0Q.7.7 0 6Q-.7.7-6 0Q-.7-.7 0-6Z" fill={color} />
          </svg>
        );
      })}
    </>
  );
}

export function TopBarBand({ preset, u }: { preset: SeasonalEffectPresetId; u: string }) {
  const cfg = EDGES[preset];
  if (!cfg?.band) return null;
  const { w, h, draw } = cfg.band;
  const id = `${u}-band`;
  return (
    <>
      <svg
        className="absolute inset-x-0 w-full"
        style={{
          height: h,
          bottom: -Math.round(h / 2),
          filter: "drop-shadow(0 1px 1px rgba(15, 23, 42, 0.25))",
        }}
      >
        <defs>
          <MotifDefs u={u} />
          <pattern id={id} width={w} height={h} patternUnits="userSpaceOnUse">
            {draw(u)}
          </pattern>
        </defs>
        <rect width="100%" height={h} fill={`url(#${id})`} />
      </svg>
      {cfg.glint ? (
        <EdgeGlints count={cfg.glint.count ?? 14} bottom={Math.round(h / 2) + 2} color={cfg.glint.color} />
      ) : null}
    </>
  );
}

export function SidebarFoot({
  preset,
  u,
  collapsed,
}: {
  preset: SeasonalEffectPresetId;
  u: string;
  collapsed: boolean;
}) {
  const cfg = EDGES[preset];
  if (!cfg) return null;
  const id = `${u}-foot`;
  return (
    <div className="absolute inset-x-0 bottom-0 h-24">
      <svg width="0" height="0" className="absolute">
        <MotifDefs u={u} />
      </svg>

      {!collapsed
        ? cfg.floaters?.map((f, i) => (
            <svg
              key={i}
              width="28"
              height="28"
              viewBox="-14 -14 28 28"
              className="absolute"
              style={{
                // Nav labels are left-aligned, so floaters stay in the right half.
                left: `${52 + f.left * 0.42}%`,
                bottom: f.bottom,
                marginLeft: -14,
                opacity: 0.7,
                overflow: "visible",
              }}
            >
              {f.anim ? (
                <g
                  className={`wh-seasonal-${f.anim} wh-anim`}
                  style={{
                    animationDuration: f.dur,
                    animationDelay: `${-i * 1.3}s`,
                    animationDirection: f.rev ? "reverse" : undefined,
                  }}
                >
                  {f.draw(u)}
                </g>
              ) : (
                f.draw(u)
              )}
            </svg>
          ))
        : null}

      {cfg.foot ? (
        <svg
          // Pastel ground would glare on a dark rail; keep it as a muted tint.
          className="absolute inset-x-0 bottom-0 w-full dark:opacity-35"
          style={{ height: cfg.foot.h, filter: "drop-shadow(0 -1px 2px rgba(15, 23, 42, 0.12))" }}
        >
          <defs>
            <pattern id={id} width={cfg.foot.w} height={cfg.foot.h} patternUnits="userSpaceOnUse">
              {cfg.foot.draw(u)}
            </pattern>
          </defs>
          <rect width="100%" height={cfg.foot.h} fill={`url(#${id})`} />
        </svg>
      ) : null}

      {!collapsed && cfg.corner ? (
        <svg
          width={cfg.corner.w}
          height={cfg.corner.h}
          viewBox={`0 0 ${cfg.corner.w} ${cfg.corner.h}`}
          className="absolute right-1"
          style={{ ...SOFT_SHADOW, bottom: cfg.cornerBottom ?? 8 }}
        >
          {cfg.corner.draw(u)}
        </svg>
      ) : null}
    </div>
  );
}
