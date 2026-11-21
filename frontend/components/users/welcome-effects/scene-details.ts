/**
 * Detailed set pieces for the holiday welcome scenes (Halloween, Mid-Autumn,
 * Teachers' Day, Floral, Lotus): each scene gets one or two hero elements drawn
 * with the same care as Tết's dragon and blossom trees or National Day's flag and map.
 * Every function draws in canvas pixels at the position and size it is given.
 */
import { clamp01, drawGlow, hash } from "@/components/users/welcome-effects/helpers";
import { cloudPath, fs, TAU } from "@/components/users/welcome-effects/shapes";

/* ------------------------------ Halloween ------------------------------ */

function deadTree(ctx: CanvasRenderingContext2D, x: number, baseY: number, H: number, clock: number) {
  ctx.strokeStyle = "#1e1b4b";
  ctx.lineCap = "round";
  const branch = (x0: number, y0: number, len: number, ang: number, depth: number) => {
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    ctx.lineWidth = Math.max(1, (depth + 1) * H * 0.012);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    if (depth > 0) {
      const sw = Math.sin(clock * 0.8 + depth) * 0.03;
      branch(x1, y1, len * 0.68, ang - 0.48 + sw, depth - 1);
      branch(x1, y1, len * 0.6, ang + 0.4 + sw, depth - 1);
    }
  };
  branch(x, baseY, H * 0.32, -Math.PI / 2 + 0.1, 4);
}

/** A haunted house with a crooked tower, flickering windows and a bare tree; `s` is its width. */
export function drawHauntedHouse(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  s: number,
  clock: number,
) {
  const wall = "#2e1065";
  const roof = "#1e1b4b";
  const edge = "#7c3aed";
  const lw = Math.max(1, s * 0.006);
  deadTree(ctx, x + s * 0.04, baseY, s * 0.8, clock);

  ctx.beginPath();
  ctx.rect(x + s * 0.18, baseY - s * 0.42, s * 0.5, s * 0.42);
  fs(ctx, wall, edge, lw);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.24, baseY - s * 0.5);
  ctx.lineTo(x + s * 0.24, baseY - s * 0.67);
  ctx.lineTo(x + s * 0.31, baseY - s * 0.69);
  ctx.lineTo(x + s * 0.31, baseY - s * 0.56);
  ctx.closePath();
  fs(ctx, wall, edge, lw);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.12, baseY - s * 0.42);
  ctx.lineTo(x + s * 0.43, baseY - s * 0.7);
  ctx.lineTo(x + s * 0.74, baseY - s * 0.42);
  ctx.closePath();
  fs(ctx, roof, edge, lw);
  // crooked tower and spire
  ctx.beginPath();
  ctx.moveTo(x + s * 0.6, baseY);
  ctx.lineTo(x + s * 0.61, baseY - s * 0.66);
  ctx.lineTo(x + s * 0.83, baseY - s * 0.68);
  ctx.lineTo(x + s * 0.82, baseY);
  ctx.closePath();
  fs(ctx, wall, edge, lw);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.56, baseY - s * 0.65);
  ctx.quadraticCurveTo(x + s * 0.7, baseY - s * 0.8, x + s * 0.76, baseY - s * 1.02);
  ctx.quadraticCurveTo(x + s * 0.78, baseY - s * 0.82, x + s * 0.88, baseY - s * 0.68);
  ctx.closePath();
  fs(ctx, roof, edge, lw);

  // windows: warm light that flickers, some going dark
  const wins: Array<[number, number, number, number]> = [
    [0.23, 0.33, 0.08, 0.1], [0.53, 0.33, 0.08, 0.1], [0.66, 0.56, 0.1, 0.11],
    [0.66, 0.32, 0.1, 0.11], [0.38, 0.6, 0.1, 0.07],
  ];
  wins.forEach(([wx, wy, ww, wh], i) => {
    const lit = clamp01(0.55 + 0.6 * Math.sin(clock * (2.6 + i * 0.7) + i * 2));
    const cx = x + s * (wx + ww / 2);
    const cy = baseY - s * (wy - wh / 2);
    drawGlow(ctx, cx, cy, s * 0.13, "250,204,21", 0.4 * lit);
    ctx.beginPath();
    ctx.rect(x + s * wx, baseY - s * wy, s * ww, s * wh);
    fs(ctx, `rgba(253,224,71,${0.25 + 0.75 * lit})`, edge, lw);
    ctx.strokeStyle = roof;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx, baseY - s * wy);
    ctx.lineTo(cx, baseY - s * (wy - wh));
    ctx.moveTo(x + s * wx, cy);
    ctx.lineTo(x + s * (wx + ww), cy);
    ctx.stroke();
  });
  // arched door
  ctx.beginPath();
  ctx.moveTo(x + s * 0.37, baseY);
  ctx.lineTo(x + s * 0.37, baseY - s * 0.13);
  ctx.arc(x + s * 0.43, baseY - s * 0.13, s * 0.06, Math.PI, 0);
  ctx.lineTo(x + s * 0.49, baseY);
  ctx.closePath();
  fs(ctx, "#0f0a1e", edge, lw);
  // crooked fence
  ctx.strokeStyle = roof;
  ctx.lineWidth = Math.max(1.5, s * 0.012);
  for (let i = 0; i < 6; i++) {
    const fx = x + s * (0.02 + i * 0.03);
    ctx.beginPath();
    ctx.moveTo(fx, baseY);
    ctx.lineTo(fx + Math.sin(i * 1.7) * s * 0.006, baseY - s * (0.08 + (i % 2) * 0.02));
    ctx.stroke();
  }
}

