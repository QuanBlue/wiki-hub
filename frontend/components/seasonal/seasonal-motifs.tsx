"use client";

/**
 * Hand-built vector motifs shared by the seasonal TopBar, Sidebar, ambient
 * layer and holiday thumbnails. Everything is inline SVG (no network assets).
 *
 * Every `*G` component returns a `<g>` positioned by its props and must be
 * rendered inside an <svg> that also contains <MotifDefs u={u} />, where `u`
 * comes from `useSeasonalUid()`. Colours are saturated enough to read on both
 * the white light-mode canvas and the dark-mode canvas.
 */

import { useId } from "react";

export function useSeasonalUid(): string {
  return useId().replace(/[^a-zA-Z0-9]/g, "");
}

interface PlaceProps {
  x?: number;
  y?: number;
  s?: number;
  r?: number;
  u: string;
  o?: number;
  cls?: string;
}

function place({ x = 0, y = 0, s = 1, r = 0 }: Pick<PlaceProps, "x" | "y" | "s" | "r">) {
  return `translate(${x} ${y}) rotate(${r}) scale(${s})`;
}

const ROSE_TINTS: Array<[string, string, string]> = [
  ["#9f1239", "#e11d48", "#fb7185"], // rose
  ["#c2547a", "#ec8aab", "#fde2ec"], // blush
  ["#c2410c", "#f2674f", "#fdbaa6"], // coral
];

/** All gradients used by the motifs. Cheap; one copy per root <svg>. */
export function MotifDefs({ u }: { u: string }) {
  const rad = (
    id: string,
    stops: Array<[number, string, number?]>,
    r = 12,
  ) => (
    <radialGradient
      key={id}
      id={`${u}-${id}`}
      gradientUnits="userSpaceOnUse"
      cx="0"
      cy="0"
      r={r}
    >
      {stops.map(([o, c, op], i) => (
        <stop key={i} offset={o} stopColor={c} stopOpacity={op ?? 1} />
      ))}
    </radialGradient>
  );
  const lin = (
    id: string,
    stops: Array<[number, string, number?]>,
    v = false,
  ) => (
    <linearGradient
      key={id}
      id={`${u}-${id}`}
      x1={v ? 0 : 0}
      y1={v ? 1 : 0}
      x2={v ? 0 : 1}
      y2={v ? 0 : 0}
    >
      {stops.map(([o, c, op], i) => (
        <stop key={i} offset={o} stopColor={c} stopOpacity={op ?? 1} />
      ))}
    </linearGradient>
  );
  return (
    <defs>
      {rad("peach", [[0, "#9d174d"], [0.28, "#f0447f"], [1, "#fdb3cb"]], 10)}
      {rad("apricot", [[0, "#ea8a06"], [0.35, "#fbbf24"], [1, "#fde047"]], 10)}
      {ROSE_TINTS.map((t, i) =>
        rad(`rose${i}`, [[0, t[0]], [0.55, t[1]], [1, t[2]]], 13),
      )}
      {lin("lotus", [[0, "#d9468f"], [0.6, "#f8a8cc"], [1, "#fff1f7"]], true)}
      {lin("lotusBronze", [[0, "#8a5a1c"], [0.55, "#d9a43c"], [1, "#fde7a3"]], true)}
      {lin("leaf", [[0, "#14532d"], [1, "#4ade80"]], true)}
      {lin("holly", [[0, "#14532d"], [0.6, "#15803d"], [1, "#4ade80"]])}
      {lin("gold", [[0, "#fff3b0"], [0.45, "#f5b50a"], [1, "#a8570a"]])}
      {lin("bronze", [[0, "#fcd9a0"], [0.5, "#c2823a"], [1, "#6b3f17"]])}
      {lin("silk", [[0, "#7f1d1d"], [0.34, "#dc2626"], [0.52, "#ff5a4f"], [0.7, "#dc2626"], [1, "#7f1d1d"]])}
      {lin("silkOr", [[0, "#9a3412"], [0.34, "#f08a1c"], [0.52, "#fcd34d"], [0.7, "#f08a1c"], [1, "#9a3412"]])}
      {lin("ribbon", [[0, "#991b1b"], [0.5, "#ef3b2d"], [1, "#991b1b"]], true)}
      {rad("heart", [[0, "#ff8aa0"], [0.55, "#e11d48"], [1, "#9f1239"]], 11)}
      {lin("jade", [[0, "#e2e8f0"], [1, "#ffffff"]], true)}
      {lin("cloud", [[0, "#fff8e6"], [1, "#fde6b0"]], true)}
      {lin("wax", [[0, "#fde3c4"], [0.4, "#fffaf2"], [1, "#f5d3a8"]])}
      {lin("ice", [[0, "#bae6fd"], [1, "#f0f9ff"]], true)}
      {lin("prismTop", [[0, "#a5f3fc"], [1, "#22d3ee"]])}
      {lin("prismLeft", [[0, "#075985"], [1, "#0284c7"]], true)}
      {lin("prismRight", [[0, "#0ea5e9"], [1, "#38bdf8"]], true)}
      {rad("pumpkin", [[0, "#fdba74"], [0.55, "#ea6a0c"], [1, "#9a3412"]], 14)}
      {rad("moon", [[0, "#fffbe0"], [0.7, "#fde68a"], [1, "#f4b73a"]], 14)}
      {rad("moonViolet", [[0, "#fff1d6"], [0.6, "#fdba74"], [1, "#c2410c"]], 14)}
      {rad("flame", [[0, "#ffffff"], [0.35, "#fde047"], [1, "#f97316"]], 8)}
      {rad("glowWarm", [[0, "#fbbf24", 0.55], [1, "#f59e0b", 0]], 30)}
      {rad("glowRed", [[0, "#ef4444", 0.4], [1, "#ef4444", 0]], 26)}
      {rad("glowCyan", [[0, "#22d3ee", 0.45], [1, "#22d3ee", 0]], 20)}
      {rad("glowViolet", [[0, "#a855f7", 0.4], [1, "#a855f7", 0]], 26)}
    </defs>
  );
}

/* ----------------------------------------------------------------------- */
/* Blossoms                                                                 */
/* ----------------------------------------------------------------------- */

const PEACH_PETAL =
  "M0 0C-4.6-2.6-6.4-8-3-9.6C-1.6-10.2-.5-9.4 0-8.4C.5-9.4 1.6-10.2 3-9.6C6.4-8 4.6-2.6 0 0Z";
const APRICOT_PETAL =
  "M0 0C-5.4-1.6-7.4-8-1.8-9.6C-.8-9.9 .8-9.9 1.8-9.6C7.4-8 5.4-1.6 0 0Z";

