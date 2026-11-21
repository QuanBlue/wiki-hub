/**
 * Detailed set pieces, part 2: Men's Day neon, Valentine, Spring Green, Easter,
 * Children's Day, Autumn Harvest and the solemn 27/7 memorial. Every function draws
 * in canvas pixels at the position and size it is given.
 */
import { clamp01, drawGlow, hash } from "@/components/users/welcome-effects/helpers";
import { cloudPath, fs, heartPath, starPath, TAU } from "@/components/users/welcome-effects/shapes";

/* ------------------------------ Men's Day ------------------------------ */

/** Glowing neon tube text: a coloured halo around a bright white core. */
function neonStroke(
  ctx: CanvasRenderingContext2D,
  draw: () => void,
  color: string,
  width: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [blur, lw] of [[width * 4, width * 1.6], [width * 2, width]] as const) {
    ctx.shadowBlur = blur;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    draw();
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#f0f9ff";
  ctx.lineWidth = width * 0.4;
  draw();
  ctx.stroke();
  ctx.restore();
}

/** A neon sign: a bow tie and moustache over "19·11" in a rounded tube frame; `sw` is its width. */
export function drawNeonSign(ctx: CanvasRenderingContext2D, x: number, y: number, sw: number, clock: number) {
  const sh = sw * 0.72;
  const tube = Math.max(1.5, sw * 0.012);
  // a tube occasionally stutters, like a real neon sign
  const stutter = Math.sin(clock * 23) > 0.96 ? 0.35 : 1;
  ctx.fillStyle = "rgba(8,47,73,0.88)";
  ctx.beginPath();
  ctx.roundRect(x, y, sw, sh, sw * 0.06);
  ctx.fill();
  neonStroke(
    ctx,
    () => {
      ctx.beginPath();
      ctx.roundRect(x + sw * 0.04, y + sw * 0.04, sw * 0.92, sh - sw * 0.08, sw * 0.05);
    },
    "#22d3ee",
    tube,
    1,
  );
  // bow tie
  const bx = x + sw / 2;
  const by = y + sh * 0.28;
  const bs = sw * 0.12;
  neonStroke(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(bx - bs * 0.25, by);
      ctx.lineTo(bx - bs * 1.4, by - bs * 0.7);
      ctx.lineTo(bx - bs * 1.4, by + bs * 0.7);
      ctx.closePath();
      ctx.moveTo(bx + bs * 0.25, by);
      ctx.lineTo(bx + bs * 1.4, by - bs * 0.7);
      ctx.lineTo(bx + bs * 1.4, by + bs * 0.7);
      ctx.closePath();
      ctx.moveTo(bx + bs * 0.25, by);
      ctx.arc(bx, by, bs * 0.25, 0, TAU);
    },
    "#f472b6",
    tube,
    stutter,
  );
  // moustache
  const my = y + sh * 0.47;
  neonStroke(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(bx, my);
      ctx.bezierCurveTo(bx - bs * 0.6, my - bs * 0.5, bx - bs * 1.5, my - bs * 0.1, bx - bs * 1.8, my - bs * 0.55);
      ctx.moveTo(bx, my);
      ctx.bezierCurveTo(bx + bs * 0.6, my - bs * 0.5, bx + bs * 1.5, my - bs * 0.1, bx + bs * 1.8, my - bs * 0.55);
    },
    "#a5f3fc",
    tube,
    1,
  );
  // date in tube lettering
  ctx.save();
  ctx.font = `800 ${sh * 0.24}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ty = y + sh * 0.76;
  for (const [blur, col, lw] of [[18, "#0ea5e9", tube * 1.6], [8, "#22d3ee", tube]] as const) {
    ctx.shadowBlur = blur;
    ctx.shadowColor = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.strokeText("19 · 11", bx, ty);
  }
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#f0f9ff";
  ctx.lineWidth = tube * 0.45;
  ctx.strokeText("19 · 11", bx, ty);
  ctx.restore();
  // two little brackets holding the sign
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = Math.max(1.5, sw * 0.01);
  for (const fx of [0.2, 0.8]) {
    ctx.beginPath();
    ctx.moveTo(x + sw * fx, y);
    ctx.lineTo(x + sw * fx, y - sw * 0.12);
    ctx.stroke();
  }
}

/** A night skyline along the bottom edge with cyan-lit windows blinking on and off. */
export function drawNeonSkyline(
  ctx: CanvasRenderingContext2D,
  w: number,
  baseY: number,
  maxH: number,
  clock: number,
  rise: number,
) {
  let x = 0;
  let i = 0;
  while (x < w) {
    const bw = maxH * (0.28 + hash(i * 3) * 0.3);
    const bh = maxH * (0.35 + hash(i * 7) * 0.65) * rise;
    const top = baseY - bh;
    ctx.beginPath();
    ctx.rect(x, top, bw - 2, bh);
    fs(ctx, "rgba(12,74,110,0.9)", "#22d3ee", 1);
    if (hash(i * 11) > 0.6) {
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + bw * 0.5, top);
      ctx.lineTo(x + bw * 0.5, top - maxH * 0.12 * rise);
      ctx.stroke();
      drawGlow(ctx, x + bw * 0.5, top - maxH * 0.12 * rise, 6, "244,114,182", 0.5 + 0.5 * Math.sin(clock * 4 + i));
    }
    const cell = Math.max(5, maxH * 0.07);
    for (let wy = top + cell * 0.6; wy < baseY - cell; wy += cell * 1.4) {
      for (let wx = x + cell * 0.6; wx < x + bw - cell; wx += cell * 1.3) {
        const on = Math.sin(clock * 0.9 + hash(wx * 0.13 + wy * 0.07) * 20) > -0.2;
        if (!on) continue;
        ctx.fillStyle = hash(wx + wy) > 0.8 ? "rgba(244,114,182,0.9)" : "rgba(103,232,249,0.9)";
        ctx.fillRect(wx, wy, cell * 0.6, cell * 0.7);
      }
    }
    x += bw;
    i++;
  }
}

/* ------------------------------ Valentine ------------------------------ */

/** A glossy heart-shaped balloon on a curling string tied at (ax, ay). */
export function drawHeartBalloon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
  ax: number,
  ay: number,
  clock: number,
  seed: number,
) {
  const bx = x + Math.sin(clock * 1.2 + seed) * s * 0.15;
  const by = y + Math.cos(clock * 1.5 + seed) * s * 0.1;
  ctx.strokeStyle = "rgba(100,116,139,0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx, by + s * 0.95);
  ctx.bezierCurveTo(bx + s * 0.3, by + s * 1.6, ax - s * 0.3, ay - s * 0.8, ax, ay);
  ctx.stroke();
  const g = ctx.createRadialGradient(bx - s * 0.35, by - s * 0.35, s * 0.1, bx, by, s * 1.3);
  g.addColorStop(0, "#ffe4e6");
  g.addColorStop(0.35, color);
  g.addColorStop(1, "#881337");
  heartPath(ctx, bx, by, s);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#881337";
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(bx - s * 0.45, by - s * 0.3, s * 0.14, s * 0.24, -0.6, 0, TAU);
  fs(ctx, "rgba(255,255,255,0.6)", null);
  ctx.beginPath();
  ctx.moveTo(bx - s * 0.08, by + s * 0.95);
  ctx.lineTo(bx + s * 0.08, by + s * 0.95);
  ctx.lineTo(bx, by + s * 0.85);
  ctx.closePath();
  fs(ctx, color, "#881337", 1);
}

/**
 * A love letter: the envelope's flap folds open (`open` 0..1), a card with a heart
 * slides up and small hearts float out. `s` is the envelope width.
 */
export function drawLoveLetter(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  s: number,
  open: number,
  clock: number,
) {
  const eh = s * 0.64;
  const top = baseY - eh;
  const lw = Math.max(1, s * 0.012);
  // back of the envelope
  ctx.beginPath();
  ctx.rect(x - s / 2, top, s, eh);
  fs(ctx, "#fecdd3", "#9f1239", lw);
  // card sliding up
  const lift = clamp01((open - 0.4) / 0.5) * eh * 0.7;
  ctx.beginPath();
  ctx.rect(x - s * 0.42, top + eh * 0.08 - lift, s * 0.84, eh * 0.8);
  fs(ctx, "#fffbeb", "#be123c", lw);
  heartPath(ctx, x, top + eh * 0.3 - lift, s * 0.09);
  fs(ctx, "#e11d48", "#881337", lw);
  ctx.strokeStyle = "rgba(190,18,60,0.4)";
  ctx.lineWidth = lw;
  for (const ly of [0.5, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.28, top + eh * ly - lift);
    ctx.lineTo(x + s * 0.28, top + eh * ly - lift);
    ctx.stroke();
  }
  // front pocket
  ctx.beginPath();
  ctx.moveTo(x - s / 2, top);
  ctx.lineTo(x, top + eh * 0.55);
  ctx.lineTo(x + s / 2, top);
  ctx.lineTo(x + s / 2, baseY);
  ctx.lineTo(x - s / 2, baseY);
  ctx.closePath();
  fs(ctx, "#fda4af", "#9f1239", lw);
  // flap folding back: it shrinks to a line, then points upwards
  const fold = Math.cos(clamp01(open) * Math.PI);
  ctx.beginPath();
  ctx.moveTo(x - s / 2, top);
  ctx.lineTo(x, top + eh * 0.5 * fold);
  ctx.lineTo(x + s / 2, top);
  ctx.closePath();
  fs(ctx, fold > 0 ? "#fb7185" : "#fecdd3", "#9f1239", lw);
  // wax seal while closed
  if (open < 0.3) {
    heartPath(ctx, x, top + eh * 0.46, s * 0.07);
    fs(ctx, "#be123c", "#881337", lw);
  }
  // hearts floating out once open
  if (open > 0.7) {
    for (let k = 0; k < 6; k++) {
      const life = (clock * 0.35 + k / 6) % 1;
      const hx = x + Math.sin(life * 6 + k) * s * 0.3;
      const hy = top - lift - life * s * 0.9;
      ctx.save();
      ctx.globalAlpha *= Math.sin(life * Math.PI);
      heartPath(ctx, hx, hy, s * (0.04 + hash(k) * 0.03));
      fs(ctx, k % 2 ? "#fb7185" : "#e11d48", "#881337", 1);
      ctx.restore();
    }
  }
}

/** A heart pierced by Cupid's arrow, flying across with a slight wobble; `s` is the heart size. */
export function drawCupidHeart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, clock: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.25 + Math.sin(clock * 2) * 0.05);
  // shaft behind
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(-s * 1.9, 0);
  ctx.lineTo(-s * 0.4, 0);
  ctx.stroke();
  heartPath(ctx, 0, 0, s);
  const g = ctx.createLinearGradient(0, -s, 0, s);
  g.addColorStop(0, "#fb7185");
  g.addColorStop(1, "#be123c");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#881337";
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.stroke();
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(s * 0.4, 0);
  ctx.lineTo(s * 1.5, 0);
  ctx.stroke();
  // arrowhead and fletching
  ctx.beginPath();
  ctx.moveTo(s * 1.85, 0);
  ctx.lineTo(s * 1.45, -s * 0.2);
  ctx.lineTo(s * 1.45, s * 0.2);
  ctx.closePath();
  fs(ctx, "#facc15", "#a16207", 1);
  for (const sd of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-s * 1.9, 0);
    ctx.lineTo(-s * 1.6, sd * s * 0.25);
    ctx.lineTo(-s * 1.4, sd * s * 0.25);
    ctx.lineTo(-s * 1.65, 0);
    ctx.closePath();
    fs(ctx, "#fda4af", "#be123c", 1);
  }
  ctx.restore();
}

/* ----------------------------- Spring Green ---------------------------- */

const CONTINENTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[-160, 62], [-130, 70], [-95, 72], [-65, 60], [-55, 50], [-80, 30], [-97, 18], [-110, 25], [-125, 40], [-150, 58]],
  [[-80, 10], [-60, 8], [-36, -6], [-40, -22], [-58, -38], [-70, -54], [-74, -40], [-80, -5]],
  [[-10, 36], [10, 37], [32, 31], [44, 12], [51, 11], [40, -15], [32, -28], [20, -35], [12, -18], [8, 4], [-8, 5], [-17, 15]],
  [[-10, 44], [-5, 58], [20, 70], [60, 72], [100, 76], [140, 72], [160, 62], [140, 50], [122, 30], [108, 18], [98, 8], [80, 8], [72, 20], [56, 25], [40, 36], [26, 40], [10, 44]],
  [[114, -22], [130, -12], [146, -18], [152, -28], [146, -38], [130, -32], [116, -34]],
];

/** The Earth turning slowly: an orthographic globe with green continents and a soft halo. */
export function drawEarthGlobe(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, clock: number) {
  drawGlow(ctx, x, y, r * 1.5, "56,189,248", 0.3);
  const ocean = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  ocean.addColorStop(0, "#7dd3fc");
  ocean.addColorStop(1, "#0369a1");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = ocean;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.clip();
  const rot = clock * 0.5;
  const tiltLat = 0.35;
  for (const blob of CONTINENTS) {
    let front = 0;
    const pts = blob.map(([lonD, latD]) => {
      const lon = (lonD * Math.PI) / 180 + rot;
      const lat = (latD * Math.PI) / 180;
      const cx = Math.cos(lat) * Math.sin(lon);
      const cz0 = Math.cos(lat) * Math.cos(lon);
      const cy0 = Math.sin(lat);
      const cy = cy0 * Math.cos(tiltLat) - cz0 * Math.sin(tiltLat);
      const cz = cy0 * Math.sin(tiltLat) + cz0 * Math.cos(tiltLat);
      if (cz > 0) front++;
      let px = cx;
      let py = cy;
      if (cz < 0) {
        const len = Math.hypot(px, py) || 1;
        px /= len;
        py /= len;
      }
      return [x + px * r, y - py * r] as const;
    });
    if (front === 0) continue;
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    fs(ctx, "#4ade80", "#166534", Math.max(1, r * 0.02));
  }
  // drifting clouds and a terminator shade
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  for (let k = 0; k < 3; k++) {
    const cx = x + ((((clock * 0.15 + k * 0.37) % 1) * 2 - 1) * r);
    ctx.beginPath();
    ctx.ellipse(cx, y + (k - 1) * r * 0.45, r * 0.25, r * 0.06, 0, 0, TAU);
    ctx.fill();
  }
  const shade = ctx.createLinearGradient(x - r, y, x + r, y);
  shade.addColorStop(0.55, "rgba(15,23,42,0)");
  shade.addColorStop(1, "rgba(15,23,42,0.35)");
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.strokeStyle = "#075985";
  ctx.lineWidth = Math.max(1, r * 0.025);
  ctx.stroke();
}

/** A rainbow arcing over (cx, cy) with a cloud at each foot; `grow` 0..1 draws it in. */
export function drawRainbow(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, grow: number) {
  const bands = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#6366f1", "#a855f7"];
  const bw = R * 0.07;
  ctx.lineCap = "butt";
  bands.forEach((col, i) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = bw;
    ctx.beginPath();
    ctx.arc(cx, cy, R - i * bw, Math.PI, Math.PI + Math.PI * grow);
    ctx.stroke();
  });
  for (const fx of [-1, 1]) {
    cloudPath(ctx, cx + fx * (R - bw * 3), cy + bw, R * 0.22);
    fs(ctx, "#ffffff", "#94a3b8", 1);
  }
}

/** A sapling growing from a mound of soil, leaves unfolding pair by pair; `s` is its full height. */
export function drawSapling(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  s: number,
  grow: number,
  clock: number,
) {
  ctx.beginPath();
  ctx.ellipse(x, baseY, s * 0.35, s * 0.09, 0, Math.PI, TAU);
  fs(ctx, "#92400e", "#451a03", 1.2);
  const hgt = s * grow;
  const sway = Math.sin(clock * 1.6) * s * 0.03;
  ctx.strokeStyle = "#15803d";
  ctx.lineWidth = Math.max(2, s * 0.035);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x - s * 0.04, baseY - hgt * 0.5, x + sway, baseY - hgt);
  ctx.stroke();
  const leaf = (lx: number, ly: number, len: number, ang: number) => {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.5, -len * 0.35, len, 0);
    ctx.quadraticCurveTo(len * 0.5, len * 0.35, 0, 0);
    fs(ctx, "#4ade80", "#166534", Math.max(1, len * 0.04));
    ctx.strokeStyle = "rgba(22,101,52,0.5)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len * 0.9, 0);
    ctx.stroke();
    ctx.restore();
  };
  for (let k = 1; k <= 3; k++) {
    const u = k / 4;
    if (grow < u + 0.1) break;
    const ly = baseY - hgt * u;
    const len = s * (0.22 - k * 0.02);
    leaf(x + sway * u, ly, len, -0.4 + Math.sin(clock * 2 + k) * 0.05);
    leaf(x + sway * u, ly, len, Math.PI + 0.4 - Math.sin(clock * 2 + k) * 0.05);
  }
  if (grow > 0.9) {
    leaf(x + sway, baseY - hgt, s * 0.24, -1.1);
    leaf(x + sway, baseY - hgt, s * 0.24, Math.PI + 1.1);
  }
}

/* -------------------------------- Easter ------------------------------- */

/** A tulip on a swaying stem; `s` is its height. */
export function drawTulip(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, color: string, clock: number) {
  const sway = Math.sin(clock * 1.5 + x * 0.01) * s * 0.05;
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = Math.max(1.5, s * 0.04);
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x, baseY - s * 0.5, x + sway, baseY - s * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, baseY - s * 0.1);
  ctx.quadraticCurveTo(x - s * 0.25, baseY - s * 0.35, x - s * 0.12, baseY - s * 0.55);
  ctx.quadraticCurveTo(x - s * 0.05, baseY - s * 0.3, x, baseY - s * 0.1);
  fs(ctx, "#22c55e", "#166534", 1);
  const tx = x + sway;
  const ty = baseY - s * 0.8;
  ctx.beginPath();
  ctx.moveTo(tx - s * 0.14, ty - s * 0.2);
  ctx.lineTo(tx - s * 0.07, ty - s * 0.1);
  ctx.lineTo(tx, ty - s * 0.22);
  ctx.lineTo(tx + s * 0.07, ty - s * 0.1);
  ctx.lineTo(tx + s * 0.14, ty - s * 0.2);
  ctx.quadraticCurveTo(tx + s * 0.16, ty + s * 0.04, tx, ty + s * 0.05);
  ctx.quadraticCurveTo(tx - s * 0.16, ty + s * 0.04, tx - s * 0.14, ty - s * 0.2);
  ctx.closePath();
  fs(ctx, color, "#831843", Math.max(1, s * 0.02));
}

/** The Easter bunny standing with a woven basket of painted eggs; `s` is its height. */
export function drawEasterBunny(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, clock: number) {
  const edge = "#78716c";
  const lw = Math.max(1, s * 0.012);
  const hop = Math.abs(Math.sin(clock * 2.4)) * s * 0.03;
  const y = baseY - hop;
  // feet
  for (const fx of [-0.12, 0.12]) {
    ctx.beginPath();
    ctx.ellipse(x + fx * s, y - s * 0.03, s * 0.1, s * 0.045, 0, 0, TAU);
    fs(ctx, "#ffffff", edge, lw);
  }
  // body
  ctx.beginPath();
  ctx.ellipse(x, y - s * 0.28, s * 0.22, s * 0.26, 0, 0, TAU);
  fs(ctx, "#fafaf9", edge, lw);
  ctx.beginPath();
  ctx.ellipse(x, y - s * 0.24, s * 0.13, s * 0.17, 0, 0, TAU);
  fs(ctx, "#fef3c7", null);
  // ears
  const twitch = Math.sin(clock * 3) * 0.08;
  for (const [ex, rot] of [[-0.08, -0.18 + twitch], [0.08, 0.18 - twitch]] as const) {
    ctx.save();
    ctx.translate(x + ex * s, y - s * 0.7);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.16, s * 0.06, s * 0.18, 0, 0, TAU);
    fs(ctx, "#fafaf9", edge, lw);
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.15, s * 0.028, s * 0.13, 0, 0, TAU);
    fs(ctx, "#fbcfe8", null);
    ctx.restore();
  }
  // head
  ctx.beginPath();
  ctx.arc(x, y - s * 0.62, s * 0.15, 0, TAU);
  fs(ctx, "#fafaf9", edge, lw);
  ctx.fillStyle = "#1f2937";
  for (const ex of [-0.055, 0.055]) {
    ctx.beginPath();
    ctx.arc(x + ex * s, y - s * 0.64, s * 0.02, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "#f472b6";
  ctx.beginPath();
  ctx.arc(x, y - s * 0.6, s * 0.018, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(251,113,133,0.4)";
  for (const cx of [-0.09, 0.09]) {
    ctx.beginPath();
    ctx.ellipse(x + cx * s, y - s * 0.58, s * 0.03, s * 0.018, 0, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = "#a8a29e";
  ctx.lineWidth = 0.8;
  for (const sd of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + sd * s * 0.03, y - s * 0.59);
    ctx.lineTo(x + sd * s * 0.14, y - s * 0.6);
    ctx.stroke();
  }
  // bow tie
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.48);
  ctx.lineTo(x - s * 0.07, y - s * 0.51);
  ctx.lineTo(x - s * 0.07, y - s * 0.45);
  ctx.closePath();
  ctx.moveTo(x, y - s * 0.48);
  ctx.lineTo(x + s * 0.07, y - s * 0.51);
  ctx.lineTo(x + s * 0.07, y - s * 0.45);
  ctx.closePath();
  fs(ctx, "#a78bfa", "#5b21b6", lw);
  // basket of eggs held in front
  const bx = x;
  const by = y - s * 0.2;
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = Math.max(1.5, s * 0.02);
  ctx.beginPath();
  ctx.arc(bx, by - s * 0.02, s * 0.17, Math.PI, TAU);
  ctx.stroke();
  const eggs = ["#c4b5fd", "#6ee7b7", "#fde68a", "#f9a8d4"];
  eggs.forEach((col, i) => {
    ctx.beginPath();
    ctx.ellipse(bx + (i - 1.5) * s * 0.075, by - s * 0.02, s * 0.045, s * 0.06, (i - 1.5) * 0.2, 0, TAU);
    fs(ctx, col, "#6b21a8", lw);
  });
  ctx.beginPath();
  ctx.moveTo(bx - s * 0.2, by);
  ctx.lineTo(bx + s * 0.2, by);
  ctx.lineTo(bx + s * 0.15, by + s * 0.14);
  ctx.lineTo(bx - s * 0.15, by + s * 0.14);
  ctx.closePath();
  fs(ctx, "#d97706", "#78350f", lw);
  ctx.strokeStyle = "rgba(120,53,15,0.55)";
  ctx.lineWidth = lw;
  for (let k = 1; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(bx - s * 0.2 + k * s * 0.015, by + k * s * 0.045);
    ctx.lineTo(bx + s * 0.2 - k * s * 0.015, by + k * s * 0.045);
    ctx.stroke();
  }
  for (let k = -3; k <= 3; k++) {
    ctx.beginPath();
    ctx.moveTo(bx + k * s * 0.05, by);
    ctx.lineTo(bx + k * s * 0.04, by + s * 0.14);
    ctx.stroke();
  }
  // paws on the basket
  for (const px of [-0.17, 0.17]) {
    ctx.beginPath();
    ctx.arc(bx + px * s, by + s * 0.02, s * 0.04, 0, TAU);
    fs(ctx, "#fafaf9", edge, lw);
  }
}

/** A chick hatching (`hatch` 0..1): the shell cracks, the top lifts and the chick peeps out. */
export function drawHatchingChick(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  s: number,
  hatch: number,
  clock: number,
) {
  const lw = Math.max(1, s * 0.03);
  const pop = clamp01((hatch - 0.3) / 0.5);
  // chick
  if (pop > 0) {
    const cy = baseY - s * 0.45 - pop * s * 0.35;
    ctx.beginPath();
    ctx.arc(x, cy, s * 0.3, 0, TAU);
    fs(ctx, "#fde047", "#a16207", lw);
    ctx.fillStyle = "#1f2937";
    for (const ex of [-0.1, 0.1]) {
      ctx.beginPath();
      ctx.arc(x + ex * s, cy - s * 0.05, s * 0.035, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x - s * 0.06, cy + s * 0.04);
    ctx.lineTo(x + s * 0.06, cy + s * 0.04);
    ctx.lineTo(x, cy + s * 0.12 + Math.abs(Math.sin(clock * 6)) * s * 0.03);
    ctx.closePath();
    fs(ctx, "#f97316", "#9a3412", lw);
    ctx.fillStyle = "rgba(251,113,133,0.5)";
    for (const cx of [-0.18, 0.18]) {
      ctx.beginPath();
      ctx.arc(x + cx * s, cy + s * 0.05, s * 0.04, 0, TAU);
      ctx.fill();
    }
  }
  // lower shell with a zigzag rim
  ctx.beginPath();
  ctx.moveTo(x - s * 0.38, baseY - s * 0.4);
  for (let k = 1; k <= 6; k++) ctx.lineTo(x - s * 0.38 + k * s * 0.127, baseY - s * (k % 2 ? 0.48 : 0.4));
  ctx.quadraticCurveTo(x + s * 0.42, baseY, x, baseY);
  ctx.quadraticCurveTo(x - s * 0.42, baseY, x - s * 0.38, baseY - s * 0.4);
  ctx.closePath();
  fs(ctx, "#fefce8", "#a8a29e", lw);
  // top shell lifted on the chick's head
  const lift = pop * s * 0.35;
  ctx.save();
  ctx.translate(x, baseY - s * 0.48 - lift - (pop > 0 ? s * 0.18 : 0));
  ctx.rotate(pop * 0.35);
  ctx.beginPath();
  ctx.moveTo(-s * 0.34, 0);
  for (let k = 1; k <= 6; k++) ctx.lineTo(-s * 0.34 + k * s * 0.113, k % 2 ? -s * 0.06 : 0);
  ctx.quadraticCurveTo(s * 0.3, -s * 0.42, 0, -s * 0.44);
  ctx.quadraticCurveTo(-s * 0.3, -s * 0.42, -s * 0.34, 0);
  ctx.closePath();
  fs(ctx, "#fefce8", "#a8a29e", lw);
  ctx.restore();
}

/* ---------------------------- Children's Day --------------------------- */

/** A striped hot-air balloon with its basket and a flickering burner; `s` is the envelope width. */
export function drawHotAirBalloon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, clock: number) {
  const yy = y + Math.sin(clock * 0.9) * s * 0.06;
  const env = () => {
    ctx.beginPath();
    ctx.moveTo(x, yy - s * 0.6);
    ctx.bezierCurveTo(x + s * 0.62, yy - s * 0.6, x + s * 0.6, yy + s * 0.1, x + s * 0.18, yy + s * 0.45);
    ctx.lineTo(x - s * 0.18, yy + s * 0.45);
    ctx.bezierCurveTo(x - s * 0.6, yy + s * 0.1, x - s * 0.62, yy - s * 0.6, x, yy - s * 0.6);
    ctx.closePath();
  };
  ctx.save();
  env();
  ctx.clip();
  const stripes = ["#ef4444", "#facc15", "#22c55e", "#38bdf8", "#a855f7", "#f97316"];
  const n = 8;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = stripes[i % stripes.length]!;
    ctx.fillRect(x - s * 0.6 + (i * s * 1.2) / n, yy - s * 0.7, (s * 1.2) / n + 1, s * 1.2);
  }
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.ellipse(x - s * 0.2, yy - s * 0.25, s * 0.1, s * 0.25, -0.2, 0, TAU);
  ctx.fill();
  ctx.restore();
  env();
  fs(ctx, null, "#1f2937", Math.max(1, s * 0.012));
  // ropes, basket and burner
  const by = yy + s * 0.68;
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = 1;
  for (const [tx, bx] of [[-0.18, -0.12], [0.18, 0.12]] as const) {
    ctx.beginPath();
    ctx.moveTo(x + tx * s, yy + s * 0.45);
    ctx.lineTo(x + bx * s, by);
    ctx.stroke();
  }
  const flame = 0.7 + 0.3 * Math.sin(clock * 18);
  drawGlow(ctx, x, yy + s * 0.5, s * 0.15 * flame, "251,146,60", 0.8);
  ctx.beginPath();
  ctx.rect(x - s * 0.13, by, s * 0.26, s * 0.17);
  fs(ctx, "#b45309", "#78350f", 1.2);
  ctx.strokeStyle = "rgba(120,53,15,0.6)";
  for (let k = 1; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.13 + k * s * 0.065, by);
    ctx.lineTo(x - s * 0.13 + k * s * 0.065, by + s * 0.17);
    ctx.stroke();
  }
}

/** A diamond kite on a long string with a tail of bows fluttering; `s` is its height. */
export function drawKite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  anchorX: number,
  anchorY: number,
  clock: number,
) {
  const kx = x + Math.sin(clock * 1.1) * s * 0.2;
  const ky = y + Math.cos(clock * 1.4) * s * 0.12;
  const tilt = Math.sin(clock * 1.1) * 0.15;
  ctx.strokeStyle = "rgba(71,85,105,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(kx, ky + s * 0.2);
  ctx.quadraticCurveTo((kx + anchorX) / 2 + s * 0.6, (ky + anchorY) / 2, anchorX, anchorY);
  ctx.stroke();
  // tail with bows
  ctx.strokeStyle = "#475569";
  ctx.beginPath();
  ctx.moveTo(kx, ky + s * 0.5);
  const tail: Array<[number, number]> = [];
  for (let k = 1; k <= 6; k++) {
    const tx = kx + Math.sin(clock * 3 + k * 0.8) * s * 0.18;
    const ty = ky + s * 0.5 + k * s * 0.18;
    tail.push([tx, ty]);
    ctx.lineTo(tx, ty);
  }
  ctx.stroke();
  tail.forEach(([tx, ty], i) => {
    if (i % 2 === 0) return;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - s * 0.08, ty - s * 0.05);
    ctx.lineTo(tx - s * 0.08, ty + s * 0.05);
    ctx.closePath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + s * 0.08, ty - s * 0.05);
    ctx.lineTo(tx + s * 0.08, ty + s * 0.05);
    ctx.closePath();
    fs(ctx, i % 4 === 1 ? "#f43f5e" : "#38bdf8", "#1f2937", 0.8);
  });
  ctx.save();
  ctx.translate(kx, ky);
  ctx.rotate(tilt);
  const quads: Array<[number, number, string]> = [
    [0, -1, "#ef4444"], [1, 0, "#facc15"], [0, 1, "#22c55e"], [-1, 0, "#38bdf8"],
  ];
  const P = (qx: number, qy: number): [number, number] => [qx * s * 0.32, qy < 0 ? qy * s * 0.5 : qy * s * 0.5];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = P(quads[i]![0], quads[i]![1]);
    const [bx, by] = P(quads[(i + 1) % 4]![0], quads[(i + 1) % 4]![1]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.closePath();
    fs(ctx, quads[i]![2], "#1f2937", 1);
  }
  ctx.restore();
}

/** A paper pinwheel (chong chóng) spinning on its stick; `s` is the blade radius. */
export function drawPinwheel(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = Math.max(1.5, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + s * 2.4);
  ctx.stroke();
  const cols = ["#ef4444", "#facc15", "#22c55e", "#38bdf8"];
  for (let i = 0; i < 4; i++) {
    const a = rot + (i / 4) * TAU;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s, 0);
    ctx.quadraticCurveTo(s * 0.9, s * 0.7, 0, s * 0.95);
    ctx.closePath();
    fs(ctx, cols[i]!, "#1f2937", 1);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(x, y, s * 0.12, 0, TAU);
  fs(ctx, "#ffffff", "#1f2937", 1);
}

/* ---------------------------- Autumn Harvest --------------------------- */

/** A ribbed pumpkin with a curly stem; `r` is its radius. */
export function drawPumpkin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  for (const [dx, sc, col] of [[-0.45, 0.62, "#ea580c"], [0.45, 0.62, "#ea580c"], [-0.2, 0.8, "#f97316"], [0.2, 0.8, "#f97316"], [0, 0.9, "#fb923c"]] as const) {
    ctx.beginPath();
    ctx.ellipse(x + dx * r, y, r * sc * 0.55, r * 0.75, 0, 0, TAU);
    fs(ctx, col, "#9a3412", Math.max(1, r * 0.04));
  }
  ctx.strokeStyle = "#3f6212";
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.7);
  ctx.quadraticCurveTo(x + r * 0.05, y - r * 0.95, x + r * 0.2, y - r * 1.0);
  ctx.stroke();
}

/** A wicker horn of plenty spilling pumpkins, apples, grapes, corn and a pear; `s` is its length. */
export function drawCornucopia(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, dir: 1 | -1) {
  const lw = Math.max(1, s * 0.008);
  const R = s * 0.2;
  const mouthX = x + dir * s * 0.35;
  const mouthY = baseY - R - s * 0.02;
  const tipX = mouthX - dir * s * 0.8;
  const tipY = mouthY - R * 1.35;
  // horn: wide at the mouth, tapering along a curve to a tip that curls upwards
  const horn = () => {
    ctx.beginPath();
    ctx.moveTo(mouthX, mouthY - R);
    ctx.bezierCurveTo(mouthX - dir * s * 0.3, mouthY - R * 0.95, mouthX - dir * s * 0.62, mouthY - R * 0.2, tipX, tipY);
    ctx.quadraticCurveTo(tipX + dir * s * 0.01, tipY + R * 0.4, tipX + dir * s * 0.12, tipY + R * 0.6);
    ctx.bezierCurveTo(mouthX - dir * s * 0.5, mouthY + R * 0.9, mouthX - dir * s * 0.25, mouthY + R * 1.05, mouthX, mouthY + R);
    ctx.closePath();
  };
  const hg = ctx.createLinearGradient(0, mouthY - R, 0, mouthY + R);
  hg.addColorStop(0, "#f59e0b");
  hg.addColorStop(1, "#b45309");
  horn();
  ctx.fillStyle = hg;
  ctx.fill();
  // woven bands following the horn's curve, clipped to it
  ctx.save();
  horn();
  ctx.clip();
  ctx.strokeStyle = "rgba(120,53,15,0.6)";
  ctx.lineWidth = Math.max(1, s * 0.01);
  for (let k = 1; k < 9; k++) {
    const u = k / 9;
    const cx = mouthX - dir * u * s * 0.66;
    const cy = mouthY - R * 0.05 - u * u * R * 0.95;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * (1 - u * 0.75) * 0.32, R * (1 - u * 0.75), dir * u * 0.5, 0, TAU);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(253,230,138,0.45)";
  ctx.beginPath();
  ctx.moveTo(mouthX, mouthY - R * 0.55);
  ctx.bezierCurveTo(mouthX - dir * s * 0.3, mouthY - R * 0.6, mouthX - dir * s * 0.55, mouthY - R * 0.3, tipX + dir * s * 0.05, tipY + R * 0.25);
  ctx.stroke();
  ctx.restore();
  horn();
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = lw;
  ctx.stroke();
  // the dark opening and its braided rim
  ctx.beginPath();
  ctx.ellipse(mouthX, mouthY, R * 0.38, R, 0, 0, TAU);
  fs(ctx, "#78350f", "#451a03", lw);
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = Math.max(1.5, s * 0.014);
  ctx.setLineDash([s * 0.02, s * 0.015]);
  ctx.beginPath();
  ctx.ellipse(mouthX, mouthY, R * 0.38, R, 0, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  // produce spilling out of the mouth
  const ox = mouthX + dir * s * 0.12;
  // corn
  ctx.save();
  ctx.translate(ox + dir * s * 0.08, mouthY - s * 0.2);
  ctx.rotate(dir * -0.6);
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.05, s * 0.15, 0, 0, TAU);
  fs(ctx, "#facc15", "#a16207", lw);
  ctx.fillStyle = "rgba(161,98,7,0.45)";
  for (let r = -3; r <= 3; r++) {
    for (const c of [-0.02, 0.02]) {
      ctx.beginPath();
      ctx.arc(c * s, r * s * 0.035, s * 0.008, 0, TAU);
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.moveTo(0, s * 0.15);
  ctx.quadraticCurveTo(s * 0.08, s * 0.05, s * 0.06, -s * 0.08);
  ctx.lineTo(0, s * 0.1);
  fs(ctx, "#84cc16", "#3f6212", lw);
  ctx.restore();
  // grapes
  for (let k = 0; k < 9; k++) {
    const row = Math.floor(k / 3);
    ctx.beginPath();
    ctx.arc(ox - dir * s * 0.02 + ((k % 3) - 1) * s * 0.04 + row * s * 0.02 * dir, mouthY + s * 0.02 + row * s * 0.045, s * 0.028, 0, TAU);
    fs(ctx, "#7c3aed", "#4c1d95", lw);
  }
  drawPumpkin(ctx, ox + dir * s * 0.14, baseY - s * 0.09, s * 0.11);
  for (const [dx, dy] of [[0.0, -0.06], [0.28, -0.05]] as const) {
    ctx.beginPath();
    ctx.arc(ox + dir * dx * s, baseY + dy * s, s * 0.05, 0, TAU);
    fs(ctx, "#dc2626", "#7f1d1d", lw);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(ox + dir * dx * s - s * 0.015, baseY + dy * s - s * 0.015, s * 0.012, 0, TAU);
    ctx.fill();
  }
  // pear
  ctx.beginPath();
  ctx.ellipse(ox + dir * s * 0.36, baseY - s * 0.05, s * 0.05, s * 0.06, 0, 0, TAU);
  ctx.ellipse(ox + dir * s * 0.36, baseY - s * 0.12, s * 0.03, s * 0.04, 0, 0, TAU);
  fs(ctx, "#bef264", "#4d7c0f", lw);
}

/** A cheerful turkey fanning its tail; `s` is its height. */
export function drawTurkey(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, clock: number) {
  const lw = Math.max(1, s * 0.012);
  const fan = 0.85 + 0.15 * Math.sin(clock * 1.5);
  const feathers = ["#b91c1c", "#ea580c", "#f59e0b", "#facc15", "#ea580c", "#b91c1c", "#92400e"];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * Math.PI * 1.1 * fan;
    ctx.save();
    ctx.translate(x, baseY - s * 0.38);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.32, s * 0.08, s * 0.3, 0, 0, TAU);
    fs(ctx, feathers[i % feathers.length]!, "#78350f", lw);
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.52, s * 0.035, s * 0.06, 0, 0, TAU);
    fs(ctx, "#fde68a", null);
    ctx.restore();
  }
  for (const fx of [-0.07, 0.07]) {
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = Math.max(1.5, s * 0.02);
    ctx.beginPath();
    ctx.moveTo(x + fx * s, baseY - s * 0.15);
    ctx.lineTo(x + fx * s, baseY);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(x, baseY - s * 0.3, s * 0.2, s * 0.2, 0, 0, TAU);
  fs(ctx, "#92400e", "#451a03", lw);
  ctx.beginPath();
  ctx.ellipse(x, baseY - s * 0.26, s * 0.12, s * 0.13, 0, 0, TAU);
  fs(ctx, "#b45309", null);
  const hy = baseY - s * 0.56;
  ctx.beginPath();
  ctx.ellipse(x, hy, s * 0.1, s * 0.12, 0, 0, TAU);
  fs(ctx, "#a16207", "#451a03", lw);
  ctx.fillStyle = "#1f2937";
  for (const ex of [-0.04, 0.04]) {
    ctx.beginPath();
    ctx.arc(x + ex * s, hy - s * 0.03, s * 0.018, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(x - s * 0.03, hy + s * 0.01);
  ctx.lineTo(x + s * 0.03, hy + s * 0.01);
  ctx.lineTo(x, hy + s * 0.06);
  ctx.closePath();
  fs(ctx, "#facc15", "#a16207", lw);
  ctx.beginPath();
  ctx.ellipse(x + s * 0.02, hy + s * 0.08, s * 0.02, s * 0.045, 0, 0, TAU);
  fs(ctx, "#dc2626", null);
}

/* ------------------------------- Memorial ------------------------------ */

/** A memorial obelisk with a gold star, its inscription on a plaque, on stepped stone. */
export function drawMemorialMonument(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  s: number,
  glow: number,
) {
  const lw = Math.max(1, s * 0.006);
  drawGlow(ctx, x, baseY - s * 0.55, s * 0.75, "217,119,6", 0.22 * glow);
  // steps
  for (const [w2, hgt, y0] of [[0.5, 0.05, 0], [0.4, 0.05, 0.05], [0.3, 0.05, 0.1]] as const) {
    ctx.beginPath();
    ctx.rect(x - s * w2, baseY - s * (y0 + hgt), s * w2 * 2, s * hgt);
    fs(ctx, "#d6d3d1", "#78716c", lw);
  }
  // obelisk
  const g = ctx.createLinearGradient(x - s * 0.12, 0, x + s * 0.12, 0);
  g.addColorStop(0, "#f5f5f4");
  g.addColorStop(1, "#a8a29e");
  ctx.beginPath();
  ctx.moveTo(x - s * 0.12, baseY - s * 0.15);
  ctx.lineTo(x - s * 0.07, baseY - s * 0.9);
  ctx.lineTo(x, baseY - s * 0.98);
  ctx.lineTo(x + s * 0.07, baseY - s * 0.9);
  ctx.lineTo(x + s * 0.12, baseY - s * 0.15);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#78716c";
  ctx.lineWidth = lw;
  ctx.stroke();
  // gold star near the top
  drawGlow(ctx, x, baseY - s * 0.78, s * 0.12, "250,204,21", 0.6 * glow);
  starPath(ctx, x, baseY - s * 0.78, s * 0.055, s * 0.022);
  fs(ctx, "#facc15", "#a16207", lw);
  // plaque with the inscription
  ctx.beginPath();
  ctx.rect(x - s * 0.17, baseY - s * 0.36, s * 0.34, s * 0.14);
  fs(ctx, "#7f1d1d", "#451a03", lw);
  ctx.fillStyle = "#fde68a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${s * 0.042}px system-ui, sans-serif`;
  ctx.fillText("TỔ QUỐC", x, baseY - s * 0.318);
  ctx.fillText("GHI CÔNG", x, baseY - s * 0.263);
}