/** A friendly ghost with a wavy hem, bobbing in place; `s` is its head radius. */
export function drawGhost(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  clock: number,
  seed: number,
) {
  const yy = y + Math.sin(clock * 2 + seed) * s * 0.18;
  ctx.beginPath();
  ctx.moveTo(x - s, yy);
  ctx.arc(x, yy, s, Math.PI, 0);
  ctx.lineTo(x + s, yy + s * 1.1);
  const waves = 4;
  for (let k = 0; k < waves; k++) {
    const x0 = x + s - (k / waves) * 2 * s;
    const x1 = x + s - ((k + 1) / waves) * 2 * s;
    const dip = Math.sin(clock * 4 + seed + k) * s * 0.12;
    ctx.quadraticCurveTo((x0 + x1) / 2, yy + s * 1.45 + dip, x1, yy + s * 1.1);
  }
  ctx.closePath();
  fs(ctx, "rgba(248,250,252,0.92)", "#6d28d9", Math.max(1, s * 0.05));
  ctx.fillStyle = "#1e1b4b";
  for (const ex of [-0.35, 0.35]) {
    ctx.beginPath();
    ctx.ellipse(x + s * ex, yy - s * 0.08, s * 0.13, s * 0.19, 0, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(x, yy + s * 0.36, s * 0.11, s * 0.15, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(244,114,182,0.5)";
  for (const cx of [-0.6, 0.6]) {
    ctx.beginPath();
    ctx.ellipse(x + s * cx, yy + s * 0.2, s * 0.12, s * 0.07, 0, 0, TAU);
    ctx.fill();
  }
}

/** A witch on a broomstick in silhouette, flying left; `s` is about her height. */
export function drawWitch(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, clock: number) {
  const ink = "#0f0a1e";
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.12 + Math.sin(clock * 3) * 0.05);
  ctx.strokeStyle = "#78350f";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, s * 0.06);
  ctx.beginPath();
  ctx.moveTo(-s * 0.9, 0);
  ctx.lineTo(s * 0.7, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.6, -s * 0.06);
  ctx.lineTo(s * 1.08, -s * 0.24);
  ctx.lineTo(s * 1.12, s * 0.2);
  ctx.lineTo(s * 0.6, s * 0.06);
  ctx.closePath();
  fs(ctx, "#d97706", "#78350f", Math.max(1, s * 0.02));
  const fl = Math.sin(clock * 9) * s * 0.1;
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(-s * 0.05, -s * 0.5);
  ctx.quadraticCurveTo(s * 0.35, -s * 0.45 + fl, s * 0.58, -s * 0.18 + fl);
  ctx.lineTo(s * 0.12, -s * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-s * 0.26, 0);
  ctx.lineTo(s * 0.16, 0);
  ctx.lineTo(-s * 0.02, -s * 0.56);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-s * 0.05, -s * 0.63, s * 0.12, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-s * 0.32, -s * 0.7);
  ctx.lineTo(s * 0.2, -s * 0.7);
  ctx.lineTo(s * 0.02, -s * 0.9);
  ctx.quadraticCurveTo(s * 0.1, -s * 1.1, s * 0.3, -s * 1.12);
  ctx.quadraticCurveTo(s * 0.0, -s * 1.12, -s * 0.12, -s * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1.2, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(-s * 0.1, 0);
  ctx.lineTo(-s * 0.22, s * 0.24);
  ctx.stroke();
  ctx.restore();
}

/** A spider dangling on its thread from (x, topY); `len` is the thread length, `s` the body size. */
export function drawSpider(
  ctx: CanvasRenderingContext2D,
  x: number,
  topY: number,
  len: number,
  s: number,
  clock: number,
) {
  const by = topY + len;
  ctx.strokeStyle = "rgba(100,116,139,0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x, by - s);
  ctx.stroke();
  ctx.strokeStyle = "#1e1b4b";
  ctx.lineWidth = Math.max(1, s * 0.18);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const wig = Math.sin(clock * 6 + k + side) * s * 0.15;
      const ky = by - s * 0.3 + k * s * 0.3;
      ctx.beginPath();
      ctx.moveTo(x, ky);
      ctx.lineTo(x + side * s * 1.3, ky - s * 0.7 + wig);
      ctx.lineTo(x + side * s * 1.9, ky + s * 0.5 + wig);
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.ellipse(x, by + s * 0.35, s * 0.9, s * 1.05, 0, 0, TAU);
  fs(ctx, "#1e1b4b", "#a78bfa", 1);
  ctx.beginPath();
  ctx.arc(x, by - s * 0.6, s * 0.55, 0, TAU);
  fs(ctx, "#1e1b4b", "#a78bfa", 1);
  ctx.fillStyle = "#f8fafc";
  for (const ex of [-0.22, 0.22]) {
    ctx.beginPath();
    ctx.arc(x + s * ex, by - s * 0.65, s * 0.16, 0, TAU);
    ctx.fill();
  }
}

/* ------------------------------ Mid-Autumn ----------------------------- */

/** Chú Cuội sitting under the banyan tree, as a silhouette inside the moon (radius r). */
export function drawCuoiOnMoon(ctx: CanvasRenderingContext2D, mx: number, my: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(mx, my, r * 0.97, 0, TAU);
  ctx.clip();
  ctx.fillStyle = "rgba(146,64,14,0.42)";
  ctx.beginPath();
  ctx.ellipse(mx, my + r * 0.72, r * 0.75, r * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(mx + r * 0.16, my + r * 0.64);
  ctx.quadraticCurveTo(mx + r * 0.04, my + r * 0.3, mx + r * 0.12, my - r * 0.06);
  ctx.lineTo(mx + r * 0.24, my - r * 0.06);
  ctx.quadraticCurveTo(mx + r * 0.22, my + r * 0.3, mx + r * 0.38, my + r * 0.64);
  ctx.closePath();
  ctx.fill();
  for (const [dx, dy, rr] of [[0.18, -0.32, 0.3], [-0.12, -0.18, 0.22], [0.46, -0.16, 0.22], [0.22, -0.56, 0.2], [-0.02, -0.44, 0.18]] as const) {
    ctx.beginPath();
    ctx.arc(mx + r * dx, my + r * dy, r * rr, 0, TAU);
    ctx.fill();
  }
  // Cuội: head, body and the axe resting beside him
  ctx.beginPath();
  ctx.arc(mx - r * 0.34, my + r * 0.24, r * 0.08, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(mx - r * 0.48, my + r * 0.62);
  ctx.lineTo(mx - r * 0.2, my + r * 0.62);
  ctx.lineTo(mx - r * 0.3, my + r * 0.32);
  ctx.lineTo(mx - r * 0.4, my + r * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(146,64,14,0.5)";
  ctx.lineWidth = Math.max(1, r * 0.03);
  ctx.beginPath();
  ctx.moveTo(mx - r * 0.58, my + r * 0.62);
  ctx.lineTo(mx - r * 0.5, my + r * 0.36);
  ctx.stroke();
  ctx.restore();
}

/** The jade rabbit sitting on a cloud; `s` is its body size. */
export function drawJadeRabbit(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, clock: number) {
  cloudPath(ctx, x + s * 0.1, y + s * 0.62, s * 0.95);
  fs(ctx, "#fff7ed", "#d97706", Math.max(1, s * 0.04));
  const edge = "#92400e";
  const lw = Math.max(1, s * 0.04);
  ctx.beginPath();
  ctx.ellipse(x + s * 0.42, y + s * 0.08, s * 0.1, s * 0.1, 0, 0, TAU);
  fs(ctx, "#ffffff", edge, lw);
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.15, s * 0.42, s * 0.36, 0, 0, TAU);
  fs(ctx, "#ffffff", edge, lw);
  const twitch = Math.sin(clock * 3) * 0.1;
  for (const [ex, rot] of [[-0.42, -0.25 + twitch], [-0.24, 0.12 - twitch]] as const) {
    ctx.save();
    ctx.translate(x + s * ex, y - s * 0.4);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.18, s * 0.08, s * 0.26, 0, 0, TAU);
    fs(ctx, "#ffffff", edge, lw);
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.18, s * 0.035, s * 0.18, 0, 0, TAU);
    fs(ctx, "#fbcfe8", null);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(x - s * 0.32, y - s * 0.16, s * 0.25, 0, TAU);
  fs(ctx, "#ffffff", edge, lw);
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.arc(x - s * 0.4, y - s * 0.2, s * 0.04, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#f472b6";
  ctx.beginPath();
  ctx.arc(x - s * 0.55, y - s * 0.12, s * 0.035, 0, TAU);
  ctx.fill();
}

/** A carp lantern (đèn cá chép) hanging from a stick, glowing and bobbing; `s` is its length. */
export function drawCarpLantern(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  clock: number,
  seed: number,
) {
  const yy = y + Math.sin(clock * 1.8 + seed) * s * 0.06;
  const tilt = Math.sin(clock * 1.3 + seed) * 0.08;
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = Math.max(1.5, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.15, yy - s * 0.68);
  ctx.lineTo(x + s * 0.7, yy - s * 0.95);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, yy - s * 0.72);
  ctx.lineTo(x, yy - s * 0.28);
  ctx.stroke();
  drawGlow(ctx, x, yy, s * 1.05, "251,146,60", 0.5);
  ctx.save();
  ctx.translate(x, yy);
  ctx.rotate(tilt);
  const sw = Math.sin(clock * 5 + seed) * s * 0.08;
  ctx.beginPath();
  ctx.moveTo(-s * 0.42, 0);
  ctx.quadraticCurveTo(-s * 0.68, -s * 0.36 + sw, -s * 0.86, -s * 0.32 + sw);
  ctx.quadraticCurveTo(-s * 0.68, 0, -s * 0.86, s * 0.32 + sw);
  ctx.quadraticCurveTo(-s * 0.68, s * 0.3 + sw, -s * 0.42, 0);
  ctx.closePath();
  fs(ctx, "#f97316", "#7c2d12", Math.max(1, s * 0.02));
  // fins
  ctx.beginPath();
  ctx.moveTo(-s * 0.15, -s * 0.24);
  ctx.quadraticCurveTo(0, -s * 0.5, s * 0.15, -s * 0.25);
  ctx.closePath();
  fs(ctx, "#fbbf24", "#7c2d12", 1);
  ctx.beginPath();
  ctx.moveTo(-s * 0.1, s * 0.24);
  ctx.quadraticCurveTo(0, s * 0.42 + sw * 0.5, s * 0.1, s * 0.24);
  ctx.closePath();
  fs(ctx, "#fbbf24", "#7c2d12", 1);
  // body
  const g = ctx.createRadialGradient(s * 0.05, -s * 0.05, s * 0.05, 0, 0, s * 0.5);
  g.addColorStop(0, "#fef3c7");
  g.addColorStop(0.5, "#fb923c");
  g.addColorStop(1, "#dc2626");
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.48, s * 0.27, 0, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#7c2d12";
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.stroke();
  // scales
  ctx.strokeStyle = "rgba(124,45,18,0.5)";
  ctx.lineWidth = 1;
  for (let col = 0; col < 4; col++) {
    for (let row = -1; row <= 1; row++) {
      const sx = -s * 0.25 + col * s * 0.13;
      const sy = row * s * 0.12;
      ctx.beginPath();
      ctx.arc(sx, sy, s * 0.06, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    }
  }
  // head
  ctx.beginPath();
  ctx.arc(s * 0.32, -s * 0.06, s * 0.055, 0, TAU);
  fs(ctx, "#ffffff", "#1f2937", 1);
  ctx.beginPath();
  ctx.arc(s * 0.335, -s * 0.06, s * 0.025, 0, TAU);
  fs(ctx, "#1f2937", null);
  ctx.strokeStyle = "#7c2d12";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(s * 0.44, s * 0.06);
  ctx.quadraticCurveTo(s * 0.58, s * 0.12, s * 0.62, s * 0.24);
  ctx.moveTo(s * 0.44, s * 0.08);
  ctx.quadraticCurveTo(s * 0.52, s * 0.2, s * 0.5, s * 0.3);
  ctx.stroke();
  ctx.restore();
}

/** A lion dance (múa lân) head bobbing to a drum beaten beside it; `s` is the head width. */
export function drawLionDance(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, clock: number) {
  const beat = Math.abs(Math.sin(clock * 4.2));
  const bob = beat * s * 0.08;
  const lw = Math.max(1, s * 0.02);

  // the dancers' legs under the cloth, stepping to the beat
  const legXs = [x - s * 0.3, x - s * 0.46, x - s * 0.86, x - s * 1.02];
  legXs.forEach((lx, i) => {
    const step = Math.max(0, Math.sin(clock * 8.4 + i * Math.PI)) * s * 0.05;
    ctx.beginPath();
    ctx.roundRect(lx - s * 0.055, baseY - s * 0.34 - step, s * 0.11, s * 0.3, s * 0.03);
    fs(ctx, "#fbbf24", "#b45309", lw);
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(lx - s * 0.055, baseY - s * 0.2 - step, s * 0.11, s * 0.035);
    ctx.beginPath();
    ctx.ellipse(lx + s * 0.03, baseY - s * 0.03 - step, s * 0.08, s * 0.04, 0, 0, TAU);
    fs(ctx, "#1f2937", null);
  });

  // the lion's body: a humped length of gold cloth with rows of red scales,
  // a fringe of tassels along the hem and a tuft at the tail
  const tailX = x - s * 1.22;
  const hump = Math.sin(clock * 4.2) * s * 0.05;
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.15, baseY - s * 0.86 - bob);
    ctx.bezierCurveTo(
      x - s * 0.5,
      baseY - s * 1.08 - hump,
      x - s * 0.98,
      baseY - s * 0.98 + hump,
      tailX,
      baseY - s * 0.56,
    );
    ctx.quadraticCurveTo(tailX - s * 0.06, baseY - s * 0.4, tailX + s * 0.06, baseY - s * 0.32);
    ctx.lineTo(x - s * 0.2, baseY - s * 0.32);
    ctx.closePath();
  };
  const bg = ctx.createLinearGradient(0, baseY - s, 0, baseY - s * 0.3);
  bg.addColorStop(0, "#fde047");
  bg.addColorStop(1, "#f59e0b");
  body();
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.save();
  body();
  ctx.clip();
  ctx.strokeStyle = "rgba(220,38,38,0.65)";
  ctx.lineWidth = Math.max(1, s * 0.018);
  for (let row = 0; row < 6; row++) {
    const ry = baseY - s * 0.4 - row * s * 0.11;
    const shift = row % 2 ? s * 0.06 : 0;
    for (let cx = tailX + shift; cx < x; cx += s * 0.12) {
      ctx.beginPath();
      ctx.arc(cx, ry, s * 0.06, 0, Math.PI);
      ctx.stroke();
    }
  }
  ctx.restore();
  body();
  ctx.strokeStyle = "#b45309";
  ctx.lineWidth = lw;
  ctx.stroke();
  for (let k = 0; k <= 12; k++) {
    const u = k / 12;
    const fx = x - s * 0.2 + (tailX + s * 0.06 - (x - s * 0.2)) * u;
    ctx.beginPath();
    ctx.ellipse(fx, baseY - s * 0.27 + Math.sin(clock * 6 + k) * s * 0.012, s * 0.028, s * 0.06, 0, 0, TAU);
    fs(ctx, k % 2 ? "#ffffff" : "#dc2626", null);
  }
  ctx.beginPath();
  ctx.ellipse(tailX - s * 0.03, baseY - s * 0.56, s * 0.09, s * 0.07, -0.4 + hump / s, 0, TAU);
  fs(ctx, "#fef3c7", "#b45309", lw);

  // drum on a stand, with two sticks beating in turn
  const dx = x + s * 0.95;
  const dy = baseY - s * 0.36;
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = Math.max(1.5, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(dx - s * 0.25, baseY);
  ctx.lineTo(dx - s * 0.15, dy + s * 0.2);
  ctx.moveTo(dx + s * 0.25, baseY);
  ctx.lineTo(dx + s * 0.15, dy + s * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(dx - s * 0.3, dy - s * 0.16, s * 0.6, s * 0.38);
  fs(ctx, "#dc2626", "#7f1d1d", lw);
  ctx.fillStyle = "#fbbf24";
  ctx.fillRect(dx - s * 0.3, dy - s * 0.16, s * 0.6, s * 0.04);
  ctx.fillRect(dx - s * 0.3, dy + s * 0.18, s * 0.6, s * 0.04);
  ctx.beginPath();
  ctx.ellipse(dx, dy - s * 0.16, s * 0.3, s * 0.08, 0, 0, TAU);
  fs(ctx, "#fde68a", "#7f1d1d", lw);
  for (const k of [-1, 1] as const) {
    const hit = k > 0 ? beat : 1 - beat;
    const tx = dx + k * s * 0.12;
    const ty = dy - s * 0.18 - (1 - hit) * s * 0.3;
    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = Math.max(1.5, s * 0.035);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + k * s * 0.26, ty - s * 0.16);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx, ty, s * 0.03, 0, TAU);
    fs(ctx, "#fbbf24", null);
    if (hit > 0.92) drawGlow(ctx, tx, dy - s * 0.16, s * 0.2, "250,204,21", 0.6);
  }

  // lion head
  ctx.save();
  ctx.translate(x, baseY - s * 0.62 - bob);
  ctx.rotate(Math.sin(clock * 4.2) * 0.08);
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * TAU;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * s * 0.56, Math.sin(a) * s * 0.48, s * 0.07, s * 0.05, a, 0, TAU);
    fs(ctx, k % 2 ? "#fef3c7" : "#fde047", null);
  }
  const g = ctx.createRadialGradient(0, -s * 0.15, s * 0.05, 0, 0, s * 0.6);
  g.addColorStop(0, "#f87171");
  g.addColorStop(1, "#b91c1c");
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.54, s * 0.45, 0, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#7f1d1d";
  ctx.lineWidth = lw;
  ctx.stroke();
  // horn with a gold ball
  ctx.beginPath();
  ctx.moveTo(-s * 0.06, -s * 0.42);
  ctx.quadraticCurveTo(0, -s * 0.62, s * 0.06, -s * 0.42);
  ctx.closePath();
  fs(ctx, "#16a34a", "#14532d", lw);
  ctx.beginPath();
  ctx.arc(0, -s * 0.66, s * 0.06, 0, TAU);
  fs(ctx, "#facc15", "#a16207", lw);
  // forehead mirror
  ctx.beginPath();
  ctx.arc(0, -s * 0.24, s * 0.08, 0, TAU);
  fs(ctx, "#e5e7eb", "#6b7280", lw);
  // eyes with gold brows and lashes
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * s * 0.2, -s * 0.04, s * 0.13, s * 0.11, 0, 0, TAU);
    fs(ctx, "#ffffff", "#1f2937", lw);
    ctx.beginPath();
    ctx.arc(sx * s * 0.2 + Math.sin(clock * 2) * s * 0.03, -s * 0.03, s * 0.055, 0, TAU);
    fs(ctx, "#1f2937", null);
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = Math.max(1.5, s * 0.035);
    ctx.beginPath();
    ctx.arc(sx * s * 0.2, -s * 0.06, s * 0.17, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
  // nose
  ctx.beginPath();
  ctx.arc(0, s * 0.13, s * 0.07, 0, TAU);
  fs(ctx, "#f472b6", "#9d174d", lw);
  // opening jaw with teeth and tongue
  const jaw = s * 0.18 * (0.3 + beat * 0.7);
  ctx.beginPath();
  ctx.moveTo(-s * 0.32, s * 0.22);
  ctx.quadraticCurveTo(0, s * 0.22 + jaw * 2, s * 0.32, s * 0.22);
  ctx.closePath();
  fs(ctx, "#7f1d1d", "#450a0a", lw);
  ctx.fillStyle = "#ffffff";
  for (let k = -2; k <= 2; k++) {
    ctx.beginPath();
    ctx.moveTo(k * s * 0.1 - s * 0.035, s * 0.22);
    ctx.lineTo(k * s * 0.1 + s * 0.035, s * 0.22);
    ctx.lineTo(k * s * 0.1, s * 0.29);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, s * 0.26 + jaw * 0.6, s * 0.1, jaw * 0.4 + 1, 0, 0, TAU);
  fs(ctx, "#f472b6", null);
  ctx.restore();
}