/** Five-petal đào (peach) or mai (apricot) blossom with a gold stamen crown. */
export function BlossomG({
  u,
  kind,
  ...p
}: PlaceProps & { kind: "peach" | "apricot" }) {
  const peach = kind === "peach";
  return (
    <g transform={place(p)} opacity={p.o}>
      {[0, 72, 144, 216, 288].map((a) => (
        <path
          key={a}
          transform={`rotate(${a})`}
          d={peach ? PEACH_PETAL : APRICOT_PETAL}
          fill={`url(#${u}-${peach ? "peach" : "apricot"})`}
          stroke={peach ? "#be185d" : "#c2570c"}
          strokeOpacity=".5"
          strokeWidth=".55"
          strokeLinejoin="round"
        />
      ))}
      <circle r="2.1" fill={peach ? "#9d174d" : "#c2410c"} opacity=".5" />
      {[0, 40, 80, 120, 160, 200, 240, 280, 320].map((a, i) => {
        const len = 3.1 + (i % 3) * 0.55;
        const rad = (a * Math.PI) / 180;
        const ex = Math.sin(rad) * len;
        const ey = -Math.cos(rad) * len;
        return (
          <g key={a}>
            <line
              x1="0"
              y1="0"
              x2={ex}
              y2={ey}
              stroke={peach ? "#be185d" : "#b45309"}
              strokeWidth=".35"
            />
            <circle cx={ex} cy={ey} r=".62" fill="#fde047" stroke="#b45309" strokeWidth=".25" />
          </g>
        );
      })}
    </g>
  );
}

/** Closed bud on a short stalk. */
export function BudG({ u, kind, ...p }: PlaceProps & { kind: "peach" | "apricot" }) {
  void u;
  const peach = kind === "peach";
  return (
    <g transform={place(p)} opacity={p.o}>
      <path
        d="M0 0C-3.2-1.6-3.6-6.4 0-8.4C3.6-6.4 3.2-1.6 0 0Z"
        fill={peach ? "#ee4a86" : "#f7b81c"}
        stroke={peach ? "#9d174d" : "#b45309"}
        strokeOpacity=".5"
        strokeWidth=".5"
      />
      <path d="M0 0C-1.4-2.4-1.2-5 0-6.8" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth=".5" />
      <path d="M-1.6 .4Q0 1.8 1.6 .4" fill="#7c3a1d" stroke="#7c3a1d" strokeWidth=".6" />
    </g>
  );
}

/** Layered rose (spiral heart, two outer rings of petals). tint 0 rose · 1 blush · 2 coral */
export function RoseG({ u, tint = 0, ...p }: PlaceProps & { tint?: 0 | 1 | 2 }) {
  const edge = ROSE_TINTS[tint][0];
  const fill = `url(#${u}-rose${tint})`;
  return (
    <g transform={place(p)} opacity={p.o}>
      {[0, 72, 144, 216, 288].map((a) => (
        <path
          key={`o${a}`}
          transform={`rotate(${a})`}
          d="M0 0C-9-3-11-11-3-12.5C3-13.5 10-9 8-2Z"
          fill={fill}
          stroke={edge}
          strokeOpacity=".55"
          strokeWidth=".55"
        />
      ))}
      {[36, 108, 180, 252, 324].map((a) => (
        <path
          key={`m${a}`}
          transform={`rotate(${a}) scale(.74)`}
          d="M0 0C-9-3-11-11-3-12.5C3-13.5 10-9 8-2Z"
          fill={fill}
          stroke={edge}
          strokeOpacity=".6"
          strokeWidth=".7"
        />
      ))}
      {[10, 100, 190, 280].map((a) => (
        <path
          key={`i${a}`}
          transform={`rotate(${a}) scale(.46)`}
          d="M0 0C-9-3-11-11-3-12.5C3-13.5 10-9 8-2Z"
          fill={fill}
          stroke={edge}
          strokeOpacity=".7"
          strokeWidth="1"
        />
      ))}
      <path
        d="M0 0m-1.5 0a1.5 1.5 0 1 1 1.5 1.5a2.5 2.5 0 0 1-2.5-2.5a3.5 3.5 0 0 1 3.5-3.5"
        fill="none"
        stroke={edge}
        strokeOpacity=".75"
        strokeWidth=".6"
        strokeLinecap="round"
      />
      <path
        d="M-6.5-8.5C-3-11.5 2-11.5 5-9"
        fill="none"
        stroke="#fff"
        strokeOpacity=".4"
        strokeWidth=".7"
        strokeLinecap="round"
      />
    </g>
  );
}

/** Pointed-petal lotus: three rows, gold seed-pod and stamens. */
export function LotusG({
  u,
  bronze = false,
  ...p
}: PlaceProps & { bronze?: boolean }) {
  const petal = "M0 0C-6.5-2.5-7.5-10 0-17C7.5-10 6.5-2.5 0 0Z";
  const fill = `url(#${u}-${bronze ? "lotusBronze" : "lotus"})`;
  const edge = bronze ? "#6b3f17" : "#be3a7e";
  const row = (angles: number[], sc: number, key: string) =>
    angles.map((a) => (
      <g key={`${key}${a}`} transform={`rotate(${a}) scale(${sc})`}>
        <path d={petal} fill={fill} stroke={edge} strokeOpacity=".55" strokeWidth=".6" strokeLinejoin="round" />
        <path d="M0-2.5Q.6-9 0-14" fill="none" stroke={bronze ? "#fff4cf" : "#fff"} strokeOpacity=".55" strokeWidth=".5" />
      </g>
    ));
  return (
    <g transform={place(p)} opacity={p.o}>
      {row([-74, 74], 0.82, "b")}
      {row([-52, 52], 0.95, "c")}
      {row([-30, 30], 1, "d")}
      {row([-12, 12], 0.84, "e")}
      {row([0], 0.96, "f")}
      <ellipse cx="0" cy="-2.6" rx="3.4" ry="1.7" fill="#f2b81d" stroke="#a8570a" strokeWidth=".4" />
      {[-2, -0.7, 0.7, 2].map((dx) => (
        <circle key={dx} cx={dx} cy="-2.9" r=".42" fill="#7c4a0a" />
      ))}
    </g>
  );
}

export function LotusLeafG({ u, ...p }: PlaceProps) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <ellipse cx="0" cy="0" rx="17" ry="5.4" fill={`url(#${u}-leaf)`} stroke="#14532d" strokeOpacity=".55" strokeWidth=".6" />
      {[-70, -45, -20, 0, 20, 45, 70].map((a) => (
        <line
          key={a}
          x1="0"
          y1="0"
          x2={Math.sin((a * Math.PI) / 180) * 15.5}
          y2={-Math.cos((a * Math.PI) / 180) * 4.6}
          stroke="#bbf7d0"
          strokeOpacity=".5"
          strokeWidth=".45"
        />
      ))}
      <ellipse cx="0" cy="0" rx="1.4" ry=".7" fill="#bbf7d0" opacity=".7" />
    </g>
  );
}

