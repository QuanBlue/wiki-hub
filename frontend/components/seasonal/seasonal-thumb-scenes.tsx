"use client";

/**
 * 360x140 illustrated scenes, one per seasonal preset, used by the holiday
 * thumbnails. Built from the shared motifs; inline SVG only (air-gap safe).
 */

import {
  BalloonG,
  BatG,
  BlossomG,
  BudG,
  BulbG,
  CandleG,
  CloudG,
  CloverG,
  CobwebG,
  CoinKnotG,
  DaisyG,
  DeadBranchG,
  DongSonG,
  EggG,
  FacetStarG,
  HeartG,
  HollyG,
  LanternG,
  LotusG,
  LotusLeafG,
  MapleLeafG,
  MeanderPattern,
  MoonG,
  MotifDefs,
  PrismG,
  PumpkinG,
  RabbitG,
  RaysG,
  RoseG,
  SnowflakeG,
  SparkleG,
  StarLanternG,
  StarburstG,
  WheatG,
  useSeasonalUid,
} from "@/components/seasonal/seasonal-motifs";
import { TeachersThumb } from "@/components/seasonal/seasonal-teachers";
import type { SeasonalEffectPresetId } from "@/types/api";

const BG: Record<string, [string, string, string]> = {
  christmas: ["#0b1530", "#1e3a5f", "#7f1d1d"],
  lunar_new_year: ["#7f1d1d", "#dc2626", "#b45309"],
  new_year: ["#0f172a", "#312e81", "#1e1b4b"],
  national_red_gold: ["#7f1d1d", "#dc2626", "#991b1b"],
  heritage_gold: ["#3b2208", "#7c4a14", "#c2823a"],
  lotus_gold: ["#831843", "#be4a7c", "#e8a33c"],
  floral_pink: ["#9f1239", "#e8637f", "#fbcfe8"],
  mid_autumn: ["#0f1a3d", "#2e2a6b", "#7c3a1a"],
  halloween: ["#1e0a3a", "#4c1d95", "#c2410c"],
  blue_neon: ["#06203a", "#0369a1", "#0e7490"],
  memorial_candle: ["#241003", "#5b2a0a", "#a35a12"],
  valentine: ["#5b0a26", "#be123c", "#fb7185"],
  spring_green: ["#0b3d24", "#15803d", "#86efac"],
  easter: ["#5b3fb5", "#a78bfa", "#99f6e4"],
  kids_party: ["#0ea5e9", "#7dd3fc", "#fde68a"],
  autumn_harvest: ["#3f1a08", "#9a3412", "#e0891b"],
  teachers_day: ["#052e2b", "#0f5f56", "#b8892e"],
};

