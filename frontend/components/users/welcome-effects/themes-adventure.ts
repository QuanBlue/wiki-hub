/** Adventure pack: Pirate, Ninja, Rocket, Jungle. */
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
  edgeX,
  focusOr,
  fs,
  INK,
  starPath,
  TAU,
} from "@/components/users/welcome-effects/shapes";

/* -------------------------------- Pirate ------------------------------ */

export function createPirateRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    const f = focusOr(focus, w, h);
    ctx.save();
    ctx.globalAlpha = env;

    // waves along the bottom
    const rise = (1 - smooth(t / 0.16)) * 60 + smooth((t - 0.84) / 0.16) * 60;
    const layers: [string, string, number, number][] = [
      ["#0ea5e9", "#0369a1", 34, 1.1],
      ["#0284c7", "#075985", 22, -1.4],
    ];
    layers.forEach(([fill, edge, amp, sp], li) => {
      ctx.beginPath();
      ctx.moveTo(0, h + 4);
      for (let x = 0; x <= w; x += 8) {
        ctx.lineTo(x, h - 28 - li * 14 + rise + Math.sin(x / 52 + clock * sp) * (amp * 0.28));
      }
      ctx.lineTo(w, h + 4);
      ctx.closePath();
      fs(ctx, fill, edge, 1.5);
    });
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let x = 6; x < w; x += 34) {
      ctx.beginPath();
      ctx.arc(x, h - 28 + rise + Math.sin(x / 52 + clock * 1.1) * 9.5, 3, 0, TAU);
      ctx.fill();
    }

    // ship sailing across
    const sail = clamp01((t - 0.12) / 0.7);
    const sx = lerp(-90, w + 90, sail);
    const sy = h - 58 + rise + Math.sin(clock * 2.2) * 4;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.sin(clock * 2.2) * 0.05);
    ctx.scale(1.5, 1.5);
    ctx.beginPath();
    ctx.moveTo(-44, 0);
    ctx.lineTo(44, 0);
    ctx.lineTo(32, 20);
    ctx.lineTo(-32, 20);
    ctx.closePath();
    fs(ctx, "#92400e", "#451a03", 2);
    ctx.fillStyle = "#451a03";
    ctx.fillRect(-2, -62, 4, 62);
    ctx.beginPath();
    ctx.moveTo(2, -58);
    ctx.quadraticCurveTo(34, -38, 2, -8);
    ctx.closePath();
    fs(ctx, "#fef3c7", "#78350f", 1.8);
    ctx.beginPath();
    ctx.moveTo(-2, -52);
    ctx.quadraticCurveTo(-26, -34, -2, -12);
    ctx.closePath();
    fs(ctx, "#fde68a", "#78350f", 1.8);
    ctx.fillStyle = "#111827";
    ctx.fillRect(2, -76, 16, 10);
    ctx.restore();

    // dashed treasure path from the bottom-left to the avatar
    const pathT = smooth((t - 0.22) / 0.3);
    if (pathT > 0) {
      ctx.save();
      ctx.setLineDash([8, 7]);
      ctx.lineDashOffset = -clock * 18;
      ctx.strokeStyle = "#b91c1c";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const ex = f.x + f.r * 1.7;
      const ey = f.y + f.r * 1.7;
      const x0 = w * 0.78;
      const y0 = h - 74;
      ctx.moveTo(x0, y0);
      const px = lerp(x0, ex, pathT);
      const py = lerp(y0, ey, pathT);
      ctx.quadraticCurveTo((x0 + px) / 2, Math.max(py, y0) - 10, px, py);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = "#b91c1c";
      ctx.lineWidth = 3;
      const cx = f.x + f.r * 1.7;
      const cy = f.y + f.r * 1.7;
      if (pathT > 0.95) {
        ctx.beginPath();
        ctx.moveTo(cx - 7, cy - 7);
        ctx.lineTo(cx + 7, cy + 7);
        ctx.moveTo(cx + 7, cy - 7);
        ctx.lineTo(cx - 7, cy + 7);
        ctx.stroke();
      }
    }

    // gold coins raining at the edges
    for (let i = 0; i < 14; i++) {
      const life = (clock * (0.25 + hash(i) * 0.15) + hash(i * 3)) % 1;
      const sxw = Math.abs(Math.cos(clock * 6 + i));
      ctx.beginPath();
      ctx.ellipse(edgeX(i * 9, w, 0.24), life * h, 7 * Math.max(0.2, sxw), 8, 0, 0, TAU);
      fs(ctx, "#fde047", "#a16207", 1.5);
    }

    // gulls
    for (let i = 0; i < 3; i++) {
      const x = ((clock * (24 + i * 8) + i * w * 0.4) % (w + 80)) - 40;
      const y = 40 + i * 24 + Math.sin(clock * 2 + i) * 6;
      const fl = Math.sin(clock * 6 + i) * 5;
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 12, y + fl);
      ctx.quadraticCurveTo(x - 5, y - 6, x, y);
      ctx.quadraticCurveTo(x + 5, y - 6, x + 12, y + fl);
      ctx.stroke();
    }
    ctx.restore();
  };
}

