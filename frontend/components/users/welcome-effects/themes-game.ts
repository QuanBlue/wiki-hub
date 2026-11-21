/** Game pack: Block Craft, Platformer, Racing. Stateless — positions are pure functions of time. */
import { DURATION_MS, type FrameRenderer } from "@/components/users/welcome-effects/engine";
import {
  clamp01,
  drawGlow,
  envelope,
  hash,
  lerp,
  smooth,
} from "@/components/users/welcome-effects/helpers";
import {
  cloudPath,
  edgeX,
  focusOr,
  fs,
  INK,
  isoCube,
  outlinedText,
  TAU,
} from "@/components/users/welcome-effects/shapes";

/* ---------------------------- Block Craft ---------------------------- */

const BLOCKS: [string, string, string][] = [
  ["#86efac", "#92400e", "#78350f"], // grass
  ["#a8a29e", "#78716c", "#57534e"], // stone
  ["#d6a86a", "#a16207", "#854d0e"], // planks
  ["#67e8f9", "#0e7490", "#155e75"], // diamond ore
  ["#fde047", "#ca8a04", "#a16207"], // gold ore
];

export function createBlockcraftRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const f = focusOr(focus, w, h);
    ctx.save();
    ctx.globalAlpha = env;
    ctx.imageSmoothingEnabled = false;

    // voxel ground strip with grass top that rises in and sinks out
    const tile = 28;
    const rise = (1 - smooth(t / 0.18)) * 70 + smooth((t - 0.82) / 0.18) * 70;
    for (let i = 0; i * tile < w + tile; i++) {
      const x = i * tile;
      const y = h - tile * 1.6 + rise;
      ctx.fillStyle = "#92400e";
      ctx.fillRect(x, y + 8, tile, tile * 1.7);
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(x, y, tile, 9);
      ctx.fillStyle = "rgba(0,0,0,0.14)";
      for (let k = 0; k < 3; k++) {
        const sx = x + 4 + hash(i * 5 + k) * (tile - 10);
        ctx.fillRect(sx, y + 14 + hash(i * 3 + k * 9) * 20, 5, 5);
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, tile, tile * 1.7 + 8);
    }

    // falling cubes near the edges
    for (let i = 0; i < 16; i++) {
      const life = ((ms / 1000) * (0.35 + hash(i) * 0.3) + hash(i * 3)) % 1;
      const s = 12 + hash(i * 7) * 12;
      const x = edgeX(i * 11, w, 0.26);
      const y = -s * 2 + life * (h + s * 4);
      const [a, b, c] = BLOCKS[i % BLOCKS.length];
      ctx.save();
      isoCube(ctx, x, y, s, a, b, c);
      ctx.restore();
    }

    // diamond burst + XP orbs flying into the avatar
    const burst = clamp01((t - 0.4) / 0.2);
    if (burst > 0) {
      for (let i = 0; i < 26; i++) {
        const ang = hash(i * 13) * TAU;
        const sp = 40 + hash(i * 5) * 90;
        const d = sp * burst * f.r * 0.035;
        const px = f.x + Math.cos(ang) * (f.r * 1.8 + d);
        const py = f.y + Math.sin(ang) * (f.r * 1.8 + d) + burst * burst * 40;
        const sz = 4 + hash(i) * 4;
        ctx.globalAlpha = env * (1 - burst * 0.6);
        ctx.fillStyle = i % 3 === 0 ? "#67e8f9" : i % 3 === 1 ? "#fde047" : "#ffffff";
        ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.strokeRect(px - sz / 2, py - sz / 2, sz, sz);
      }
    }
    const orbT = clamp01((t - 0.45) / 0.35);
    if (orbT > 0 && orbT < 1) {
      ctx.globalAlpha = env;
      for (let i = 0; i < 14; i++) {
        const u = clamp01(orbT * 1.3 - hash(i) * 0.3);
        if (u <= 0 || u >= 1) continue;
        const a = hash(i * 17) * TAU;
        const sx = f.x + Math.cos(a) * f.r * 4.5;
        const sy = f.y + Math.sin(a) * f.r * 3;
        const e = u * u;
        const ox = lerp(sx, f.x, e) + Math.sin(u * 9 + i) * 8 * (1 - u);
        const oy = lerp(sy, f.y, e);
        drawGlow(ctx, ox, oy, 11, "163,230,53", 0.8);
        ctx.fillStyle = "#bef264";
        ctx.fillRect(ox - 2.5, oy - 2.5, 5, 5);
      }
    }
    ctx.restore();
  };
}

