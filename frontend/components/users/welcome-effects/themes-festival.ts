/** Festival pack: Tết, Halloween, Christmas, Mid-Autumn. */
import {
  DURATION_MS,
  mascotLayout,
  type FrameRenderer,
} from "@/components/users/welcome-effects/engine";
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
  drawCarpLantern,
  drawCuoiOnMoon,
  drawGhost,
  drawHauntedHouse,
  drawJadeRabbit,
  drawLionDance,
  drawSpider,
  drawWitch,
} from "@/components/users/welcome-effects/scene-details";
import {
  edgeX,
  focusOr,
  fs,
  heartPath,
  INK,
  starPath,
  TAU,
  TOPBAR_H,
} from "@/components/users/welcome-effects/shapes";

function blossom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  petal: string,
  edge: string,
  core: string,
  rot: number,
) {
  for (let i = 0; i < 5; i++) {
    const a = rot + (i / 5) * TAU;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.52, 0, TAU);
    fs(ctx, petal, edge, 1);
  }
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, TAU);
  fs(ctx, core, null);
}

/* -------------------------------- Tết -------------------------------- */

const LIXI_WORDS = ["Lộc", "Phúc", "Tài", "An"];

/** A lì xì packet centred at (x, y): red, gold border, darker flap, gold seal and a blessing. */
function drawLiXi(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  rot: number,
  word: string,
) {
  const W = s * 0.95;
  const H = s * 1.45;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.roundRect(-W / 2, -H / 2, W, H, s * 0.1);
  fs(ctx, "#dc2626", "#7f1d1d", Math.max(1, s * 0.08));
  ctx.beginPath();
  ctx.roundRect(-W / 2 + s * 0.09, -H / 2 + s * 0.09, W - s * 0.18, H - s * 0.18, s * 0.06);
  fs(ctx, null, "#fbbf24", Math.max(0.8, s * 0.05));
  ctx.beginPath();
  ctx.moveTo(-W / 2, -H / 2);
  ctx.lineTo(0, -H / 2 + H * 0.3);
  ctx.lineTo(W / 2, -H / 2);
  ctx.closePath();
  fs(ctx, "#b91c1c", "#7f1d1d", Math.max(0.8, s * 0.06));
  ctx.beginPath();
  ctx.arc(0, -H / 2 + H * 0.3, s * 0.13, 0, TAU);
  fs(ctx, "#fde047", "#a16207", Math.max(0.8, s * 0.05));
  if (s >= 14) {
    ctx.font = `800 ${s * 0.3}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fde047";
    ctx.fillText(word, 0, H * 0.18);
  }
  ctx.restore();
}

/**
 * A blossoming tree in a red pot, rooted at (x, baseY) and leaning towards the page
 * (`side` 1 = rooted left, -1 = right). `kind` picks the flower: đào (pink) or mai (yellow).
 */
function drawBlossomTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  H: number,
  side: 1 | -1,
  kind: "dao" | "mai",
  grow: number,
  clock: number,
) {
  if (grow <= 0.02 || H < 30) return;
  const pot = H * 0.1;
  const P = (u: number, v: number): [number, number] => [x + side * u * H, baseY - pot - v * H * grow];
  const petal = kind === "dao" ? "#f9a8d4" : "#fde047";
  const edge = kind === "dao" ? "#be185d" : "#b45309";
  const core = kind === "dao" ? "#fde047" : "#f97316";

  // red pot with a gold band
  ctx.beginPath();
  ctx.moveTo(x - pot * 0.9, baseY - pot);
  ctx.lineTo(x + pot * 0.9, baseY - pot);
  ctx.lineTo(x + pot * 0.65, baseY);
  ctx.lineTo(x - pot * 0.65, baseY);
  ctx.closePath();
  fs(ctx, "#dc2626", "#7f1d1d", 1.6);
  ctx.fillStyle = "#fbbf24";
  ctx.fillRect(x - pot * 0.85, baseY - pot * 0.8, pot * 1.7, pot * 0.16);

  // trunk and branches: [start u,v, control u,v, end u,v]
  const branches: [number, number, number, number, number, number][] = [
    [0, 0, 0.03, 0.32, 0.01, 0.62],
    [0.02, 0.3, 0.12, 0.38, 0.27, 0.6],
    [0.015, 0.48, 0.09, 0.62, 0.17, 0.88],
    [0.012, 0.62, -0.08, 0.7, -0.12, 0.84],
    [0.01, 0.62, 0.15, 0.78, 0.3, 0.96],
  ];
  ctx.lineCap = "round";
  branches.forEach(([a, b, c, d, e, f], i) => {
    const [x0, y0] = P(a, b);
    const [x1, y1] = P(c, d);
    const [x2, y2] = P(e, f);
    for (const [col, lw] of [["#451a03", i === 0 ? H * 0.045 : H * 0.026], ["#92400e", i === 0 ? H * 0.03 : H * 0.015]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, lw);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x1, y1, x2, y2);
      ctx.stroke();
    }
  });

  // blossoms along each branch, opening towards the tips as the tree grows
  const qb = (a: number, b: number, c: number, u: number) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * b + u * u * c;
  branches.forEach(([a, b, c, d, e, f], i) => {
    if (i === 0) return;
    for (let k = 0; k < 7; k++) {
      const u = 0.35 + (k / 6) * 0.65;
      if (u > grow) continue;
      const jx = (hash(i * 13 + k) - 0.5) * 0.06;
      const jy = (hash(i * 7 + k * 3) - 0.5) * 0.06;
      const [bx, by] = P(qb(a, c, e, u) + jx, qb(b, d, f, u) + jy);
      const r = H * (0.028 + hash(i * 5 + k) * 0.016);
      blossom(ctx, bx, by, r, petal, edge, core, clock * 0.3 + k + i);
    }
  });

  // lì xì swinging from two branches
  if (grow >= 0.9) {
    [2, 4].forEach((bi, i) => {
      const [a, b, c, d, e, f] = branches[bi]!;
      const u = 0.78 + i * 0.12;
      const [tx, ty] = P(qb(a, c, e, u), qb(b, d, f, u));
      const len = H * 0.12;
      const sw = Math.sin(clock * 1.8 + i * 1.7 + side) * 0.22;
      const lx = tx + Math.sin(sw) * len;
      const ly = ty + Math.cos(sw) * len;
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      drawLiXi(ctx, lx, ly + H * 0.05, H * 0.07, sw, LIXI_WORDS[(i + (side === 1 ? 0 : 2)) % 4]!);
    });
  }
}

export function createTetRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    const f = focusOr(focus, w, h);
    ctx.save();
    ctx.globalAlpha = env;

    // petals (mai = yellow, đào = pink) drifting down along the edges
    for (let i = 0; i < 24; i++) {
      const life = (clock * (0.12 + hash(i) * 0.12) + hash(i * 3)) % 1;
      const x = edgeX(i * 5, w, 0.3) + Math.sin(clock * 1.4 + i) * 18;
      const y = -20 + life * (h + 40);
      const yellow = i % 2 === 0;
      blossom(
        ctx, x, y, 7 + hash(i * 9) * 5,
        yellow ? "#fde047" : "#f9a8d4",
        yellow ? "#b45309" : "#be185d",
        yellow ? "#f97316" : "#fde047",
        clock * 1.5 + i,
      );
    }

    // đào (peach, north) on the left and mai (apricot, south) on the right, in red pots,
    // with lì xì hanging from their branches
    const treeH = Math.min(h * 0.62, w * 0.36, 300);
    const grow = easeOutCubic(clamp01((t - 0.02) / 0.3));
    drawBlossomTree(ctx, w * 0.035, h - 2, treeH, 1, "dao", grow, clock);
    drawBlossomTree(ctx, w * 0.965, h - 2, treeH, -1, "mai", grow, clock);

    // lì xì falling along the edges
    for (let i = 0; i < 12; i++) {
      const life = (clock * (0.16 + hash(i + 40) * 0.1) + hash(i * 17)) % 1;
      const x = edgeX(i * 31 + 3, w, 0.26);
      const y = -30 + life * (h + 60);
      drawLiXi(ctx, x, y, 12 + hash(i * 5) * 6, Math.sin(clock * 2 + i) * 0.4, LIXI_WORDS[i % LIXI_WORDS.length]!);
    }

    // Hubby hands lì xì to the avatar: a few packets arc from its hand and land round the avatar
    const lay = mascotLayout(f, w, h);
    for (let k = 0; k < 5; k++) {
      const p = clamp01((t - 0.4 - k * 0.035) / 0.22);
      if (p <= 0 || p >= 1) continue;
      const sx = lay.x + lay.facing * lay.size * 0.5;
      const sy = lay.y + lay.size * 0.08;
      const ang = Math.atan2(lay.y - f.y, lay.x - f.x) + (k - 2) * 0.55;
      const ex = f.x + Math.cos(ang) * f.r * 2;
      const ey = f.y + Math.sin(ang) * f.r * 2;
      const e = easeOutCubic(p);
      const px = sx + (ex - sx) * e;
      const py = sy + (ey - sy) * e - Math.sin(p * Math.PI) * lay.size * 0.7;
      ctx.globalAlpha = env * (1 - smooth((p - 0.8) / 0.2));
      drawLiXi(ctx, px, py, 14, p * 5 + k, LIXI_WORDS[k % LIXI_WORDS.length]!);
      ctx.globalAlpha = env;
      if (p > 0.82) drawSparkle(ctx, ex, ey, 3 + (1 - p) * 8, "#fde047", "#b45309", (1 - p) * 4);
    }

    // dragon roaming the whole page along a wide figure-eight: a thick, tapering
    // serpent body with gold belly scales, flame fins and a horned, whiskered head.
    const dragonIn = smooth((t - 0.08) / 0.16) * (1 - smooth((t - 0.82) / 0.16));
    if (dragonIn > 0.02) {
      const n = 46;
      // DIR = -1: the dragon enters from the right and sweeps counter-clockwise.
      const DIR = -1;
      const head = DIR * (clock * 1.35 + Math.sin(clock * 1.7) * 0.25);
      const ax = w * 0.4;
      const ay = h * 0.34;
      const pos = (a: number) => {
        const wob = Math.sin(a * 5 + clock * 3) * f.r * 0.3;
        return [
          w / 2 + Math.cos(a) * ax + wob * 0.3,
          h * 0.48 + Math.sin(2 * a + 0.6) * ay + wob,
        ] as const;
      };
      // keep the body about the same on-screen length whatever the page size
      const pxPerRad = Math.hypot(ax, ay * 2) * 0.75;
      const span = Math.min(1.6, Math.max(0.7, Math.min(560, w * 0.5) / pxPerRad));
      const thick = f.r * 0.72 * dragonIn;
      const radiusAt = (i: number, a: number) => {
        const u = i / n;
        const profile = u < 0.12 ? 0.78 + u * 1.8 : 1 - (u - 0.12) * 0.82;
        const depth = 0.9 + 0.1 * Math.sin(a * 2);
        return Math.max(2, thick * profile * depth * (1 + Math.sin(u * 18 - clock * 9) * 0.06));
      };

      // tail flame
      const [tx, ty] = pos(head - DIR * span);
      for (let k = 0; k < 6; k++) {
        drawGlow(
          ctx,
          tx + Math.cos(clock * 7 + k) * 6,
          ty + Math.sin(clock * 9 + k) * 6,
          10 + k * 2,
          k % 2 ? "251,146,60" : "250,204,21",
          0.35,
        );
      }

      // Body: sampled densely and painted in passes (outline, fill, belly, gloss) so it
      // reads as one smooth serpent, not a chain of segments.
      const m = 190;
      const samples: [number, number, number, number][] = [];
      for (let k = m; k >= 1; k--) {
        const a = head - DIR * (k / m) * span;
        const [px, py] = pos(a);
        const [qx2, qy2] = pos(a + DIR * 0.01);
        // belly faces the left-hand side of travel (downwards while flying left)
        samples.push([px, py, radiusAt((k / m) * n, a), Math.atan2(qy2 - py, qx2 - px) + DIR * (Math.PI / 2)]);
      }
      for (const [px, py, r] of samples) {
        ctx.beginPath();
        ctx.arc(px, py, r + 2, 0, TAU);
        fs(ctx, "#7f1d1d", null);
      }
      // dorsal flame fins, few and large
      for (let k = 14; k < samples.length - 10; k += 26) {
        const [px, py, r, ang] = samples[k];
        const out = ang + Math.PI;
        const flick = 1 + Math.sin(clock * 10 + k) * 0.15;
        const back = out - DIR * 0.9;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(out + DIR * 0.6) * r * 0.8, py + Math.sin(out + DIR * 0.6) * r * 0.8);
        ctx.quadraticCurveTo(
          px + Math.cos(out) * r * 2.2 * flick,
          py + Math.sin(out) * r * 2.2 * flick,
          px + Math.cos(back) * r * 2.4 * flick,
          py + Math.sin(back) * r * 2.4 * flick,
        );
        ctx.quadraticCurveTo(
          px + Math.cos(out - DIR * 0.5) * r * 1.3,
          py + Math.sin(out - DIR * 0.5) * r * 1.3,
          px + Math.cos(out - DIR * 0.7) * r * 0.8,
          py + Math.sin(out - DIR * 0.7) * r * 0.8,
        );
        ctx.closePath();
        fs(ctx, "#f97316", "#7f1d1d", 1.2);
      }
      // two clawed legs (front and rear)
      for (const k of [Math.floor(samples.length * 0.78), Math.floor(samples.length * 0.36)]) {
        const [px, py, r, ang] = samples[k];
        const knee = ang + DIR * 0.5;
        const kx = px + Math.cos(knee) * r * 1.2;
        const ky = py + Math.sin(knee) * r * 1.2;
        const fx = kx + Math.cos(knee - DIR * 0.9) * r * 0.9;
        const fy = ky + Math.sin(knee - DIR * 0.9) * r * 0.9;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#7f1d1d";
        ctx.lineWidth = r * 0.62;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(kx, ky);
        ctx.lineTo(fx, fy);
        ctx.stroke();
        ctx.strokeStyle = "#dc2626";
        ctx.lineWidth = r * 0.42;
        ctx.stroke();
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = Math.max(1.4, r * 0.14);
        for (const s of [-0.55, 0, 0.55]) {
          const ca = knee - DIR * 0.9 + s;
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx + Math.cos(ca) * r * 0.55, fy + Math.sin(ca) * r * 0.55);
          ctx.stroke();
        }
      }
      for (const [px, py, r] of samples) {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, TAU);
        fs(ctx, "#dc2626", null);
      }
      for (const [px, py, r, ang] of samples) {
        ctx.beginPath();
        ctx.arc(px + Math.cos(ang) * r * 0.45, py + Math.sin(ang) * r * 0.45, r * 0.5, 0, TAU);
        fs(ctx, "#fbbf24", null);
      }
      // scale texture: soft arcs on the back, belly plates on the gold stripe
      ctx.lineWidth = 1.2;
      for (let k = 4; k < samples.length; k += 5) {
        const [px, py, r, ang] = samples[k];
        const out = ang + Math.PI;
        ctx.strokeStyle = "rgba(127,29,29,0.55)";
        ctx.beginPath();
        ctx.arc(px + Math.cos(out) * r * 0.3, py + Math.sin(out) * r * 0.3, r * 0.45, out - 1.1, out + 1.1);
        ctx.stroke();
        ctx.strokeStyle = "rgba(180,83,9,0.6)";
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(ang - 0.6) * r * 0.85, py + Math.sin(ang - 0.6) * r * 0.85);
        ctx.lineTo(px + Math.cos(ang + 0.6) * r * 0.85, py + Math.sin(ang + 0.6) * r * 0.85);
        ctx.stroke();
      }
      for (const [px, py, r, ang] of samples) {
        ctx.beginPath();
        ctx.arc(px - Math.cos(ang) * r * 0.45, py - Math.sin(ang) * r * 0.45, r * 0.16, 0, TAU);
        fs(ctx, "rgba(255,255,255,0.18)", null);
      }

      // head, oriented along the direction of travel
      const [hx, hy] = pos(head);
      const [nx, ny] = pos(head + DIR * 0.02);
      const hr = thick * 1.25;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(Math.atan2(ny - hy, nx - hx));
      // mirror so the jaw sits on the belly side of the body
      ctx.scale(1, DIR);
      // flowing mane
      for (let k = 0; k < 6; k++) {
        const a0 = Math.PI * (0.55 + k * 0.17) + Math.sin(clock * 8 + k) * 0.15;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a0 - 0.2) * hr * 0.7, Math.sin(a0 - 0.2) * hr * 0.7);
        ctx.quadraticCurveTo(
          Math.cos(a0) * hr * 2.3,
          Math.sin(a0) * hr * 2.3,
          Math.cos(a0 + 0.25) * hr * 2.6 - hr,
          Math.sin(a0 + 0.25) * hr * 2.1,
        );
        ctx.lineTo(Math.cos(a0 + 0.2) * hr * 0.7, Math.sin(a0 + 0.2) * hr * 0.7);
        ctx.closePath();
        fs(ctx, k % 2 ? "#f97316" : "#fbbf24", "#7f1d1d", 1);
      }
      // skull + long snout
      ctx.beginPath();
      ctx.ellipse(0, 0, hr * 1.05, hr * 0.85, 0, 0, TAU);
      fs(ctx, "#dc2626", "#7f1d1d", 2);
      ctx.beginPath();
      ctx.moveTo(hr * 0.4, -hr * 0.6);
      ctx.quadraticCurveTo(hr * 1.9, -hr * 0.55, hr * 2.1, -hr * 0.05);
      ctx.lineTo(hr * 0.5, hr * 0.05);
      ctx.closePath();
      fs(ctx, "#dc2626", "#7f1d1d", 2);
      // snapping lower jaw with fangs
      ctx.save();
      ctx.rotate(0.15 + Math.abs(Math.sin(clock * 3)) * 0.25);
      ctx.beginPath();
      ctx.moveTo(hr * 0.3, hr * 0.15);
      ctx.quadraticCurveTo(hr * 1.4, hr * 0.35, hr * 1.8, hr * 0.15);
      ctx.lineTo(hr * 0.4, hr * 0.5);
      ctx.closePath();
      fs(ctx, "#b91c1c", "#7f1d1d", 1.6);
      ctx.restore();
      ctx.fillStyle = "#fff";
      for (const fx of [1.2, 1.6]) {
        ctx.beginPath();
        ctx.moveTo(hr * fx, 0);
        ctx.lineTo(hr * (fx + 0.1), hr * 0.28);
        ctx.lineTo(hr * (fx + 0.2), 0);
        ctx.fill();
      }
      // gold brow ridge + nostril
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = Math.max(2, hr * 0.14);
      ctx.beginPath();
      ctx.moveTo(hr * 0.1, -hr * 0.62);
      ctx.quadraticCurveTo(hr * 0.8, -hr * 0.95, hr * 1.3, -hr * 0.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hr * 1.85, -hr * 0.2, hr * 0.08, 0, TAU);
      fs(ctx, "#7f1d1d", null);
      // fierce glowing eye
      drawGlow(ctx, hr * 0.55, -hr * 0.3, hr * 0.7, "250,204,21", 0.55);
      ctx.beginPath();
      ctx.ellipse(hr * 0.55, -hr * 0.3, hr * 0.24, hr * 0.15, -0.3, 0, TAU);
      fs(ctx, "#fde047", "#7f1d1d", 1.2);
      ctx.beginPath();
      ctx.ellipse(hr * 0.6, -hr * 0.3, hr * 0.05, hr * 0.13, 0, 0, TAU);
      fs(ctx, INK, null);
      // swept-back antler horns
      ctx.strokeStyle = "#fbbf24";
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2.5, hr * 0.18);
      for (const s of [0, 1]) {
        const off = s * hr * 0.25;
        ctx.beginPath();
        ctx.moveTo(-hr * 0.1 + off, -hr * 0.7);
        ctx.quadraticCurveTo(-hr * 0.6 + off, -hr * 1.8, -hr * 1.6 + off, -hr * 1.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-hr * 0.7 + off, -hr * 1.45);
        ctx.lineTo(-hr * 0.55 + off, -hr * 2.05);
        ctx.stroke();
      }
      // long flowing whiskers
      ctx.lineWidth = Math.max(1.5, hr * 0.09);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(hr * 1.8, -hr * 0.1);
        ctx.bezierCurveTo(
          hr * 2.4,
          s * hr * 0.9,
          hr * 1.2,
          s * hr * 1.6 + Math.sin(clock * 6 + s) * hr * 0.4,
          -hr * 0.4,
          s * hr * 1.9 + Math.sin(clock * 5 + s) * hr * 0.5,
        );
        ctx.stroke();
      }
      ctx.restore();

      // the flaming pearl it chases
      const [qx, qy] = pos(head + DIR * 0.22);
      drawGlow(ctx, qx, qy, hr * 2.2, "253,224,71", 0.75);
      drawGlow(ctx, qx, qy, hr * 1.2, "249,115,22", 0.5);
      ctx.beginPath();
      ctx.arc(qx, qy, hr * 0.5, 0, TAU);
      fs(ctx, "#fef9c3", "#ca8a04", 1.4);
    }

    // firecracker sparks at the top corners
    for (const side of [0.06, 0.94]) {
      const x = w * side;
      ctx.fillStyle = "#dc2626";
      ctx.fillRect(x - 3, 0, 6, 36 * smooth(t / 0.1));
      for (let k = 0; k < 7; k++) {
        const a = hash(k * 7 + side * 10) * TAU + clock * 6;
        const d = ((clock * 3 + k * 0.2) % 1) * 22;
        drawGlow(ctx, x + Math.cos(a) * d, 38 + Math.sin(a) * d, 6, "250,204,21", 0.85 * (1 - d / 22));
      }
    }
    ctx.restore();
  };
}

/* ----------------------------- Halloween ----------------------------- */

export function createHalloweenRenderer(): FrameRenderer {
  return (ctx, w, h, ms) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    ctx.save();
    ctx.globalAlpha = env;

    // big moon
    const mx = w * 0.9;
    const my = h * 0.16;
    drawGlow(ctx, mx, my, 120, "251,146,60", 0.35);
    ctx.beginPath();
    ctx.arc(mx, my, 46, 0, TAU);
    fs(ctx, "#fed7aa", "#c2410c", 2);
    ctx.fillStyle = "rgba(194,65,12,0.25)";
    for (const [dx, dy, r] of [[-12, -8, 9], [10, 12, 7], [14, -16, 5]]) {
      ctx.beginPath();
      ctx.arc(mx + dx, my + dy, r, 0, TAU);
      ctx.fill();
    }

    // cobweb top-left
    ctx.strokeStyle = "rgba(100,116,139,0.85)";
    ctx.lineWidth = 1.2;
    const web = 90 * smooth(t / 0.15);
    for (let i = 0; i < 6; i++) {
      const a = (i / 5) * (Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * web, Math.sin(a) * web);
      ctx.stroke();
    }
    for (let r = 1; r <= 4; r++) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 5) * (Math.PI / 2);
        const rr = (web * r) / 4;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.quadraticCurveTo(px * 0.9, py * 0.9, px, py);
      }
      ctx.stroke();
    }

    // haunted house with a bare tree rising in the bottom-left corner
    const houseS = Math.min(h * 0.5, w * 0.26, 260);
    const houseIn = smooth(t / 0.2);
    ctx.globalAlpha = env * houseIn;
    drawHauntedHouse(ctx, w * 0.02, h - 6 + (1 - houseIn) * houseS * 0.3, houseS, clock);
    ctx.globalAlpha = env;

    // a spider lets itself down from the web
    const thread = h * 0.22 * smooth(t / 0.2) * (0.75 + 0.25 * Math.sin(clock * 1.4));
    drawSpider(ctx, 62, 0, thread, Math.max(3, Math.min(h * 0.012, 6)), clock);

    // a witch on her broom crosses in front of the moon
    const flight = clamp01((t - 0.12) / 0.62);
    if (flight > 0 && flight < 1) {
      const wx = mx + 120 - flight * w * 0.8;
      const wy = my + 8 + Math.sin(flight * Math.PI * 2) * h * 0.04 + flight * h * 0.1;
      drawWitch(ctx, wx, wy, Math.min(h * 0.12, 62), clock);
    }

    // friendly ghosts floating around the page
    const ghostS = Math.max(10, Math.min(h * 0.055, 28));
    [[0.34, 0.6], [0.72, 0.68], [0.86, 0.42]].forEach(([gx, gy], i) => {
      const appear = smooth((t - 0.15 - i * 0.08) / 0.15);
      if (appear <= 0.01) return;
      ctx.globalAlpha = env * appear;
      drawGhost(ctx, w * gx! + Math.sin(clock * 0.8 + i) * 18, h * gy!, ghostS, clock, i * 2.3);
    });
    ctx.globalAlpha = env;

    // bats
    for (let i = 0; i < 6; i++) {
      const life = (clock * (0.1 + hash(i) * 0.08) + hash(i * 5)) % 1;
      const x = life * (w + 120) - 60;
      const y = h * (0.12 + hash(i * 3) * 0.3) + Math.sin(clock * 3 + i) * 14;
      if (x > w * 0.3 && x < w * 0.7 && y > h * 0.25) continue;
      const flap = Math.sin(clock * 14 + i) * 0.6;
      ctx.fillStyle = "#1e1b4b";
      ctx.strokeStyle = "#a78bfa";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x - 14, y - 12 + flap * 10, x - 26, y + flap * 8);
      ctx.quadraticCurveTo(x - 16, y + 3, x - 8, y + 4);
      ctx.lineTo(x, y + 8);
      ctx.lineTo(x + 8, y + 4);
      ctx.quadraticCurveTo(x + 16, y + 3, x + 26, y + flap * 8);
      ctx.quadraticCurveTo(x + 14, y - 12 + flap * 10, x, y);
      ctx.closePath();
      fs(ctx, "#1e1b4b", "#a78bfa", 1);
    }

    // glowing jack-o'-lanterns in the bottom corners
    for (const side of [0.07, 0.93]) {
      const px = w * side;
      const py = h - 30 + (1 - smooth(t / 0.15)) * 60;
      const flick = 0.75 + 0.25 * Math.sin(clock * 9 + side * 20);
      drawGlow(ctx, px, py - 6, 70, "251,146,60", 0.45 * flick);
      ctx.beginPath();
      ctx.ellipse(px, py, 32, 26, 0, 0, TAU);
      fs(ctx, "#f97316", "#7c2d12", 2);
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.moveTo(px - 16, py - 8);
      ctx.lineTo(px - 6, py - 8);
      ctx.lineTo(px - 11, py - 18);
      ctx.moveTo(px + 6, py - 8);
      ctx.lineTo(px + 16, py - 8);
      ctx.lineTo(px + 11, py - 18);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px - 18, py + 6);
      for (let k = 0; k < 6; k++) ctx.lineTo(px - 18 + k * 7.2, py + (k % 2 ? 14 : 6));
      ctx.lineTo(px + 18, py + 6);
      ctx.fill();
    }

    // wisps
    for (let i = 0; i < 9; i++) {
      const life = (clock * 0.1 + hash(i)) % 1;
      drawGlow(
        ctx,
        edgeX(i * 13, w, 0.28) + Math.sin(clock + i) * 20,
        h - life * h,
        22 + hash(i * 7) * 18,
        "168,85,247",
        0.28 * Math.sin(life * Math.PI),
      );
    }
    ctx.restore();
  };
}

/* ----------------------------- Christmas ----------------------------- */

export function createChristmasRenderer(): FrameRenderer {
  return (ctx, w, h, ms) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    ctx.save();
    ctx.globalAlpha = env;

    // string lights along the top of the content area (below the top bar)
    ctx.save();
    ctx.translate(0, TOPBAR_H);
    const cols = ["#ef4444", "#22c55e", "#facc15", "#3b82f6"];
    const drop = smooth(t / 0.12);
    ctx.strokeStyle = "#14532d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = (Math.sin((x / w) * Math.PI * 5) * 0.5 + 0.5) * 16 * drop + 2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const n = Math.max(8, Math.floor(w / 46));
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * (w / n);
      const y = (Math.sin((x / w) * Math.PI * 5) * 0.5 + 0.5) * 16 * drop + 4;
      const on = Math.sin(clock * 5 + i * 1.3) > -0.4;
      const col = cols[i % 4];
      if (on) drawGlow(ctx, x, y + 9, 15, i % 4 === 0 ? "239,68,68" : i % 4 === 1 ? "34,197,94" : i % 4 === 2 ? "250,204,21" : "59,130,246", 0.7);
      ctx.beginPath();
      ctx.ellipse(x, y + 8, 4.5, 7, 0, 0, TAU);
      fs(ctx, on ? col : "#94a3b8", INK, 1);
    }

    ctx.restore();

    // pine trees at the bottom corners
    for (const side of [0.06, 0.94]) {
      const px = w * side;
      const base = h + (1 - smooth(t / 0.16)) * 120;
      const hgt = Math.min(170, h * 0.4);
      for (let k = 0; k < 3; k++) {
        const ty = base - hgt * (0.3 + k * 0.28);
        const tw = hgt * (0.38 - k * 0.09);
        ctx.beginPath();
        ctx.moveTo(px, ty - hgt * 0.34);
        ctx.lineTo(px + tw, ty + hgt * 0.08);
        ctx.lineTo(px - tw, ty + hgt * 0.08);
        ctx.closePath();
        fs(ctx, "#15803d", "#052e16", 2);
      }
      starPath(ctx, px, base - hgt * 1.02, 10, 4.5);
      fs(ctx, "#fde047", "#a16207", 1.5);
      for (let k = 0; k < 6; k++) {
        const ox = px + (hash(k + side * 9) - 0.5) * hgt * 0.5;
        const oy = base - hgt * (0.2 + hash(k * 5) * 0.55);
        ctx.beginPath();
        ctx.arc(ox, oy, 4.5, 0, TAU);
        fs(ctx, cols[k % 4], INK, 1);
      }
    }

    // gifts + snowflakes falling by the edges
    for (let i = 0; i < 5; i++) {
      const life = (clock * (0.16 + hash(i) * 0.08) + hash(i * 3)) % 1;
      const x = edgeX(i * 19 + 2, w, 0.2);
      const y = -30 + life * (h + 60);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(clock + i) * 0.3);
      ctx.fillStyle = cols[i % 4];
      ctx.fillRect(-11, -11, 22, 22);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-11, -11, 22, 22);
      ctx.fillStyle = "#fff7ed";
      ctx.fillRect(-2, -11, 4, 22);
      ctx.fillRect(-11, -2, 22, 4);
      ctx.restore();
    }
    for (let i = 0; i < 26; i++) {
      const life = (clock * (0.1 + hash(i) * 0.12) + hash(i * 9)) % 1;
      ctx.beginPath();
      ctx.arc(edgeX(i * 3, w, 0.35) + Math.sin(clock + i) * 12, life * h, 2 + hash(i * 5) * 2.2, 0, TAU);
      fs(ctx, "#ffffff", "rgba(56,189,248,0.9)", 1);
    }
    ctx.restore();
  };
}

/* ----------------------------- Mid-Autumn ---------------------------- */

export function createMidautumnRenderer(): FrameRenderer {
  return (ctx, w, h, ms) => {
    ctx.clearRect(0, 0, w, h);
    const t = clamp01(ms / DURATION_MS);
    const env = envelope(t);
    const clock = ms / 1000;
    ctx.save();
    ctx.globalAlpha = env;

    // harvest moon
    const mx = w * 0.62;
    const my = h * 0.2;
    drawGlow(ctx, mx, my, 130, "254,240,138", 0.55);
    ctx.beginPath();
    ctx.arc(mx, my, 50, 0, TAU);
    fs(ctx, "#fef9c3", "#ca8a04", 2);
    ctx.fillStyle = "rgba(202,138,4,0.22)";
    for (const [dx, dy, r] of [[-14, -10, 10], [12, 8, 8], [-4, 18, 6], [18, -18, 5]]) {
      ctx.beginPath();
      ctx.arc(mx + dx, my + dy, r, 0, TAU);
      ctx.fill();
    }
    // Chú Cuội under the banyan tree on the moon, the jade rabbit on a cloud beside it
    drawCuoiOnMoon(ctx, mx, my, 50);
    drawJadeRabbit(ctx, mx - 100, my + 24, 26, clock);

    // star lanterns swaying from the top
    const lamps: [number, number, string, string][] = [
      [0.9, 56, "#ef4444", "#7f1d1d"],
      [0.76, 38, "#f59e0b", "#78350f"],
      [0.4, 44, "#22c55e", "#14532d"],
      [0.96, 96, "#ec4899", "#831843"],
    ];
    lamps.forEach(([fx, len, c1, c2], i) => {
      const sway = Math.sin(clock * 1.6 + i) * 6;
      const x = w * fx + sway;
      const y = (len + 20) * smooth(t / 0.14);
      ctx.strokeStyle = "#78350f";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(w * fx, 0);
      ctx.lineTo(x, y - 20);
      ctx.stroke();
      drawGlow(ctx, x, y, 50, c1 === "#ef4444" ? "248,113,113" : "253,224,71", 0.45);
      starPath(ctx, x, y, 22, 11, 5, clock * 0.4 + i);
      fs(ctx, c1, c2, 1.6);
      starPath(ctx, x, y, 9, 4.5, 5, clock * 0.4 + i);
      fs(ctx, "#fef08a", null);
    });

    // mooncakes in the bottom corners
    // mooncakes in the bottom-right corner (the lion dance has the left one)
    for (const side of [0.92]) {
      const px = w * side;
      const py = h - 26 + (1 - smooth(t / 0.16)) * 70;
      ctx.beginPath();
      ctx.ellipse(px, py, 34, 20, 0, 0, TAU);
      fs(ctx, "#d97706", "#78350f", 2);
      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(a) * 8, py + Math.sin(a) * 5);
        ctx.lineTo(px + Math.cos(a) * 24, py + Math.sin(a) * 14);
        ctx.stroke();
      }
    }

    // carp lanterns carried along the sides
    const carpS = Math.min(w * 0.09, h * 0.16, 76);
    drawCarpLantern(ctx, w * 0.2, h * 0.46, carpS, clock, 0);
    drawCarpLantern(ctx, w * 0.8, h * 0.58, carpS * 0.9, clock, 2.1);

    // lion dance with its drum in the bottom-left corner
    const lionS = Math.min(h * 0.24, w * 0.12, 110);
    const lionIn = smooth((t - 0.05) / 0.18);
    ctx.globalAlpha = env * lionIn;
    drawLionDance(ctx, w * 0.02 + lionS * 1.15, h - 6 + (1 - lionIn) * lionS * 0.6, lionS, clock);
    ctx.globalAlpha = env;

    // fireflies
    for (let i = 0; i < 18; i++) {
      const x = edgeX(i * 7 + 1, w, 0.3) + Math.sin(clock * 0.8 + i) * 24;
      const y = h * (0.2 + hash(i * 3) * 0.7) + Math.cos(clock * 0.9 + i) * 18;
      drawGlow(ctx, x, y, 10, "250,204,21", 0.8 * (0.5 + 0.5 * Math.sin(clock * 3 + i)));
    }
    // hearts for family warmth
    for (let i = 0; i < 4; i++) {
      const life = (clock * 0.12 + hash(i) * 0.9) % 1;
      heartPath(ctx, edgeX(i * 29, w, 0.2), h - life * h, 7);
      ctx.globalAlpha = env * Math.sin(life * Math.PI);
      fs(ctx, "#fb7185", "#9f1239", 1);
      ctx.globalAlpha = env;
    }
    ctx.restore();
  };
}
