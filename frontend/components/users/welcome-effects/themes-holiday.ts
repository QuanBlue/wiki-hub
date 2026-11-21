/**
 * Holiday pack (played on Home during the matching seasonal theme; not member-pickable):
 * Valentine, Floral (8/3 · 20/10), Teachers' Day, Men's Day, Children's Day, Easter,
 * Spring Green, Autumn Harvest.
 */
import { DURATION_MS, type FrameRenderer } from "@/components/users/welcome-effects/engine";
import {
  clamp01,
  drawGlow,
  drawSparkle,
  easeOutCubic,
  envelope,
  hash,
  smooth,
} from "@/components/users/welcome-effects/helpers";
import {
  drawCornucopia,
  drawCupidHeart,
  drawEarthGlobe,
  drawEasterBunny,
  drawHatchingChick,
  drawHeartBalloon,
  drawHotAirBalloon,
  drawKite,
  drawLoveLetter,
  drawNeonSign,
  drawNeonSkyline,
  drawPinwheel,
  drawPumpkin,
  drawRainbow,
  drawSapling,
  drawTulip,
  drawTurkey,
} from "@/components/users/welcome-effects/scene-details-2";
import {
  drawBouquet,
  drawChalkboard,
  drawGiftBox,
  drawPaperPlane,
} from "@/components/users/welcome-effects/scene-details";
import {
  edgeX,
  focusOr,
  fs,
  heartPath,
  starPath,
  TAU,
  TOPBAR_H,
} from "@/components/users/welcome-effects/shapes";

function begin(ctx: CanvasRenderingContext2D, w: number, h: number, ms: number) {
  ctx.clearRect(0, 0, w, h);
  const t = clamp01(ms / DURATION_MS);
  const env = envelope(t);
  ctx.save();
  ctx.globalAlpha = env;
  return { t, env, clock: ms / 1000 };
}

function rose(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  for (let ring = 0; ring < 3; ring++) {
    const rr = r * (1 - ring * 0.28);
    const n = 5 - ring;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + ring * 0.6;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr * 0.42, Math.sin(a) * rr * 0.42, rr * 0.55, 0, TAU);
      fs(ctx, ring === 0 ? "#fb7185" : ring === 1 ? "#f43f5e" : "#be123c", "#881337", 0.9);
    }
  }
  ctx.restore();
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, fill: string, edge: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(-s, 0);
  ctx.quadraticCurveTo(0, -s * 0.6, s, 0);
  ctx.quadraticCurveTo(0, s * 0.6, -s, 0);
  ctx.closePath();
  fs(ctx, fill, edge, 1);
  ctx.restore();
}

/* ------------------------------ Valentine ------------------------------ */

export function createValentineRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    const f = focusOr(focus, w, h);
    // hearts rising along the edges
    for (let i = 0; i < 22; i++) {
      const life = (clock * (0.1 + hash(i) * 0.12) + hash(i * 5)) % 1;
      const x = edgeX(i * 3 + 2, w, 0.28) + Math.sin(clock * 1.3 + i) * 14;
      const y = h + 20 - life * (h + 40);
      const s = 7 + hash(i * 11) * 9;
      ctx.globalAlpha = env * Math.sin(life * Math.PI);
      heartPath(ctx, x, y, s);
      fs(ctx, i % 3 === 0 ? "#fda4af" : "#e11d48", "#881337", 1);
    }
    ctx.globalAlpha = env;
    // ribbon of small hearts circling the avatar
    const grow = easeOutCubic(clamp01((t - 0.06) / 0.3));
    const n = Math.round(14 * grow);
    for (let i = 0; i < n; i++) {
      const a = clock * 0.7 + (i / 14) * TAU;
      const R = f.r * 1.9 + Math.sin(clock * 2 + i) * 4;
      heartPath(ctx, f.x + Math.cos(a) * R, f.y + Math.sin(a) * R, 5);
      fs(ctx, "#f43f5e", "#881337", 0.8);
    }
    // heart balloons tied together on the side away from the avatar, a love letter
    // opening beneath them and Cupid's arrow crossing the page
    const avatarLeft = f.x < w / 2;
    const hb = Math.min(h * 0.07, w * 0.04, 30);
    const knotX = avatarLeft ? w * 0.8 : w * 0.2;
    const knotY = h * 0.72;
    const balloonIn = easeOutCubic(clamp01((t - 0.04) / 0.3));
    ["#f43f5e", "#fb7185", "#e11d48", "#f472b6", "#be123c"].forEach((col, i) => {
      const bx = knotX + (i - 2) * hb * 1.5;
      const by = knotY - hb * (4 + (i % 2) * 1.4) - (1 - balloonIn) * h * 0.4;
      drawHeartBalloon(ctx, bx, by, hb, col, knotX, knotY, clock, i);
    });
    drawLoveLetter(ctx, knotX, h - 14, Math.min(w * 0.14, h * 0.26, 120), clamp01((t - 0.2) / 0.3), clock);
    const arrow = clamp01((t - 0.1) / 0.6);
    if (arrow > 0 && arrow < 1) {
      drawCupidHeart(ctx, w * (-0.1 + arrow * 1.2), h * 0.2 - Math.sin(arrow * Math.PI) * h * 0.05, Math.min(h * 0.05, 24), clock);
    }

    // a rose in each bottom corner
    const rise = (1 - smooth(t / 0.18)) * 80;
    rose(ctx, 36, h - 30 + rise, 20, clock * 0.2);
    rose(ctx, w - 36, h - 30 + rise, 20, -clock * 0.2);
    ctx.restore();
  };
}