/* ----------------------------- Platformer ---------------------------- */

function drawPipe(ctx: CanvasRenderingContext2D, x: number, y: number, bodyW: number, hgt: number, dir: 1 | -1) {
  const lipW = bodyW * 1.18;
  const bx = x - bodyW / 2;
  ctx.fillStyle = "#22c55e";
  ctx.fillRect(bx, y + 14, bodyW, hgt);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, y + 14, bodyW, hgt);
  ctx.fillStyle = "#4ade80";
  ctx.fillRect(x - lipW / 2, y, lipW, 18);
  ctx.strokeRect(x - lipW / 2, y, lipW, 18);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(bx + 5 * dir + (dir < 0 ? bodyW - 12 : 0), y + 18, 6, hgt - 6);
}

export function createPlatformerRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    focusOr(focus, w, h);
    ctx.save();
    ctx.globalAlpha = env;

    // brick floor
    const rise = (1 - smooth(t / 0.16)) * 60 + smooth((t - 0.84) / 0.16) * 60;
    const bw = 34;
    const bh = 17;
    for (let r = 0; r < 3; r++) {
      for (let i = -1; i * bw < w + bw; i++) {
        const x = i * bw + (r % 2) * (bw / 2);
        const y = h - bh * 3 + r * bh + rise;
        ctx.fillStyle = "#f97316";
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = "#7c2d12";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(x + 2, y + 2, bw - 4, 3);
      }
    }
    // pipes at both edges
    const pipeH = Math.min(120, h * 0.28);
    const pr = smooth((t - 0.04) / 0.2) * (1 - smooth((t - 0.84) / 0.16));
    drawPipe(ctx, 34, h - bh * 3 - pipeH * pr + rise, 52, pipeH, 1);
    drawPipe(ctx, w - 34, h - bh * 3 - pipeH * pr + rise, 52, pipeH, -1);

    // clouds
    for (let i = 0; i < 4; i++) {
      const x = ((hash(i) * w * 1.3 + clock * (10 + i * 4)) % (w + 120)) - 60;
      const y = 26 + hash(i * 9) * h * 0.18;
      if (x > w * 0.28 && x < w * 0.72) continue;
      cloudPath(ctx, x, y, 26);
      fs(ctx, "#ffffff", "#38bdf8", 2);
    }

    // "?" blocks popping coins
    for (let i = 0; i < 3; i++) {
      const side = i % 2 === 0 ? 0.12 + i * 0.03 : 0.88 - i * 0.03;
      const bx = w * side;
      const by = h * (0.3 + i * 0.1);
      const hit = (clock * 0.9 + i * 0.37) % 1.6;
      const bump = hit < 0.18 ? -Math.sin((hit / 0.18) * Math.PI) * 6 : 0;
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(bx - 15, by - 15 + bump, 30, 30);
      ctx.strokeStyle = "#78350f";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx - 15, by - 15 + bump, 30, 30);
      outlinedText(ctx, "?", bx, by + 1 + bump, 20, "#fff7ed", "#78350f");
      if (hit < 0.9) {
        const u = hit / 0.9;
        const cy = by - 22 - Math.sin(u * Math.PI) * 42;
        const sx = Math.abs(Math.cos(u * 14));
        ctx.beginPath();
        ctx.ellipse(bx, cy, 7 * Math.max(0.15, sx), 10, 0, 0, TAU);
        fs(ctx, "#fde047", "#a16207", 1.5);
      }
    }
    ctx.restore();
  };
}

/* ------------------------------- Racing ------------------------------ */

function drawRaceCar(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-1, 0.1);
  ctx.quadraticCurveTo(-0.95, -0.28, -0.5, -0.3);
  ctx.lineTo(-0.25, -0.62);
  ctx.lineTo(0.35, -0.62);
  ctx.lineTo(0.62, -0.3);
  ctx.quadraticCurveTo(1, -0.26, 1, 0.1);
  ctx.closePath();
  fs(ctx, "#ef4444", INK, 0.06);
  ctx.beginPath();
  ctx.moveTo(-0.2, -0.54);
  ctx.lineTo(0.3, -0.54);
  ctx.lineTo(0.48, -0.32);
  ctx.lineTo(-0.38, -0.32);
  ctx.closePath();
  fs(ctx, "#bae6fd", INK, 0.04);
  ctx.fillStyle = "#fff";
  ctx.fillRect(-0.6, -0.1, 1.2, 0.07);
  for (const wx of [-0.55, 0.55]) {
    ctx.beginPath();
    ctx.arc(wx, 0.12, 0.26, 0, TAU);
    fs(ctx, "#111827", INK, 0.05);
    ctx.beginPath();
    ctx.arc(wx, 0.12, 0.1, 0, TAU);
    fs(ctx, "#e5e7eb", null);
  }
  ctx.restore();
}

