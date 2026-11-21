/**
 * Dignified holiday pack: National Celebration, Hung Kings, Lotus (19/5), Memorial (27/7).
 * Slower motion, no confetti.
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
  drawChrysanthemumVase,
  drawIncenseBowl,
  drawMemorialMonument,
} from "@/components/users/welcome-effects/scene-details-2";
import {
  drawDragonfly,
  drawGoldRays,
  drawGrandLotus,
} from "@/components/users/welcome-effects/scene-details";
import { edgeX, focusOr, fs, starPath, TAU, TOPBAR_H } from "@/components/users/welcome-effects/shapes";

function begin(ctx: CanvasRenderingContext2D, w: number, h: number, ms: number) {
  ctx.clearRect(0, 0, w, h);
  const t = clamp01(ms / DURATION_MS);
  const env = envelope(t);
  ctx.save();
  ctx.globalAlpha = env;
  return { t, env, clock: ms / 1000 };
}

/* ------------------------------ National ------------------------------- */

/**
 * Simplified outline of mainland Vietnam as [longitude, latitude], clockwise from
 * Lũng Cú: the China border east to Móng Cái, the coast down to Cà Mau and Hà Tiên,
 * then the Cambodia and Laos borders back north to A Pa Chải.
 */
export const VN_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [105.32, 23.39], [105.9, 22.95], [106.7, 22.85], [106.55, 22.45], [106.75, 22.0],
  [107.35, 21.7], [108.05, 21.55], [107.4, 21.25], [106.8, 20.9], [106.55, 20.25],
  [106.0, 19.95], [105.8, 19.3], [105.65, 18.9], [106.1, 18.4], [106.5, 17.9],
  [106.9, 17.3], [107.3, 16.8], [108.1, 16.2], [108.6, 15.5], [108.85, 15.0],
  [109.05, 14.3], [109.3, 13.4], [109.45, 12.9], [109.2, 12.2], [109.0, 11.6],
  [108.6, 11.2], [108.0, 10.7], [107.2, 10.4], [106.8, 10.3], [106.6, 9.9],
  [106.2, 9.5], [105.5, 9.0], [105.0, 8.6], [104.8, 8.65], [104.85, 9.4],
  [104.9, 10.2], [104.5, 10.42], [105.1, 10.95], [105.85, 10.95], [106.2, 11.4],
  [106.4, 11.7], [106.8, 11.95], [107.55, 12.3], [107.5, 13.0], [107.6, 14.1],
  [107.55, 14.7], [107.7, 15.3], [107.2, 16.0], [106.7, 16.5], [106.6, 16.9],
  [106.2, 17.3], [105.7, 18.0], [105.5, 18.25], [105.1, 18.65], [104.5, 19.0],
  [103.9, 19.3], [104.05, 19.7], [104.6, 20.2], [104.4, 20.5], [104.0, 20.7],
  [103.6, 20.75], [103.2, 20.85], [102.95, 21.25], [102.85, 21.7], [102.6, 21.9],
  [102.15, 22.4], [102.5, 22.75], [103.0, 22.55], [103.5, 22.6], [103.95, 22.5],
  [104.3, 22.75], [104.8, 22.85], [105.0, 23.25],
];

/** Coastal islands: Phú Quốc, Côn Đảo, Bạch Long Vĩ, Lý Sơn, Phú Quý, Cô Tô. */
export const VN_COASTAL_ISLANDS: ReadonlyArray<readonly [number, number, number]> = [
  [103.97, 10.2, 2.4], [106.6, 8.7, 1.4], [107.72, 20.13, 1], [109.12, 15.38, 1],
  [108.93, 10.52, 1], [107.78, 20.98, 1],
];

/**
 * Hoàng Sa (Paracel) archipelago, by named feature: Hoàng Sa (Pattle), Quang Hòa
 * (Duncan), Duy Mộng (Drummond), Vĩnh Lạc (Money), Hữu Nhật (Robert), Tri Tôn
 * (Triton), Phú Lâm (Woody), Cây (Tree), Linh Côn (Lincoln), Bông Bay (Bombay Reef).
 */
