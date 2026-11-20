"use client";

/**
 * Art for the "teachers_day" preset (Vietnamese Teachers' Day, 20/11).
 *
 * The brief is restraint: a certificate-style border, a quiet row of book
 * spines, one mortarboard, laurel. Few elements, muted emerald / antique gold
 * / cream, thin line-art for the watermark. Nothing is drawn in saturated
 * pinks or reds.
 */

import type { ReactNode } from "react";

export const TD = {
  emerald: "#0f766e",
  deep: "#0b4a42",
  ink: "#062b25",
  laurel: "#3f7d5a",
  laurelLight: "#5fa886",
  gold: "#c9993a",
  goldLight: "#e8c46a",
  goldPale: "#f5e3a8",
  cream: "#fbf3df",
  paper: "#fffaf0",
  burgundy: "#8b2e3c",
  navy: "#1e3a5f",
  wood: "#6b4a2b",
} as const;

/* ------------------------------ laurel ----------------------------------- */

const LEAF = "M0 0C2.2-2.6 6.4-2.6 8 0C6.4 2.6 2.2 2.6 0 0Z";

/** A straight sprig growing toward +x from the origin. */
function Sprig({ leaves = 4, step = 7 }: { leaves?: number; step?: number }) {
  const len = leaves * step + 4;
  return (
    <g>
      <path d={`M0 0H${len}`} stroke={TD.laurel} strokeWidth=".8" strokeLinecap="round" />
      {Array.from({ length: leaves }).map((_, i) => {
        const x = 3 + i * step;
        return (
          <g key={i}>
            <path d={LEAF} transform={`translate(${x} 0) rotate(-38)`} fill={TD.laurelLight} stroke={TD.laurel} strokeWidth=".35" />
            <path d={LEAF} transform={`translate(${x + 2} 0) rotate(38)`} fill={TD.laurel} stroke={TD.deep} strokeOpacity=".5" strokeWidth=".35" />
          </g>
        );
      })}
      <path d={LEAF} transform={`translate(${len - 1} 0)`} fill={TD.laurelLight} stroke={TD.laurel} strokeWidth=".35" />
    </g>
  );
}