/* ----------------------------- Teachers' Day ---------------------------- */

/**
 * A green chalkboard whose two lines of chalk writing appear left to right as
 * `reveal` goes 0..1, with a chalk tray, chalk sticks and an eraser; `bw` is its width.
 */
export function drawChalkboard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bw: number,
  reveal: number,
  lines: readonly [string, string],
) {
  const bh = bw * 0.6;
  ctx.beginPath();
  ctx.roundRect(x - bw * 0.045, y - bw * 0.045, bw * 1.09, bh + bw * 0.09, bw * 0.025);
  fs(ctx, "#a16207", "#451a03", Math.max(1.5, bw * 0.008));
  const g = ctx.createLinearGradient(x, y, x, y + bh);
  g.addColorStop(0, "#22684a");
  g.addColorStop(1, "#14462e");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, bw, bh);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.ellipse(x + bw * (0.15 + hash(i) * 0.7), y + bh * (0.2 + hash(i * 3) * 0.6), bw * 0.12, bh * 0.05, hash(i * 5), 0, TAU);
    ctx.fill();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, bw, bh);
  ctx.clip();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fonts = ["\"Segoe Print\"", "\"Chalkboard SE\"", "\"Comic Sans MS\"", "cursive"].join(", ");
  const rows: Array<[string, number, number, number]> = [
    [lines[0], y + bh * 0.33, bh * 0.19, clamp01(reveal * 2)],
    [lines[1], y + bh * 0.64, bh * 0.25, clamp01(reveal * 2 - 1)],
  ];
  for (const [text, ty, size, r] of rows) {
    if (r <= 0) continue;
    ctx.font = `700 ${size}px ${fonts}`;
    const tw = ctx.measureText(text).width;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + bw / 2 - tw / 2 - 4, ty - size, (tw + 8) * r, size * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(text, x + bw / 2 + 0.8, ty + 0.8);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(text, x + bw / 2, ty);
    ctx.restore();
  }
  const r2 = clamp01(reveal * 2 - 1);
  if (r2 > 0) {
    ctx.strokeStyle = "rgba(253,224,71,0.85)";
    ctx.lineWidth = Math.max(1.5, bh * 0.025);
    ctx.lineCap = "round";
    ctx.beginPath();
    const ux0 = x + bw * 0.28;
    const ux1 = ux0 + bw * 0.44 * r2;
    ctx.moveTo(ux0, y + bh * 0.82);
    ctx.quadraticCurveTo((ux0 + ux1) / 2, y + bh * 0.88, ux1, y + bh * 0.8);
    ctx.stroke();
  }
  // chalk doodles: a heart and a little flower in the corners
  ctx.strokeStyle = "rgba(251,207,232,0.8)";
  ctx.lineWidth = Math.max(1, bh * 0.015);
  const hx = x + bw * 0.1;
  const hy = y + bh * 0.16;
  const hs = bh * 0.06;
  ctx.beginPath();
  ctx.moveTo(hx, hy + hs);
  ctx.bezierCurveTo(hx - hs * 1.5, hy - hs * 0.2, hx - hs * 0.7, hy - hs * 1.1, hx, hy - hs * 0.4);
  ctx.bezierCurveTo(hx + hs * 0.7, hy - hs * 1.1, hx + hs * 1.5, hy - hs * 0.2, hx, hy + hs);
  ctx.stroke();
  ctx.strokeStyle = "rgba(254,240,138,0.8)";
  const fx = x + bw * 0.9;
  const fy = y + bh * 0.82;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ctx.beginPath();
    ctx.arc(fx + Math.cos(a) * hs * 0.9, fy + Math.sin(a) * hs * 0.9, hs * 0.55, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  // tray with chalk sticks and an eraser
  const ty = y + bh + bw * 0.045;
  ctx.fillStyle = "#78350f";
  ctx.fillRect(x - bw * 0.02, ty, bw * 1.04, bw * 0.03);
  for (const [cx, col] of [[0.62, "#ffffff"], [0.68, "#f9a8d4"], [0.73, "#fde047"]] as const) {
    ctx.beginPath();
    ctx.roundRect(x + bw * cx, ty - bw * 0.014, bw * 0.045, bw * 0.016, bw * 0.006);
    fs(ctx, col, "#94a3b8", 0.6);
  }
  ctx.beginPath();
  ctx.roundRect(x + bw * 0.2, ty - bw * 0.03, bw * 0.12, bw * 0.032, bw * 0.006);
  fs(ctx, "#334155", "#0f172a", 0.8);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(x + bw * 0.2, ty - bw * 0.006, bw * 0.12, bw * 0.008);
}