function Scene({ preset, u }: { preset: SeasonalEffectPresetId; u: string }) {
  switch (preset) {
    case "christmas":
      return (
        <>
          <ellipse cx="80" cy="150" rx="150" ry="36" fill="#e2e8f0" />
          <ellipse cx="290" cy="152" rx="160" ry="38" fill="#f8fafc" />
          <polygon points="180,22 144,76 216,76" fill="#15803d" />
          <polygon points="180,46 134,104 226,104" fill="#166534" />
          <polygon points="180,70 126,128 234,128" fill="#14532d" />
          <rect x="172" y="126" width="16" height="12" fill="#78350f" />
          <FacetStarG u={u} x={180} y={14} R={10} />
          {[
            [166, 62, "#ef4444"],
            [194, 70, "#38bdf8"],
            [156, 94, "#fbbf24"],
            [188, 100, "#ef4444"],
            [206, 116, "#38bdf8"],
            [150, 118, "#fbbf24"],
          ].map(([x, y, c], i) => (
            <circle key={i} cx={Number(x)} cy={Number(y)} r="4" fill={String(c)} stroke="#fff" strokeOpacity=".5" strokeWidth=".6" />
          ))}
          <SnowflakeG x={50} y={40} s={1.6} r={10} />
          <SnowflakeG x={312} y={34} s={1.3} r={-12} />
          <SnowflakeG x={92} y={86} s={0.9} r={20} />
          <SnowflakeG x={270} y={80} s={1} r={5} />
          <HollyG u={u} x={30} y={118} s={1.8} r={-20} />
          <HollyG u={u} x={334} y={120} s={1.8} r={200} />
          {[24, 60, 96, 132, 228, 264, 300, 336].map((x, i) => (
            <BulbG key={x} x={x} y={2 + (i % 2) * 3} color={["#ef4444", "#22c55e", "#fbbf24", "#38bdf8"][i % 4]} delay={`${i * 0.3}s`} />
          ))}
        </>
      );
    case "lunar_new_year":
      return (
        <>
          <circle cx="180" cy="70" r="62" fill="#f59e0b" opacity=".18" />
          <LanternG u={u} x={64} y={0} s={1.5} />
          <LanternG u={u} x={296} y={0} s={1.5} orange />
          <path d="M-10 128C60 100 130 118 190 108S310 100 370 112" fill="none" stroke="#3b2210" strokeWidth="5" strokeLinecap="round" />
          <BlossomG u={u} kind="peach" x={44} y={112} s={1.6} r={10} />
          <BlossomG u={u} kind="apricot" x={118} y={106} s={1.5} r={-20} />
          <BlossomG u={u} kind="peach" x={236} y={108} s={1.7} r={30} />
          <BlossomG u={u} kind="apricot" x={316} y={102} s={1.5} r={8} />
          <BudG u={u} kind="peach" x={160} y={104} s={1.6} r={-30} />
          <CoinKnotG u={u} x={180} y={20} s={1.5} />
          <SparkleG x={120} y={40} s={1} color="#fde047" cls="wh-seasonal-twinkle" />
          <SparkleG x={252} y={48} s={0.8} color="#fde047" cls="wh-seasonal-twinkle" />
        </>
      );
    case "new_year":
      return (
        <>
          <StarburstG x={92} y={52} s={1.7} r={10} />
          <StarburstG x={262} y={44} s={2} r={-6} color="#94a3b8" accent="#d9a032" />
          <StarburstG x={176} y={78} s={1.2} r={20} color="#f472b6" accent="#fde68a" />
          <path d="M0 140V118h24V104h18v14h20V96h22v22h26V110h18v8h24v-20h20v20h30v-12h22v12h26V100h20v18h24v-12h18v12h24v-16h22V140Z" fill="#0b1026" opacity=".9" />
          {[40, 130, 210, 300].map((x, i) => (
            <SparkleG key={x} x={x} y={20 + (i % 2) * 26} s={0.9} color="#fde68a" cls="wh-seasonal-twinkle" />
          ))}
        </>
      );
    case "national_red_gold":
      return (
        <>
          <RaysG x={180} y={64} n={36} r1={30} r2={150} color="#fde047" o={0.5} />
          <FacetStarG u={u} x={180} y={64} R={40} />
          <path d="M0 116C80 96 140 124 200 108S320 104 360 98V140H0Z" fill={`url(#${u}-ribbon)`} stroke="#f5b50a" strokeWidth="2" />
          <FacetStarG u={u} x={50} y={36} R={9} r={-10} />
          <FacetStarG u={u} x={312} y={32} R={9} r={12} />
          <FacetStarG u={u} x={92} y={92} R={6} />
          <FacetStarG u={u} x={270} y={90} R={6} />
        </>
      );
    case "heritage_gold":
      return (
        <>
          <defs>
            <MeanderPattern id={`${u}-thm`} color="#f5c453" />
          </defs>
          <rect y="4" width="360" height="9" fill={`url(#${u}-thm)`} />
          <rect y="127" width="360" height="9" fill={`url(#${u}-thm)`} />
          <circle cx="180" cy="70" r="60" fill="#f5c453" opacity=".14" />
          <DongSonG u={u} x={180} y={70} s={2.1} />
          <DongSonG u={u} x={58} y={72} s={0.9} />
          <DongSonG u={u} x={302} y={72} s={0.9} />
        </>
      );
    case "lotus_gold":
      return (
        <>
          <ellipse cx="180" cy="120" rx="150" ry="12" fill="none" stroke="#fde68a" strokeOpacity=".5" strokeWidth="1" />
          <LotusLeafG u={u} x={80} y={116} s={2.4} r={-6} />
          <LotusLeafG u={u} x={284} y={120} s={2.1} r={8} />
          <LotusG u={u} x={180} y={112} s={3.4} />
          <LotusG u={u} x={118} y={116} s={1.6} r={-8} />
          <LotusG u={u} x={246} y={118} s={1.4} r={10} />
          <SparkleG x={60} y={36} s={1} color="#fde68a" cls="wh-seasonal-twinkle" />
          <SparkleG x={308} y={40} s={0.8} color="#fde68a" cls="wh-seasonal-twinkle" />
        </>
      );
    case "teachers_day":
      return <TeachersThumb u={u} />;
    case "floral_pink":
      return (
        <>
          <path d="M-10 130C70 100 150 120 220 104S330 96 370 108" fill="none" stroke="#2f6b3e" strokeWidth="3" strokeLinecap="round" />
          <RoseG u={u} tint={0} x={180} y={72} s={3} r={-8} />
          <RoseG u={u} tint={1} x={88} y={90} s={2} r={14} />
          <RoseG u={u} tint={2} x={278} y={88} s={2.2} r={-20} />
          <RoseG u={u} tint={1} x={330} y={40} s={1.2} />
          <RoseG u={u} tint={0} x={34} y={38} s={1.1} r={20} />
        </>
      );
    case "mid_autumn":
      return (
        <>
          <MoonG u={u} x={258} y={56} r={34} />
          <CloudG u={u} x={196} y={80} s={2.6} />
          <CloudG u={u} x={300} y={100} s={2.2} />
          <CloudG u={u} x={20} y={104} s={2.4} />
          <StarLanternG u={u} x={64} y={0} s={1.5} />
          <StarLanternG u={u} x={128} y={0} s={1.2} />
          <LanternG u={u} x={176} y={0} s={1.1} orange />
          <RabbitG u={u} x={224} y={112} s={1.6} />
          <SparkleG x={330} y={20} s={0.8} color="#fde68a" cls="wh-seasonal-twinkle" />
        </>
      );
    case "halloween":
      return (
        <>
          <MoonG u={u} x={104} y={50} r={34} violet />
          <BatG x={132} y={42} s={2} r={-10} />
          <BatG x={70} y={30} s={1.3} r={12} />
          <BatG x={316} y={36} s={1.6} r={-6} />
          <g transform="translate(360 0)">
            <CobwebG size={92} />
          </g>
          <DeadBranchG x={360} y={118} s={1.8} />
          <path d="M0 140V122C80 112 160 128 240 118S330 118 360 122V140Z" fill="#2b1245" />
          <PumpkinG u={u} x={190} y={106} s={2.1} />
          <PumpkinG u={u} x={284} y={120} s={1.1} />
        </>
      );
    case "blue_neon":
      return (
        <>
          <g fill="none" stroke="#22d3ee" strokeOpacity=".35" strokeWidth=".6" strokeDasharray="3 4">
            <path d="M0 110H360M0 50H360M60 0V140M300 0V140" />
          </g>
          <PrismG u={u} x={180} y={70} s={2.6} />
          <PrismG u={u} x={70} y={96} s={1.1} compass={false} />
          <PrismG u={u} x={296} y={44} s={0.9} compass={false} />
          <PrismG u={u} x={110} y={30} s={0.6} compass={false} />
        </>
      );
    case "memorial_candle":
      return (
        <>
          <CandleG u={u} x={180} y={106} s={2.4} />
          <rect y="124" width="360" height="1" fill="#d97706" opacity=".5" />
        </>
      );
    case "valentine":
      return (
        <>
          <HeartG u={u} x={180} y={70} s={5.2} r={-6} />
          <HeartG u={u} x={80} y={86} s={2.4} r={12} />
          <HeartG u={u} x={290} y={48} s={2.2} r={-14} />
          <HeartG u={u} x={44} y={34} s={1.2} r={-8} />
          <HeartG u={u} x={326} y={104} s={1.4} r={10} />
          <RoseG u={u} tint={1} x={248} y={110} s={1.6} />
          <SparkleG x={130} y={24} s={1} color="#fda4af" cls="wh-seasonal-twinkle" />
          <SparkleG x={226} y={22} s={0.8} color="#fda4af" cls="wh-seasonal-twinkle" />
        </>
      );
    case "spring_green":
      return (
        <>
          <path d="M0 140V112C40 100 70 116 110 108S190 98 240 110S330 100 360 108V140Z" fill="#22c55e" stroke="#bbf7d0" strokeOpacity=".5" strokeWidth="1" />
          <CloverG u={u} x={180} y={64} s={4.4} r={8} />
          <CloverG u={u} x={80} y={84} s={2.2} r={-14} />
          <CloverG u={u} x={284} y={76} s={2.6} r={20} />
          <CloverG u={u} x={330} y={30} s={1.2} stem={false} />
          <CloverG u={u} x={34} y={34} s={1.3} stem={false} r={20} />
        </>
      );
    case "easter":
      return (
        <>
          <path d="M0 140V108C20 96 30 110 48 100C64 112 84 100 104 112C122 100 144 110 166 102C190 112 212 100 236 110C258 98 284 110 308 102C330 110 346 100 360 108V140Z" fill="#4ade80" stroke="#15803d" strokeOpacity=".5" strokeWidth="1" />
          <EggG tone={0} x={74} y={96} s={2.4} r={-8} />
          <EggG tone={2} x={140} y={108} s={1.8} r={10} />
          <EggG tone={1} x={196} y={90} s={3} r={-4} />
          <EggG tone={3} x={262} y={106} s={2.1} r={14} />
          <EggG tone={0} x={316} y={96} s={1.5} r={-10} />
          <DaisyG x={30} y={78} s={1.6} />
          <DaisyG x={106} y={72} s={1.2} r={20} />
          <DaisyG x={336} y={64} s={1.5} r={-10} />
          <SparkleG x={160} y={30} s={1} color="#fff" cls="wh-seasonal-twinkle" />
        </>
      );
    case "kids_party":
      return (
        <>
          <path d="M-5 10C80 40 150 4 230 30S330 14 365 24" fill="none" stroke="#475569" strokeWidth="1.5" />
          {Array.from({ length: 12 }).map((_, i) => {
            const x = 14 + i * 30;
            const y = 12 + Math.sin(i * 0.9) * 8 + 8;
            return <polygon key={i} points={`${x - 9},${y} ${x + 9},${y} ${x},${y + 18}`} fill={["#ef4444", "#f59e0b", "#22c55e", "#a855f7", "#ec4899", "#fff"][i % 6]} stroke="#000" strokeOpacity=".15" />;
          })}
          <BalloonG color="#ef4444" x={80} y={84} s={2.3} r={-10} string={30} />
          <BalloonG color="#facc15" x={140} y={76} s={2.6} r={4} string={32} />
          <BalloonG color="#38bdf8" x={206} y={84} s={2.4} r={10} string={28} />
          <BalloonG color="#22c55e" x={262} y={78} s={2.2} r={-6} string={32} />
          <BalloonG color="#ec4899" x={316} y={92} s={1.8} r={14} string={22} />
          <BalloonG color="#a855f7" x={36} y={92} s={1.8} r={-14} string={22} />
        </>
      );
    case "autumn_harvest":
      return (
        <>
          <path d="M0 140V112C60 100 120 118 190 108S320 104 360 112V140Z" fill="#7c2d12" opacity=".8" />
          <WheatG x={246} y={132} s={2.4} r={-8} />
          <WheatG x={276} y={136} s={2.2} r={8} />
          <WheatG x={218} y={136} s={2} r={-20} />
          <MapleLeafG x={110} y={74} s={4} r={-20} fill="#dc3c14" />
          <MapleLeafG x={176} y={104} s={2.4} r={30} fill="#f59e0b" />
          <MapleLeafG x={52} y={104} s={2.2} r={50} fill="#c2410c" />
          <MapleLeafG x={320} y={46} s={2} r={-40} fill="#e8a317" />
          <MapleLeafG x={44} y={36} s={1.6} r={20} fill="#dc3c14" />
        </>
      );
    default:
      return (
        <>
          <circle cx="180" cy="70" r="46" fill="none" stroke="#e0f2fe" strokeOpacity=".5" strokeDasharray="4 4" />
          <SparkleG x={180} y={70} s={3} color="#e0f2fe" cls="wh-seasonal-twinkle" />
        </>
      );
  }
}

export function ThumbScene({ preset }: { preset: SeasonalEffectPresetId }) {
  const u = useSeasonalUid();
  const [a, b, c] = BG[preset] ?? ["#0c4a6e", "#0284c7", "#0891b2"];
  return (
    <svg
      viewBox="0 0 360 140"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <MotifDefs u={u} />
      <defs>
        <linearGradient id={`${u}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="0.55" stopColor={b} />
          <stop offset="1" stopColor={c} />
        </linearGradient>
      </defs>
      <rect width="360" height="140" fill={`url(#${u}-bg)`} />
      <Scene preset={preset} u={u} />
    </svg>
  );
}
