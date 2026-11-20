/**
 * Small hand-drawn accents shown at the right end of the selected sidebar item
 * while a seasonal preset is active. Kept as SVG strings so they can be used as
 * CSS background images (data URIs, no network: works air-gapped).
 */

import { TEACHERS_NAV_ACCENT } from "@/components/seasonal/seasonal-teachers";
import type { SeasonalEffectPresetId } from "@/types/api";

const flake = (x: number, y: number, r: number, c: string, w = 1.2) => {
  const arms = [0, 60, 120, 180, 240, 300]
    .map(
      (a) =>
        `<path transform="rotate(${a})" d="M0 0V-${r}M0 -${r * 0.5}L-${r * 0.3} -${r * 0.75}M0 -${r * 0.5}L${r * 0.3} -${r * 0.75}"/>`,
    )
    .join("");
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round">${arms}</g>`;
};

const blossom = (x: number, y: number, r: number, petal: string, core: string) =>
  `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288]
    .map((a) => {
      const rad = (a * Math.PI) / 180;
      return `<circle cx="${(Math.sin(rad) * r).toFixed(2)}" cy="${(-Math.cos(rad) * r).toFixed(2)}" r="${(r * 0.75).toFixed(2)}" fill="${petal}"/>`;
    })
    .join("")}<circle r="${(r * 0.4).toFixed(2)}" fill="${core}"/></g>`;

const sparkle = (x: number, y: number, r: number, c: string) =>
  `<path transform="translate(${x} ${y}) scale(${r / 6})" d="M0-6Q.8-.8 6 0Q.8.8 0 6Q-.8.8-6 0Q-.8-.8 0-6Z" fill="${c}"/>`;

const heart = (x: number, y: number, s: number, c: string) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 7C-12-1-9-10-4.5-9C-2-8.6-.6-7 0-5.6C.6-7 2-8.6 4.5-9C9-10 12-1 0 7Z" fill="${c}"/>`;