/* -------------------------------- Ninja ------------------------------- */

function shuriken(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  starPath(ctx, x, y, r, r * 0.38, 4, rot);
  fs(ctx, "#cbd5e1", INK, 1.5);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.18, 0, TAU);
  fs(ctx, "#334155", INK, 1);
}

export function createNinjaRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    const f = focusOr(focus, w, h);
    ctx.save();
    ctx.globalAlpha = env;

    // pale moon
    const mx = w * 0.14;
    const my = h * 0.2;
    drawGlow(ctx, mx, my, 110, "226,232,240", 0.5);
    ctx.beginPath();
    ctx.arc(mx, my, 40, 0, TAU);
    fs(ctx, "#f8fafc", "#64748b", 2);

    // bamboo groves at both edges
    const sprout = smooth(t / 0.2);
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0;
      const x = side ? 10 + (i / 2) * 22 : w - 10 - ((i - 1) / 2) * 22;
      const top = h - (h * (0.55 + hash(i * 3) * 0.3)) * sprout;
      const sway = Math.sin(clock * 1.3 + i) * 3;
      ctx.strokeStyle = "#166534";
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, h + 4);
      ctx.lineTo(x + sway, top);
      ctx.stroke();
      ctx.strokeStyle = "#4ade80";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = "#14532d";
      ctx.lineWidth = 2;
      for (let y = h - 30; y > top + 10; y -= 30) {
        const u = (h - y) / (h - top);
        ctx.beginPath();
        ctx.moveTo(x - 5 + sway * u, y);
        ctx.lineTo(x + 5 + sway * u, y);
        ctx.stroke();
      }
      for (let k = 0; k < 2; k++) {
        const ly = top + 18 + k * 34;
        ctx.save();
        ctx.translate(x + sway, ly);
        ctx.rotate((side ? 1 : -1) * (0.5 + k * 0.4) + Math.sin(clock * 2 + i) * 0.1);
        ctx.beginPath();
        ctx.ellipse(side ? 14 : -14, 0, 15, 4, 0, 0, TAU);
        fs(ctx, "#22c55e", "#14532d", 1);
        ctx.restore();
      }
    }

    // shurikens flying across with motion trails
    for (let i = 0; i < 5; i++) {
      const u = (clock * (0.35 + hash(i) * 0.2) + hash(i * 3)) % 1;
      const y = h * (0.15 + hash(i * 7) * 0.6);
      const dir = i % 2 === 0 ? 1 : -1;
      const x = dir > 0 ? u * (w + 80) - 40 : w - u * (w + 80) + 40;
      if (Math.abs(x - f.x) < f.r * 2 && Math.abs(y - f.y) < f.r * 2) continue;
      ctx.strokeStyle = "rgba(100,116,139,0.45)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - dir * 60, y);
      ctx.stroke();
      shuriken(ctx, x, y, 11, clock * 12 + i);
    }

    // ink slash across the scene at the climax
    const slash = smooth((t - 0.36) / 0.1) * (1 - smooth((t - 0.62) / 0.14));
    if (slash > 0.01) {
      ctx.save();
      ctx.globalAlpha = env * slash;
      const sx = w * 0.04;
      const sy = h * 0.82;
      const ex = w * 0.96;
      const ey = h * 0.16;
      const prog = smooth((t - 0.36) / 0.1);
      const px = lerp(sx, ex, prog);
      const py = lerp(sy, ey, prog);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo((sx + px) / 2, (sy + py) / 2 - 36, px, py);
      ctx.quadraticCurveTo((sx + px) / 2 + 6, (sy + py) / 2 - 18, sx, sy);
      fs(ctx, "#0f172a", null);
      ctx.strokeStyle = "rgba(248,250,252,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo((sx + px) / 2, (sy + py) / 2 - 28, px, py);
      ctx.stroke();
      ctx.restore();
    }

    // red leaves
    for (let i = 0; i < 18; i++) {
      const life = (clock * (0.14 + hash(i) * 0.1) + hash(i * 3)) % 1;
      const x = edgeX(i * 5, w, 0.3) + Math.sin(clock * 1.6 + i) * 22;
      ctx.save();
      ctx.translate(x, life * h);
      ctx.rotate(clock * 2 + i);
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.quadraticCurveTo(6, -2, 0, 7);
      ctx.quadraticCurveTo(-6, -2, 0, -7);
      fs(ctx, i % 3 === 0 ? "#f97316" : "#dc2626", "#7f1d1d", 1);
      ctx.restore();
    }
    ctx.restore();
  };
}