export const HOANG_SA: ReadonlyArray<readonly [number, number]> = [
  [111.6, 16.53], [111.75, 16.45], [111.73, 16.47], [111.58, 16.45], [111.56, 16.5],
  [111.2, 15.78], [112.33, 16.83], [112.26, 16.98], [112.73, 16.67], [112.53, 16.03],
];
/**
 * Trường Sa (Spratly) archipelago, by named feature: Song Tử Tây, Song Tử Đông,
 * Thị Tứ, Loại Ta, Ba Bình, Sơn Ca, Nam Yết, Sinh Tồn, Cô Lin, Len Đao, Phan Vinh,
 * Tiên Nữ, Trường Sa Lớn, Đá Tây, Đá Lát, Thuyền Chài, An Bang, Vành Khăn, Bình Nguyên.
 */
export const TRUONG_SA: ReadonlyArray<readonly [number, number]> = [
  [114.33, 11.43], [114.34, 11.45], [114.28, 11.05], [114.42, 10.68], [114.36, 10.38],
  [114.48, 10.37], [114.36, 10.18], [114.33, 9.88], [114.26, 9.77], [114.37, 9.71],
  [113.7, 8.97], [114.67, 8.86], [111.92, 8.64], [112.2, 8.85], [111.67, 8.67],
  [113.3, 8.12], [112.9, 7.9], [115.53, 9.9], [116.13, 10.75],
];

export const MAP_LON0 = 102;
export const MAP_LAT0 = 23.6;
export const MAP_LON_SPAN = 14.6;
export const MAP_LAT_SPAN = 16.3;

/**
 * Vietnam with its islands and both archipelagos, fitted in a box `mh` tall whose
 * top-left is (x, y). `reveal` (0..1) unrolls it from the top.
 */
function drawVietnamMap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  mh: number,
  reveal: number,
  clock: number,
) {
  if (reveal <= 0.01) return;
  const k = mh / MAP_LAT_SPAN;
  const mw = MAP_LON_SPAN * k;
  const P = (lon: number, lat: number): [number, number] => [
    x + (lon - MAP_LON0) * k,
    y + (MAP_LAT0 - lat) * k,
  ];
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 20, y - 20, mw + 80, (mh + 30) * reveal + 10);
  ctx.clip();

  drawGlow(ctx, x + mw * 0.3, y + mh * 0.5, mh * 0.55, "220,38,38", 0.12);

  // mainland
  const grad = ctx.createLinearGradient(x, y, x, y + mh);
  grad.addColorStop(0, "#ef4444");
  grad.addColorStop(1, "#b91c1c");
  ctx.beginPath();
  VN_OUTLINE.forEach(([lon, lat], i) => {
    const [px, py] = P(lon, lat);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = Math.max(1.2, mh * 0.006);
  ctx.stroke();

  // capital
  const [hx, hy] = P(105.85, 21.03);
  starPath(ctx, hx, hy, Math.max(3, mh * 0.022), Math.max(1.3, mh * 0.009));
  fs(ctx, "#fde047", "#7f1d1d", 0.8);

  const dot = Math.max(1.4, mh * 0.007);
  for (const [lon, lat, size] of VN_COASTAL_ISLANDS) {
    const [px, py] = P(lon, lat);
    ctx.beginPath();
    ctx.arc(px, py, dot * size, 0, TAU);
    fs(ctx, "#dc2626", "#facc15", 0.8);
  }

  // archipelagos: twinkling islands inside a dashed boundary, with their names
  const fontSize = Math.max(8, Math.min(13, mh * 0.04));
  for (const [group, label, i0] of [
    [HOANG_SA, "Hoàng Sa", 0],
    [TRUONG_SA, "Trường Sa", 20],
  ] as const) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    group.forEach(([lon, lat], i) => {
      const [px, py] = P(lon, lat);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
      const tw = 0.6 + 0.4 * Math.sin(clock * 3 + i0 + i);
      drawGlow(ctx, px, py, dot * 4, "250,204,21", 0.5 * tw);
      ctx.beginPath();
      ctx.arc(px, py, dot, 0, TAU);
      fs(ctx, "#dc2626", "#facc15", 0.8);
    });
    const pad = dot * 5;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(161,98,7,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (maxX - minX) / 2 + pad,
      (maxY - minY) / 2 + pad,
      0,
      0,
      TAU,
    );
    ctx.stroke();
    ctx.restore();
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    const lx = (minX + maxX) / 2;
    const ly = minY - pad - 2;
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = "#991b1b";
    ctx.fillText(label, lx, ly);
  }
  ctx.restore();
}

