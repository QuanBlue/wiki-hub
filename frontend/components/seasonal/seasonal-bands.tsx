"use client";

/**
 * TopBar edge bands for the seasonal presets.
 *
 * Shared recipe (the one the autumn branch settled on): one thin, continuous
 * line with a pale halo so it reads on both the bar and the page; a few larger
 * focal motifs spaced well apart; small supporting leaves or beads along the
 * line. Tiles are 240 x 28 (heritage 224 x 28) and centre on y = 14, which is
 * the bar's lower edge. Nothing hangs more than ~12px below the line.
 */

import type { ReactNode } from "react";

import {
  BalloonG,
  BatG,
  BlossomG,
  BudG,
  CloudG,
  CloverG,
  DaisyG,
  EggG,
  FacetStarG,
  HeartG,
  LotusG,
  LotusLeafG,
  MeanderPattern,
  PumpkinG,
  RoseG,
  SparkleG,
  SpiderG,
  StarburstG,
} from "@/components/seasonal/seasonal-motifs";
import type { SeasonalEffectPresetId } from "@/types/api";

export interface Band {
  w: number;
  h: number;
  draw: (u: string) => ReactNode;
}

/* ------------------------------ wave helpers ----------------------------- */

const PERIOD = 60;
const AMP = 3.5;
const MID = 14;
const TAU = Math.PI * 2;

const yAt = (x: number) => MID + AMP * Math.sin((TAU * x) / PERIOD);
/** Tangent angle (deg) of the wave at x. */
const angAt = (x: number) =>
  (Math.atan(((AMP * TAU) / PERIOD) * Math.cos((TAU * x) / PERIOD)) * 180) / Math.PI;

function waveD(width = 240): string {
  const pts: string[] = [];
  for (let x = 0; x <= width; x += 3) pts.push(`${x} ${yAt(x).toFixed(2)}`);
  return `M${pts.join("L")}`;
}

