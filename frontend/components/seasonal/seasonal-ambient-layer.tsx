"use client";

import type { CSSProperties, ReactNode } from "react";

import {
  BatShape,
  ConfettiShape,
  FloatingLanternShape,
  HeartShape,
  LeafShape,
  MapleShape,
  MoteShape,
  PetalShape,
  PointedPetalShape,
  SmallStarShape,
  SnowflakeShape,
  SparkleShape,
} from "@/components/seasonal/seasonal-motifs";
import { useThemeSettings } from "@/components/theme-color-provider";
import { cn } from "@/lib/utils";
import type { SeasonalEffectPresetId } from "@/types/api";

type Motion = "fall" | "rise" | "float";
type Depth = 0 | 1 | 2; // 0 = near, 1 = mid, 2 = far

interface ParticleSpec {
  left: number; // %
  top: number; // % (float only)
  depth: Depth;
  variant: number;
  duration: number;
  delay: number;
  drift: number;
  wobble: number;
  wobbleDur: number;
  spin: number;
  bat?: boolean;
}

/** Small deterministic PRNG so SSR and client render identical particles. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * ~85% of particles live in the outer 18% of each side, ~15% in a faint
 * transition band; the centre reading column (30–70%) stays empty.
 */
function makeParticles(seed: number, count: number, slow = 1): ParticleSpec[] {
  const rnd = mulberry32(seed);
  const out: ParticleSpec[] = [];
  for (let i = 0; i < count; i++) {
    const depth: Depth = rnd() < 0.22 ? 0 : rnd() < 0.5 ? 1 : 2;
    const edge = rnd() < 0.85;
    const side = rnd() < 0.5 ? 0 : 1;
    const left = edge
      ? side === 0
        ? 0.5 + rnd() * 17
        : 82.5 + rnd() * 17
      : side === 0
        ? 18 + rnd() * 11
        : 71 + rnd() * 11;
    const base = depth === 0 ? 12 : depth === 1 ? 19 : 27;
    out.push({
      left,
      top: 6 + rnd() * 88,
      depth,
      variant: Math.floor(rnd() * 3),
      duration: (base + rnd() * 6) * slow,
      delay: -rnd() * 30,
      drift: (rnd() - 0.5) * (depth === 0 ? 60 : 36),
      wobble: 8 + rnd() * (depth === 0 ? 22 : 12),
      wobbleDur: 2.6 + rnd() * 2.6,
      spin: (rnd() - 0.5) * 240,
    });
  }
  return out;
}

const SIZE_BY_DEPTH = [1, 0.68, 0.44] as const;
const OPACITY_BY_DEPTH = [0.95, 0.72, 0.46] as const;

function sized(base: number, depth: Depth) {
  return Math.round(base * SIZE_BY_DEPTH[depth] * 10) / 10;
}

interface PresetConfig {
  motion: Motion;
  particles: ParticleSpec[];
  tumble?: boolean;
  render: (p: ParticleSpec) => ReactNode;
}

const PETAL_PALETTE = {
  peach: ["#f472a0", "#be185d"],
  apricot: ["#fbbf24", "#c2570c"],
  rose: ["#f0486a", "#9f1239"],
  blush: ["#f7a8c4", "#c2547a"],
  coral: ["#fb8672", "#c2410c"],
  lotus: ["#f6a8cc", "#c2417f"],
} as const;