/**
 * The Vietnamese flag (red, gold five-pointed star, 3:2) on a pole planted at
 * (px, baseY), flying towards `dir`. The cloth ripples in the wind: it is drawn as
 * thin vertical strips whose height offset is a travelling wave, shaded by its slope.
 * `raise` (0..1) hoists it up the pole.
 */
function drawVietnamFlag(
  ctx: CanvasRenderingContext2D,
  px: number,
  baseY: number,
  poleH: number,
  fw: number,
  dir: 1 | -1,
  raise: number,
  clock: number,
) {
  // pole and gold finial
  ctx.strokeStyle = "#78350f";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2.5, poleH * 0.018);
  ctx.beginPath();
  ctx.moveTo(px, baseY);
  ctx.lineTo(px, baseY - poleH);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, baseY - poleH - 3, Math.max(3, poleH * 0.022), 0, TAU);
  fs(ctx, "#facc15", "#a16207", 1);
  if (raise <= 0.01) return;

  const fh = (fw * 2) / 3;
  const top = baseY - poleH + 4 + (1 - raise) * (poleH - fh - 10);
  const phase = clock * 5.5;
  // amplitude grows away from the pole, as cloth does
  const wave = (u: number) => Math.sin(u * 5.2 - phase) * fh * 0.09 * u;
  const slope = (u: number) => Math.cos(u * 5.2 - phase) * u;
  // the free end also flutters a little closer to the pole
  const reach = (u: number) => u * fw * (1 - 0.06 * u * (0.5 + 0.5 * Math.sin(phase * 0.7)));

  const strips = 28;
  for (let i = 0; i < strips; i++) {
    const u0 = i / strips;
    const u1 = (i + 1) / strips;
    const x0 = px + dir * reach(u0);
    const x1 = px + dir * (reach(u1) + 0.6);
    const light = 46 + slope((u0 + u1) / 2) * 7;
    ctx.fillStyle = `hsl(0, 78%, ${light}%)`;
    ctx.beginPath();
    ctx.moveTo(x0, top + wave(u0));
    ctx.lineTo(x1, top + wave(u1));
    ctx.lineTo(x1, top + fh + wave(u1));
    ctx.lineTo(x0, top + fh + wave(u0));
    ctx.closePath();
    ctx.fill();
  }
  // thin outline so the flag reads on a white page
  ctx.strokeStyle = "rgba(127,29,29,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= strips; i++) {
    const u = i / strips;
    const fx = px + dir * reach(u);
    if (i === 0) ctx.moveTo(fx, top + wave(u));
    else ctx.lineTo(fx, top + wave(u));
  }
  for (let i = strips; i >= 0; i--) {
    const u = i / strips;
    ctx.lineTo(px + dir * reach(u), top + fh + wave(u));
  }
  ctx.closePath();
  ctx.stroke();

  // gold star at the centre, following the ripple and foreshortened by its slope
  const sx = px + dir * reach(0.5);
  const sy = top + fh / 2 + wave(0.5);
  const R = fh * 0.3;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(Math.atan(slope(0.5) * 0.15) * dir);
  ctx.scale(0.86 + 0.14 * Math.abs(Math.cos(0.5 * 5.2 - phase)), 1);
  starPath(ctx, 0, 0, R, R * 0.382, 5, -Math.PI / 2);
  ctx.fillStyle = "#ffde00";
  ctx.fill();
  ctx.restore();
}