const star5 = (x: number, y: number, r: number, fill: string, stroke: string) => {
  const pts = Array.from({ length: 10 })
    .map((_, i) => {
      const a = (-90 + i * 36) * (Math.PI / 180);
      const rr = i % 2 === 0 ? r : r * 0.42;
      return `${(x + Math.cos(a) * rr).toFixed(2)},${(y + Math.sin(a) * rr).toFixed(2)}`;
    })
    .join(" ");
  return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width=".8" stroke-linejoin="round"/>`;
};

/** viewBox 0 0 48 32; drawn to sit at the right end of a nav row. */
const ACCENTS: Partial<Record<SeasonalEffectPresetId, string>> = {
  teachers_day: TEACHERS_NAV_ACCENT,
  christmas:
    flake(33, 16, 10, "#5b9bd5", 1.3) +
    flake(13, 9, 5, "#7fb2e0") +
    sparkle(16, 24, 2.4, "#93c5fd"),
  lunar_new_year:
    `<path d="M48 26C38 22 30 20 18 14" fill="none" stroke="#7a4a2a" stroke-width="1.4" stroke-linecap="round"/>` +
    blossom(32, 18, 4.4, "#f9a8c9", "#f59e0b") +
    blossom(16, 11, 3.2, "#fcd34d", "#d97706"),
  new_year: sparkle(32, 15, 8, "#d9a032") + sparkle(16, 22, 4, "#94a3b8") + sparkle(42, 26, 2.6, "#d9a032"),
  national_red_gold: star5(32, 16, 10, "#dc2626", "#f5b50a") + star5(14, 22, 4, "#f5b50a", "#dc2626"),
  heritage_gold:
    `<g fill="none" stroke="#b4651b" stroke-width="1"><circle cx="32" cy="16" r="11"/><circle cx="32" cy="16" r="6.5" stroke-dasharray="1.5 2"/></g>` +
    star5(32, 16, 4, "#c2823a", "#b4651b"),
  lotus_gold: `<g transform="translate(32 22)">${[-50, -25, 0, 25, 50]
    .map(
      (a) =>
        `<path transform="rotate(${a})" d="M0 0C-4-2-5-9 0-15C5-9 4-2 0 0Z" fill="#f9a8d4" stroke="#db2777" stroke-width=".7"/>`,
    )
    .join("")}</g>`,
  floral_pink:
    `<path d="M24 26C20 22 16 21 10 22" fill="none" stroke="#2f6b3e" stroke-width="1.2"/><path d="M14 22C16 18 20 18 22 21C19 23 16 23 14 22Z" fill="#4d8f5a"/>` +
    `<circle cx="32" cy="15" r="8" fill="#fb7185"/><path d="M32 15m-1.6 0a1.6 1.6 0 1 1 1.6 1.6a3 3 0 0 1-3-3a4.4 4.4 0 0 1 4.4-4.4a5.8 5.8 0 0 1 5.8 5.8" fill="none" stroke="#be123c" stroke-width="1"/>`,
  mid_autumn:
    `<path d="M38 6a11 11 0 1 0 6 18a9 9 0 0 1-6-18Z" fill="#fbbf24" stroke="#d97706" stroke-width=".8"/>` +
    sparkle(16, 12, 3.5, "#f59e0b") +
    sparkle(20, 25, 2.2, "#fbbf24"),
  halloween:
    `<circle cx="36" cy="14" r="8" fill="#c4b5fd" opacity=".85"/>` +
    `<path transform="translate(18 18) scale(.9)" d="M0 0C-3-3-7-4-10-2C-8-1-7 1-7 3C-5 1-3 1-2 3C-1 1 1 1 2 3C3 1 5 1 7 3C7 1 8-1 10-2C7-4 3-3 0 0Z" fill="#4c1d95"/>`,
  blue_neon:
    `<g fill="none" stroke="#0ea5e9" stroke-width="1.1"><path d="M32 4L42 10V22L32 28L22 22V10Z"/><path d="M22 10L32 16L42 10M32 16V28"/></g>` +
    `<circle cx="12" cy="20" r="1.6" fill="#22d3ee"/>`,
  valentine: heart(32, 16, 1.05, "#f43f5e") + heart(15, 21, 0.5, "#fb7185") + heart(42, 6, 0.32, "#fda4af"),
  spring_green: `<g transform="translate(32 16)">${[45, 135, 225, 315]
    .map(
      (a) =>
        `<path transform="rotate(${a})" d="M0 0C-6-1-8.4-7-4.4-8.8C-2.2-9.6 0-8.2 0-6.2C0-8.2 2.2-9.6 4.4-8.8C8.4-7 6-1 0 0Z" fill="#4ade80" stroke="#15803d" stroke-width=".6"/>`,
    )
    .join("")}</g>`,
  easter:
    `<path d="M32 4C38 4 41 13 41 18C41 24 37 28 32 28C27 28 23 24 23 18C23 13 26 4 32 4Z" fill="#c4b5fd" stroke="#7c3aed" stroke-width=".8"/>` +
    `<path d="M23.4 17l3-2.6 2.8 2.6 2.8-2.6 2.8 2.6 2.8-2.6 3 2.6" fill="none" stroke="#fff" stroke-width="1.2"/>` +
    `<path d="M12 20C15 20 17 24 17 26C17 28.5 15 30 12 30C9 30 7 28.5 7 26C7 24 9 20 12 20Z" fill="#fde68a" stroke="#d97706" stroke-width=".6"/>`,
  kids_party:
    `<path d="M24 16Q22 24 26 31M36 14Q36 24 34 31" fill="none" stroke="#64748b" stroke-width=".6"/>` +
    `<ellipse cx="24" cy="10" rx="5" ry="6" fill="#f87171"/><ellipse cx="36" cy="8" rx="5.5" ry="6.5" fill="#38bdf8"/>` +
    `<rect x="10" y="22" width="5" height="2.6" rx=".6" fill="#facc15" transform="rotate(-25 12 23)"/>`,
  autumn_harvest:
    `<path transform="translate(32 15)" d="M0-12L2-7L6-9L5-4L10-5L7 0L9 2L3 4L4 8L0 6.5L-4 8L-3 4L-9 2L-7 0L-10-5L-5-4L-6-9L-2-7ZM0 6.5V13" fill="#f97316" stroke="#c2410c" stroke-width=".7"/>` +
    `<path transform="translate(14 22) rotate(-30) scale(.5)" d="M0-12L2-7L6-9L5-4L10-5L7 0L9 2L3 4L4 8L0 6.5L-4 8L-3 4L-9 2L-7 0L-10-5L-5-4L-6-9L-2-7Z" fill="#facc15"/>`,
};

/** CSS `url(...)` for the accent, or null when the preset has none. */
export function navAccentImage(preset: SeasonalEffectPresetId): string | null {
  const body = ACCENTS[preset];
  if (!body) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32" viewBox="0 0 48 32"><g opacity=".72">${body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