/** A bronze incense bowl with three glowing sticks and slow curls of smoke; `s` is the bowl width. */
export function drawIncenseBowl(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, clock: number) {
  const lw = Math.max(1, s * 0.02);
  for (const dx of [-0.12, 0, 0.12]) {
    const sx = x + dx * s;
    const top = baseY - s * 0.9 + Math.abs(dx) * s * 0.4;
    ctx.strokeStyle = "#7f1d1d";
    ctx.lineWidth = Math.max(1.5, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(sx, baseY - s * 0.3);
    ctx.lineTo(sx + dx * s * 0.6, top);
    ctx.stroke();
    const tx = sx + dx * s * 0.6;
    drawGlow(ctx, tx, top, s * 0.05, "249,115,22", 0.9);
    ctx.strokeStyle = "rgba(168,162,158,0.55)";
    ctx.lineWidth = Math.max(1, s * 0.015);
    ctx.beginPath();
    for (let k = 0; k <= 20; k++) {
      const u = k / 20;
      const px = tx + Math.sin(u * 6 + clock * 0.8 + dx * 10) * s * (0.03 + u * 0.12);
      const py = top - u * s * 1.3;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, baseY - s * 0.32);
  ctx.lineTo(x + s * 0.5, baseY - s * 0.32);
  ctx.quadraticCurveTo(x + s * 0.48, baseY - s * 0.05, x + s * 0.3, baseY - s * 0.02);
  ctx.lineTo(x - s * 0.3, baseY - s * 0.02);
  ctx.quadraticCurveTo(x - s * 0.48, baseY - s * 0.05, x - s * 0.5, baseY - s * 0.32);
  ctx.closePath();
  const g = ctx.createLinearGradient(x - s * 0.5, 0, x + s * 0.5, 0);
  g.addColorStop(0, "#92400e");
  g.addColorStop(0.5, "#d97706");
  g.addColorStop(1, "#78350f");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#451a03";
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.strokeStyle = "rgba(253,230,138,0.7)";
  ctx.beginPath();
  ctx.moveTo(x - s * 0.44, baseY - s * 0.2);
  for (let k = 0; k <= 10; k++) ctx.lineTo(x - s * 0.44 + k * s * 0.088, baseY - s * (k % 2 ? 0.16 : 0.22));
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, baseY - s * 0.32, s * 0.5, s * 0.06, 0, 0, TAU);
  fs(ctx, "#a8a29e", "#451a03", lw);
}

/** A vase of white chrysanthemums; `s` is its height. */
export function drawChrysanthemumVase(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, clock: number) {
  const lw = Math.max(1, s * 0.012);
  const blooms: Array<[number, number, number]> = [[0, -0.95, 0.14], [-0.17, -0.82, 0.12], [0.17, -0.84, 0.12], [-0.06, -0.72, 0.11], [0.09, -0.68, 0.1]];
  ctx.strokeStyle = "#15803d";
  ctx.lineWidth = Math.max(1.5, s * 0.015);
  for (const [dx, dy] of blooms) {
    ctx.beginPath();
    ctx.moveTo(x, baseY - s * 0.45);
    ctx.lineTo(x + dx * s, baseY + dy * s);
    ctx.stroke();
  }
  for (const [lx, rot] of [[-0.1, -0.7], [0.1, 0.7]] as const) {
    ctx.save();
    ctx.translate(x + lx * s, baseY - s * 0.55);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.06, s * 0.03, s * 0.08, 0, 0, TAU);
    fs(ctx, "#22c55e", "#166534", lw);
    ctx.restore();
  }
  blooms.forEach(([dx, dy, r], i) => {
    const bx = x + dx * s;
    const by = baseY + dy * s + Math.sin(clock * 0.8 + i) * s * 0.005;
    const petals = 18;
    for (let k = 0; k < petals; k++) {
      const a = (k / petals) * TAU + i;
      ctx.beginPath();
      ctx.ellipse(bx + Math.cos(a) * r * s * 0.55, by + Math.sin(a) * r * s * 0.55, r * s * 0.5, r * s * 0.12, a, 0, TAU);
      fs(ctx, "#ffffff", "#a8a29e", lw * 0.7);
    }
    ctx.beginPath();
    ctx.arc(bx, by, r * s * 0.28, 0, TAU);
    fs(ctx, "#fef9c3", "#ca8a04", lw * 0.7);
  });
  ctx.beginPath();
  ctx.moveTo(x - s * 0.12, baseY - s * 0.45);
  ctx.quadraticCurveTo(x - s * 0.2, baseY - s * 0.15, x - s * 0.13, baseY);
  ctx.lineTo(x + s * 0.13, baseY);
  ctx.quadraticCurveTo(x + s * 0.2, baseY - s * 0.15, x + s * 0.12, baseY - s * 0.45);
  ctx.closePath();
  fs(ctx, "#e0f2fe", "#0369a1", lw);
  ctx.strokeStyle = "#0369a1";
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.15, baseY - s * 0.25);
  ctx.quadraticCurveTo(x, baseY - s * 0.3, x + s * 0.15, baseY - s * 0.25);
  ctx.stroke();
}