export function createNationalRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    const f = focusOr(focus, w, h);
    // large gold star rising behind the avatar
    const rise = easeOutCubic(clamp01(t / 0.35));
    const sy = f.y + (1 - rise) * h * 0.4;
    drawGlow(ctx, f.x, sy, f.r * 5, "250,204,21", 0.3);
    starPath(ctx, f.x, sy, f.r * 3.2, f.r * 1.3, 5, -Math.PI / 2 + Math.sin(clock) * 0.04);
    ctx.globalAlpha = env * 0.55;
    fs(ctx, "#facc15", "#a16207", 2);
    ctx.globalAlpha = env;

    // The map of Vietnam with its archipelagos on the side away from the avatar,
    // and the national flag hoisted and waving on the avatar's side.
    const avatarLeft = f.x < w / 2;
    const mh = Math.min(h * 0.68, w * 0.36, 360);
    const mw = (mh * MAP_LON_SPAN) / MAP_LAT_SPAN;
    const mapX = avatarLeft ? w - mw - w * 0.04 : w * 0.04;
    const mapY = Math.max(32, (h - mh) / 2);
    drawVietnamMap(ctx, mapX, mapY, mh, easeOutCubic(clamp01((t - 0.06) / 0.4)), clock);

    // keep the flag below the gold star so the two never overlap
    const free = h - 30 - (f.y + f.r * 3.4);
    const poleH = Math.max(h * 0.25, Math.min(free, h * 0.62, 320));
    const flagW = Math.min(poleH * 0.6, w * 0.2);
    const poleX = avatarLeft ? w * 0.05 : w * 0.95;
    drawVietnamFlag(
      ctx,
      poleX,
      h - 30,
      poleH,
      flagW,
      avatarLeft ? 1 : -1,
      easeOutCubic(clamp01((t - 0.04) / 0.32)),
      clock,
    );

    // red ribbon with gold stars sweeping across the top and bottom of the content area
    // (the top one sits below the top bar so the header stays visible)
    const sweep = easeOutCubic(clamp01((t - 0.02) / 0.3));
    for (const [y, dir] of [[TOPBAR_H + 16, 1], [h - 18, -1]] as const) {
      const len = w * sweep;
      const x0 = dir === 1 ? 0 : w - len;
      ctx.fillStyle = "#dc2626";
      ctx.fillRect(x0, y - 9, len, 18);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 2;
      ctx.strokeRect(x0, y - 9, len, 18);
      const n = Math.floor(len / 46);
      for (let i = 0; i < n; i++) {
        starPath(ctx, x0 + 22 + i * 46, y, 6, 2.6);
        fs(ctx, "#facc15", null);
      }
    }
    // restrained red/gold bursts in the open space between the map and the avatar
    for (let k = 0; k < 2; k++) {
      const p = clamp01((t - 0.25 - k * 0.12) / 0.4);
      if (p <= 0 || p >= 1) continue;
      const cx = k === 0 ? w * 0.4 : w * 0.6;
      const cy = h * 0.28;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        const r = easeOutCubic(p) * Math.min(w, h) * 0.18;
        drawSparkle(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r + p * 14, 2.2, i % 2 ? "#facc15" : "#ef4444", "#7f1d1d", (1 - p) * env);
      }
    }
    ctx.restore();
  };
}

/* ------------------------------ Hung Kings ----------------------------- */