/** Thin line over a wider pale halo (legible on the blue bar and the white page). */
function Line({
  stroke,
  width = 1.4,
  halo = "#fbeed6",
  haloWidth = 3.6,
  w = 240,
}: {
  stroke: string;
  width?: number;
  halo?: string;
  haloWidth?: number;
  w?: number;
}) {
  const d = waveD(w);
  return (
    <>
      <path d={d} fill="none" stroke={halo} strokeWidth={haloWidth} strokeLinecap="round" strokeLinejoin="round" opacity=".95" />
      <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

const SMALL_LEAF = "M0 0C2-2.6 6-2.6 8 0C6 2.6 2 2.6 0 0Z";

/** Small leaves springing from the wave at `xs`, alternating above / below. */
function Leaves({
  xs,
  fills,
  stroke = "#14532d",
  scale = 0.75,
}: {
  xs: number[];
  fills: string[];
  stroke?: string;
  scale?: number;
}) {
  return (
    <>
      {xs.map((x, i) => (
        <path
          key={x}
          d={SMALL_LEAF}
          transform={`translate(${x} ${yAt(x).toFixed(1)}) rotate(${(angAt(x) + (i % 2 ? 52 : -52)).toFixed(0)}) scale(${scale})`}
          fill={fills[i % fills.length]}
          stroke={stroke}
          strokeOpacity=".45"
          strokeWidth=".4"
        />
      ))}
    </>
  );
}

const dot = (x: number, r: number, fill: string, dy = 0, stroke?: string) => (
  <circle key={`${x}-${dy}`} cx={x} cy={yAt(x) + dy} r={r} fill={fill} stroke={stroke} strokeOpacity=".5" strokeWidth=".4" />
);

const star5 = (x: number, y: number, r: number, fill: string) => {
  const pts = Array.from({ length: 10 })
    .map((_, i) => {
      const a = (-90 + i * 36) * (Math.PI / 180);
      const rr = i % 2 === 0 ? r : r * 0.42;
      return `${(x + Math.cos(a) * rr).toFixed(2)},${(y + Math.sin(a) * rr).toFixed(2)}`;
    })
    .join(" ");
  return <polygon key={`s${x}`} points={pts} fill={fill} strokeLinejoin="round" />;
};

/* ------------------------------- the bands -------------------------------- */

const lunar = (u: string): ReactNode => (
  <>
    <Line stroke="#5a371f" width={1.6} />
    <Leaves xs={[14, 36, 96, 112, 140, 200, 226]} fills={["#4d8f5a", "#3f7d5a"]} />
    {/* cluster A */}
    <BlossomG u={u} kind="peach" x={64} y={yAt(64) - 6} s={0.64} r={10} />
    <BlossomG u={u} kind="apricot" x={78} y={yAt(78) - 3} s={0.5} r={-14} />
    <BudG u={u} kind="peach" x={52} y={yAt(52) - 2} s={0.62} r={-60} />
    <BlossomG u={u} kind="peach" x={72} y={yAt(72) + 5} s={0.42} r={30} />
    {/* a gold coin resting on the branch */}
    <g transform={`translate(124 ${yAt(124).toFixed(1)})`}>
      <circle r="3.2" fill="#fbbf24" stroke="#b45309" strokeWidth=".6" />
      <rect x="-1.1" y="-1.1" width="2.2" height="2.2" fill="#b91c1c" />
    </g>
    {/* cluster B */}
    <BlossomG u={u} kind="apricot" x={178} y={yAt(178) - 6} s={0.66} r={-8} />
    <BlossomG u={u} kind="peach" x={192} y={yAt(192) - 2} s={0.46} r={22} />
    <BudG u={u} kind="apricot" x={166} y={yAt(166) - 1} s={0.6} r={-70} />
    <BlossomG u={u} kind="apricot" x={186} y={yAt(186) + 6} s={0.4} r={10} />
  </>
);

const newYear = (): ReactNode => (
  <>
    <Line stroke="#b8892e" width={1.2} />
    {[16, 34, 88, 100, 146, 158, 214, 230].map((x, i) =>
      dot(x, [1.4, 2.1, 1.6, 1.1, 2.1, 1.4, 1.2, 1.8][i], i % 2 ? "#cbd5e1" : "#f5d27a", 0, "#8a6a1f"),
    )}
    <StarburstG x={56} y={yAt(56) - 9} s={0.66} r={8} />
    <SparkleG x={116} y={yAt(116) - 9} s={0.8} color="#d9a032" />
    <StarburstG x={176} y={yAt(176) - 8} s={0.52} r={-12} color="#94a3b8" accent="#d9a032" />
    <SparkleG x={208} y={yAt(208) + 8} s={0.55} color="#94a3b8" />
    <SparkleG x={34} y={yAt(34) + 8} s={0.5} color="#d9a032" />
    {[
      [76, 5, 24, "#d9a032"],
      [138, -6, -30, "#94a3b8"],
      [196, 6, 40, "#f5d27a"],
      [100, 7, -20, "#94a3b8"],
    ].map(([x, dy, r, c]) => (
      <rect key={String(x)} x={Number(x)} y={yAt(Number(x)) + Number(dy)} width="5" height="2.2" rx=".5" fill={String(c)} transform={`rotate(${r} ${x} ${yAt(Number(x)) + Number(dy)})`} />
    ))}
  </>
);

const national = (u: string): ReactNode => {
  const d = waveD();
  return (
    <>
      {/* a silk ribbon rippling along the edge */}
      <path d={d} fill="none" stroke="#f5b50a" strokeWidth="5.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#c81e1e" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#f87171" strokeWidth=".8" strokeLinecap="round" strokeLinejoin="round" opacity=".7" transform="translate(0 -.8)" />
      <FacetStarG u={u} x={60} y={yAt(60)} R={8} />
      <FacetStarG u={u} x={180} y={yAt(180)} R={6} r={14} />
      {[20, 120, 220].map((x) => star5(x, yAt(x), 2.6, "#fde047"))}
      {[90, 150, 36, 204].map((x) => dot(x, 1.1, "#fde047"))}
    </>
  );
};

const heritage = (u: string): ReactNode => {
  const id = `${u}-mea`;
  return (
    <>
      <defs>
        <MeanderPattern id={id} color="#f0c98a" />
      </defs>
      <rect x="0" y="9" width="224" height="10" fill="#6b3a12" />
      <rect x="0" y="8.4" width="224" height="1" fill="#e0a85a" />
      <rect x="0" y="18.6" width="224" height="1" fill="#e0a85a" />
      <rect x="0" y="10.4" width="224" height="8" fill={`url(#${id})`} />
      {[56, 168].map((x) => (
        <g key={x} transform={`translate(${x} 14)`}>
          <circle r="7.6" fill="#8a4a14" stroke="#e0a85a" strokeWidth=".8" />
          <circle r="5.2" fill="none" stroke="#f0c98a" strokeWidth=".6" />
          {Array.from({ length: 12 }).map((_, i) => (
            <path key={i} transform={`rotate(${i * 30})`} d="M0-5.2L1-3.4H-1Z" fill="#f5c453" />
          ))}
          <circle r="1.8" fill="#f5c453" />
        </g>
      ))}
    </>
  );
};

const lotus = (u: string): ReactNode => (
  <>
    <Line stroke="#b8892e" width={1.2} halo="#e6f7f2" />
    {/* ripples */}
    {[44, 156].map((x) => (
      <ellipse key={x} cx={x} cy={yAt(x) + 3} rx="13" ry="2" fill="none" stroke="#7fcdbf" strokeOpacity=".7" strokeWidth=".6" />
    ))}
    <LotusLeafG u={u} x={44} y={yAt(44) + 2} s={0.64} r={-4} />
    <LotusLeafG u={u} x={156} y={yAt(156) + 2} s={0.58} r={6} />
    <LotusG u={u} x={92} y={yAt(92) + 3} s={0.84} />
    <LotusG u={u} x={106} y={yAt(106) + 4} s={0.5} r={12} />
    <LotusG u={u} x={204} y={yAt(204) + 3} s={0.66} r={-4} />
    {[16, 126, 230].map((x) => dot(x, 1.2, "#f9a8d4", -2))}
    <SparkleG x={128} y={yAt(128) - 8} s={0.5} color="#f5b50a" />
  </>
);

const floral = (u: string): ReactNode => (
  <>
    <Line stroke="#2f6b3e" />
    <Leaves xs={[14, 30, 46, 96, 112, 128, 150, 196, 224]} fills={["#4d8f5a", "#3f7d5a", "#5fa886"]} />
    <RoseG u={u} tint={0} x={64} y={yAt(64) - 5} s={0.56} r={-8} />
    <BudG u={u} kind="peach" x={80} y={yAt(80) - 2} s={0.62} r={-50} />
    <RoseG u={u} tint={1} x={172} y={yAt(172) - 5} s={0.5} r={12} />
    <RoseG u={u} tint={2} x={190} y={yAt(190) + 3} s={0.4} r={-20} />
    <BudG u={u} kind="peach" x={108} y={yAt(108) + 1} s={0.58} r={140} />
    {[88, 138, 212].map((x, i) => dot(x, 1.1, "#fda4af", i % 2 ? 4 : -4))}
  </>
);

const midAutumn = (u: string): ReactNode => (
  <>
    <Line stroke="#b8892e" width={1.2} halo="#fff6d6" />
    <CloudG u={u} x={22} y={yAt(22) - 4} s={0.95} />
    <CloudG u={u} x={150} y={yAt(150) - 4} s={0.85} />
    {/* a full moon drawn flat (the glow of MoonG would be clipped by the tile) */}
    <g transform={`translate(96 ${(yAt(96) - 3).toFixed(1)})`}>
      <circle r="7" fill="#fff3b0" stroke="#d99a10" strokeWidth=".8" />
      <circle cx="-2.2" cy="-1.6" r="1.5" fill="#f5d77a" opacity=".8" />
      <circle cx="2.4" cy="1.8" r="1.1" fill="#f5d77a" opacity=".8" />
    </g>
    <SparkleG x={62} y={yAt(62) - 8} s={0.6} color="#d99a10" />
    <SparkleG x={200} y={yAt(200) - 8} s={0.7} color="#d99a10" />
    <SparkleG x={124} y={yAt(124) + 8} s={0.45} color="#f59e0b" />
    {[44, 132, 178, 224].map((x, i) => dot(x, 1.4, "#fbbf24", i % 2 ? 4 : -5, "#b45309"))}
  </>
);

const halloween = (u: string): ReactNode => (
  <>
    <Line stroke="#4a2575" halo="#efe6ff" />
    {/* cobweb scrap in the corner of the tile */}
    <g fill="none" stroke="#cbb8ee" strokeOpacity=".8" strokeWidth=".6">
      <path d="M12 8Q20 12 28 8M16 5Q22 9 30 5M10 11Q18 14 26 11" />
      <path d="M12 3V13M20 3V13M28 3V13" strokeOpacity=".5" />
    </g>
    <PumpkinG u={u} x={64} y={yAt(64) - 5} s={0.5} />
    <PumpkinG u={u} x={78} y={yAt(78) - 2} s={0.32} />
    <BatG x={128} y={yAt(128) - 9} s={0.58} r={-8} />
    <SpiderG x={188} y={yAt(188)} len={10} s={0.6} />
    <BatG x={226} y={yAt(226) - 8} s={0.42} r={10} />
    {[108, 160, 208].map((x, i) => dot(x, 1.3, "#f97316", i % 2 ? 4 : -4))}
  </>
);

const blueNeon = (): ReactNode => {
  const d = "M0 14H40L46 8H88L94 14H150L156 20H196L202 14H240";
  return (
    <>
      <path d={d} fill="none" stroke="#e0f7ff" strokeWidth="3.2" strokeLinejoin="round" opacity=".55" />
      <path d={d} fill="none" stroke="#0891b2" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M0 18H34L40 14M100 14L106 20H140M208 14L214 8H240" fill="none" stroke="#38bdf8" strokeWidth=".7" strokeLinejoin="round" opacity=".8" />
      {[[40, 14], [94, 14], [156, 20], [202, 14]].map(([x, y]) => (
        <g key={String(x)}>
          <circle cx={x} cy={y} r="2.6" fill="#e0f7ff" stroke="#0891b2" strokeWidth="1" />
          <circle cx={x} cy={y} r=".9" fill="#0891b2" />
        </g>
      ))}
      <path d="M118 9.6l3.4-2 3.4 2v4l-3.4 2-3.4-2Z" fill="#e0f7ff" stroke="#0891b2" strokeWidth=".8" />
      <rect x="168" y="14.6" width="10" height="6" rx="1" fill="#e0f7ff" stroke="#0891b2" strokeWidth=".8" />
      {[170, 173, 176].map((x) => (
        <path key={x} d={`M${x} 20.6V23.4`} stroke="#0891b2" strokeWidth=".7" />
      ))}
      {[18, 66, 128, 226].map((x, i) => (
        <circle key={x} cx={x} cy={i % 2 ? 11 : 17} r="1.1" fill="#22d3ee" />
      ))}
    </>
  );
};

const valentine = (u: string): ReactNode => (
  <>
    <Line stroke="#be123c" width={1.2} halo="#ffe4e6" />
    <Leaves xs={[14, 40, 100, 124, 206, 228]} fills={["#4d8f5a", "#5fa886"]} scale={0.6} />
    <HeartG u={u} x={62} y={yAt(62) - 7} s={0.56} r={-10} fill="#e11d48" />
    <HeartG u={u} x={76} y={yAt(76) - 3} s={0.34} r={14} fill="#fb7185" />
    <HeartG u={u} x={52} y={yAt(52) + 6} s={0.28} r={-16} fill="#fda4af" />
    <RoseG u={u} tint={0} x={150} y={yAt(150) - 4} s={0.5} r={-6} />
    <BudG u={u} kind="peach" x={164} y={yAt(164) - 1} s={0.56} r={-60} />
    <HeartG u={u} x={210} y={yAt(210) - 6} s={0.46} r={12} fill="#f43f5e" />
    {[96, 112, 130, 184].map((x, i) => dot(x, 1.3, "#fff1f2", i % 2 ? 3 : -3, "#fb7185"))}
  </>
);

const spring = (u: string): ReactNode => (
  <>
    <Line stroke="#2f6b3e" halo="#e8fbe9" />
    <Leaves xs={[16, 34, 92, 108, 142, 156, 214, 230]} fills={["#4ade80", "#22c55e", "#86efac"]} />
    <CloverG u={u} stem={false} x={62} y={yAt(62) - 6} s={0.68} r={8} />
    <CloverG u={u} stem={false} x={130} y={yAt(130) - 5} s={0.5} r={-16} />
    <CloverG u={u} stem={false} x={190} y={yAt(190) - 6} s={0.72} r={20} />
    <CloverG u={u} stem={false} x={204} y={yAt(204) + 5} s={0.42} r={-8} />
    {[78, 168, 46].map((x, i) => dot(x, 1.2, "#e0f2fe", i % 2 ? 4 : -3, "#38bdf8"))}
  </>
);

const easter = (): ReactNode => (
  <>
    <Line stroke="#8b5cf6" width={1.3} halo="#f3eeff" />
    <Leaves xs={[14, 38, 90, 118, 140, 176, 226]} fills={["#4ade80", "#86efac"]} scale={0.7} />
    <EggG tone={0} x={56} y={yAt(56) - 6} s={0.68} r={-8} />
    <EggG tone={3} x={72} y={yAt(72) - 2} s={0.46} r={14} />
    <DaisyG x={104} y={yAt(104) - 4} s={0.52} />
    <EggG tone={2} x={150} y={yAt(150) - 6} s={0.62} r={8} />
    <DaisyG x={200} y={yAt(200) - 4} s={0.46} r={20} />
    <EggG tone={1} x={214} y={yAt(214) + 2} s={0.4} r={-12} />
    {[84, 128, 168].map((x, i) => dot(x, 1.2, "#f9a8d4", i % 2 ? 4 : -4))}
  </>
);

const PENNANT = ["#ef4444", "#facc15", "#38bdf8", "#22c55e", "#a855f7", "#f97316"];

const kids = (): ReactNode => (
  <>
    <Line stroke="#475569" width={1.2} halo="#f1f5f9" haloWidth={3.2} />
    {Array.from({ length: 11 }).map((_, i) => {
      const x = 10 + i * 21;
      const y = yAt(x);
      return (
        <polygon
          key={i}
          points={`${x - 5},${(y + 0.6).toFixed(1)} ${x + 5},${(y + 0.6).toFixed(1)} ${x},${(y + 10).toFixed(1)}`}
          fill={PENNANT[i % PENNANT.length]}
          stroke="#000"
          strokeOpacity=".18"
          strokeWidth=".5"
          strokeLinejoin="round"
        />
      );
    })}
    <BalloonG color="#ef4444" x={72} y={yAt(72) - 12} s={0.5} r={-8} string={12} />
    <BalloonG color="#38bdf8" x={192} y={yAt(192) - 12} s={0.52} r={8} string={12} />
    {star5(130, yAt(130) - 8, 3, "#facc15")}
    {star5(32, yAt(32) - 7, 2.2, "#ec4899")}
    {[
      [100, -6, 20, "#a855f7"],
      [160, -8, -30, "#22c55e"],
      [222, -7, 40, "#f97316"],
    ].map(([x, dy, r, c]) => (
      <rect key={String(x)} x={Number(x)} y={yAt(Number(x)) + Number(dy)} width="4.6" height="2" rx=".5" fill={String(c)} transform={`rotate(${r} ${x} ${yAt(Number(x)) + Number(dy)})`} />
    ))}
  </>
);

export const BANDS: Partial<Record<SeasonalEffectPresetId, Band>> = {
  lunar_new_year: { w: 240, h: 28, draw: lunar },
  new_year: { w: 240, h: 28, draw: newYear },
  national_red_gold: { w: 240, h: 28, draw: national },
  heritage_gold: { w: 224, h: 28, draw: heritage },
  lotus_gold: { w: 240, h: 28, draw: lotus },
  floral_pink: { w: 240, h: 28, draw: floral },
  mid_autumn: { w: 240, h: 28, draw: midAutumn },
  halloween: { w: 240, h: 28, draw: halloween },
  blue_neon: { w: 240, h: 28, draw: blueNeon },
  valentine: { w: 240, h: 28, draw: valentine },
  spring_green: { w: 240, h: 28, draw: spring },
  easter: { w: 240, h: 28, draw: easter },
  kids_party: { w: 240, h: 28, draw: kids },
};