/** A leafy branch following a quadratic curve, leaves set along its tangent. */
export function Branch({
  from,
  ctrl,
  to,
  n = 6,
  size = 1,
}: {
  from: [number, number];
  ctrl: [number, number];
  to: [number, number];
  n?: number;
  size?: number;
}) {
  const at = (t: number): [number, number] => [
    (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * ctrl[0] + t * t * to[0],
    (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * ctrl[1] + t * t * to[1],
  ];
  const angle = (t: number) =>
    (Math.atan2(
      2 * (1 - t) * (ctrl[1] - from[1]) + 2 * t * (to[1] - ctrl[1]),
      2 * (1 - t) * (ctrl[0] - from[0]) + 2 * t * (to[0] - ctrl[0]),
    ) *
      180) /
    Math.PI;
  return (
    <g>
      <path d={`M${from[0]} ${from[1]}Q${ctrl[0]} ${ctrl[1]} ${to[0]} ${to[1]}`} fill="none" stroke={TD.laurel} strokeWidth={1.1 * size} strokeLinecap="round" />
      {Array.from({ length: n }).map((_, i) => {
        const t = (i + 1) / (n + 1);
        const [x, y] = at(t);
        const a = angle(t);
        return (
          <g key={i} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${size * (1.15 - t * 0.35)})`}>
            <path d={LEAF} transform={`rotate(${a - 42})`} fill={TD.laurelLight} stroke={TD.laurel} strokeWidth=".35" />
            <path d={LEAF} transform={`rotate(${a + 42})`} fill={TD.laurel} stroke={TD.deep} strokeOpacity=".5" strokeWidth=".35" />
          </g>
        );
      })}
      <g transform={`translate(${to[0]} ${to[1]}) scale(${size})`}>
        <path d={LEAF} transform={`rotate(${angle(1)})`} fill={TD.laurelLight} stroke={TD.laurel} strokeWidth=".35" />
      </g>
    </g>
  );
}

/* ------------------------------ TopBar band ------------------------------ */

/** Certificate-style border: cream ribbon, gold rules, laurel pair, diamonds. */
export const TEACHERS_BAND = {
  w: 160,
  h: 16,
  draw: (): ReactNode => (
    <>
      <rect x="0" y="5" width="160" height="6" fill={TD.cream} />
      <rect x="0" y="4.6" width="160" height=".8" fill={TD.gold} />
      <rect x="0" y="10.6" width="160" height=".8" fill={TD.gold} />
      {/* centre diamond with a pair of laurel sprigs */}
      <g transform="translate(86 8)">
        <Sprig />
      </g>
      <g transform="translate(74 8) scale(-1 1)">
        <Sprig />
      </g>
      <path d="M80 3.2L84 8L80 12.8L76 8Z" fill={TD.gold} stroke="#8a6a1f" strokeWidth=".4" />
      <path d="M80 5.4L81.9 8L80 10.6L78.1 8Z" fill={TD.cream} />
      {/* edge diamonds (half at each end so the tile repeats cleanly) and dots */}
      {[0, 160].map((x) => (
        <path key={x} d={`M${x} 5.2L${x + 2.8} 8L${x} 10.8L${x - 2.8} 8Z`} fill={TD.gold} />
      ))}
      {[
        [124, 1.2],
        [132, 0.9],
        [140, 0.7],
        [36, 0.7],
        [28, 0.9],
        [20, 1.2],
      ].map(([x, r]) => (
        <circle key={x} cx={x} cy="8" r={r} fill={TD.gold} />
      ))}
    </>
  ),
};

/* ------------------------------ watermark -------------------------------- */

/** Stroke-only tile: open book, mortarboard, laurel sprig and a sparkle. */
export const TEACHERS_PATTERN = {
  w: 76,
  h: 76,
  draw: (): ReactNode => (
    <>
      <g transform="translate(8 10)">
        <path d="M0 4C5 1 11 1 15 4V19C11 16 5 16 0 19Z" />
        <path d="M15 4C19 1 25 1 30 4V19C25 16 19 16 15 19Z" />
        <path d="M3.5 8C6 7 9 7 11.5 8M3.5 12C6 11 9 11 11.5 12" strokeWidth=".6" />
      </g>
      <path transform="translate(56 16) scale(.8)" d="M0-6Q.8-.8 6 0Q.8.8 0 6Q-.8.8-6 0Q-.8-.8 0-6Z" />
      <g transform="translate(54 50)">
        <path d="M-13 0L0 -6L13 0L0 6Z" />
        <path d="M-7 3V8C-3 11 3 11 7 8V3" />
        <path d="M13 0V8" />
      </g>
      <g transform="translate(6 58)">
        <path d="M0 0Q10 -4 24 -1" />
        {[3, 9, 15, 21].map((x, i) => (
          <g key={x}>
            <path d="M0 0C2-3 6-3 8 0C6 3 2 3 0 0Z" transform={`translate(${x} ${-1.2 - i * 0.1}) rotate(-40)`} />
            <path d="M0 0C2-3 6-3 8 0C6 3 2 3 0 0Z" transform={`translate(${x + 2} ${-1.2 - i * 0.1}) rotate(40)`} />
          </g>
        ))}
      </g>
      <circle cx="30" cy="44" r="1" />
      <circle cx="66" cy="68" r="1" />
    </>
  ),
};

/* ------------------------------ sidebar foot ----------------------------- */

const BOOKS: Array<[number, number, string]> = [
  [10, 11, TD.deep],
  [7, 8, TD.burgundy],
  [11, 13, TD.navy],
  [8, 9.5, TD.gold],
  [9, 12, TD.laurel],
  [7, 7.5, TD.wood],
  [12, 12.5, TD.burgundy],
  [8, 10, TD.emerald],
  [10, 8.5, TD.gold],
  [7, 13, TD.navy],
  [9, 11, TD.laurel],
  [11, 8, TD.burgundy],
  [8, 12.5, TD.wood],
  [9, 9.5, TD.deep],
  [14, 11.5, TD.gold],
  [10, 10, TD.navy],
]; // widths add up to 150

/** A low row of book spines on a shelf board (tile 150 x 16, spines <= 13px). */
export const TEACHERS_FOOT = {
  w: 150,
  h: 16,
  draw: (): ReactNode => {
    let x = 0;
    return (
      <>
        {BOOKS.map(([w, h, fill], i) => {
          const bx = x;
          x += w;
          return (
            <g key={i}>
              <rect x={bx + 0.25} y={13.4 - h} width={w - 0.5} height={h} rx=".8" fill={fill} />
              <rect x={bx + 0.25} y={13.4 - h} width="1.2" height={h} rx=".6" fill="#fff" opacity=".18" />
              <rect x={bx + 1.5} y={13.4 - h + 2.2} width={w - 3} height=".7" fill={TD.goldPale} opacity=".75" />
              <rect x={bx + 1.5} y={13.4 - h + 4} width={w - 3} height=".5" fill={TD.goldPale} opacity=".5" />
            </g>
          );
        })}
        <rect x="0" y="13.4" width="150" height="2.6" fill={TD.wood} />
        <rect x="0" y="13.4" width="150" height=".7" fill="#a98458" />
      </>
    );
  },
};

/** A mortarboard resting on the shelf, with a gold tassel. 52 x 36. */
export function TeachersCap() {
  return (
    <>
      <path d="M13 20V28C13 31 21 34 26 34C31 34 39 31 39 28V20Z" fill={TD.deep} stroke={TD.ink} strokeWidth=".6" />
      <path d="M26 5L50 14.5L26 24L2 14.5Z" fill="#14594b" stroke={TD.ink} strokeWidth=".7" strokeLinejoin="round" />
      <path d="M26 5L50 14.5L26 14.5Z" fill="#1c7a68" opacity=".85" />
      <path d="M2 14.5L26 24L26 14.5Z" fill={TD.ink} opacity=".25" />
      <circle cx="26" cy="14.5" r="1.7" fill={TD.gold} stroke="#8a6a1f" strokeWidth=".4" />
      <path d="M26 14.5C34 14.5 42 15.5 44 19V28" fill="none" stroke={TD.gold} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M42.3 28H45.7L46.4 34H41.6Z" fill={TD.gold} stroke="#8a6a1f" strokeWidth=".4" strokeLinejoin="round" />
    </>
  );
}

/* ------------------------------ nav accent ------------------------------- */

/** viewBox 0 0 48 32: a small open book with a gold ribbon and a sparkle. */
export const TEACHERS_NAV_ACCENT =
  `<path d="M32 21C28 18 22 18 17 20V9C22 7 28 7 32 10Z" fill="${TD.paper}" stroke="${TD.emerald}" stroke-width="1"/>` +
  `<path d="M32 21C36 18 42 18 47 20V9C42 7 36 7 32 10Z" fill="${TD.paper}" stroke="${TD.emerald}" stroke-width="1"/>` +
  `<path d="M32 10V21" stroke="${TD.emerald}" stroke-width="1"/>` +
  `<path d="M20 12C23 11 26 11 29 12.4M20 15C23 14 26 14 29 15.4" stroke="#9fc9bd" stroke-width=".7" fill="none"/>` +
  `<path d="M36 8.4V17L38 15.4L40 17V9.2Z" fill="${TD.gold}"/>` +
  `<path transform="translate(10 11) scale(.55)" d="M0-6Q.8-.8 6 0Q.8.8 0 6Q-.8.8-6 0Q-.8-.8 0-6Z" fill="${TD.goldLight}"/>`;

/* ------------------------------ thumbnail -------------------------------- */

/** 360 x 140: an open book under a mortarboard, framed by two laurel branches. */
export function TeachersThumb({ u }: { u: string }) {
  const page = `${u}-tpage`;
  const glow = `${u}-tglow`;
  return (
    <>
      <defs>
        <linearGradient id={page} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={TD.paper} />
          <stop offset="1" stopColor="#efdfb8" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.45" r="0.5">
          <stop offset="0" stopColor={TD.goldLight} stopOpacity=".55" />
          <stop offset="1" stopColor={TD.goldLight} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="180" cy="70" rx="150" ry="70" fill={`url(#${glow})`} />

      <Branch from={[10, 128]} ctrl={[56, 122]} to={[96, 84]} n={7} size={1.2} />
      <Branch from={[350, 128]} ctrl={[304, 122]} to={[264, 84]} n={7} size={1.2} />

      {/* open book */}
      <path d="M70 110C108 100 150 100 180 114C210 100 252 100 290 110V114C252 104 210 104 180 118C150 104 108 104 70 114Z" fill={TD.deep} />
      <path d="M180 50C150 38 110 38 74 48V108C110 98 150 98 180 112Z" fill={`url(#${page})`} stroke="#d8c690" strokeWidth=".8" />
      <path d="M180 50C210 38 250 38 286 48V108C250 98 210 98 180 112Z" fill={`url(#${page})`} stroke="#d8c690" strokeWidth=".8" />
      <path d="M180 50V112" stroke="#c9b27a" strokeWidth="1" />
      <g stroke="#bda468" strokeWidth=".9" strokeLinecap="round" fill="none" opacity=".75">
        <path d="M92 60C118 54 146 56 166 64M92 70C118 64 146 66 166 74M92 80C118 74 146 76 166 84M92 90C112 86 132 87 148 92" />
        <path d="M194 64C214 56 242 54 268 60M194 74C214 66 242 64 268 70M194 84C214 76 242 74 268 80" />
      </g>
      <path d="M196 50V96L202 91L208 96V47Z" fill={TD.gold} stroke="#8a6a1f" strokeWidth=".6" />

      {/* mortarboard */}
      <g transform="translate(180 18) rotate(-6) scale(1.15) translate(-26 -14)">
        <TeachersCap />
      </g>

      {[
        [60, 34, 1],
        [304, 30, 0.8],
        [40, 78, 0.6],
        [326, 80, 0.7],
        [128, 22, 0.55],
      ].map(([x, y, s], i) => (
        <path
          key={i}
          className="wh-seasonal-twinkle"
          transform={`translate(${x} ${y}) scale(${Number(s) * 1.3})`}
          d="M0-6Q.8-.8 6 0Q.8.8 0 6Q-.8.8-6 0Q-.8-.8 0-6Z"
          fill={TD.goldLight}
        />
      ))}
    </>
  );
}