/* ------------------------- Floral (8/3 · 20/10) ------------------------- */

export function createFloralRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    const f = focusOr(focus, w, h);
    const grow = easeOutCubic(clamp01(t / 0.35));
    // rose vines curling in from all four corners
    const corners: [number, number, number, number][] = [
      [0, 0, 1, 1],
      [w, 0, -1, 1],
      [0, h, 1, -1],
      [w, h, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      const len = Math.min(w, h) * 0.36 * grow;
      ctx.strokeStyle = "#15803d";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + sx * len * 0.9, cy + sy * len * 0.1, cx + sx * len, cy + sy * len * 0.6);
      ctx.stroke();
      for (let k = 1; k <= 3; k++) {
        const u = k / 3.4;
        if (u > grow) break;
        const px = cx + sx * len * u * 0.95;
        const py = cy + sy * len * u * u * 0.6;
        leaf(ctx, px, py - sy * 8, 8, sx * 0.6, "#22c55e", "#14532d");
        rose(ctx, px, py, 9 + k * 2, clock * 0.3 * sx);
      }
    }
    // a bouquet and a gift on the side away from the avatar
    const avatarLeft = f.x < w / 2;
    const bq = Math.min(h * 0.55, w * 0.26, 260);
    const bqX = avatarLeft ? w * 0.78 : w * 0.22;
    const bqIn = easeOutCubic(clamp01((t - 0.04) / 0.28));
    ctx.globalAlpha = env * smooth(bqIn * 2);
    drawGiftBox(ctx, bqX + (avatarLeft ? -1 : 1) * bq * 0.42, h - 8 + (1 - bqIn) * bq * 0.4, bq * 0.28);
    drawBouquet(ctx, bqX, h - 6 + (1 - bqIn) * bq * 0.5, bq, clock);
    ctx.globalAlpha = env;

    // butterflies visiting the flowers
    const wings = ["#f9a8d4", "#fde047", "#c4b5fd"];
    for (let i = 0; i < 3; i++) {
      const bfx = bqX + Math.sin(clock * 0.8 + i * 2.1) * bq * 0.7;
      const bfy = h - bq * (0.95 + i * 0.15) + Math.cos(clock * 1.1 + i) * 18;
      butterfly(ctx, bfx, bfy, 11, 0.35 + 0.65 * Math.abs(Math.sin(clock * 9 + i)), wings[i]!);
    }

    // a ring of petals turning slowly round the avatar
    const ring = easeOutCubic(clamp01((t - 0.08) / 0.3));
    for (let i = 0; i < 12; i++) {
      const a = clock * 0.5 + (i / 12) * TAU;
      const R = f.r * (1.6 + 0.2 * Math.sin(clock * 2 + i)) * ring;
      ctx.beginPath();
      ctx.ellipse(f.x + Math.cos(a) * R, f.y + Math.sin(a) * R, 5, 3, a + clock, 0, TAU);
      fs(ctx, i % 2 ? "#fbcfe8" : "#fb7185", "#be185d", 0.8);
    }

    // drifting petals
    for (let i = 0; i < 26; i++) {
      const life = (clock * (0.09 + hash(i) * 0.1) + hash(i * 7)) % 1;
      const x = edgeX(i * 13, w, 0.34) + Math.sin(clock * 1.2 + i) * 22;
      const y = -10 + life * (h + 20);
      ctx.globalAlpha = env * Math.sin(life * Math.PI);
      ctx.beginPath();
      ctx.ellipse(x, y, 5, 3, clock + i, 0, TAU);
      fs(ctx, i % 2 ? "#fbcfe8" : "#f472b6", "#be185d", 0.8);
    }
    ctx.restore();
  };
}