/** A folded paper plane pointing along `ang`; `s` is its length. */
export function drawPaperPlane(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ang: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(s * 0.5, 0);
  ctx.lineTo(-s * 0.5, -s * 0.36);
  ctx.lineTo(-s * 0.28, 0);
  ctx.lineTo(-s * 0.5, s * 0.22);
  ctx.closePath();
  fs(ctx, "#ffffff", "#0f766e", Math.max(1, s * 0.04));
  ctx.strokeStyle = "rgba(15,118,110,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(s * 0.5, 0);
  ctx.lineTo(-s * 0.28, 0);
  ctx.stroke();
  ctx.restore();
}

/* -------------------------------- Floral -------------------------------- */

function roseBloom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  palette: readonly [string, string, string, string],
) {
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
      fs(ctx, palette[ring]!, palette[3], Math.max(0.7, r * 0.06));
    }
  }
  ctx.restore();
}

const ROSE_PALETTES: ReadonlyArray<readonly [string, string, string, string]> = [
  ["#fb7185", "#f43f5e", "#be123c", "#881337"],
  ["#fbcfe8", "#f9a8d4", "#ec4899", "#9d174d"],
  ["#fed7aa", "#fdba74", "#f97316", "#9a3412"],
];

/**
 * A bouquet: roses in red, pink and peach with baby's breath and leaves, in pink tissue
 * and kraft paper, tied with a satin bow whose tails flutter. `s` is its height.
 */