/* ----------------------------------------------------------------------- */
/* Lanterns, stars, coins                                                   */
/* ----------------------------------------------------------------------- */

/** Silk lantern with gold caps and tassel, anchored at its hanging cord. */
export function LanternG({
  u,
  orange = false,
  glow = true,
  ...p
}: PlaceProps & { orange?: boolean; glow?: boolean }) {
  const silk = `url(#${u}-${orange ? "silkOr" : "silk"})`;
  return (
    <g transform={place(p)} opacity={p.o}>
      {glow ? (
        <circle cx="0" cy="19" r="26" fill={`url(#${u}-${orange ? "glowWarm" : "glowRed"})`} className="wh-seasonal-twinkle" />
      ) : null}
      <line x1="0" y1="-14" x2="0" y2="2" stroke="#d99a0b" strokeWidth="1" />
      <rect x="-5" y="1.5" width="10" height="3.2" rx="1.2" fill={`url(#${u}-gold)`} stroke="#a8570a" strokeWidth=".3" />
      <path d="M-5 4.7C-17 8-17 28-5 32L5 32C17 28 17 8 5 4.7Z" fill={silk} stroke="#e0a90f" strokeWidth=".7" />
      <path d="M-2.6 4.8C-9.5 11-9.5 26-2.6 32M2.6 4.8C9.5 11 9.5 26 2.6 32M0 4.8V32" fill="none" stroke="#fde68a" strokeOpacity=".5" strokeWidth=".55" />
      <circle cx="0" cy="18.5" r="3.4" fill="none" stroke="#fde047" strokeWidth=".8" />
      <rect x="-1.2" y="17.3" width="2.4" height="2.4" fill="none" stroke="#fde047" strokeWidth=".6" />
      <rect x="-5.5" y="31.6" width="11" height="3.2" rx="1.2" fill={`url(#${u}-gold)`} stroke="#a8570a" strokeWidth=".3" />
      <line x1="0" y1="34.8" x2="0" y2="38.5" stroke="#d99a0b" strokeWidth=".8" />
      <ellipse cx="0" cy="39.8" rx="1.9" ry="1.5" fill={`url(#${u}-gold)`} />
      {[-4.5, -2.2, 0, 2.2, 4.5].map((dx, i) => (
        <path
          key={dx}
          d={`M0 41.2Q${dx * 0.3} ${46 + (i % 2)} ${dx} ${52 - (i % 2) * 2}`}
          fill="none"
          stroke={i % 2 ? "#fbbf24" : "#ef4444"}
          strokeWidth=".8"
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

/** Five-point paper star lantern (Trung Thu đèn ông sao). */
export function StarLanternG({ u, ...p }: PlaceProps) {
  const cx = 0;
  const cy = 15;
  const R = 15;
  const ri = 6.6;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const rr = i % 2 === 0 ? R : ri;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const arms = [0, 1, 2, 3, 4].map((k) => {
    const tip = pts[k * 2];
    const left = pts[(k * 2 + 9) % 10];
    const right = pts[(k * 2 + 1) % 10];
    return { tip, left, right, gold: k % 2 === 1 };
  });
  return (
    <g transform={place(p)} opacity={p.o}>
      <circle cx="0" cy="15" r="26" fill={`url(#${u}-glowWarm)`} className="wh-seasonal-twinkle" />
      <line x1="0" y1="-14" x2="0" y2={cy - R} stroke="#d99a0b" strokeWidth="1" />
      {arms.map((a, i) => (
        <g key={i}>
          <polygon
            points={`${a.tip.join(",")} ${a.left.join(",")} ${cx},${cy}`}
            fill={a.gold ? "#fbbf24" : "#ef4444"}
          />
          <polygon
            points={`${a.tip.join(",")} ${a.right.join(",")} ${cx},${cy}`}
            fill={a.gold ? "#d9890b" : "#b91c1c"}
          />
        </g>
      ))}
      <polygon points={pts.map((q) => q.join(",")).join(" ")} fill="none" stroke="#fde68a" strokeWidth=".6" strokeLinejoin="round" />
      <circle cx={cx} cy={cy} r="4" fill="#fff7c2" opacity=".92" />
      <circle cx={cx} cy={cy} r="2" fill="#fff" />
      <line x1="0" y1={cy + ri} x2="0" y2={cy + ri + 5} stroke="#d99a0b" strokeWidth=".8" />
      {[-4, -1.6, 1.6, 4].map((dx, i) => (
        <path key={dx} d={`M0 ${cy + ri + 5}Q${dx * 0.4} ${cy + ri + 10} ${dx} ${cy + ri + 14 - (i % 2) * 2}`} fill="none" stroke={i % 2 ? "#fbbf24" : "#ef4444"} strokeWidth=".8" strokeLinecap="round" />
      ))}
    </g>
  );
}

/** Old coin knot: coin on a red cord with tassel. */
export function CoinKnotG({ u, ...p }: PlaceProps) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <line x1="0" y1="-10" x2="0" y2="0" stroke="#dc2626" strokeWidth="1" />
      <circle cx="0" cy="8" r="8" fill={`url(#${u}-gold)`} stroke="#a8570a" strokeWidth=".6" />
      <circle cx="0" cy="8" r="6.2" fill="none" stroke="#a8570a" strokeOpacity=".5" strokeWidth=".5" />
      <rect x="-2.4" y="5.6" width="4.8" height="4.8" fill="#7f1d1d" opacity=".85" />
      <path d="M0 16c-2 2-3 3-1 5s2 3 0 5c2-2 3-3 1-5s-2-3 0-5Z" fill="#dc2626" />
      {[-3, 0, 3].map((dx) => (
        <path key={dx} d={`M${dx * 0.3} 25Q${dx} 30 ${dx * 1.3} 34`} fill="none" stroke="#dc2626" strokeWidth=".9" strokeLinecap="round" />
      ))}
    </g>
  );
}

/** Faceted five-point star (light/dark bevel per facet). */
export function FacetStarG({ u, R = 14, ...p }: PlaceProps & { R?: number }) {
  const ri = R * 0.382;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const rr = i % 2 === 0 ? R : ri;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return (
    <g transform={place(p)} opacity={p.o}>
      <polygon points={pts.map((q) => q.join(",")).join(" ")} fill={`url(#${u}-gold)`} stroke="#8a4a08" strokeWidth={R * 0.04} strokeLinejoin="round" />
      {[0, 1, 2, 3, 4].map((k) => {
        const tip = pts[k * 2];
        const left = pts[(k * 2 + 9) % 10];
        const right = pts[(k * 2 + 1) % 10];
        return (
          <g key={k}>
            <polygon points={`${tip.join(",")} ${left.join(",")} 0,0`} fill="#fff2a8" opacity=".85" />
            <polygon points={`${tip.join(",")} ${right.join(",")} 0,0`} fill="#c98306" opacity=".7" />
          </g>
        );
      })}
    </g>
  );
}

/** Fine radiating rays behind a star / sun. */
export function RaysG({
  n = 24,
  r1 = 16,
  r2 = 40,
  color = "#f5b50a",
  ...p
}: Omit<PlaceProps, "u"> & { n?: number; r1?: number; r2?: number; color?: string }) {
  return (
    <g transform={place(p)} opacity={p.o} stroke={color} strokeLinecap="round">
      {Array.from({ length: n }).map((_, i) => {
        const a = (i / n) * Math.PI * 2;
        const long = i % 2 === 0;
        const rr = long ? r2 : r2 * 0.72;
        return (
          <line
            key={i}
            x1={Math.cos(a) * r1}
            y1={Math.sin(a) * r1}
            x2={Math.cos(a) * rr}
            y2={Math.sin(a) * rr}
            strokeWidth={long ? 0.7 : 0.45}
            strokeOpacity={long ? 0.75 : 0.5}
          />
        );
      })}
    </g>
  );
}

/* ----------------------------------------------------------------------- */
/* Winter / New Year                                                        */
/* ----------------------------------------------------------------------- */

/** Six-arm crystal with side branches; two-tone so it reads on white and dark. */
export function SnowflakeG({ s = 1, x = 0, y = 0, r = 0, o }: Omit<PlaceProps, "u">) {
  const arm = "M0 0V-13M0-5L-3.2-8.2M0-5L3.2-8.2M0-9L-2.3-11.3M0-9L2.3-11.3";
  return (
    <g transform={place({ x, y, s, r })} opacity={o} strokeLinecap="round" fill="none">
      <g stroke="#4f9fe0" strokeWidth="2.2" opacity=".85">
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <path key={a} d={arm} transform={`rotate(${a})`} />
        ))}
      </g>
      <g stroke="#ffffff" strokeWidth=".9">
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <path key={a} d={arm} transform={`rotate(${a})`} />
        ))}
      </g>
      <polygon points="0,-2.2 1.9,-1.1 1.9,1.1 0,2.2 -1.9,1.1 -1.9,-1.1" fill="#fff" stroke="#4f9fe0" strokeWidth=".6" />
    </g>
  );
}

