/**
 * "Hubby" — the WikiHub mascot: a round, friendly owl of knowledge. One body,
 * many costumes: every welcome theme dresses Hubby differently. Drawn in unit
 * space (body ≈ 0.88 wide × 1.04 tall, origin at its centre) and scaled to `size`.
 */
import { clamp01 } from "@/components/users/welcome-effects/helpers";

export type MascotHat =
  | "crown"
  | "hood"
  | "witch"
  | "pirate"
  | "ninja"
  | "helmet"
  | "santa"
  | "bow"
  | "hardhat"
  | "tophat"
  | "flower"
  | "cap"
  | "headphones";
export type MascotEyewear = "shades" | "visor" | "goggles" | "patch" | "glasses";
export type MascotProp = "pickaxe" | "envelope" | "lollipop" | "wand" | "flag" | "vnflag";
export type MascotPose = "fly" | "walk" | "present" | "wave";

export interface MascotCostume {
  /** Body colour (the belly and face are lighter tints of it). */
  cover: string;
  /** Wings and ear tufts. */
  trim: string;
  hat?: MascotHat;
  eyewear?: MascotEyewear;
  prop?: MascotProp;
  /** Square, pixel-art body (Block Craft, Arcade). */
  blocky?: boolean;
  /** Small cape on the back (admin, platformer…). */
  cape?: string;
  /** Traditional outfit worn over the cover: Vietnamese áo dài (Tết). */
  outfit?: "aodai";
}

export interface MascotDrawOptions {
  pose: MascotPose;
  costume: MascotCostume;
  /** 1 = facing right, -1 = facing left (towards the avatar). */
  facing: 1 | -1;
  /** Seconds-ish clock driving the idle motion. */
  clock: number;
  alpha: number;
  rotation?: number;
}