export function createRacingRenderer(): FrameRenderer {
  return (ctx, w, h, ms) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    ctx.save();
    ctx.globalAlpha = env;

    // scrolling chequered strips top and bottom
    const sq = 14;
    const off = (clock * 120) % (sq * 2);
    const slide = (1 - smooth(t / 0.12)) * 30;
    for (let i = -2; i * sq < w + sq * 2; i++) {
      for (let r = 0; r < 2; r++) {
        const dark = (i + r) % 2 === 0;
        ctx.fillStyle = dark ? "#111827" : "#ffffff";
        ctx.fillRect(i * sq + off, r * sq - slide, sq, sq);
        ctx.fillRect(i * sq - off, h - (r + 1) * sq + slide, sq, sq);
      }
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, -slide, w, sq * 2);
    ctx.strokeRect(0, h - sq * 2 + slide, w, sq * 2);

    // speed streaks
    for (let i = 0; i < 22; i++) {
      const y = sq * 2 + 8 + hash(i * 3) * (h - sq * 4 - 16);
      const x = (((clock * (360 + hash(i) * 260) + hash(i * 7) * w) % (w + 200)) - 100);
      if (x > w * 0.25 && x < w * 0.75) continue;
      const len = 50 + hash(i * 9) * 70;
      const col = i % 3 === 0 ? "239,68,68" : i % 3 === 1 ? "14,165,233" : "250,204,21";
      const g = ctx.createLinearGradient(x - len, y, x, y);
      g.addColorStop(0, `rgba(${col},0)`);
      g.addColorStop(1, `rgba(${col},0.85)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - len, y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    // two cars race across the bottom lane, one each way
    const cs = Math.max(30, Math.min(70, h * 0.08));
    const laneY = h - sq * 2 - cs * 0.45;
    const passes: [number, number, 1 | -1, string][] = [
      [0.26, 0.5, 1, "239,68,68"],
      [0.52, 0.76, -1, "59,130,246"],
    ];
    for (const [a, b, dir, smoke] of passes) {
      const run = clamp01((t - a) / (b - a));
      if (run <= 0 || run >= 1) continue;
      const cx = dir > 0 ? lerp(-cs * 2, w + cs * 2, run) : lerp(w + cs * 2, -cs * 2, run);
      for (let k = 0; k < 10; k++) {
        drawGlow(ctx, cx - dir * (cs + k * cs * 0.45), laneY + cs * 0.2, cs * 0.25 + k * 2, smoke, 0.3 - k * 0.025);
      }
      ctx.save();
      ctx.translate(cx, laneY);
      ctx.scale(dir, 1);
      drawRaceCar(ctx, 0, 0, cs);
      ctx.restore();
    }

    // waving chequered flags in the lower corners
    for (const side of [0, 1]) {
      const fx = side ? w - 40 : 40;
      const fy = h - sq * 2 - 70;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx, h - sq * 2);
      ctx.stroke();
      const dirx = side ? -1 : 1;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const wave = Math.sin(clock * 8 + c * 0.8) * 3;
          ctx.fillStyle = (r + c) % 2 ? "#ffffff" : "#111827";
          ctx.fillRect(fx + dirx * c * 9 - (dirx < 0 ? 9 : 0), fy + r * 8 + wave, 9, 8);
        }
      }
    }

    // countdown 3-2-1-GO!
    const seq: [number, number, string, string][] = [
      [0.04, 0.1, "3", "#ef4444"],
      [0.1, 0.16, "2", "#f59e0b"],
      [0.16, 0.22, "1", "#facc15"],
      [0.22, 0.34, "GO!", "#22c55e"],
    ];
    for (const [a, b, label, col] of seq) {
      if (t >= a && t < b) {
        const u = (t - a) / (b - a);
        const pop = 1 + (1 - u) * 0.5;
        outlinedText(ctx, label, w / 2, Math.min(h * 0.2, 110), 54 * pop, col, "#111827", "ui-monospace, monospace");
      }
    }
    ctx.restore();
  };
}