export function drawBouquet(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, clock: number) {
  const topY = baseY - s * 0.6;
  const lw = Math.max(1, s * 0.006);
  // pink tissue fan behind
  ctx.beginPath();
  ctx.moveTo(x - s * 0.44, topY - s * 0.08);
  ctx.quadraticCurveTo(x, topY - s * 0.2, x + s * 0.44, topY - s * 0.08);
  ctx.lineTo(x + s * 0.06, baseY - s * 0.08);
  ctx.lineTo(x - s * 0.06, baseY - s * 0.08);
  ctx.closePath();
  fs(ctx, "#fbcfe8", "#be185d", lw);
  // leaves fanning out
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (k - 3) * 0.34;
    ctx.save();
    ctx.translate(x + Math.cos(a) * s * 0.18, topY - s * 0.06 + Math.sin(a) * s * 0.16);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(s * 0.06, -s * 0.12, 0, -s * 0.24);
    ctx.quadraticCurveTo(-s * 0.06, -s * 0.12, 0, 0);
    fs(ctx, k % 2 ? "#22c55e" : "#16a34a", "#14532d", lw);
    ctx.restore();
  }
  // roses in a dome
  const blooms: ReadonlyArray<readonly [number, number, number]> = [
    [0, -0.3, 0.1], [-0.17, -0.22, 0.09], [0.17, -0.23, 0.09], [-0.29, -0.1, 0.08],
    [0.29, -0.11, 0.08], [-0.08, -0.1, 0.095], [0.1, -0.08, 0.095], [-0.02, -0.44, 0.08],
  ];
  blooms.forEach(([dx, dy, r], i) => {
    roseBloom(ctx, x + dx * s, topY + dy * s, r * s, clock * 0.15 + i, ROSE_PALETTES[i % ROSE_PALETTES.length]!);
  });
  // baby's breath
  for (let i = 0; i < 30; i++) {
    const a = -Math.PI + hash(i) * Math.PI;
    const rr = s * (0.25 + hash(i * 3) * 0.24);
    const bx = x + Math.cos(a) * rr;
    const by = topY - s * 0.1 + Math.sin(a) * rr * 0.8;
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(1.2, s * 0.012), 0, TAU);
    fs(ctx, "#ffffff", "#cbd5e1", 0.6);
  }
  // kraft wrapper with a ruffled top edge and folds
  ctx.beginPath();
  ctx.moveTo(x - s * 0.36, topY);
  for (let k = 1; k <= 8; k++) ctx.lineTo(x - s * 0.36 + k * s * 0.09, topY + (k % 2 ? -s * 0.03 : 0));
  ctx.lineTo(x + s * 0.05, baseY);
  ctx.lineTo(x - s * 0.05, baseY);
  ctx.closePath();
  fs(ctx, "#e7c9a5", "#92400e", lw);
  ctx.strokeStyle = "rgba(146,64,14,0.35)";
  ctx.lineWidth = lw;
  for (const fx of [-0.18, 0, 0.18]) {
    ctx.beginPath();
    ctx.moveTo(x + fx * s, topY);
    ctx.lineTo(x + fx * s * 0.15, baseY - s * 0.04);
    ctx.stroke();
  }
  // satin bow with fluttering tails
  const ky = baseY - s * 0.26;
  const tail = Math.sin(clock * 3) * s * 0.03;
  ctx.strokeStyle = "#db2777";
  ctx.lineWidth = Math.max(2, s * 0.025);
  ctx.lineCap = "round";
  for (const sd of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, ky);
    ctx.quadraticCurveTo(x + sd * s * 0.08 + tail, ky + s * 0.12, x + sd * s * 0.06 - tail, ky + s * 0.24);
    ctx.stroke();
  }
  for (const sd of [-1, 1]) {
    ctx.save();
    ctx.translate(x + sd * s * 0.07, ky - s * 0.01);
    ctx.rotate(sd * 0.5);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.08, s * 0.045, 0, 0, TAU);
    fs(ctx, "#f472b6", "#9d174d", lw);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(x, ky, s * 0.03, 0, TAU);
  fs(ctx, "#ec4899", "#9d174d", lw);
}