/* --------------------------- Teachers' Day ----------------------------- */

export function createTeachersRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    const f = focusOr(focus, w, h);
    // laurel wreath growing up both sides of the avatar
    const grow = easeOutCubic(clamp01((t - 0.04) / 0.34));
    const R = f.r * 1.75;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const u = i / 8;
        if (u > grow) break;
        const a = Math.PI / 2 - side * u * Math.PI * 0.8;
        const x = f.x + Math.cos(a) * R;
        const y = f.y + Math.sin(a) * R;
        leaf(ctx, x, y, 9 - u * 2, a + side * 0.9, "#14b8a6", "#134e4a");
      }
    }
    // open books in the bottom corners with a page turning
    for (const [bx, dir] of [[w * 0.1, 1], [w * 0.9, -1]] as const) {
      const by = h - 34 + (1 - smooth(t / 0.16)) * 80;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(bx, by + 14);
        ctx.quadraticCurveTo(bx + s * 18, by + 8, bx + s * 34, by + 12);
        ctx.lineTo(bx + s * 34, by - 12);
        ctx.quadraticCurveTo(bx + s * 18, by - 18, bx, by - 10);
        ctx.closePath();
        fs(ctx, "#fffbeb", "#0f766e", 1.6);
      }
      const turn = Math.cos(clock * 2.4 * dir);
      ctx.beginPath();
      ctx.moveTo(bx, by - 10);
      ctx.quadraticCurveTo(bx + turn * 16, by - 22, bx + turn * 30, by - 14);
      ctx.lineTo(bx + turn * 30, by + 10);
      ctx.lineTo(bx, by + 14);
      ctx.closePath();
      fs(ctx, "#fef3c7", "#0f766e", 1.2);
    }
    // a chalkboard on the side away from the avatar, the greeting chalked on stroke by stroke
    const avatarLeft = f.x < w / 2;
    const bw = Math.min(w * 0.3, h * 0.8, 320);
    const bx = avatarLeft ? w - bw - w * 0.06 : w * 0.06;
    const by = h * 0.14;
    const boardIn = smooth((t - 0.03) / 0.14);
    ctx.globalAlpha = env * boardIn;
    drawChalkboard(ctx, bx, by - (1 - boardIn) * 20, bw, clamp01((t - 0.12) / 0.45), ["Tri ân Thầy Cô", "20 · 11"]);
    ctx.globalAlpha = env;

    // paper planes gliding out from the board with dotted trails
    for (let k = 0; k < 3; k++) {
      const p = (clock * 0.16 + k * 0.33) % 1;
      const x0 = avatarLeft ? bx : bx + bw;
      const dirX = avatarLeft ? -1 : 1;
      const px = x0 + dirX * p * w * 0.55;
      const py = by + bw * 0.25 + k * h * 0.1 - Math.sin(p * Math.PI) * h * 0.12;
      const dy = -Math.cos(p * Math.PI) * h * 0.12 * Math.PI;
      const ang = Math.atan2(dy, dirX * w * 0.55);
      ctx.globalAlpha = env * Math.sin(p * Math.PI);
      for (let d = 1; d <= 5; d++) {
        const q = Math.max(0, p - d * 0.025);
        ctx.beginPath();
        ctx.arc(
          x0 + dirX * q * w * 0.55,
          by + bw * 0.25 + k * h * 0.1 - Math.sin(q * Math.PI) * h * 0.12,
          1.2,
          0,
          TAU,
        );
        fs(ctx, "rgba(15,118,110,0.5)", null);
      }
      drawPaperPlane(ctx, px, py, Math.min(30, h * 0.07), ang);
    }
    ctx.globalAlpha = env;

    // slow golden motes
    for (let i = 0; i < 20; i++) {
      const x = edgeX(i * 9 + 3, w, 0.32) + Math.sin(clock * 0.6 + i) * 18;
      const y = h * (0.1 + hash(i * 4) * 0.8) - clock * 8;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(clock * 2 + i));
      drawSparkle(ctx, x, ((y % h) + h) % h, 2.4, "#e3b341", "#92400e", tw * env);
    }
    ctx.restore();
  };
}