const CONFIG: Partial<Record<SeasonalEffectPresetId, PresetConfig>> = {
  christmas: {
    motion: "fall",
    particles: makeParticles(11, 24),
    render: (p) =>
      p.depth === 2 ? (
        <MoteShape size={sized(9, 2)} color="#8cc8f5" />
      ) : (
        <SnowflakeShape size={sized(26, p.depth)} />
      ),
  },
  lunar_new_year: {
    motion: "fall",
    tumble: true,
    particles: makeParticles(23, 24),
    render: (p) => {
      if (p.variant === 2 && p.depth !== 0)
        return <MoteShape size={sized(7, p.depth)} color="#f0b429" />;
      const [fill, edge] =
        p.variant === 1 ? PETAL_PALETTE.apricot : PETAL_PALETTE.peach;
      return <PetalShape fill={fill} edge={edge} size={sized(20, p.depth)} />;
    },
  },
  new_year: {
    motion: "fall",
    tumble: true,
    particles: makeParticles(37, 22, 1.15),
    render: (p) => {
      const colors = ["#e0b04a", "#a9b4c2", "#e0a090"];
      if (p.depth === 2)
        return <SparkleShape size={sized(16, 2)} color="#d9a032" />;
      return <ConfettiShape size={sized(14, p.depth)} color={colors[p.variant]} />;
    },
  },
  national_red_gold: {
    motion: "rise",
    particles: makeParticles(41, 22),
    render: (p) => {
      if (p.depth === 0)
        return <SmallStarShape size={sized(20, 0)} fill={p.variant === 2 ? "#ef4444" : "#f5b50a"} />;
      if (p.depth === 1)
        return <SmallStarShape size={sized(16, 1)} fill="#f5b50a" />;
      return <MoteShape size={sized(7, 2)} color="#f0b429" />;
    },
  },
  heritage_gold: {
    motion: "float",
    particles: makeParticles(53, 18, 1.4),
    render: (p) => (
      <MoteShape
        size={sized(11, p.depth)}
        color={p.variant === 1 ? "#c2823a" : "#d98a1e"}
      />
    ),
  },
  lotus_gold: {
    motion: "fall",
    tumble: true,
    particles: makeParticles(61, 16, 1.25),
    render: (p) =>
      p.variant === 2 ? (
        <MoteShape size={sized(7, p.depth)} color="#f0b429" />
      ) : (
        <PointedPetalShape
          fill={PETAL_PALETTE.lotus[0]}
          edge={PETAL_PALETTE.lotus[1]}
          size={sized(22, p.depth)}
        />
      ),
  },
  teachers_day: {
    motion: "float",
    particles: makeParticles(211, 16, 0.7),
    render: (p) =>
      p.variant === 1 ? (
        <SparkleShape size={sized(13, p.depth)} color="#c9993a" />
      ) : p.variant === 2 ? (
        <LeafShape size={sized(15, p.depth)} fill="#5fa886" />
      ) : (
        <MoteShape size={sized(6, p.depth)} color="#e8c46a" />
      ),
  },
  floral_pink: {
    motion: "fall",
    tumble: true,
    particles: makeParticles(71, 24),
    render: (p) => {
      const key = (["rose", "blush", "coral"] as const)[p.variant];
      return (
        <PetalShape
          fill={PETAL_PALETTE[key][0]}
          edge={PETAL_PALETTE[key][1]}
          size={sized(21, p.depth)}
        />
      );
    },
  },
  mid_autumn: {
    motion: "float",
    particles: makeParticles(83, 18, 0.6),
    render: (p) =>
      p.depth === 0 && p.variant === 0 ? (
        <FloatingLanternShape size={sized(22, 0)} />
      ) : (
        <MoteShape size={sized(8, p.depth)} color="#f5c518" />
      ),
  },
  halloween: {
    motion: "float",
    particles: [
      ...makeParticles(97, 16, 0.6),
      { left: 4, top: 22, depth: 0, variant: 0, duration: 9, delay: -2, drift: 40, wobble: 0, wobbleDur: 3, spin: 0, bat: true },
      { left: 90, top: 64, depth: 1, variant: 0, duration: 11, delay: -6, drift: -46, wobble: 0, wobbleDur: 3, spin: 0, bat: true },
    ],
    render: (p) =>
      p.bat ? (
        <BatShape size={sized(34, p.depth)} />
      ) : (
        <MoteShape size={sized(8, p.depth)} color={p.variant === 1 ? "#f97316" : "#a855f7"} />
      ),
  },
  valentine: {
    motion: "fall",
    tumble: true,
    particles: makeParticles(113, 20, 1.2),
    render: (p) =>
      p.variant === 2 ? (
        <PetalShape fill={PETAL_PALETTE.rose[0]} edge={PETAL_PALETTE.rose[1]} size={sized(18, p.depth)} />
      ) : (
        <HeartShape size={sized(20, p.depth)} fill={p.variant === 1 ? "#fb7185" : "#e11d48"} />
      ),
  },
  spring_green: {
    motion: "fall",
    tumble: true,
    particles: makeParticles(127, 22, 1.1),
    render: (p) => (
      <LeafShape size={sized(20, p.depth)} fill={["#4ade80", "#22c55e", "#86efac"][p.variant]} />
    ),
  },
  easter: {
    motion: "fall",
    tumble: true,
    particles: makeParticles(131, 20, 1.2),
    render: (p) => {
      const pal = [
        ["#c4a5fa", "#6d28d9"],
        ["#6ee7b7", "#0f766e"],
        ["#f9a8d4", "#be185d"],
      ][p.variant];
      return <PetalShape fill={pal[0]} edge={pal[1]} size={sized(20, p.depth)} />;
    },
  },
  kids_party: {
    motion: "fall",
    tumble: true,
    particles: makeParticles(137, 26, 0.95),
    render: (p) => {
      const colors = ["#ef4444", "#facc15", "#38bdf8", "#22c55e", "#ec4899", "#a855f7"];
      return <ConfettiShape size={sized(15, p.depth)} color={colors[(p.variant + p.depth * 2) % colors.length]} />;
    },
  },
  autumn_harvest: {
    motion: "fall",
    tumble: true,
    particles: makeParticles(149, 22, 1.2),
    render: (p) => (
      <MapleShape size={sized(24, p.depth)} fill={["#dc3c14", "#f59e0b", "#c2410c"][p.variant]} />
    ),
  },
  blue_neon: {
    motion: "float",
    particles: makeParticles(101, 20, 0.7),
    render: (p) => (
      <MoteShape
        size={sized(p.variant === 2 ? 20 : 10, p.depth)}
        color={p.variant === 1 ? "#22d3ee" : "#0ea5e9"}
        ring={p.variant === 2}
      />
    ),
  },
};