/** A wrapped gift box with a gold ribbon and bow; `s` is its width. */
export function drawGiftBox(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number) {
  const lw = Math.max(1, s * 0.02);
  ctx.beginPath();
  ctx.rect(x - s / 2, baseY - s * 0.68, s, s * 0.68);
  fs(ctx, "#f9a8d4", "#9d174d", lw);
  ctx.beginPath();
  ctx.rect(x - s * 0.55, baseY - s * 0.84, s * 1.1, s * 0.17);
  fs(ctx, "#f472b6", "#9d174d", lw);
  ctx.fillStyle = "#fde047";
  ctx.fillRect(x - s * 0.06, baseY - s * 0.84, s * 0.12, s * 0.84);
  ctx.fillRect(x - s / 2, baseY - s * 0.42, s, s * 0.1);
  for (const sd of [-1, 1]) {
    ctx.save();
    ctx.translate(x + sd * s * 0.13, baseY - s * 0.9);
    ctx.rotate(sd * 0.45);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.15, s * 0.08, 0, 0, TAU);
    fs(ctx, "#fde047", "#a16207", lw);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(x, baseY - s * 0.88, s * 0.05, 0, TAU);
  fs(ctx, "#facc15", "#a16207", lw);
}

/* -------------------------------- Lotus --------------------------------- */