export function createHeritageRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    const f = focusOr(focus, w, h);
    // bronze drum-face rings expanding from the avatar
    for (let k = 0; k < 4; k++) {
      const p = (clock * 0.3 + k / 4) % 1;
      ctx.globalAlpha = env * (1 - p) * 0.8;
      ctx.strokeStyle = k % 2 ? "#b45309" : "#d97706";
      ctx.lineWidth = 3 - p * 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1.4 + p * 3), 0, TAU);
      ctx.stroke();
      if (k === 0) {
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (1.2 + p * 2.4), 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = env;
    // meander band along the top (below the top bar) and bottom of the content area
    const sweep = easeOutCubic(clamp01(t / 0.3));
    for (const y of [TOPBAR_H + 14, h - 10]) {
      ctx.strokeStyle = "#b45309";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const steps = Math.floor((w * sweep) / 14);
      for (let i = 0; i < steps; i++) {
        const x = i * 14;
        const up = i % 2 === 0 ? -5 : 5;
        ctx.lineTo(x, y + up);
        ctx.lineTo(x + 7, y + up);
      }
      ctx.stroke();
    }
    // incense smoke curls rising at the edges
    for (let i = 0; i < 5; i++) {
      const bx = i % 2 ? w * 0.06 + i * 8 : w * 0.94 - i * 8;
      ctx.strokeStyle = "rgba(180,83,9,0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let s = 0; s <= 24; s++) {
        const u = s / 24;
        const x = bx + Math.sin(u * 7 + clock * 1.5 + i) * (6 + u * 14);
        const y = h - u * h * 0.55;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // the 18 Hùng Kings standing in a row along the bottom, like the frieze on a bronze
    // drum, appearing one after another from the centre outwards
    const kings = 18;
    const gap = w / (kings + 1);
    const kingH = Math.min(h * 0.22, gap * 2.3, 96);
    const baseY = h - 20;
    for (let i = 0; i < kings; i++) {
      const fromCentre = Math.abs(i - (kings - 1) / 2);
      const appear = smooth((t - 0.04 - fromCentre * 0.022) / 0.12);
      if (appear <= 0.01) continue;
      ctx.globalAlpha = env * appear;
      drawHungKing(
        ctx,
        gap * (i + 1),
        baseY + (1 - appear) * kingH * 0.4,
        kingH,
        i % 2 === 0 ? "#991b1b" : "#78350f",
        Math.sin(clock * 1.2 + i * 0.7) * 0.06,
      );
    }
    ctx.globalAlpha = env;
    ctx.restore();
  };
}

/**
 * One Hùng King, standing on (x, baseY), about `H` tall: a feathered crown in the
 * Đông Sơn manner, a calm bearded face, a long robe with a gold sash and a
 * ceremonial tablet (hốt) held at the chest. `sway` gently stirs the feathers.
 */