const HOLLY_LEAF =
  "M0 0C2-2 3-3 5-3.5L5.5-5.5L8-4.5L9-7L11.5-5.5L13.5-7L14-4.5L17-3.5L15-1.5L17 .5L14 1L13.5 3L11.5 1.5L9 3L8 1L5.5 1.5L5 -.3C3 .2 1.5 .3 0 0Z";

export function HollyG({ u, ...p }: PlaceProps) {
  return (
    <g transform={place(p)} opacity={p.o}>
      {[-38, 22, 96].map((a) => (
        <g key={a} transform={`rotate(${a})`}>
          <path d={HOLLY_LEAF} fill={`url(#${u}-holly)`} stroke="#14532d" strokeOpacity=".7" strokeWidth=".5" strokeLinejoin="round" />
          <path d="M0 0L16-2" stroke="#bbf7d0" strokeOpacity=".5" strokeWidth=".5" />
        </g>
      ))}
      {[
        [-1.6, 1.2],
        [1.8, 2.4],
        [0.2, -1.8],
      ].map(([bx, by], i) => (
        <g key={i}>
          <circle cx={bx} cy={by} r="2.1" fill="#dc2626" stroke="#7f1d1d" strokeWidth=".4" />
          <circle cx={bx - 0.7} cy={by - 0.7} r=".6" fill="#fff" opacity=".75" />
        </g>
      ))}
    </g>
  );
}

/** Hanging fairy-light bulb; the halo twinkles out of phase via `delay`. */
export function BulbG({
  x,
  y,
  color,
  delay = "0s",
  s = 1,
}: {
  x: number;
  y: number;
  color: string;
  delay?: string;
  s?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle cx="0" cy="8.5" r="8" fill={color} opacity=".3" className="wh-seasonal-twinkle" style={{ animationDelay: delay }} />
      <rect x="-1.5" y="0" width="3" height="3.2" rx=".6" fill="#374151" />
      <path d="M-3 3C-4.5 8-2.6 12.6 0 12.6C2.6 12.6 4.5 8 3 3Z" fill={color} stroke="rgba(0,0,0,.25)" strokeWidth=".4" className="wh-seasonal-twinkle" style={{ animationDelay: delay }} />
      <ellipse cx="-1" cy="6" rx=".8" ry="1.8" fill="#fff" opacity=".7" />
    </g>
  );
}

/** Radiating firework burst (alternating long/short spokes with spark tips). */
export function StarburstG({
  color = "#d9a032",
  accent = "#94a3b8",
  ...p
}: Omit<PlaceProps, "u"> & { color?: string; accent?: string }) {
  return (
    <g transform={place(p)} opacity={p.o} strokeLinecap="round">
      {Array.from({ length: 16 }).map((_, i) => {
        const a = (i / 16) * Math.PI * 2;
        const long = i % 2 === 0;
        const r1 = 4.5;
        const r2 = long ? 18 : 11.5;
        const c = i % 4 === 0 ? accent : color;
        return (
          <g key={i}>
            <line x1={Math.cos(a) * r1} y1={Math.sin(a) * r1} x2={Math.cos(a) * r2} y2={Math.sin(a) * r2} stroke={c} strokeWidth={long ? 1.2 : 0.9} />
            <circle cx={Math.cos(a) * (r2 + 2.2)} cy={Math.sin(a) * (r2 + 2.2)} r={long ? 1.2 : 0.8} fill={c} />
          </g>
        );
      })}
      <circle r="2.2" fill={color} />
    </g>
  );
}

export function SparkleG({
  color = "#e0a82a",
  ...p
}: Omit<PlaceProps, "u"> & { color?: string }) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <path
        className={p.cls}
        d="M0-6Q.8-.8 6 0Q.8.8 0 6Q-.8.8-6 0Q-.8-.8 0-6Z"
        fill={color}
      />
    </g>
  );
}

/* ----------------------------------------------------------------------- */
/* Heritage, memorial                                                       */
/* ----------------------------------------------------------------------- */