function lotusPetal(ctx: CanvasRenderingContext2D, L: number, W: number, deep: string) {
  const g = ctx.createLinearGradient(0, 0, 0, -L);
  g.addColorStop(0, "#fdf2f8");
  g.addColorStop(0.55, "#f9a8d4");
  g.addColorStop(1, deep);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(W, -L * 0.3, W * 0.8, -L * 0.8, 0, -L);
  ctx.bezierCurveTo(-W * 0.8, -L * 0.8, -W, -L * 0.3, 0, 0);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#be185d";
  ctx.lineWidth = Math.max(0.8, L * 0.02);
  ctx.stroke();
  ctx.strokeStyle = "rgba(190,24,93,0.35)";
  ctx.beginPath();
  ctx.moveTo(0, -L * 0.1);
  ctx.lineTo(0, -L * 0.85);
  ctx.stroke();
}

/**
 * A full lotus in bloom (layered petals, golden stamens and a seed pod) on its stem,
 * a broad lotus leaf with water drops, and a bud; `s` is the flower size, `open` 0..1.
 */
export function drawGrandLotus(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  s: number,
  open: number,
  clock: number,
) {
  const sway = Math.sin(clock * 0.9) * s * 0.04;
  // broad leaf
  ctx.save();
  ctx.translate(x - s * 0.75, baseY - s * 0.1);
  ctx.rotate(-0.12);
  const lg = ctx.createRadialGradient(0, 0, s * 0.05, 0, 0, s * 0.62);
  lg.addColorStop(0, "#86efac");
  lg.addColorStop(1, "#15803d");
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.62, s * 0.22, 0, 0, TAU);
  ctx.fillStyle = lg;
  ctx.fill();
  ctx.strokeStyle = "#14532d";
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.stroke();
  ctx.strokeStyle = "rgba(20,83,45,0.4)";
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * s * 0.58, Math.sin(a) * s * 0.2);
    ctx.stroke();
  }
  for (const [dx, dy, r] of [[-0.2, -0.04, 0.035], [0.18, 0.05, 0.028], [0.32, -0.06, 0.022]] as const) {
    ctx.beginPath();
    ctx.ellipse(dx * s, dy * s, r * s, r * s * 0.8, 0, 0, TAU);
    fs(ctx, "rgba(240,253,250,0.8)", "rgba(15,118,110,0.6)", 0.8);
    ctx.beginPath();
    ctx.arc(dx * s - r * s * 0.3, dy * s - r * s * 0.3, r * s * 0.25, 0, TAU);
    fs(ctx, "#ffffff", null);
  }
  ctx.restore();

  // bud on its own stem
  const bx = x + s * 0.72;
  ctx.strokeStyle = "#15803d";
  ctx.lineWidth = Math.max(2, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(bx, baseY);
  ctx.quadraticCurveTo(bx + s * 0.05, baseY - s * 0.5, bx + sway, baseY - s * 0.9);
  ctx.stroke();
  ctx.save();
  ctx.translate(bx + sway, baseY - s * 0.9);
  lotusPetal(ctx, s * 0.34, s * 0.14, "#db2777");
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.02, s * 0.08, s * 0.04, 0, 0, TAU);
  fs(ctx, "#22c55e", "#14532d", 1);
  ctx.restore();

  // main stem and flower
  const fx = x + sway;
  const fy = baseY - s * 0.62;
  ctx.strokeStyle = "#15803d";
  ctx.lineWidth = Math.max(2.5, s * 0.04);
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x - s * 0.04, baseY - s * 0.3, fx, fy);
  ctx.stroke();
  drawGlow(ctx, fx, fy - s * 0.25, s * 0.95, "253,224,71", 0.35);

  const spread = 0.35 + open * 0.65;
  const layer = (n: number, fan: number, L: number, W: number, deep: string) => {
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * fan * spread;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(a);
      lotusPetal(ctx, L, W, deep);
      ctx.restore();
    }
  };
  layer(8, Math.PI * 1.15, s * 0.5, s * 0.17, "#ec4899");
  layer(6, Math.PI * 0.8, s * 0.44, s * 0.15, "#f472b6");
  // seed pod with golden stamens
  const py = fy - s * 0.2;
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = Math.max(1, s * 0.012);
  for (let k = 0; k < 14; k++) {
    const a = Math.PI + (k / 13) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(fx + Math.cos(a) * s * 0.1, py + s * 0.04);
    ctx.lineTo(fx + Math.cos(a) * s * 0.17, py - s * 0.05 + Math.sin(a) * s * 0.03);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(fx - s * 0.12, py);
  ctx.lineTo(fx - s * 0.07, py + s * 0.12);
  ctx.lineTo(fx + s * 0.07, py + s * 0.12);
  ctx.lineTo(fx + s * 0.12, py);
  ctx.closePath();
  fs(ctx, "#a3e635", "#3f6212", 1);
  ctx.beginPath();
  ctx.ellipse(fx, py, s * 0.12, s * 0.045, 0, 0, TAU);
  fs(ctx, "#d9f99d", "#3f6212", 1);
  ctx.fillStyle = "#3f6212";
  for (const [dx, dy] of [[0, 0], [-0.06, -0.01], [0.06, -0.01], [-0.03, 0.02], [0.03, 0.02]] as const) {
    ctx.beginPath();
    ctx.arc(fx + dx * s, py + dy * s, s * 0.012, 0, TAU);
    ctx.fill();
  }
  // front petals
  layer(4, Math.PI * 0.45, s * 0.36, s * 0.13, "#f9a8d4");
}