/* ------------------------------ Men's Day ------------------------------ */

export function createMensdayRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    const f = focusOr(focus, w, h);
    // circuit traces running in from the side edges
    const trace = easeOutCubic(clamp01(t / 0.4));
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (let i = 0; i < 8; i++) {
      const left = i % 2 === 0;
      const y = h * (0.12 + (i / 8) * 0.8);
      const len = w * (0.16 + hash(i) * 0.12) * trace;
      const x0 = left ? 0 : w;
      const x1 = left ? len : w - len;
      ctx.strokeStyle = "rgba(2,132,199,0.85)";
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1 - (left ? 14 : -14), y);
      ctx.lineTo(x1, y + (hash(i * 3) < 0.5 ? -14 : 14));
      ctx.stroke();
      drawGlow(ctx, x1, y, 10, "34,211,238", 0.8);
      ctx.beginPath();
      ctx.arc(x1, y + (hash(i * 3) < 0.5 ? -14 : 14), 3, 0, TAU);
      fs(ctx, "#22d3ee", "#0c4a6e", 1);
    }
    // floating prisms
    for (let i = 0; i < 6; i++) {
      const x = edgeX(i * 17 + 5, w, 0.24);
      const y = h * (0.2 + hash(i * 2) * 0.6) + Math.sin(clock * 1.5 + i) * 10;
      const s = 10 + hash(i * 5) * 8;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(clock * 0.8 + i);
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.87, s * 0.5);
      ctx.lineTo(-s * 0.87, s * 0.5);
      ctx.closePath();
      fs(ctx, "rgba(56,189,248,0.35)", "#0284c7", 1.5);
      ctx.restore();
    }
    // a night skyline along the bottom and a neon sign on the side away from the avatar
    drawNeonSkyline(ctx, w, h, Math.min(h * 0.28, 140), clock, easeOutCubic(clamp01(t / 0.3)));
    const avatarLeft = f.x < w / 2;
    const sw = Math.min(w * 0.26, h * 0.62, 260);
    const signIn = smooth((t - 0.08) / 0.15);
    ctx.globalAlpha = env * signIn;
    drawNeonSign(ctx, avatarLeft ? w - sw - w * 0.06 : w * 0.06, h * 0.16, sw, clock);
    ctx.globalAlpha = env;

    // neon pulse rings from the avatar
    for (let k = 0; k < 3; k++) {
      const p = (clock * 0.5 + k / 3) % 1;
      ctx.globalAlpha = env * (1 - p) * 0.8;
      ctx.strokeStyle = "#06b6d4";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1.3 + p * 1.6), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  };
}

/* --------------------------- Children's Day ---------------------------- */

const KID_COLOURS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#38bdf8", "#a855f7"];