/** Dong Son bronze-drum face: rays sun, triangle band, bird ring, tick rim. */
export function DongSonG({ u, ...p }: PlaceProps) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <circle r="26" fill={`url(#${u}-bronze)`} stroke="#5b3414" strokeWidth=".8" />
      <circle r="24.2" fill="none" stroke="#fde7a3" strokeOpacity=".55" strokeWidth=".5" />
      {Array.from({ length: 48 }).map((_, i) => (
        <line key={i} transform={`rotate(${(i / 48) * 360})`} x1="0" y1="-24.6" x2="0" y2="-22.8" stroke="#4a2810" strokeOpacity=".7" strokeWidth=".5" />
      ))}
      <circle r="22.2" fill="none" stroke="#4a2810" strokeOpacity=".65" strokeWidth=".5" />
      {Array.from({ length: 8 }).map((_, i) => (
        <path
          key={i}
          transform={`rotate(${i * 45}) translate(0 -18.3)`}
          d="M-3.6 .2Q-1.4-2.2 1-1.4L3.8-2.9L2.8-.1Q.7 1.9-3.6 .2Z"
          fill="#4a2810"
          opacity=".85"
        />
      ))}
      <circle r="14.6" fill="none" stroke="#4a2810" strokeOpacity=".65" strokeWidth=".5" />
      {Array.from({ length: 24 }).map((_, i) => (
        <polygon key={i} transform={`rotate(${(i / 24) * 360})`} points="0,-14.2 1.5,-11 -1.5,-11" fill="#4a2810" opacity=".7" />
      ))}
      <circle r="10.4" fill="none" stroke="#fde7a3" strokeOpacity=".5" strokeWidth=".5" />
      {Array.from({ length: 14 }).map((_, i) => (
        <polygon key={i} transform={`rotate(${(i / 14) * 360})`} points="0,-10 1.5,-6 -1.5,-6" fill="#fff0b8" stroke="#6b3f17" strokeWidth=".3" />
      ))}
      <circle r="5.4" fill={`url(#${u}-gold)`} stroke="#6b3f17" strokeWidth=".5" />
      <circle r="2.4" fill="#6b3f17" opacity=".55" />
    </g>
  );
}

/** Greek-key / meander band, used as a border. Draws a repeating unit. */
export function MeanderPattern({ id, color = "#a8570a" }: { id: string; color?: string }) {
  return (
    <pattern id={id} width="14" height="8" patternUnits="userSpaceOnUse">
      <path d="M0 6.5H3V1.5H8.5V5H5.8V3.5" fill="none" stroke={color} strokeWidth=".9" strokeLinejoin="miter" />
      <path d="M8.5 6.5H14" fill="none" stroke={color} strokeWidth=".9" />
    </pattern>
  );
}

/** Memorial candle on a bronze lotus pedestal with a warm, slow halo. */
export function CandleG({ u, ...p }: PlaceProps) {
  const petal = "M0 0C-5-2-6-9 0-14C6-9 5-2 0 0Z";
  return (
    <g transform={place(p)} opacity={p.o}>
      <circle cx="0" cy="-30" r="34" fill={`url(#${u}-glowWarm)`} className="wh-seasonal-halo" />
      <g transform="translate(0 12)">
        {[-72, -48, 48, 72].map((a) => (
          <path key={a} d={petal} transform={`rotate(${a}) scale(1.05)`} fill={`url(#${u}-lotusBronze)`} stroke="#5b3414" strokeOpacity=".6" strokeWidth=".5" />
        ))}
        {[-26, 26].map((a) => (
          <path key={a} d={petal} transform={`rotate(${a}) scale(1.15)`} fill={`url(#${u}-lotusBronze)`} stroke="#5b3414" strokeOpacity=".6" strokeWidth=".5" />
        ))}
        <path d={petal} transform="scale(1.2)" fill={`url(#${u}-lotusBronze)`} stroke="#5b3414" strokeOpacity=".6" strokeWidth=".5" />
        <path d="M-17 2Q0 16 17 2Q10 8 0 8Q-10 8-17 2Z" fill={`url(#${u}-bronze)`} stroke="#5b3414" strokeWidth=".5" />
      </g>
      <rect x="-4.6" y="-26" width="9.2" height="31" rx="1.3" fill={`url(#${u}-wax)`} stroke="#c58a4d" strokeOpacity=".6" strokeWidth=".5" />
      <path d="M-4.6-26Q-1-22-2-18.5Q-3-15-4.6-17Z" fill="#fff" opacity=".7" />
      <ellipse cx="0" cy="-26" rx="4.6" ry="1.3" fill="#fde3c4" stroke="#c58a4d" strokeOpacity=".6" strokeWidth=".4" />
      <line x1="0" y1="-26.6" x2="0" y2="-29.2" stroke="#3f2a1a" strokeWidth=".7" />
      <g transform="translate(0 -28.5)">
        <g className="wh-seasonal-flicker">
          <path d="M0-13C-4-7-4-2.6 0-.6C4-2.6 4-7 0-13Z" fill={`url(#${u}-flame)`} />
          <path d="M0-7.5C-1.5-4.5-1.3-2.4 0-1.4C1.3-2.4 1.5-4.5 0-7.5Z" fill="#fff" opacity=".9" />
        </g>
      </g>
    </g>
  );
}

/* ----------------------------------------------------------------------- */
/* Autumn, Halloween                                                        */
/* ----------------------------------------------------------------------- */

export function MoonG({
  u,
  r = 14,
  violet = false,
  ...p
}: PlaceProps & { r?: number; violet?: boolean }) {
  const k = r / 14;
  return (
    <g transform={place(p)} opacity={p.o}>
      <circle r={r * 1.9} fill={`url(#${u}-${violet ? "glowViolet" : "glowWarm"})`} transform={`scale(${1})`} />
      <circle r={r} fill={`url(#${u}-${violet ? "moonViolet" : "moon"})`} stroke={violet ? "#9a3412" : "#d99a10"} strokeOpacity=".7" strokeWidth=".6" />
      {[
        [-4.5, -3.5, 2.6],
        [3.8, 2.6, 3.2],
        [-2.2, 5.6, 1.8],
        [5.6, -4.6, 1.5],
      ].map(([cx, cy, cr], i) => (
        <circle key={i} cx={cx * k} cy={cy * k} r={cr * k} fill={violet ? "#c2410c" : "#e6b244"} opacity=".4" />
      ))}
    </g>
  );
}

/** Classic scrolled "xiangyun"-style cloud. */
export function CloudG({ u, ...p }: PlaceProps) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <path
        d="M0 14C-4 14-6 10-3 8C-5 4 0 1 3 4C5 0 11 1 11 6C15 5 18 9 15 12C17 14 14 16 12 14Z"
        fill={`url(#${u}-cloud)`}
        stroke="#c98f2c"
        strokeWidth=".7"
        strokeLinejoin="round"
      />
      <path d="M4 8a2 2 0 1 1 2 2M10 8.5a1.5 1.5 0 1 1 1.5 1.5" fill="none" stroke="#c98f2c" strokeWidth=".6" strokeLinecap="round" />
    </g>
  );
}