/** A dragonfly hovering with shimmering wings; `s` is its length. */
export function drawDragonfly(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, clock: number) {
  const flick = 0.75 + 0.25 * Math.sin(clock * 40);
  for (const [dx, a] of [[0.1, -0.35], [0.1, 0.35], [-0.08, -0.5], [-0.08, 0.5]] as const) {
    ctx.save();
    ctx.translate(x + dx * s, y);
    ctx.rotate(a - Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.28 * flick, s * 0.08, s * 0.28 * flick, 0, 0, TAU);
    fs(ctx, "rgba(186,230,253,0.55)", "#0ea5e9", 0.8);
    ctx.restore();
  }
  ctx.strokeStyle = "#0d9488";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.6, y);
  ctx.lineTo(x + s * 0.25, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + s * 0.32, y, s * 0.09, 0, TAU);
  fs(ctx, "#14b8a6", "#134e4a", 0.8);
}

/** Soft rays of warm golden light fanning down from (cx, cy). */
export function drawGoldRays(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  clock: number,
  alpha: number,
) {
  for (let k = 0; k < 9; k++) {
    const a = Math.PI / 2 + (k - 4) * 0.16 + Math.sin(clock * 0.4) * 0.04;
    const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    const pulse = 0.5 + 0.5 * Math.sin(clock * 0.9 + k);
    g.addColorStop(0, `rgba(253,224,71,${alpha * pulse})`);
    g.addColorStop(1, "rgba(253,224,71,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - 0.04) * R, cy + Math.sin(a - 0.04) * R);
    ctx.lineTo(cx + Math.cos(a + 0.04) * R, cy + Math.sin(a + 0.04) * R);
    ctx.closePath();
    ctx.fill();
  }
}