export function createKidsRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    // bunting across the top of the content area (below the top bar)
    ctx.save();
    ctx.translate(0, TOPBAR_H);
    const drop = smooth(t / 0.15);
    const flags = Math.max(8, Math.round(w / 48));
    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= flags; i++) {
      const x = (i / flags) * w;
      const y = (10 + Math.sin((i / flags) * Math.PI) * 18) * drop;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let i = 0; i < flags; i++) {
      const x = ((i + 0.5) / flags) * w;
      const y = (10 + Math.sin(((i + 0.5) / flags) * Math.PI) * 18) * drop;
      const sway = Math.sin(clock * 3 + i) * 3;
      ctx.beginPath();
      ctx.moveTo(x - 12, y);
      ctx.lineTo(x + 12, y);
      ctx.lineTo(x + sway, y + 22);
      ctx.closePath();
      fs(ctx, KID_COLOURS[i % KID_COLOURS.length]!, "#1f2937", 1);
    }
    ctx.restore();
    // balloons floating up the sides
    for (let i = 0; i < 10; i++) {
      const life = (clock * (0.1 + hash(i) * 0.08) + hash(i * 3)) % 1;
      const x = edgeX(i * 7 + 11, w, 0.26) + Math.sin(clock + i) * 10;
      const y = h + 40 - life * (h + 80);
      const c = KID_COLOURS[i % KID_COLOURS.length]!;
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 20);
      ctx.quadraticCurveTo(x - 6, y + 34, x, y + 48);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x, y, 14, 18, 0, 0, TAU);
      fs(ctx, c, "#1f2937", 1.2);
      ctx.beginPath();
      ctx.ellipse(x - 5, y - 6, 3, 5, -0.4, 0, TAU);
      fs(ctx, "rgba(255,255,255,0.6)", null);
    }
    // a hot-air balloon drifting up on the side away from the avatar, a kite above it
    // and paper pinwheels (chong chóng) spinning along the bottom
    const f = focusOr(focus, w, h);
    const avatarLeft = f.x < w / 2;
    const hab = Math.min(h * 0.32, w * 0.16, 150);
    const habX = avatarLeft ? w * 0.8 : w * 0.2;
    drawHotAirBalloon(ctx, habX, h * 0.62 - easeOutCubic(clamp01(t / 0.6)) * h * 0.22, hab, clock);
    drawKite(
      ctx,
      avatarLeft ? w * 0.62 : w * 0.38,
      h * 0.2,
      Math.min(h * 0.14, 60),
      avatarLeft ? w * 0.7 : w * 0.3,
      h,
      clock,
    );
    for (let i = 0; i < 4; i++) {
      const px = (avatarLeft ? w * 0.56 : w * 0.06) + i * w * 0.1;
      drawPinwheel(ctx, px, h - Math.min(h * 0.2, 80), Math.min(h * 0.04, 16), clock * (3 + i * 0.4) + i);
    }

    // confetti burst from the bottom corners
    for (let i = 0; i < 40; i++) {
      const p = clamp01((t - 0.05) / 0.7);
      const left = i % 2 === 0;
      const ang = -Math.PI / 2 + (left ? 0.5 : -0.5) + (hash(i) - 0.5) * 0.9;
      const sp = 0.5 + hash(i * 3) * 0.6;
      const x = (left ? 0 : w) + Math.cos(ang) * sp * h * p;
      const y = h + Math.sin(ang) * sp * h * p + p * p * h * 0.8;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(clock * 4 + i);
      ctx.fillStyle = KID_COLOURS[i % KID_COLOURS.length]!;
      ctx.fillRect(-4, -2, 8, 4);
      ctx.restore();
    }
    ctx.globalAlpha = env;
    ctx.restore();
  };
}

/* -------------------------------- Easter ------------------------------- */

const EGG_COLOURS: [string, string][] = [
  ["#c4b5fd", "#7c3aed"],
  ["#6ee7b7", "#047857"],
  ["#fde68a", "#b45309"],
  ["#f9a8d4", "#be185d"],
  ["#bae6fd", "#0369a1"],
];

function egg(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string, edge: string) {
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.78, s, 0, 0, TAU);
  fs(ctx, fill, edge, 1.4);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let k = 0; k <= 6; k++) {
    const px = x - s * 0.7 + (k / 6) * s * 1.4;
    const py = y + (k % 2 ? -s * 0.15 : s * 0.15);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function daisy(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  for (let i = 0; i < 8; i++) {
    const a = rot + (i / 8) * TAU;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.5, r * 0.22, a, 0, TAU);
    fs(ctx, "#ffffff", "#94a3b8", 0.8);
  }
  ctx.beginPath();
  ctx.arc(x, y, r * 0.35, 0, TAU);
  fs(ctx, "#facc15", "#a16207", 0.8);
}