const INK = "#1f2937";

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawHat(ctx: CanvasRenderingContext2D, hat: MascotHat, trim: string, clock: number) {
  const top = -0.5;
  ctx.lineWidth = 0.04;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  switch (hat) {
    case "crown": {
      ctx.fillStyle = "#fcd34d";
      ctx.beginPath();
      ctx.moveTo(-0.26, top + 0.02);
      ctx.lineTo(-0.3, top - 0.24);
      ctx.lineTo(-0.15, top - 0.1);
      ctx.lineTo(0, top - 0.3);
      ctx.lineTo(0.15, top - 0.1);
      ctx.lineTo(0.3, top - 0.24);
      ctx.lineTo(0.26, top + 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(0, top - 0.04, 0.04, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "hood": {
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.moveTo(-0.46, top + 0.34);
      ctx.quadraticCurveTo(-0.5, top - 0.18, 0, top - 0.16);
      ctx.quadraticCurveTo(0.5, top - 0.18, 0.46, top + 0.34);
      ctx.quadraticCurveTo(0.3, top + 0.12, 0, top + 0.12);
      ctx.quadraticCurveTo(-0.3, top + 0.12, -0.46, top + 0.34);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "witch": {
      ctx.fillStyle = "#312e81";
      ctx.beginPath();
      ctx.moveTo(-0.2, top + 0.02);
      ctx.quadraticCurveTo(-0.08, top - 0.3, 0.12, top - 0.48);
      ctx.quadraticCurveTo(0.14, top - 0.2, 0.2, top + 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f97316";
      ctx.fillRect(-0.19, top - 0.07, 0.38, 0.06);
      ctx.fillStyle = "#312e81";
      ctx.beginPath();
      ctx.ellipse(0, top + 0.03, 0.4, 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "pirate": {
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.moveTo(-0.42, top + 0.06);
      ctx.quadraticCurveTo(-0.3, top - 0.3, 0, top - 0.2);
      ctx.quadraticCurveTo(0.3, top - 0.3, 0.42, top + 0.06);
      ctx.quadraticCurveTo(0, top - 0.02, -0.42, top + 0.06);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(0, top - 0.1, 0.045, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "ninja": {
      ctx.fillStyle = "#dc2626";
      ctx.fillRect(-0.44, top + 0.12, 0.88, 0.1);
      ctx.strokeRect(-0.44, top + 0.12, 0.88, 0.1);
      const sway = Math.sin(clock * 5) * 0.04;
      ctx.beginPath();
      ctx.moveTo(-0.44, top + 0.17);
      ctx.lineTo(-0.62, top + 0.12 + sway);
      ctx.lineTo(-0.58, top + 0.26 + sway);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(-0.06, top + 0.14, 0.12, 0.06);
      break;
    }
    case "helmet": {
      ctx.fillStyle = "rgba(186,230,253,0.35)";
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.arc(0, -0.04, 0.58, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.arc(0, -0.04, 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.ellipse(-0.26, -0.34, 0.07, 0.13, -0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "santa": {
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.moveTo(-0.34, top + 0.04);
      ctx.quadraticCurveTo(-0.28, top - 0.3, 0.3, top - 0.28);
      ctx.quadraticCurveTo(0.42, top - 0.06, 0.34, top + 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      rr(ctx, -0.38, top - 0.04, 0.76, 0.1, 0.05);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0.32, top - 0.26, 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "bow": {
      ctx.fillStyle = "#f472b6";
      ctx.beginPath();
      ctx.moveTo(0.18, top - 0.04);
      ctx.lineTo(0.02, top - 0.17);
      ctx.lineTo(0.02, top + 0.09);
      ctx.closePath();
      ctx.moveTo(0.18, top - 0.04);
      ctx.lineTo(0.34, top - 0.17);
      ctx.lineTo(0.34, top + 0.09);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0.18, top - 0.04, 0.045, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "hardhat": {
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.moveTo(-0.34, top + 0.06);
      ctx.quadraticCurveTo(-0.3, top - 0.22, 0, top - 0.2);
      ctx.quadraticCurveTo(0.3, top - 0.22, 0.34, top + 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      rr(ctx, -0.42, top + 0.02, 0.84, 0.07, 0.03);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fffbeb";
      ctx.beginPath();
      ctx.arc(0, top - 0.1, 0.05, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "tophat": {
      ctx.fillStyle = "#78350f";
      rr(ctx, -0.2, top - 0.3, 0.4, 0.32, 0.03);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, top + 0.02, 0.34, 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(-0.2, top - 0.08, 0.4, 0.06);
      break;
    }
    case "flower": {
      const fx = 0.22;
      const fy = top + 0.03;
      ctx.fillStyle = "#fde047";
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(fx + Math.cos(a) * 0.075, fy + Math.sin(a) * 0.075, 0.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.arc(fx, fy, 0.04, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "cap": {
      ctx.fillStyle = trim;
      ctx.beginPath();
      ctx.moveTo(-0.3, top + 0.06);
      ctx.quadraticCurveTo(-0.24, top - 0.2, 0.04, top - 0.18);
      ctx.quadraticCurveTo(0.3, top - 0.18, 0.32, top + 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      rr(ctx, 0.1, top + 0.02, 0.38, 0.07, 0.035);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "headphones": {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.arc(0, -0.2, 0.46, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.fillStyle = trim;
      ctx.lineWidth = 0.03;
      for (const sx of [-0.45, 0.45]) {
        rr(ctx, sx - 0.06, -0.3, 0.12, 0.26, 0.05);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
  }
}

const AODAI_RED = "#dc2626";
const AODAI_GOLD = "#fbbf24";

/**
 * Áo dài, drawn as the real garment rather than trousers: a fitted bodice from a small
 * mandarin collar down to the waist, the diagonal "cổ chéo" fastening with gold buttons,
 * then side slits and one long front panel (tà trước) that sways down past the knees,
 * with the back panel just visible behind it. Gold blossoms and a gold hem finish it.
 * No trousers are drawn: Hubby's talons show below the panel.
 */
function drawAoDai(ctx: CanvasRenderingContext2D, clock: number) {
  const sway = Math.sin(clock * 3) * 0.022;
  ctx.lineWidth = 0.03;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";

  // back panel, a shade darker, peeking out on the far side
  ctx.fillStyle = "#b91c1c";
  ctx.beginPath();
  ctx.moveTo(-0.26, 0.3);
  ctx.quadraticCurveTo(-0.3, 0.5, -0.27 - sway, 0.66);
  ctx.quadraticCurveTo(-0.17 - sway, 0.69, -0.1 - sway, 0.66);
  ctx.lineTo(-0.1, 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // fitted bodice: collar line to waist, following the round body
  ctx.fillStyle = AODAI_RED;
  ctx.beginPath();
  ctx.moveTo(-0.38, 0.14);
  ctx.quadraticCurveTo(0, 0.1, 0.38, 0.14);
  ctx.quadraticCurveTo(0.39, 0.24, 0.33, 0.32);
  ctx.quadraticCurveTo(0, 0.35, -0.33, 0.32);
  ctx.quadraticCurveTo(-0.39, 0.24, -0.38, 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // long front panel (tà trước) from the waist, swaying, with a rounded hem
  ctx.beginPath();
  ctx.moveTo(-0.16, 0.31);
  ctx.lineTo(0.16, 0.31);
  ctx.quadraticCurveTo(0.19 + sway * 0.5, 0.52, 0.25 + sway, 0.73);
  ctx.quadraticCurveTo(0 + sway, 0.79, -0.25 + sway, 0.73);
  ctx.quadraticCurveTo(-0.19 + sway * 0.5, 0.52, -0.16, 0.31);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // gold hem on the front panel
  ctx.strokeStyle = AODAI_GOLD;
  ctx.lineWidth = 0.028;
  ctx.beginPath();
  ctx.moveTo(-0.23 + sway, 0.705);
  ctx.quadraticCurveTo(0 + sway, 0.76, 0.23 + sway, 0.705);
  ctx.stroke();

  // diagonal fastening from the collar to the underarm, with gold buttons
  ctx.beginPath();
  ctx.moveTo(0.05, 0.15);
  ctx.quadraticCurveTo(0.2, 0.17, 0.33, 0.26);
  ctx.stroke();
  ctx.fillStyle = AODAI_GOLD;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.015;
  for (const [bx, by] of [[0.11, 0.158], [0.21, 0.18], [0.3, 0.235]] as const) {
    ctx.beginPath();
    ctx.arc(bx, by, 0.022, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // small mandarin collar at the neck
  ctx.lineWidth = 0.022;
  rr(ctx, -0.13, 0.095, 0.26, 0.06, 0.025);
  ctx.fill();
  ctx.stroke();

  // gold blossoms (five dots round a centre) down the front panel
  for (const [fx, fy] of [[0, 0.42], [-0.08, 0.56], [0.09, 0.6]] as const) {
    ctx.fillStyle = AODAI_GOLD;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(fx + sway + Math.cos(a) * 0.026, fy + Math.sin(a) * 0.026, 0.016, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#b91c1c";
    ctx.beginPath();
    ctx.arc(fx + sway, fy, 0.011, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEyewear(ctx: CanvasRenderingContext2D, kind: MascotEyewear, clock: number) {
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = INK;
  switch (kind) {
    case "shades": {
      ctx.fillStyle = "#0f172a";
      rr(ctx, -0.3, -0.19, 0.26, 0.15, 0.05);
      ctx.fill();
      rr(ctx, 0.04, -0.19, 0.26, 0.15, 0.05);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-0.04, -0.14);
      ctx.lineTo(0.04, -0.14);
      ctx.stroke();
      ctx.fillStyle = "rgba(244,114,182,0.6)";
      ctx.fillRect(-0.27, -0.17, 0.08, 0.03);
      ctx.fillRect(0.07, -0.17, 0.08, 0.03);
      break;
    }
    case "visor": {
      const hue = 170 + Math.sin(clock * 3) * 30;
      ctx.fillStyle = `hsl(${hue} 95% 55%)`;
      rr(ctx, -0.34, -0.2, 0.68, 0.14, 0.06);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "goggles": {
      ctx.fillStyle = "rgba(180,83,9,0.9)";
      for (const gx of [-0.15, 0.17]) {
        ctx.beginPath();
        ctx.arc(gx, -0.12, 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(254,243,199,0.9)";
        ctx.beginPath();
        ctx.arc(gx, -0.12, 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(180,83,9,0.9)";
      }
      break;
    }
    case "patch": {
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.arc(0.17, -0.12, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-0.4, -0.3);
      ctx.lineTo(0.17, -0.12);
      ctx.stroke();
      break;
    }
    case "glasses": {
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 0.045;
      for (const gx of [-0.15, 0.17]) {
        ctx.beginPath();
        ctx.arc(gx, -0.12, 0.12, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, -0.12);
      ctx.lineTo(0.02, -0.12);
      ctx.stroke();
      break;
    }
  }
}

/** Draw a prop whose grip (its local origin, the bottom of the handle) sits at (gx, gy). */
function drawProp(
  ctx: CanvasRenderingContext2D,
  prop: MascotProp,
  swing: number,
  gx: number,
  gy: number,
  clock: number,
) {
  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(swing);
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = INK;
  switch (prop) {
    case "pickaxe": {
      ctx.fillStyle = "#92400e";
      ctx.fillRect(-0.025, -0.5, 0.05, 0.55);
      ctx.strokeRect(-0.025, -0.5, 0.05, 0.55);
      ctx.fillStyle = "#67e8f9";
      ctx.beginPath();
      ctx.moveTo(-0.26, -0.44);
      ctx.quadraticCurveTo(0, -0.62, 0.26, -0.44);
      ctx.lineTo(0.2, -0.4);
      ctx.quadraticCurveTo(0, -0.54, -0.2, -0.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "envelope": {
      // lì xì: red packet, gold border, darker flap and a gold seal
      ctx.fillStyle = "#dc2626";
      rr(ctx, -0.12, -0.28, 0.24, 0.32, 0.03);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 0.018;
      rr(ctx, -0.095, -0.255, 0.19, 0.27, 0.02);
      ctx.stroke();
      ctx.fillStyle = "#b91c1c";
      ctx.beginPath();
      ctx.moveTo(-0.12, -0.28);
      ctx.lineTo(0, -0.14);
      ctx.lineTo(0.12, -0.28);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.025;
      ctx.stroke();
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(0, -0.13, 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "lollipop": {
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(0, 0.04);
      ctx.lineTo(0, -0.34);
      ctx.stroke();
      ctx.fillStyle = "#f472b6";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.arc(0, -0.44, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(0, -0.44, 0.07, 0, Math.PI * 1.6);
      ctx.stroke();
      break;
    }
    case "wand": {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(0, 0.04);
      ctx.lineTo(0.12, -0.42);
      ctx.stroke();
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(0.12, -0.46, 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "flag": {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.moveTo(0, 0.04);
      ctx.lineTo(0, -0.56);
      ctx.stroke();
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.moveTo(0, -0.56);
      ctx.lineTo(0.28, -0.46);
      ctx.lineTo(0, -0.36);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 0.03;
      ctx.stroke();
      break;
    }
    case "vnflag": {
      // a small hand-held Vietnamese flag (3:2, red with a gold star) rippling in the wind
      ctx.strokeStyle = "#78350f";
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.moveTo(0, 0.04);
      ctx.lineTo(0, -0.64);
      ctx.stroke();
      const fw = 0.42;
      const fh = 0.28;
      const top = -0.62;
      const wave = (u: number) => Math.sin(u * 4.5 - clock * 7) * 0.03 * u;
      const strips = 10;
      for (let i = 0; i < strips; i++) {
        const u0 = i / strips;
        const u1 = (i + 1) / strips;
        ctx.fillStyle = `hsl(0, 78%, ${46 + Math.cos(((u0 + u1) / 2) * 4.5 - clock * 7) * 6}%)`;
        ctx.beginPath();
        ctx.moveTo(u0 * fw, top + wave(u0));
        ctx.lineTo(u1 * fw + 0.004, top + wave(u1));
        ctx.lineTo(u1 * fw + 0.004, top + fh + wave(u1));
        ctx.lineTo(u0 * fw, top + fh + wave(u0));
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(127,29,29,0.8)";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      for (let i = 0; i <= strips; i++) ctx.lineTo((i / strips) * fw, top + wave(i / strips));
      for (let i = strips; i >= 0; i--) ctx.lineTo((i / strips) * fw, top + fh + wave(i / strips));
      ctx.closePath();
      ctx.stroke();
      // gold star
      const sx = fw / 2;
      const sy = top + fh / 2 + wave(0.5);
      const R = fh * 0.3;
      ctx.fillStyle = "#ffde00";
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? R : R * 0.382;
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        if (i === 0) ctx.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
        else ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** Mix a #rrggbb colour towards white (k = 0 unchanged, 1 = white). */
function tint(hex: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const mix = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

/** Draw Hubby with its centre at (x, y); `size` is the body height in pixels. */
export function drawMascot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  o: MascotDrawOptions,
) {
  if (o.alpha <= 0.01 || size < 4) return;
  const { costume: c, pose, clock } = o;
  const blink = Math.sin(clock * 1.3 + 1) > 0.965 ? 0.12 : 1;
  const flap = Math.sin(clock * 14);
  const step = Math.sin(clock * 12);
  const wingColour = c.outfit === "aodai" ? AODAI_RED : c.trim;

  ctx.save();
  ctx.globalAlpha = clamp01(o.alpha);
  ctx.translate(x, y);
  if (o.rotation) ctx.rotate(o.rotation);
  ctx.scale(size * o.facing, size);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // soft ground shadow keeps the mascot readable on any backdrop
  ctx.fillStyle = "rgba(15,23,42,0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 0.62, 0.36, 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  if (c.cape) {
    ctx.fillStyle = c.cape;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(-0.36, -0.3);
    ctx.quadraticCurveTo(-0.66 - flap * 0.04, 0.1, -0.5, 0.58);
    ctx.lineTo(-0.2, 0.46);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // talons
  ctx.fillStyle = "#f59e0b";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.035;
  const lift = pose === "walk" ? step * 0.05 : 0;
  for (const fx of [-0.16, 0.16]) {
    const ly = fx < 0 ? -Math.max(0, lift) : -Math.max(0, -lift);
    ctx.beginPath();
    ctx.ellipse(fx, 0.52 + ly, 0.11, 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // ear tufts
  ctx.fillStyle = c.trim;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.2, -0.4);
    ctx.lineTo(s * 0.36, -0.64);
    ctx.lineTo(s * 0.4, -0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // body: a round owl, or a square one for the pixel themes
  ctx.fillStyle = c.cover;
  ctx.lineWidth = 0.05;
  if (c.blocky) rr(ctx, -0.43, -0.5, 0.86, 1, 0.04);
  else {
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.44, 0.52, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();

  // belly with feather scallops
  ctx.fillStyle = tint(c.cover, 0.8);
  if (c.blocky) {
    rr(ctx, -0.26, -0.04, 0.52, 0.46, 0.03);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(0, 0.18, 0.28, 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.globalAlpha *= 0.5;
  ctx.strokeStyle = c.trim;
  ctx.lineWidth = 0.022;
  for (const [sx, sy] of [[-0.1, 0.14], [0.1, 0.14], [0, 0.26], [-0.12, 0.34], [0.12, 0.34]] as const) {
    ctx.beginPath();
    ctx.arc(sx, sy, 0.06, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
  if (c.blocky) {
    // pixel shading
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(-0.4, -0.47, 0.6, 0.08);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(-0.3, 0.39, 0.6, 0.08);
  }
  if (c.outfit === "aodai") drawAoDai(ctx, clock);

  // facial discs and big round eyes
  ctx.fillStyle = tint(c.cover, 0.9);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * 0.17, -0.13, 0.17, 0, Math.PI * 2);
    ctx.fill();
  }
  const eyeY = -0.13;
  ctx.strokeStyle = INK;
  for (const ex of [-0.16, 0.17]) {
    ctx.lineWidth = 0.03;
    if (blink < 1) {
      ctx.beginPath();
      ctx.moveTo(ex - 0.08, eyeY);
      ctx.quadraticCurveTo(ex, eyeY + 0.05, ex + 0.08, eyeY);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 0.1, 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(ex + 0.025, eyeY + 0.015, 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ex + 0.045, eyeY - 0.01, 0.02, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(251,113,133,0.5)";
  for (const cx of [-0.3, 0.31]) {
    ctx.beginPath();
    ctx.ellipse(cx, 0.0, 0.055, 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // beak: closed while idle, open and cheerful when presenting or waving
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.025;
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.moveTo(-0.055, -0.01);
  ctx.lineTo(0.055, -0.01);
  ctx.lineTo(0, pose === "present" || pose === "wave" ? 0.05 : 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (pose === "present" || pose === "wave") {
    ctx.fillStyle = "#7f1d1d";
    ctx.beginPath();
    ctx.moveTo(-0.035, 0.06);
    ctx.lineTo(0.035, 0.06);
    ctx.lineTo(0, 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (c.eyewear) drawEyewear(ctx, c.eyewear, clock);
  if (c.hat) drawHat(ctx, c.hat, c.trim, clock);

  // wings: spread and flapping in flight, otherwise the back one rests and the
  // front one points at the avatar or waves goodbye
  ctx.fillStyle = wingColour;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.04;
  const wing = (side: -1 | 1, ang: number) => {
    ctx.save();
    ctx.translate(side * 0.4, -0.02);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.ellipse(0, 0.16, 0.09, 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  let frontAng = 0.25;
  if (pose === "fly") {
    wing(-1, 1.3 + flap * 0.45);
    frontAng = -1.3 - flap * 0.45;
  } else {
    wing(-1, 0.25 + (pose === "walk" ? -step * 0.12 : 0));
    if (pose === "present") frontAng = -1.0 + Math.sin(clock * 5) * 0.06;
    else if (pose === "wave") frontAng = -2.4 + Math.sin(clock * 14) * 0.35;
    else if (pose === "walk") frontAng = 0.25 + step * 0.2;
  }
  // The prop is gripped at the tip of the front wing: it moves with the wing and is
  // drawn first so the wingtip sits over its handle.
  if (c.prop) {
    const gripX = 0.4 - Math.sin(frontAng) * 0.3;
    const gripY = -0.02 + Math.cos(frontAng) * 0.3;
    // A lowered wing tilts the prop outwards so it never crosses the face;
    // a raised wing holds it upright.
    const lean = clamp01((frontAng + 1) * 0.5) * 0.7;
    const swing = pose === "wave" ? Math.sin(clock * 14) * 0.2 : Math.sin(clock * 3) * 0.08;
    drawProp(ctx, c.prop, swing + lean, gripX, gripY, clock);
  }
  wing(1, frontAng);

  ctx.restore();
}