const MOTION_CLASS: Record<Motion, string> = {
  fall: "wh-seasonal-fall absolute top-0",
  rise: "wh-seasonal-rise absolute bottom-0",
  float: "wh-seasonal-float absolute",
};

/**
 * Full-viewport ambient seasonal particle layer.
 * - Strictly pointer-events-none and z-20 (below TopBar z-[41] and modals z-50).
 * - Particles keep to the left/right margins; the reading column stays clear.
 * - Hidden for `memorial_candle` (solemn) and under prefers-reduced-motion.
 *
 * `preset` overrides the workspace's active pack; `contained` keeps the layer
 * inside its nearest positioned ancestor (the settings preview) instead of the
 * viewport. Set `--wh-fall-span` on that ancestor to its height so particles
 * cross it fully.
 */
export function SeasonalAmbientLayer({
  preset: presetOverride,
  contained = false,
  className,
}: {
  preset?: SeasonalEffectPresetId;
  contained?: boolean;
  /** Extra classes, e.g. a different stacking order on the sign-in page. */
  className?: string;
} = {}) {
  const { effectiveSeasonalPreset } = useThemeSettings();
  const preset = presetOverride ?? effectiveSeasonalPreset;
  if (!preset || preset === "none" || preset === "memorial_candle") return null;

  const cfg = CONFIG[preset];
  if (!cfg) return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none inset-0 overflow-hidden select-none",
        contained ? "absolute" : "fixed z-20",
        className,
      )}
    >
      {cfg.particles.map((p, idx) => (
        <span
          key={idx}
          className={MOTION_CLASS[cfg.motion]}
          style={
            {
              left: `${p.left}%`,
              top: cfg.motion === "float" ? `${p.top}%` : undefined,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              "--wh-drift-x": `${p.drift}px`,
              "--wh-spin": `${p.spin}deg`,
              "--wh-particle-opacity": String(OPACITY_BY_DEPTH[p.depth]),
            } as CSSProperties
          }
        >
          <span
            className={cfg.motion === "float" ? "block" : "wh-seasonal-wobble block"}
            style={
              {
                animationDuration: `${p.wobbleDur}s`,
                "--wh-wobble": `${p.wobble}px`,
                filter: p.depth === 2 ? "blur(0.7px)" : undefined,
              } as CSSProperties
            }
          >
            <span
              className={cfg.tumble ? "wh-seasonal-tumble block" : "block"}
              style={{ animationDuration: `${3.2 + (p.variant + p.depth) * 1.1}s` }}
            >
              {cfg.render(p)}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}