export function createEasterRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    // grass strip
    const rise = smooth(t / 0.15);
    ctx.fillStyle = "#86efac";
    ctx.strokeStyle = "#15803d";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h);
    const blades = Math.round(w / 9);
    for (let i = 0; i <= blades; i++) {
      const x = (i / blades) * w;
      ctx.lineTo(x, h - (i % 2 ? 8 : 18 + hash(i) * 10) * rise);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // eggs bouncing in along the bottom
    const count = Math.max(6, Math.round(w / 110));
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count;
      if (Math.abs(u - 0.5) < 0.12) continue;
      const arrive = clamp01((t - i * 0.03) / 0.2);
      const bounce = Math.abs(Math.sin(arrive * Math.PI * 2.5)) * (1 - arrive) * 60;
      const [fill, edge] = EGG_COLOURS[i % EGG_COLOURS.length]!;
      egg(ctx, u * w, h - 22 - bounce + (1 - smooth(arrive * 3)) * 60, 14, fill, edge);
    }
    // one egg cracks open in the left corner and a sparkle pops out
    const crack = clamp01((t - 0.4) / 0.2);
    const ex = w * 0.06;
    const ey = h - 60;
    egg(ctx, ex, ey + crack * -6, 18, "#fde68a", "#b45309");
    if (crack > 0) {
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k - 2.5) * 0.4;
        drawSparkle(ctx, ex + Math.cos(a) * 30 * crack, ey - 20 + Math.sin(a) * 30 * crack, 3, "#fef08a", "#a16207", 1 - crack * 0.5);
      }
    }
    // the Easter bunny with its basket, a chick hatching beside it, tulips around them
    const f = focusOr(focus, w, h);
    const avatarLeft = f.x < w / 2;
    const bun = Math.min(h * 0.45, w * 0.2, 200);
    const bunX = avatarLeft ? w * 0.8 : w * 0.2;
    const bunIn = easeOutCubic(clamp01((t - 0.05) / 0.25));
    const tulipCols = ["#f43f5e", "#facc15", "#a78bfa", "#fb923c"];
    tulipCols.forEach((col, i) => {
      const tx = bunX + (i < 2 ? -1 : 1) * bun * (0.32 + (i % 2) * 0.16);
      drawTulip(ctx, tx, h - 12, Math.min(h * 0.18, 70), col, clock);
    });
    ctx.globalAlpha = env * smooth(bunIn * 2);
    drawEasterBunny(ctx, bunX, h - 16 + (1 - bunIn) * bun * 0.5, bun, clock);
    ctx.globalAlpha = env;
    drawHatchingChick(
      ctx,
      bunX + (avatarLeft ? -1 : 1) * bun * 0.5,
      h - 16,
      Math.min(h * 0.12, 50),
      clamp01((t - 0.3) / 0.35),
      clock,
    );

    // daisies at the sides
    for (let i = 0; i < 8; i++) {
      daisy(ctx, edgeX(i * 23 + 1, w, 0.22), h * (0.25 + hash(i * 3) * 0.5), 9, clock * 0.5 + i);
    }
    ctx.restore();
  };
}

/* ----------------------------- Spring Green ---------------------------- */

function clover(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  for (let i = 0; i < 4; i++) {
    const a = rot + (i / 4) * TAU;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    heartPath(ctx, 0, s * 0.45, s * 0.5);
    fs(ctx, "#22c55e", "#14532d", 0.9);
    ctx.restore();
  }
}

function butterfly(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flap: number, c: string) {
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + side * s * 0.5 * flap, y - s * 0.2, s * 0.55 * flap, s * 0.45, 0, 0, TAU);
    fs(ctx, c, "#1f2937", 0.9);
    ctx.beginPath();
    ctx.ellipse(x + side * s * 0.38 * flap, y + s * 0.35, s * 0.36 * flap, s * 0.3, 0, 0, TAU);
    fs(ctx, c, "#1f2937", 0.9);
  }
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.1, s * 0.5, 0, 0, TAU);
  fs(ctx, "#1f2937", null);
}

export function createSpringRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    // grass growing along the bottom edge
    const grow = easeOutCubic(clamp01(t / 0.3));
    ctx.strokeStyle = "#16a34a";
    ctx.lineCap = "round";
    const blades = Math.round(w / 7);
    for (let i = 0; i < blades; i++) {
      const x = (i / blades) * w + hash(i) * 6;
      const bh = (14 + hash(i * 3) * 26) * grow;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.quadraticCurveTo(x + Math.sin(clock * 2 + i) * 4, h - bh * 0.6, x + Math.sin(clock * 2 + i) * 8, h - bh);
      ctx.stroke();
    }
    // drifting clovers
    for (let i = 0; i < 14; i++) {
      const life = (clock * (0.08 + hash(i) * 0.08) + hash(i * 5)) % 1;
      const x = edgeX(i * 11 + 4, w, 0.3) + Math.sin(clock + i) * 26;
      const y = -20 + life * (h + 40);
      ctx.globalAlpha = env * Math.sin(life * Math.PI);
      clover(ctx, x, y, 10 + hash(i * 7) * 6, clock + i);
    }
    ctx.globalAlpha = env;
    // a rainbow and the turning Earth on the side away from the avatar, a sapling growing below
    const f = focusOr(focus, w, h);
    const avatarLeft = f.x < w / 2;
    const gx = avatarLeft ? w * 0.78 : w * 0.22;
    const gr = Math.min(h * 0.17, w * 0.08, 80);
    drawRainbow(ctx, gx, h * 0.62, gr * 2.4, easeOutCubic(clamp01((t - 0.04) / 0.35)));
    const globeIn = smooth((t - 0.1) / 0.2);
    ctx.globalAlpha = env * globeIn;
    drawEarthGlobe(ctx, gx, h * 0.42, gr, clock);
    ctx.globalAlpha = env;
    drawSapling(
      ctx,
      gx + (avatarLeft ? -1 : 1) * gr * 1.9,
      h - 10,
      Math.min(h * 0.3, 120),
      easeOutCubic(clamp01((t - 0.08) / 0.5)),
      clock,
    );

    // butterflies
    const wings = ["#fde047", "#a7f3d0", "#f9a8d4", "#bfdbfe"];
    for (let i = 0; i < 4; i++) {
      const x = edgeX(i * 31 + 2, w, 0.22) + Math.sin(clock * 0.9 + i * 2) * 40;
      const y = h * (0.3 + hash(i) * 0.4) + Math.cos(clock * 1.3 + i) * 24;
      butterfly(ctx, x, y, 12, 0.35 + 0.65 * Math.abs(Math.sin(clock * 9 + i)), wings[i]!);
    }
    ctx.restore();
  };
}