/* -------------------------------- Rocket ------------------------------ */

function drawRocket(ctx: CanvasRenderingContext2D, s: number, clock: number) {
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.quadraticCurveTo(11, -8, 8, 14);
  ctx.lineTo(-8, 14);
  ctx.quadraticCurveTo(-11, -8, 0, -22);
  fs(ctx, "#f8fafc", INK, 1.6 / s);
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.quadraticCurveTo(6, -17, 7, -11);
  ctx.lineTo(-7, -11);
  ctx.quadraticCurveTo(-6, -17, 0, -22);
  fs(ctx, "#ef4444", INK, 1.2 / s);
  ctx.beginPath();
  ctx.arc(0, -2, 4.5, 0, TAU);
  fs(ctx, "#38bdf8", INK, 1.2 / s);
  ctx.beginPath();
  ctx.moveTo(-8, 6);
  ctx.lineTo(-16, 18);
  ctx.lineTo(-8, 14);
  ctx.closePath();
  ctx.moveTo(8, 6);
  ctx.lineTo(16, 18);
  ctx.lineTo(8, 14);
  ctx.closePath();
  fs(ctx, "#ef4444", INK, 1.2 / s);
  ctx.beginPath();
  ctx.moveTo(-6, 14);
  ctx.quadraticCurveTo(0, 36 + Math.sin(clock * 30) * 6, 6, 14);
  fs(ctx, "#fb923c", "#b45309", 1 / s);
  ctx.beginPath();
  ctx.moveTo(-3, 14);
  ctx.quadraticCurveTo(0, 26 + Math.sin(clock * 34) * 4, 3, 14);
  fs(ctx, "#fde047", null);
}

export function createRocketRenderer(): FrameRenderer {
  return (ctx, w, h, ms) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    ctx.save();
    ctx.globalAlpha = env;

    // twinkling star field (indigo + gold reads on white and on dark)
    for (let i = 0; i < 46; i++) {
      const x = hash(i * 3.1) * w;
      const y = hash(i * 7.7) * h * 0.85;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(clock * 2 + i));
      if (i % 3 === 0) {
        starPath(ctx, x, y, 4.5 * tw + 1.5, 1.6, 4, 0);
        fs(ctx, "#fde047", "#a16207", 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 1.4 + tw, 0, TAU);
        fs(ctx, "rgba(99,102,241,0.75)", null);
      }
    }

    // shooting stars
    for (let i = 0; i < 3; i++) {
      const u = (clock * 0.45 + i * 0.37) % 1;
      const sx = w * (0.15 + i * 0.3) + u * 160;
      const sy = h * 0.05 + u * 110 + i * 20;
      const g = ctx.createLinearGradient(sx - 70, sy - 48, sx, sy);
      g.addColorStop(0, "rgba(129,140,248,0)");
      g.addColorStop(1, "rgba(79,70,229,0.9)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx - 70, sy - 48);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      drawGlow(ctx, sx, sy, 8, "253,224,71", 0.9);
    }

    // big ringed planet in the lower-right + a small moon
    const pr = Math.max(28, Math.min(80, h * 0.12));
    const px = w - pr * 1.3;
    const py = h - pr * 1.1 + (1 - smooth(t / 0.18)) * pr * 2;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.35);
    ctx.strokeStyle = "#fde68a";
    ctx.lineWidth = pr * 0.12;
    ctx.beginPath();
    ctx.ellipse(0, 0, pr * 1.7, pr * 0.42, 0, Math.PI, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, TAU);
    fs(ctx, "#fb923c", "#9a3412", 2);
    ctx.fillStyle = "rgba(154,52,18,0.25)";
    ctx.fillRect(-pr, -pr * 0.25, pr * 2, pr * 0.16);
    ctx.fillRect(-pr, pr * 0.25, pr * 2, pr * 0.12);
    ctx.strokeStyle = "#fde68a";
    ctx.lineWidth = pr * 0.12;
    ctx.beginPath();
    ctx.ellipse(0, 0, pr * 1.7, pr * 0.42, 0, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(pr * 0.9, h * 0.22, pr * 0.3, 0, TAU);
    fs(ctx, "#e2e8f0", "#64748b", 1.5);

    // rocket flying a big figure-eight loop with a glowing exhaust trail
    const loop = clamp01((t - 0.08) / 0.8);
    if (loop > 0 && loop < 1) {
      const pos = (u: number) => {
        const a = u * TAU * 1.15 - Math.PI / 2;
        return [w * 0.5 + Math.cos(a) * w * 0.36, h * 0.45 + Math.sin(2 * a) * h * 0.2] as const;
      };
      for (let k = 26; k >= 1; k--) {
        const [x, y] = pos(Math.max(0, loop - k * 0.006));
        drawGlow(ctx, x, y, 6 + (26 - k) * 0.45, k % 2 ? "251,146,60" : "253,224,71", (0.6 * (26 - k)) / 26);
      }
      const [x, y] = pos(loop);
      const [nx, ny] = pos(Math.min(1, loop + 0.004));
      const s = Math.max(1.3, Math.min(2.4, h / 260));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(ny - y, nx - x) + Math.PI / 2);
      ctx.scale(s, s);
      drawRocket(ctx, s, clock);
      ctx.restore();
    }

    // launch smoke rising from the bottom-left
    for (let i = 0; i < 10; i++) {
      const life = (clock * 0.4 + hash(i)) % 1;
      ctx.beginPath();
      ctx.arc(w * 0.08 + Math.sin(i * 3 + clock) * 20, h - life * 80, 10 + life * 24, 0, TAU);
      ctx.globalAlpha = env * (1 - life) * 0.5;
      fs(ctx, "#e2e8f0", null);
      ctx.globalAlpha = env;
    }
    ctx.restore();
  };
}