/** Sitting jade rabbit (profile). */
export function RabbitG({ u, ...p }: PlaceProps) {
  return (
    <g transform={place(p)} opacity={p.o} stroke="#64748b" strokeWidth=".6" strokeLinejoin="round">
      <ellipse cx="0" cy="8" rx="7" ry="6" fill={`url(#${u}-jade)`} />
      <path d="M4-4C2-14 5-16 7-14C8-11 7-7 6-4Z" fill={`url(#${u}-jade)`} />
      <path d="M6-4C6-13 10-15 11-12C11-9 9-6 8-3Z" fill={`url(#${u}-jade)`} />
      <path d="M5.2-5C4-11 5.6-12.4 6.2-11.5" fill="none" stroke="#f9a8c4" strokeWidth="1" />
      <circle cx="5" cy="-1" r="4" fill={`url(#${u}-jade)`} />
      <circle cx="6.6" cy="-1.6" r=".7" fill="#1e293b" stroke="none" />
      <circle cx="-7" cy="8" r="2.3" fill="#fff" />
      <path d="M3 12Q6 14 9 12" fill="none" />
    </g>
  );
}

/** Pumpkin lantern with glowing carved face. */
export function PumpkinG({ u, ...p }: PlaceProps) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <circle cy="0" r="22" fill={`url(#${u}-glowViolet)`} opacity=".7" />
      <ellipse cx="-7" cy="1" rx="8.5" ry="11" fill="#c2570c" />
      <ellipse cx="7" cy="1" rx="8.5" ry="11" fill="#c2570c" />
      <ellipse cx="0" cy="0" rx="9.6" ry="12" fill={`url(#${u}-pumpkin)`} stroke="#7c2d12" strokeOpacity=".6" strokeWidth=".6" />
      <path d="M-3.8-11Q-5 0-3.6 11.6M3.8-11Q5 0 3.6 11.6" fill="none" stroke="#7c2d12" strokeOpacity=".4" strokeWidth=".6" />
      <path d="M-1-12L-1.4-16Q1-18.4 3-15.5L1.6-12Z" fill="#3f6212" stroke="#1a2e05" strokeWidth=".4" />
      <g fill="#ffe27a" className="wh-seasonal-twinkle">
        <path d="M-7.4-3L-2.8-3L-5.2-8Z" />
        <path d="M7.4-3L2.8-3L5.2-8Z" />
        <path d="M-1.2 1.4L1.2 1.4L0-1.4Z" />
        <path d="M-7.5 4.2L-5 7L-2.4 4.8L0 7.6L2.4 4.8L5 7L7.5 4.2L5.8 9.6L-5.8 9.6Z" />
      </g>
    </g>
  );
}

export function CobwebG({ size = 64, flip = false, o }: { size?: number; flip?: boolean; o?: number }) {
  const angles = [0, 18, 36, 54, 72, 90];
  const pt = (rad: number, a: number): [number, number] => [
    -rad * Math.cos((a * Math.PI) / 180),
    rad * Math.sin((a * Math.PI) / 180),
  ];
  return (
    <g transform={flip ? "scale(-1 1)" : undefined} opacity={o} fill="none" stroke="#94a3b8" strokeLinecap="round">
      {angles.map((a) => {
        const [x, y] = pt(size, a);
        return <line key={a} x1="0" y1="0" x2={x} y2={y} strokeWidth=".7" strokeOpacity=".85" />;
      })}
      {[0.22, 0.4, 0.58, 0.78, 1].map((f) =>
        angles.slice(0, -1).map((a, i) => {
          const [x1, y1] = pt(size * f, a);
          const [x2, y2] = pt(size * f, angles[i + 1]);
          const mx = (x1 + x2) / 2 * 0.84;
          const my = (y1 + y2) / 2 * 0.84;
          return <path key={`${f}-${a}`} d={`M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`} strokeWidth=".5" strokeOpacity=".75" />;
        }),
      )}
    </g>
  );
}

export function SpiderG({ len = 26, ...p }: Omit<PlaceProps, "u"> & { len?: number }) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <g className={p.cls}>
      <line x1="0" y1="0" x2="0" y2={len} stroke="#94a3b8" strokeWidth=".6" />
      <g transform={`translate(0 ${len})`} stroke="#2b1740" strokeWidth=".7" fill="none" strokeLinecap="round">
        {[-1, 1].map((d) =>
          [0, 1, 2, 3].map((i) => (
            <path key={`${d}${i}`} d={`M0 ${1 + i}Q${d * 5} ${-1 + i * 2} ${d * 6.5} ${3 + i * 2.2}`} />
          )),
        )}
        <circle cx="0" cy="2.6" r="2.9" fill="#4c2a73" stroke="#c084fc" strokeWidth=".4" />
        <circle cx="0" cy="-.6" r="1.7" fill="#4c2a73" stroke="#c084fc" strokeWidth=".4" />
        <circle cx="-.7" cy="-.9" r=".35" fill="#f97316" stroke="none" />
        <circle cx=".7" cy="-.9" r=".35" fill="#f97316" stroke="none" />
      </g>
      </g>
    </g>
  );
}

export function BatG({ ...p }: Omit<PlaceProps, "u">) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <path
        className="wh-seasonal-flap"
        d="M0 0C-2-3-4-5-6-4C-8-8-12-8-14-4C-12-4-11-2-10 0C-8-1-7-.5-6 1C-4 .5-2 1 0 4C2 1 4 .5 6 1C7-.5 8-1 10 0C11-2 12-4 14-4C12-8 8-8 6-4C4-5 2-3 0 0Z"
        fill="#4c2a73"
        stroke="#c084fc"
        strokeOpacity=".8"
        strokeWidth=".5"
        strokeLinejoin="round"
      />
      <path d="M-2.4-1L-2-3.4L-.8-2M2.4-1L2-3.4L.8-2" fill="#4c2a73" stroke="#c084fc" strokeOpacity=".8" strokeWidth=".4" />
    </g>
  );
}

export function DeadBranchG({ ...p }: Omit<PlaceProps, "u">) {
  return (
    <g transform={place(p)} opacity={p.o} fill="none" stroke="#7a5a78" strokeLinecap="round">
      <path d="M0 0C-20-4-34 4-52-6" strokeWidth="3" />
      <path d="M-14-1.5C-20-12-18-20-24-26M-28 1C-30 8-38 10-40 18M-38-1C-42-10-50-10-54-18M-44-4C-52-2-58-6-64-4" strokeWidth="1.4" />
      <path d="M-24-26C-28-28-28-32-32-33M-24-26C-22-30-24-34-22-37" strokeWidth=".9" />
    </g>
  );
}

/* ----------------------------------------------------------------------- */
/* Blue neon                                                                */
/* ----------------------------------------------------------------------- */