/* ---------------------------- Autumn Harvest --------------------------- */

function maple(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  starPath(ctx, 0, 0, s, s * 0.5, 5);
  fs(ctx, fill, "#7c2d12", 1);
  ctx.strokeStyle = "#7c2d12";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, s * 1.2);
  ctx.stroke();
  ctx.restore();
}

function wheat(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, sway: number) {
  const tx = x + sway;
  const ty = y - len;
  ctx.strokeStyle = "#a16207";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x, y - len * 0.5, tx, ty);
  ctx.stroke();
  for (let k = 0; k < 6; k++) {
    const u = 1 - k * 0.07;
    const px = x + (tx - x) * u;
    const py = y + (ty - y) * u;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(px + side * 4, py, 3, 6, side * 0.5, 0, TAU);
      fs(ctx, "#fbbf24", "#92400e", 0.8);
    }
  }
}

export function createHarvestRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    // wheat swaying in the bottom corners
    const grow = easeOutCubic(clamp01(t / 0.25));
    for (let i = 0; i < 7; i++) {
      const sway = Math.sin(clock * 1.6 + i) * 8;
      wheat(ctx, 10 + i * 12, h, (60 + hash(i) * 40) * grow, sway);
      wheat(ctx, w - 10 - i * 12, h, (60 + hash(i + 9) * 40) * grow, sway);
    }
    // tumbling maple leaves
    const leafColours = ["#c2410c", "#ea580c", "#f59e0b", "#b91c1c"];
    for (let i = 0; i < 24; i++) {
      const life = (clock * (0.09 + hash(i) * 0.1) + hash(i * 3)) % 1;
      const x = edgeX(i * 5 + 8, w, 0.32) + Math.sin(clock * 1.1 + i) * 30;
      const y = -20 + life * (h + 40);
      ctx.globalAlpha = env * Math.sin(life * Math.PI);
      maple(ctx, x, y, 9 + hash(i * 7) * 7, clock * 1.5 + i, leafColours[i % leafColours.length]!);
    }
    ctx.globalAlpha = env;
    // a horn of plenty, a fanning turkey and a pumpkin on the side away from the avatar
    const f = focusOr(focus, w, h);
    const avatarLeft = f.x < w / 2;
    const cs = Math.min(h * 0.5, w * 0.26, 240);
    const cx = avatarLeft ? w * 0.72 : w * 0.28;
    const harvestIn = easeOutCubic(clamp01((t - 0.04) / 0.3));
    ctx.globalAlpha = env * smooth(harvestIn * 2);
    drawTurkey(ctx, cx + (avatarLeft ? 1 : -1) * cs * 0.6, h - 12, cs * 0.55, clock);
    drawCornucopia(ctx, cx, h - 14 + (1 - harvestIn) * cs * 0.3, cs, avatarLeft ? -1 : 1);
    drawPumpkin(ctx, cx - (avatarLeft ? 1 : -1) * cs * 0.05, h - 20, cs * 0.08);
    ctx.globalAlpha = env;

    // warm low-sun glow
    drawGlow(ctx, w * 0.5, h * 1.05, Math.max(w, h) * 0.45, "251,146,60", 0.22);
    ctx.restore();
  };
}
