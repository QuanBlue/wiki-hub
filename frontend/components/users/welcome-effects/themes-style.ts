/** Style pack: Cyberpunk, Steampunk, Candy, Kawaii. */
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
  drawGear,
  edgeX,
  focusOr,
  fs,
  heartPath,
  INK,
  outlinedText,
  starPath,
  TAU,
} from "@/components/users/welcome-effects/shapes";

/* ------------------------------ Cyberpunk ----------------------------- */

export function createCyberpunkRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    const f = focusOr(focus, w, h);
    ctx.save();
    ctx.globalAlpha = env;

    // neon rain, slanted
    for (let i = 0; i < 40; i++) {
      const life = (clock * (0.9 + hash(i) * 0.7) + hash(i * 3)) % 1;
      const x = edgeX(i * 7, w, 0.36) + life * 40;
      const y = life * (h + 80) - 40;
      const cy = i % 2 === 0;
      const g = ctx.createLinearGradient(x - 14, y - 40, x, y);
      g.addColorStop(0, cy ? "rgba(6,182,212,0)" : "rgba(236,72,153,0)");
      g.addColorStop(1, cy ? "rgba(6,182,212,0.95)" : "rgba(236,72,153,0.95)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 14, y - 40);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    // neon signs on dark plates (readable in light mode)
    const signs: [number, number, string, string][] = [
      [0.1, 0.2, "ネオ", "#22d3ee"],
      [0.9, 0.3, "2099", "#f472b6"],
      [0.08, 0.7, "夜市", "#a3e635"],
    ];
    signs.forEach(([fx, fy, label, col], i) => {
      const flick = Math.sin(clock * 20 + i * 5) > 0.92 ? 0.35 : 1;
      const x = w * fx;
      const y = h * fy;
      const pw = 74;
      ctx.globalAlpha = env * smooth((t - 0.06 * i) / 0.1) * flick;
      ctx.beginPath();
      ctx.roundRect(x - pw / 2, y - 18, pw, 36, 6);
      fs(ctx, "rgba(15,23,42,0.88)", col, 2);
      drawGlow(ctx, x, y, 58, col === "#22d3ee" ? "34,211,238" : col === "#f472b6" ? "244,114,182" : "163,230,53", 0.35);
      outlinedText(ctx, label, x, y + 1, 22, col, "rgba(15,23,42,0.9)");
    });
    ctx.globalAlpha = env;

    // glitch slices
    const gl = Math.sin(clock * 7) > 0.8 || (t > 0.38 && t < 0.46);
    if (gl) {
      for (let i = 0; i < 4; i++) {
        const y = hash(Math.floor(clock * 14) + i) * h;
        ctx.fillStyle = "rgba(244,63,94,0.45)";
        ctx.fillRect(0, y, w * 0.1, 2 + hash(i + 3) * 4);
        ctx.fillStyle = "rgba(6,182,212,0.45)";
        ctx.fillRect(w * 0.9, y + 3, w * 0.1, 2 + hash(i + 8) * 4);
      }
    }

    // drone scanning the avatar
    const dIn = smooth((t - 0.2) / 0.15) * (1 - smooth((t - 0.8) / 0.15));
    if (dIn > 0.02) {
      const dx = f.x - f.r * 2.6 + Math.sin(clock * 1.8) * 10;
      const dy = f.y - f.r * 2.5 + Math.cos(clock * 2.4) * 6;
      const beam = ctx.createLinearGradient(dx, dy, f.x, f.y - f.r * 1.2);
      beam.addColorStop(0, `rgba(34,211,238,${0.5 * dIn})`);
      beam.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(dx, dy + 6);
      ctx.lineTo(f.x - f.r * 1.3, f.y - f.r * 1.15);
      ctx.lineTo(f.x + f.r * 0.9, f.y - f.r * 1.3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(dx, dy, 15, 6, 0, 0, TAU);
      fs(ctx, "#0f172a", "#22d3ee", 2);
      ctx.fillStyle = "#f43f5e";
      ctx.beginPath();
      ctx.arc(dx, dy, 2.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };
}

/* ------------------------------ Steampunk ----------------------------- */

export function createSteampunkRenderer(): FrameRenderer {
  return (ctx, w, h, ms) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    ctx.save();
    ctx.globalAlpha = env;
    const grow = smooth(t / 0.18);

    // meshing gear pairs in the lower corners
    for (const side of [-1, 1]) {
      const bx = side < 0 ? 30 : w - 30;
      const by = h - 30 + (1 - grow) * 80;
      drawGear(ctx, bx, by, 44, 12, clock * 0.8 * side, "#b45309");
      drawGear(ctx, bx + side * 62, by - 38, 28, 8, -clock * 0.8 * 1.5 * side + 0.3, "#d97706");
      drawGear(ctx, bx + side * 8, by - 78, 20, 7, clock * 0.8 * 2.1 * side, "#fbbf24");
    }

    // brass pipes at the top edge
    const pg = ctx.createLinearGradient(0, 0, 0, 14);
    pg.addColorStop(0, "#fcd34d");
    pg.addColorStop(0.5, "#b45309");
    pg.addColorStop(1, "#78350f");
    ctx.fillStyle = pg;
    ctx.fillRect(0, -4 + (grow - 1) * 20, w, 14);
    ctx.fillStyle = "#fde68a";
    for (let x = 20; x < w; x += 60) {
      ctx.beginPath();
      ctx.arc(x, 3 + (grow - 1) * 20, 2.5, 0, TAU);
      ctx.fill();
    }

    // steam puffs
    for (let i = 0; i < 12; i++) {
      const life = (clock * 0.3 + hash(i)) % 1;
      const x = edgeX(i * 11, w, 0.24) + Math.sin(clock + i) * 14;
      ctx.globalAlpha = env * (1 - life) * 0.7;
      ctx.beginPath();
      ctx.arc(x, h - 30 - life * h * 0.7, 9 + life * 26, 0, TAU);
      fs(ctx, "rgba(148,163,184,0.45)", null);
    }
    ctx.globalAlpha = env;

    // airship
    const sx = lerp(w + 90, -90, clamp01((t - 0.1) / 0.8));
    const sy = h * 0.17 + Math.sin(clock * 1.5) * 8;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 56, 22, 0, 0, TAU);
    fs(ctx, "#fbbf24", "#78350f", 2);
    ctx.strokeStyle = "#b45309";
    ctx.lineWidth = 1.5;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(sx + k * 18, sy - 21);
      ctx.quadraticCurveTo(sx + k * 24, sy, sx + k * 18, sy + 21);
      ctx.stroke();
    }
    ctx.fillStyle = "#78350f";
    ctx.fillRect(sx - 14, sy + 28, 28, 12);
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(sx - 12, sy + 20);
    ctx.lineTo(sx - 12, sy + 28);
    ctx.moveTo(sx + 12, sy + 20);
    ctx.lineTo(sx + 12, sy + 28);
    ctx.stroke();
    ctx.restore();
  };
}