/** Isometric prism over a dashed compass ring. */
export function PrismG({ u, compass = true, ...p }: PlaceProps & { compass?: boolean }) {
  return (
    <g transform={place(p)} opacity={p.o}>
      {compass ? (
        <g fill="none" stroke="#0ea5e9" className="wh-seasonal-spin wh-anim" style={{ animationDuration: "48s" }}>
          <circle r="21" strokeWidth=".7" strokeDasharray="1.5 2.4" strokeOpacity=".8" />
          <circle r="16.5" strokeWidth=".5" strokeOpacity=".5" />
          {[0, 90, 180, 270].map((a) => (
            <line key={a} transform={`rotate(${a})`} x1="0" y1="-23.5" x2="0" y2="-18.5" strokeWidth="1" />
          ))}
          {Array.from({ length: 24 }).map((_, i) => (
            <line key={i} transform={`rotate(${i * 15})`} x1="0" y1="-21" x2="0" y2="-19.6" strokeWidth=".4" strokeOpacity=".6" />
          ))}
        </g>
      ) : null}
      <circle r="20" fill={`url(#${u}-glowCyan)`} />
      <polygon points="0,-14 12,-7 0,0 -12,-7" fill={`url(#${u}-prismTop)`} />
      <polygon points="-12,-7 0,0 0,14 -12,7" fill={`url(#${u}-prismLeft)`} />
      <polygon points="12,-7 12,7 0,14 0,0" fill={`url(#${u}-prismRight)`} />
      <g fill="none" stroke="#082f49" strokeWidth=".7" strokeLinejoin="round">
        <polygon points="0,-14 12,-7 12,7 0,14 -12,7 -12,-7" />
        <path d="M-12-7L0 0L12-7M0 0V14" />
      </g>
      <path d="M0-14L-5-8.6L0-4.5L5-8.6Z" fill="#fff" opacity=".35" />
    </g>
  );
}

/* ----------------------------------------------------------------------- */
/* Ambient particles                                                        */
/* ----------------------------------------------------------------------- */

/** A single soft petal; hue chosen from a small palette. */
export function PetalShape({ fill, edge, size }: { fill: string; edge: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="-8 -8 16 16" overflow="visible" aria-hidden>
      <path
        d="M0 6C-5 3-6-3-1.4-6C.6-7 2.6-6 3.6-4C5.4-1 3.4 3 0 6Z"
        fill={fill}
        stroke={edge}
        strokeOpacity=".5"
        strokeWidth=".6"
      />
      <path d="M0 5C-.4 1 0-2 .8-4.6" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth=".6" strokeLinecap="round" />
    </svg>
  );
}

export function PointedPetalShape({ fill, edge, size }: { fill: string; edge: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="-8 -9 16 18" overflow="visible" aria-hidden>
      <path d="M0 8C-5.2 4-5.6-3.4 0-8.5C5.6-3.4 5.2 4 0 8Z" fill={fill} stroke={edge} strokeOpacity=".5" strokeWidth=".6" />
      <path d="M0 7C-.5 2 0-2.5 0-6" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth=".6" />
    </svg>
  );
}

export function SnowflakeShape({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="-15 -15 30 30" overflow="visible" aria-hidden>
      <SnowflakeG />
    </svg>
  );
}

export function SparkleShape({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="-7 -7 14 14" overflow="visible" aria-hidden>
      <SparkleG color={color} />
    </svg>
  );
}

export function ConfettiShape({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size * 0.55} viewBox="0 0 10 5.5" aria-hidden>
      <rect width="10" height="5.5" rx=".8" fill={color} />
      <rect width="10" height="2" rx=".8" fill="#fff" opacity=".35" />
    </svg>
  );
}

export function SmallStarShape({ size, fill }: { size: number; fill: string }) {
  const pts = Array.from({ length: 10 })
    .map((_, i) => {
      const a = (-90 + i * 36) * (Math.PI / 180);
      const rr = i % 2 === 0 ? 7 : 2.9;
      return `${(Math.cos(a) * rr).toFixed(2)},${(Math.sin(a) * rr).toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg width={size} height={size} viewBox="-8 -8 16 16" overflow="visible" aria-hidden>
      <polygon points={pts} fill={fill} stroke="#a8570a" strokeOpacity=".6" strokeWidth=".5" strokeLinejoin="round" />
    </svg>
  );
}

export function MoteShape({ size, color, ring = false }: { size: number; color: string; ring?: boolean }) {
  return (
    <span
      className="block rounded-full"
      style={{
        width: size,
        height: size,
        background: ring
          ? "transparent"
          : `radial-gradient(circle at 35% 35%, #fff 0%, ${color} 45%, ${color} 100%)`,
        border: ring ? `1.2px solid ${color}` : undefined,
        boxShadow: `0 0 ${Math.round(size * 1.6)}px ${color}, 0 0 ${Math.round(size * 0.5)}px ${color}`,
      }}
    />
  );
}

export function FloatingLanternShape({ size }: { size: number }) {
  return (
    <svg width={size} height={size * 1.2} viewBox="-8 -10 16 20" overflow="visible" aria-hidden>
      <circle r="10" cy="0" fill="#fbbf24" opacity=".28" />
      <path d="M-5-5L5-5L6 5L-6 5Z" fill="#f59e0b" stroke="#b45309" strokeWidth=".6" strokeLinejoin="round" />
      <path d="M-5-5Q0-8 5-5" fill="#fde68a" stroke="#b45309" strokeWidth=".5" />
      <path d="M0 1C-1.6 3-1.2 4.6 0 5C1.2 4.6 1.6 3 0 1Z" fill="#fff7c2" />
    </svg>
  );
}

export function BatShape({ size }: { size: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="-15 -9 30 14" overflow="visible" aria-hidden>
      <BatG />
    </svg>
  );
}

/* ----------------------------------------------------------------------- */
/* Valentine, spring, Easter, kids, harvest                                 */
/* ----------------------------------------------------------------------- */

const HEART_PATH = "M0 7C-12-1-9-10-4.5-9C-2-8.6-.6-7 0-5.6C.6-7 2-8.6 4.5-9C9-10 12-1 0 7Z";

export function HeartG({ u, fill, ...p }: PlaceProps & { fill?: string }) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <path d={HEART_PATH} fill={fill ?? `url(#${u}-heart)`} stroke="#9f1239" strokeOpacity=".6" strokeWidth=".6" strokeLinejoin="round" />
      <path d="M-6.4-4.4C-6-6.6-4.4-7.4-2.8-7" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth=".9" strokeLinecap="round" />
    </g>
  );
}