function drawHungKing(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  H: number,
  robe: string,
  sway: number,
) {
  const u = H / 1.2;
  const lw = Math.max(0.8, u * 0.025);
  const edge = "#451a03";

  // robe
  ctx.beginPath();
  ctx.moveTo(x - u * 0.17, baseY - u * 0.62);
  ctx.lineTo(x + u * 0.17, baseY - u * 0.62);
  ctx.quadraticCurveTo(x + u * 0.24, baseY - u * 0.3, x + u * 0.27, baseY);
  ctx.lineTo(x - u * 0.27, baseY);
  ctx.quadraticCurveTo(x - u * 0.24, baseY - u * 0.3, x - u * 0.17, baseY - u * 0.62);
  ctx.closePath();
  fs(ctx, robe, edge, lw);
  // gold sash and hem
  ctx.fillStyle = "#d97706";
  ctx.fillRect(x - u * 0.03, baseY - u * 0.6, u * 0.06, u * 0.6);
  ctx.fillRect(x - u * 0.26, baseY - u * 0.05, u * 0.52, u * 0.05);
  // hands holding the tablet (hốt)
  ctx.beginPath();
  ctx.roundRect(x - u * 0.045, baseY - u * 0.56, u * 0.09, u * 0.22, u * 0.02);
  fs(ctx, "#fde68a", edge, lw * 0.8);
  ctx.beginPath();
  ctx.ellipse(x, baseY - u * 0.36, u * 0.1, u * 0.045, 0, 0, TAU);
  fs(ctx, robe, edge, lw * 0.8);

  // head, calm closed eyes and beard
  const hy = baseY - u * 0.75;
  ctx.beginPath();
  ctx.moveTo(x - u * 0.08, hy + u * 0.06);
  ctx.quadraticCurveTo(x, hy + u * 0.24, x + u * 0.08, hy + u * 0.06);
  ctx.closePath();
  fs(ctx, "#1f2937", null);
  ctx.beginPath();
  ctx.arc(x, hy, u * 0.12, 0, TAU);
  fs(ctx, "#fcd9b6", edge, lw);
  ctx.strokeStyle = edge;
  ctx.lineWidth = lw;
  for (const ex of [-0.045, 0.045]) {
    ctx.beginPath();
    ctx.arc(x + u * ex, hy, u * 0.025, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  // crown: a gold band with tall feathers fanning upwards
  const by = hy - u * 0.1;
  for (let k = -2; k <= 2; k++) {
    const ang = k * 0.32 + sway;
    const len = u * (0.36 - Math.abs(k) * 0.05);
    ctx.save();
    ctx.translate(x + k * u * 0.05, by);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(u * 0.06, -len * 0.55, 0, -len);
    ctx.quadraticCurveTo(-u * 0.06, -len * 0.55, 0, 0);
    ctx.closePath();
    fs(ctx, k % 2 === 0 ? "#f59e0b" : "#b45309", edge, lw * 0.8);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.roundRect(x - u * 0.14, by - u * 0.02, u * 0.28, u * 0.06, u * 0.02);
  fs(ctx, "#fbbf24", edge, lw * 0.8);
}

/* -------------------------------- Lotus -------------------------------- */

function lotus(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, open: number) {
  const petals = 9;
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < petals; i++) {
      const spread = (i / (petals - 1) - 0.5) * Math.PI * 0.9 * open;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(spread);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(s * 0.45, -s * 0.5, 0, -s * (ring === 0 ? 1.1 : 0.8));
      ctx.quadraticCurveTo(-s * 0.45, -s * 0.5, 0, 0);
      fs(ctx, ring === 0 ? "#f9a8d4" : "#fce7f3", "#be185d", 1);
      ctx.restore();
    }
  }
  ctx.beginPath();
  ctx.arc(x, y - s * 0.15, s * 0.14, 0, TAU);
  fs(ctx, "#fde047", "#a16207", 1);
}

export function createLotusRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    const f = focusOr(focus, w, h);
    drawGlow(ctx, f.x, f.y, f.r * 4.5, "253,224,71", 0.22);
    // calm pond along the bottom with gold ripples
    const pond = smooth(t / 0.15);
    const pg = ctx.createLinearGradient(0, h - 70 * pond, 0, h);
    pg.addColorStop(0, "rgba(20,184,166,0)");
    pg.addColorStop(1, "rgba(13,148,136,0.35)");
    ctx.fillStyle = pg;
    ctx.fillRect(0, h - 70 * pond, w, 70 * pond);
    ctx.strokeStyle = "rgba(245,158,11,0.7)";
    ctx.lineWidth = 1.2;
    const count = Math.max(4, Math.round(w / 160));
    for (let i = 0; i < count; i++) {
      const x = ((i + 0.5) / count) * w;
      if (Math.abs(x - w / 2) < w * 0.1) continue;
      if (Math.abs(x - (f.x < w / 2 ? w * 0.78 : w * 0.22)) < Math.min(h * 0.38, w * 0.17, 170) * 1.3) continue;
      const open = easeOutCubic(clamp01((t - 0.05 - i * 0.04) / 0.3));
      const p = (clock * 0.35 + i * 0.3) % 1;
      ctx.globalAlpha = env * (1 - p);
      ctx.beginPath();
      ctx.ellipse(x, h - 18, 24 + p * 30, 6 + p * 8, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = env;
      ctx.beginPath();
      ctx.ellipse(x - 26, h - 16, 18, 7, 0, 0, TAU);
      fs(ctx, "#4ade80", "#166534", 1);
      lotus(ctx, x, h - 20 - (1 - open) * 20, 26 * open + 4, open);
    }
    // a grand lotus with its leaf and bud on the side away from the avatar, under warm
    // golden rays, with dragonflies hovering over the pond
    const avatarLeft = f.x < w / 2;
    const ls = Math.min(h * 0.38, w * 0.17, 170);
    const lx = avatarLeft ? w * 0.78 : w * 0.22;
    drawGoldRays(ctx, lx, -10, h * 0.95, clock, 0.16 * smooth(t / 0.3));
    const bloom = easeOutCubic(clamp01((t - 0.05) / 0.4));
    ctx.globalAlpha = env * smooth(bloom * 3);
    drawGrandLotus(ctx, lx, h - 20 + (1 - bloom) * ls * 0.4, ls, bloom, clock);
    ctx.globalAlpha = env;
    for (let i = 0; i < 2; i++) {
      drawDragonfly(
        ctx,
        lx + Math.sin(clock * 0.7 + i * 2.5) * ls * 1.3,
        h - ls * (1.35 + i * 0.35) + Math.cos(clock * 1.3 + i) * 16,
        Math.min(34, ls * 0.25),
        clock + i,
      );
    }

    // gentle golden motes
    for (let i = 0; i < 14; i++) {
      const x = edgeX(i * 9 + 3, w, 0.3);
      const y = h * (0.15 + hash(i * 3) * 0.7) + Math.sin(clock + i) * 10;
      drawSparkle(ctx, x, y, 2, "#fde68a", "#b45309", (0.4 + 0.6 * Math.abs(Math.sin(clock * 1.6 + i))) * env);
    }
    ctx.restore();
  };
}