/* -------------------------------- Candy ------------------------------- */

const CANDY = ["#f472b6", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa"];

export function createCandyRenderer(): FrameRenderer {
  return (ctx, w, h, ms) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    ctx.save();
    ctx.globalAlpha = env;

    // chocolate drip across the top
    const drip = smooth(t / 0.18);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= w; x += 6) {
      const bump = (Math.sin(x / 31) * 0.5 + 0.5) * 20 + (Math.sin(x / 13 + 1) * 0.5 + 0.5) * 10;
      ctx.lineTo(x, 8 + bump * drip);
    }
    ctx.lineTo(w, 0);
    ctx.closePath();
    fs(ctx, "#78350f", "#451a03", 1.5);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(0, 3, w, 3);

    // lollipops bouncing up at both edges
    for (let i = 0; i < 6; i++) {
      const x = edgeX(i * 19 + 3, w, 0.22);
      const bounce = Math.abs(Math.sin(clock * 1.7 + i * 1.2));
      const y = h - 26 - bounce * 46 + (1 - smooth(t / 0.15)) * 90;
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, y + 14);
      ctx.lineTo(x, y + 52);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, TAU);
      fs(ctx, CANDY[i % 6], INK, 1.5);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 8, clock + i, clock + i + Math.PI * 1.5);
      ctx.stroke();
    }

    // gumdrops
    for (let i = 0; i < 8; i++) {
      const x = edgeX(i * 29 + 5, w, 0.3);
      const y = h - 12 + (1 - smooth((t - 0.04 * i) / 0.15)) * 50;
      ctx.beginPath();
      ctx.moveTo(x - 14, y);
      ctx.arc(x, y, 14, Math.PI, 0);
      ctx.closePath();
      fs(ctx, CANDY[(i + 2) % 6], INK, 1.4);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.arc(x - 5, y - 8, 3, 0, TAU);
      ctx.fill();
    }

    // sprinkles raining down
    for (let i = 0; i < 40; i++) {
      const life = (clock * (0.28 + hash(i) * 0.25) + hash(i * 3)) % 1;
      ctx.save();
      ctx.translate(edgeX(i * 5 + 1, w, 0.36), 20 + life * (h - 20));
      ctx.rotate(hash(i * 7) * TAU + clock);
      ctx.beginPath();
      ctx.roundRect(-5, -1.8, 10, 3.6, 2);
      fs(ctx, CANDY[i % 6], null);
      ctx.restore();
    }
    ctx.restore();
  };
}

