import type { MascotSpec } from "@/components/users/welcome-effects/engine";

/** Hubby's costume, entrance and avatar-halo colour for every welcome theme. */
export const MASCOTS: Record<string, MascotSpec> = {
  phoenix: {
    costume: { cover: "#f97316", trim: "#b91c1c", hat: "flower", cape: "#ef4444" },
    entrance: "fly",
    stage: "249,115,22",
    restY: 0.82,
  },
  hacker: {
    costume: { cover: "#14532d", trim: "#052e16", hat: "hood", eyewear: "glasses" },
    entrance: "pixel",
    stage: "34,197,94",
  },
  admin: {
    costume: { cover: "#b45309", trim: "#78350f", hat: "crown", cape: "#b91c1c" },
    entrance: "drop",
    stage: "245,158,11",
  },
  aurora: {
    costume: { cover: "#6366f1", trim: "#3730a3", hat: "bow", prop: "wand" },
    entrance: "fly",
    stage: "45,212,191",
  },
  sakura: {
    costume: { cover: "#f472b6", trim: "#be185d", hat: "flower" },
    entrance: "fly",
    stage: "244,114,182",
  },
  fireworks: {
    costume: { cover: "#dc2626", trim: "#7f1d1d", hat: "cap", prop: "wand" },
    entrance: "rocket",
    stage: "250,204,21",
  },
  ocean: {
    costume: { cover: "#0891b2", trim: "#155e75", hat: "cap", eyewear: "goggles" },
    entrance: "run",
    stage: "34,211,238",
  },
  neon: {
    costume: { cover: "#7c3aed", trim: "#4c1d95", hat: "headphones", eyewear: "visor" },
    entrance: "pixel",
    stage: "217,70,239",
  },
  vice: {
    costume: { cover: "#ec4899", trim: "#9d174d", eyewear: "shades", hat: "headphones" },
    entrance: "run",
    stage: "244,63,94",
  },
  storm: {
    costume: { cover: "#475569", trim: "#1e293b", hat: "hood", prop: "wand" },
    entrance: "drop",
    stage: "167,139,250",
  },
  cosmos: {
    costume: { cover: "#4338ca", trim: "#1e1b4b", hat: "helmet" },
    entrance: "rocket",
    stage: "129,140,248",
  },
  snow: {
    costume: { cover: "#38bdf8", trim: "#0369a1", hat: "santa" },
    entrance: "drop",
    stage: "125,211,252",
  },
  lantern: {
    costume: { cover: "#dc2626", trim: "#991b1b", hat: "flower", prop: "envelope" },
    entrance: "fly",
    stage: "251,146,60",
  },
  arcade: {
    costume: { cover: "#2563eb", trim: "#1e3a8a", blocky: true, hat: "cap", prop: "flag" },
    entrance: "pixel",
    stage: "250,204,21",
  },
  koi: {
    costume: { cover: "#f97316", trim: "#c2410c", hat: "bow" },
    entrance: "run",
    stage: "251,146,60",
  },
  blockcraft: {
    costume: { cover: "#65a30d", trim: "#3f6212", blocky: true, hat: "hardhat", prop: "pickaxe" },
    entrance: "pixel",
    stage: "163,230,53",
  },
  platformer: {
    costume: { cover: "#ef4444", trim: "#991b1b", hat: "cap", cape: "#2563eb" },
    entrance: "drop",
    stage: "250,204,21",
  },
  racing: {
    costume: { cover: "#dc2626", trim: "#111827", hat: "cap", eyewear: "shades", prop: "flag" },
    entrance: "run",
    stage: "239,68,68",
  },
  tet: {
    // Cream cover so the red-and-gold áo dài stands out; yellow hoa mai in the hair, lì xì in hand.
    costume: {
      cover: "#fde68a",
      trim: "#b91c1c",
      hat: "flower",
      prop: "envelope",
      outfit: "aodai",
    },
    entrance: "fly",
    stage: "250,204,21",
  },
  halloween: {
    costume: { cover: "#7c3aed", trim: "#4c1d95", hat: "witch", prop: "wand" },
    entrance: "fly",
    stage: "249,115,22",
  },
  christmas: {
    costume: { cover: "#16a34a", trim: "#14532d", hat: "santa", prop: "lollipop" },
    entrance: "drop",
    stage: "239,68,68",
  },
  midautumn: {
    costume: { cover: "#f59e0b", trim: "#92400e", hat: "flower", prop: "lollipop" },
    entrance: "fly",
    stage: "253,224,71",
  },
  valentine: {
    costume: { cover: "#e11d48", trim: "#881337", hat: "bow", prop: "envelope" },
    entrance: "fly",
    stage: "244,63,94",
  },
  floral: {
    costume: { cover: "#f472b6", trim: "#9d174d", hat: "flower" },
    entrance: "fly",
    stage: "244,114,182",
  },
  teachers: {
    costume: { cover: "#0f766e", trim: "#134e4a", hat: "cap", eyewear: "glasses" },
    entrance: "drop",
    stage: "227,179,65",
  },
  mensday: {
    costume: { cover: "#0284c7", trim: "#0c4a6e", hat: "headphones", eyewear: "visor" },
    entrance: "pixel",
    stage: "34,211,238",
  },
  national: {
    costume: { cover: "#dc2626", trim: "#facc15", hat: "cap", prop: "vnflag" },
    entrance: "drop",
    stage: "250,204,21",
  },
  heritage: {
    costume: { cover: "#b45309", trim: "#78350f", hat: "tophat" },
    entrance: "drop",
    stage: "217,119,6",
  },
  lotus: {
    costume: { cover: "#ec4899", trim: "#9d174d", hat: "flower" },
    entrance: "fly",
    stage: "253,224,71",
  },
  kids: {
    costume: { cover: "#f97316", trim: "#c2410c", hat: "cap", prop: "lollipop" },
    entrance: "run",
    stage: "56,189,248",
  },
  easter: {
    costume: { cover: "#a78bfa", trim: "#5b21b6", hat: "bow", prop: "lollipop" },
    entrance: "run",
    stage: "167,139,250",
  },
  spring: {
    costume: { cover: "#16a34a", trim: "#14532d", hat: "flower" },
    entrance: "fly",
    stage: "74,222,128",
  },
  harvest: {
    costume: { cover: "#c2410c", trim: "#7c2d12", hat: "hardhat" },
    entrance: "drop",
    stage: "245,158,11",
  },
  pirate: {
    costume: { cover: "#92400e", trim: "#451a03", hat: "pirate", eyewear: "patch" },
    entrance: "run",
    stage: "251,191,36",
  },
  ninja: {
    costume: { cover: "#1e293b", trim: "#0f172a", hat: "ninja" },
    entrance: "pixel",
    stage: "239,68,68",
  },
  rocket: {
    costume: { cover: "#e2e8f0", trim: "#3b82f6", hat: "helmet" },
    entrance: "rocket",
    stage: "99,102,241",
  },
  jungle: {
    costume: { cover: "#15803d", trim: "#14532d", hat: "hardhat", eyewear: "goggles" },
    entrance: "drop",
    stage: "74,222,128",
  },
  cyberpunk: {
    costume: { cover: "#0f172a", trim: "#be185d", eyewear: "visor", hat: "headphones" },
    entrance: "pixel",
    stage: "34,211,238",
  },
  steampunk: {
    costume: { cover: "#b45309", trim: "#78350f", hat: "tophat", eyewear: "goggles" },
    entrance: "fly",
    stage: "251,191,36",
  },
  candy: {
    costume: { cover: "#f472b6", trim: "#be185d", hat: "bow", prop: "lollipop" },
    entrance: "drop",
    stage: "244,114,182",
  },
  kawaii: {
    costume: { cover: "#fda4af", trim: "#e11d48", hat: "bow", prop: "wand" },
    entrance: "fly",
    stage: "251,113,133",
  },
};