/* ------------------------------- Memorial ------------------------------ */

export function createMemorialRenderer(): FrameRenderer {
  return (ctx, w, h, ms, focus) => {
    const { t, env, clock } = begin(ctx, w, h, ms);
    // a row of candles lighting one after another along the bottom
    const n = Math.max(5, Math.round(w / 120));
    drawGlow(ctx, w / 2, h, Math.max(w, h) * 0.55, "217,119,6", 0.18 * smooth(t / 0.4));
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * w;
      const lit = smooth((t - 0.04 - i * 0.05) / 0.1);
      const bodyH = 26;
      ctx.beginPath();
      ctx.roundRect(x - 5, h - 14 - bodyH, 10, bodyH, 2);
      fs(ctx, "#fef3c7", "#92400e", 1);
      if (lit <= 0.02) continue;
      const flick = 1 + Math.sin(clock * 9 + i * 2) * 0.08;
      const fy = h - 14 - bodyH - 8;
      drawGlow(ctx, x, fy, 34, "251,191,36", 0.55 * lit);
      ctx.beginPath();
      ctx.moveTo(x, fy - 12 * lit * flick);
      ctx.quadraticCurveTo(x + 6, fy, x, fy + 6);
      ctx.quadraticCurveTo(x - 6, fy, x, fy - 12 * lit * flick);
      fs(ctx, "#fb923c", null);
      ctx.beginPath();
      ctx.ellipse(x, fy + 1, 2.2, 4 * lit, 0, 0, TAU);
      fs(ctx, "#fef9c3", null);
    }
    // the memorial with its incense bowl and two vases of white chrysanthemums, on the
    // side away from the avatar; everything still and quiet
    const f = focusOr(focus, w, h);
    const avatarLeft = f.x < w / 2;
    const mon = Math.min(h * 0.62, w * 0.3, 300);
    const monX = avatarLeft ? w * 0.75 : w * 0.25;
    const calm = smooth((t - 0.02) / 0.3);
    ctx.globalAlpha = env * calm;
    drawMemorialMonument(ctx, monX, h - 46, mon, calm);
    drawChrysanthemumVase(ctx, monX - mon * 0.42, h - 46, mon * 0.35, clock);
    drawChrysanthemumVase(ctx, monX + mon * 0.42, h - 46, mon * 0.35, clock);
    drawIncenseBowl(ctx, monX, h - 44, mon * 0.22, clock);
    ctx.globalAlpha = env;

    // faint sparks rising
    for (let i = 0; i < 12; i++) {
      const life = (clock * 0.07 + hash(i) * 0.9) % 1;
      const x = ((i + 0.5) / 12) * w + Math.sin(clock + i) * 6;
      drawSparkle(ctx, x, h - 60 - life * h * 0.5, 1.6, "#fde68a", null, Math.sin(life * Math.PI) * 0.7 * env);
    }
    ctx.restore();
  };
}