/* ------------------------------- Kawaii ------------------------------- */

export function createKawaiiRenderer(): FrameRenderer {
  return (ctx, w, h, ms) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    ctx.save();
    ctx.globalAlpha = env;
    const grow = smooth(t / 0.2);

    // rainbow arch in the lower-left and lower-right corners
    const bands = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa"];
    for (const side of [0, 1]) {
      const cx = side === 0 ? 0 : w;
      const cy = h + 10;
      bands.forEach((c, i) => {
        ctx.beginPath();
        ctx.arc(cx, cy, (120 - i * 9) * grow, Math.PI, Math.PI * 2);
        ctx.strokeStyle = c;
        ctx.lineWidth = 9;
        ctx.stroke();
      });
    }

    // smiling clouds
    for (let i = 0; i < 4; i++) {
      const x = edgeX(i * 31 + 1, w, 0.24) + Math.sin(clock * 0.7 + i) * 18;
      const y = h * (0.14 + i * 0.16) + Math.cos(clock * 0.9 + i) * 6;
      cloudPath(ctx, x, y, 22);
      fs(ctx, "#ffffff", "#7dd3fc", 2);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x - 6, y + 2, 1.8, 0, TAU);
      ctx.arc(x + 6, y + 2, 1.8, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y + 5, 3, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = "rgba(251,113,133,0.6)";
      ctx.beginPath();
      ctx.ellipse(x - 12, y + 6, 3.5, 2.2, 0, 0, TAU);
      ctx.ellipse(x + 12, y + 6, 3.5, 2.2, 0, 0, TAU);
      ctx.fill();
    }

    // hearts and stars floating up
    for (let i = 0; i < 20; i++) {
      const life = (clock * (0.1 + hash(i) * 0.1) + hash(i * 3)) % 1;
      const x = edgeX(i * 7 + 2, w, 0.34) + Math.sin(clock * 1.3 + i) * 12;
      const y = h - life * (h + 40) + 10;
      const s = 6 + hash(i * 9) * 6;
      ctx.globalAlpha = env * Math.sin(Math.min(1, life * 1.2) * Math.PI);
      if (i % 2 === 0) {
        heartPath(ctx, x, y, s);
        fs(ctx, i % 4 === 0 ? "#f9a8d4" : "#fda4af", "#be185d", 1.2);
      } else {
        starPath(ctx, x, y, s * 1.2, s * 0.55, 5, clock + i);
        fs(ctx, "#fde68a", "#b45309", 1.2);
      }
    }
    ctx.globalAlpha = env;
    ctx.restore();
  };
}