/** Four-leaf clover with veins and a curved stem. */
export function CloverG({ u, stem = true, ...p }: PlaceProps & { stem?: boolean }) {
  const leaf = "M0 0C-6-1-8.4-7-4.4-8.8C-2.2-9.6 0-8.2 0-6.2C0-8.2 2.2-9.6 4.4-8.8C8.4-7 6-1 0 0Z";
  return (
    <g transform={place(p)} opacity={p.o}>
      {stem ? <path d="M0 0C1 6 3 10 7 13" fill="none" stroke="#166534" strokeWidth="1.3" strokeLinecap="round" /> : null}
      {[45, 135, 225, 315].map((a) => (
        <g key={a} transform={`rotate(${a}) translate(0 -.4)`}>
          <path d={leaf} fill={`url(#${u}-leaf)`} stroke="#14532d" strokeOpacity=".6" strokeWidth=".6" strokeLinejoin="round" />
          <path d="M0-1.2C-.2-4-.4-6 0-7.2" fill="none" stroke="#bbf7d0" strokeOpacity=".65" strokeWidth=".5" />
        </g>
      ))}
      <circle r="1" fill="#14532d" opacity=".5" />
    </g>
  );
}

const EGG_PALETTES: Array<[string, string]> = [
  ["#c4b5fd", "#6d28d9"],
  ["#99f6e4", "#0f766e"],
  ["#fbcfe8", "#be185d"],
  ["#fde68a", "#b45309"],
];

/** Painted Easter egg; `tone` 0-3 selects the palette and pattern. */
export function EggG({ tone = 0, ...p }: Omit<PlaceProps, "u"> & { tone?: 0 | 1 | 2 | 3 }) {
  const [base, ink] = EGG_PALETTES[tone];
  return (
    <g transform={place(p)} opacity={p.o}>
      <path d="M0-11C6-11 9-2 9 3C9 8.5 5 12 0 12C-5 12-9 8.5-9 3C-9-2-6-11 0-11Z" fill={base} stroke={ink} strokeOpacity=".7" strokeWidth=".7" />
      {tone % 2 === 0 ? (
        <path d="M-8.8 2L-5.8-1L-2.9 2L0-1L2.9 2L5.8-1L8.8 2" fill="none" stroke={ink} strokeWidth="1.1" strokeLinejoin="round" />
      ) : (
        <g fill={ink}>
          {[-6, -2, 2, 6].map((x) => (
            <circle key={x} cx={x} cy="1.4" r="1.1" />
          ))}
          {[-4, 0, 4].map((x) => (
            <circle key={x} cx={x} cy="6" r=".9" />
          ))}
        </g>
      )}
      <path d="M-3.4-8C-6-5-7 -1-6.6 1" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.1" strokeLinecap="round" />
    </g>
  );
}

export function DaisyG({ ...p }: Omit<PlaceProps, "u">) {
  return (
    <g transform={place(p)} opacity={p.o}>
      {Array.from({ length: 8 }).map((_, i) => (
        <ellipse key={i} cx="0" cy="-5" rx="1.9" ry="4.2" fill="#fff" stroke="#94a3b8" strokeOpacity=".6" strokeWidth=".4" transform={`rotate(${i * 45})`} />
      ))}
      <circle r="2.6" fill="#f5b50a" stroke="#a8570a" strokeWidth=".4" />
    </g>
  );
}

export function BalloonG({
  color = "#ef4444",
  string = 28,
  ...p
}: Omit<PlaceProps, "u"> & { color?: string; string?: number }) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <path d={`M0 10.5Q-3 ${10.5 + string * 0.5} 1.5 ${10.5 + string}`} fill="none" stroke="#64748b" strokeWidth=".6" />
      <ellipse cx="0" cy="0" rx="8" ry="10" fill={color} stroke="#000" strokeOpacity=".18" strokeWidth=".6" />
      <path d="M-1.6 10.2L1.6 10.2L0 12.4Z" fill={color} stroke="#000" strokeOpacity=".18" strokeWidth=".4" />
      <ellipse cx="-3" cy="-4" rx="1.8" ry="3" fill="#fff" opacity=".55" transform="rotate(25 -3 -4)" />
    </g>
  );
}

export function MapleLeafG({
  fill = "#dc5a14",
  ...p
}: Omit<PlaceProps, "u"> & { fill?: string }) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <path d="M0-12L2-7L6-9L5-4L10-5L7 0L9 2L3 4L4 8L0 6.5L-4 8L-3 4L-9 2L-7 0L-10-5L-5-4L-6-9L-2-7Z" fill={fill} stroke="#7c2d12" strokeOpacity=".7" strokeWidth=".6" strokeLinejoin="round" />
      <path d="M0 6.5V13M0 5L0-7M0 1L-6-3M0 1L6-3" fill="none" stroke="#7c2d12" strokeOpacity=".55" strokeWidth=".6" strokeLinecap="round" />
    </g>
  );
}

export function WheatG({ ...p }: Omit<PlaceProps, "u">) {
  return (
    <g transform={place(p)} opacity={p.o}>
      <path d="M0 0V-30" stroke="#a8761c" strokeWidth="1" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          <ellipse cx="-2.4" cy={-8 - i * 3.4} rx="1.5" ry="3.2" fill="#e8a817" stroke="#a8570a" strokeOpacity=".7" strokeWidth=".4" transform={`rotate(-28 -2.4 ${-8 - i * 3.4})`} />
          <ellipse cx="2.4" cy={-8 - i * 3.4} rx="1.5" ry="3.2" fill="#f2bb2a" stroke="#a8570a" strokeOpacity=".7" strokeWidth=".4" transform={`rotate(28 2.4 ${-8 - i * 3.4})`} />
        </g>
      ))}
      <ellipse cx="0" cy="-31" rx="1.4" ry="3.2" fill="#f2bb2a" stroke="#a8570a" strokeOpacity=".7" strokeWidth=".4" />
    </g>
  );
}

/** Flat-fill particle shapes (no gradient defs needed). */
export function HeartShape({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="-12 -10 24 20" overflow="visible" aria-hidden>
      <path d={HEART_PATH} fill={fill} stroke="#9f1239" strokeOpacity=".5" strokeWidth=".8" strokeLinejoin="round" />
      <path d="M-6.4-4.4C-6-6.6-4.4-7.4-2.8-7" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function LeafShape({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="-8 -9 16 18" overflow="visible" aria-hidden>
      <path d="M0 8C-6 4-6-4 0-8C6-4 6 4 0 8Z" fill={fill} stroke="#14532d" strokeOpacity=".55" strokeWidth=".6" />
      <path d="M0 8V-5" stroke="#14532d" strokeOpacity=".5" strokeWidth=".6" />
    </svg>
  );
}

export function MapleShape({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="-12 -13 24 26" overflow="visible" aria-hidden>
      <MapleLeafG fill={fill} />
    </svg>
  );
}