/* -------------------------------- Jungle ------------------------------ */

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, rot: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.38, len, 0);
  ctx.quadraticCurveTo(len * 0.5, len * 0.38, 0, 0);
  fs(ctx, fill, "#14532d", 1.4);
  ctx.strokeStyle = "rgba(20,83,45,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len * 0.94, 0);
  ctx.stroke();
  ctx.restore();
}

export function createJungleRenderer(): FrameRenderer {
  return (ctx, w, h, ms) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    ctx.save();
    ctx.globalAlpha = env;
    const grow = smooth(t / 0.2);

    // big leaves growing in from both lower corners
    for (const side of [-1, 1]) {
      const bx = side < 0 ? -6 : w + 6;
      for (let i = 0; i < 6; i++) {
        const rot =
          (side < 0 ? -0.15 : Math.PI + 0.15) + side * (-0.18 * i) + Math.sin(clock * 1.2 + i + side) * 0.05;
        leaf(ctx, bx, h + 6, (90 + i * 16) * grow, rot * (side < 0 ? 1 : 1) - (side < 0 ? 0.4 : -0.4), i % 2 ? "#22c55e" : "#16a34a");
      }
    }

    // hanging vines from the top
    for (let i = 0; i < 8; i++) {
      const x = edgeX(i * 17 + 4, w, 0.28);
      const len = (50 + hash(i * 5) * 80) * grow;
      const sway = Math.sin(clock * 1.5 + i) * 6;
      ctx.strokeStyle = "#15803d";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + sway, len * 0.5, x + sway * 1.6, len);
      ctx.stroke();
      for (let k = 1; k <= 3; k++) {
        const u = k / 3.2;
        leaf(ctx, x + sway * u * 1.6, len * u, 14, k % 2 ? 0.8 : 2.3, "#4ade80");
      }
    }

    // butterflies
    const hues = ["#f97316", "#ec4899", "#38bdf8", "#facc15"];
    for (let i = 0; i < 6; i++) {
      const x = edgeX(i * 23 + 2, w, 0.3) + Math.sin(clock * 0.9 + i) * 34;
      const y = h * (0.2 + hash(i * 5) * 0.6) + Math.cos(clock * 1.1 + i) * 22;
      const fl = Math.abs(Math.sin(clock * 9 + i));
      ctx.save();
      ctx.translate(x, y);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * 7 * fl, -3, 8 * Math.max(0.2, fl), 10, s * 0.5, 0, TAU);
        fs(ctx, hues[i % 4], INK, 1.2);
      }
      ctx.fillStyle = INK;
      ctx.fillRect(-1, -8, 2, 14);
      ctx.restore();
    }

    // fireflies
    for (let i = 0; i < 16; i++) {
      drawGlow(
        ctx,
        edgeX(i * 7 + 9, w, 0.32) + Math.sin(clock + i) * 20,
        h * (0.1 + hash(i * 3) * 0.8) + Math.cos(clock * 0.8 + i) * 16,
        9,
        "253,224,71",
        0.85 * (0.5 + 0.5 * Math.sin(clock * 3.4 + i)),
      );
    }

    // hibiscus flowers blooming along the bottom
    for (let i = 0; i < 6; i++) {
      const x = edgeX(i * 13 + 6, w, 0.3);
      const bloom = smooth((t - 0.2 - i * 0.03) / 0.15);
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * TAU + 0.3;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * 9 * bloom, h - 26 + Math.sin(a) * 9 * bloom, 8 * bloom, 6 * bloom, a, 0, TAU);
        fs(ctx, "#f43f5e", "#881337", 1);
      }
      ctx.beginPath();
      ctx.arc(x, h - 26, 3.5 * bloom, 0, TAU);
      fs(ctx, "#fde047", null);
    }
    ctx.restore();
  };
}
