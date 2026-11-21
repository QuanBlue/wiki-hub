/**
 * Shared "script" for every welcome theme (5 s):
 *   0–8 %    opening   — theme particles start from the edges, shockwave ring
 *   8–38 %   build     — Hubby arrives beside the avatar; a clean ring grows round the avatar
 *   38–84 %  climax    — Hubby presents the avatar, speech bubble, rays + sparkles
 *   84–100 % outro     — Hubby waves and leaves, everything dissolves
 * A theme only paints its own scene; this engine then carves a soft hole around
 * the avatar (so nothing covers it), draws the avatar "stage" and the mascot.
 */
import {
  clamp01,
  drawSparkle,
  easeOutBack,
  easeOutCubic,
  lerp,
  smooth,
} from "@/components/users/welcome-effects/helpers";
import {
  drawMascot,
  type MascotCostume,
  type MascotPose,
} from "@/components/users/welcome-effects/mascot";

export const DURATION_MS = 5000;
export const FADE_START_MS = 4200;

/** A theme's own scene. `focus` (the avatar) lets it aim at / orbit the avatar. */
export type FrameRenderer = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsedMs: number,
  focus?: Focus,
) => void;

export type MascotEntrance = "fly" | "drop" | "run" | "pixel" | "rocket";

export interface MascotSpec {
  costume: MascotCostume;
  entrance: MascotEntrance;
  /** "r,g,b" colour of the avatar ring, rays and sparkles. */
  stage: string;
  /** Resting height as a fraction of the stage (default 0.56) when the theme's centrepiece needs the middle. */
  restY?: number;
}

/** Avatar position in canvas pixels. */
export interface Focus {
  x: number;
  y: number;
  r: number;
}

export interface MascotLayout {
  x: number;
  y: number;
  size: number;
  /** Direction Hubby faces (towards the avatar). */
  facing: 1 | -1;
}

/**
 * Where Hubby rests: the middle of the stage, turned towards the avatar. If the
 * avatar itself is near the middle (no avatar measured), Hubby steps aside so it
 * never stands on it.
 */
export function mascotLayout(focus: Focus, w: number, h: number, restY = 0.56): MascotLayout {
  const size = Math.max(56, Math.min(130, Math.min(w, h) * 0.24));
  let x = w / 2;
  const y = h * restY;
  const clear = focus.r * 1.8 + size * 0.55;
  if (Math.abs(x - focus.x) < clear && Math.abs(y - focus.y) < clear + size * 0.5) {
    x = focus.x + (focus.x < w / 2 ? clear : -clear);
  }
  return { x, y, size, facing: focus.x < x ? -1 : 1 };
}

/** Fallback focus when the avatar can't be measured: upper-middle of the canvas. */
export function fallbackFocus(w: number, h: number): Focus {
  return { x: w / 2, y: h * 0.4, r: Math.max(16, Math.min(w, h) * 0.1) };
}

/** Remove everything the theme drew over the avatar, with a soft feathered edge. */
export function carveFocus(ctx: CanvasRenderingContext2D, f: Focus) {
  const inner = f.r * 1.12;
  const outer = f.r * 1.75;
  const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, outer);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(inner / outer, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(f.x, f.y, outer, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Halo, ring, rays and orbiting sparkles around the avatar — never over it. */
export function drawStage(
  ctx: CanvasRenderingContext2D,
  f: Focus,
  rgb: string,
  t: number,
  clock: number,
) {
  const grow = smooth((t - 0.08) / 0.2);
  const fade = 1 - smooth((t - 0.86) / 0.14);
  const s = grow * fade;
  if (s <= 0.01) return;

  // shockwave
  const wave = clamp01((t - 0.05) / 0.2);
  if (wave > 0 && wave < 1) {
    ctx.save();
    ctx.strokeStyle = `rgba(${rgb}, ${0.8 * (1 - wave)})`;
    ctx.lineWidth = Math.max(1.5, f.r * 0.1 * (1 - wave));
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r * (1.15 + easeOutCubic(wave) * 2.8), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // rays
  const climax = smooth((t - 0.34) / 0.12) * fade;
  if (climax > 0.02) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(clock * 0.25);
    ctx.fillStyle = `rgba(${rgb}, ${0.55 * climax})`;
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const inner = f.r * 1.25;
      const len = f.r * (0.45 + 0.35 * ((i % 3) / 2)) * climax;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(inner, -f.r * 0.022);
      ctx.lineTo(inner + len, 0);
      ctx.lineTo(inner, f.r * 0.022);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ring (white core + colour) breathing slightly
  const rr = f.r * (1.12 + 0.025 * Math.sin(clock * 4));
  ctx.save();
  ctx.lineWidth = Math.max(2, f.r * 0.07);
  ctx.strokeStyle = `rgba(${rgb}, ${0.95 * s})`;
  ctx.beginPath();
  ctx.arc(f.x, f.y, rr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, f.r * 0.025);
  ctx.strokeStyle = `rgba(255,255,255,${0.9 * s})`;
  ctx.beginPath();
  ctx.arc(f.x, f.y, rr - f.r * 0.045, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // orbiting sparkles
  for (let i = 0; i < 8; i++) {
    const a = clock * (0.8 + (i % 2) * 0.3) + (i / 8) * Math.PI * 2;
    const rad = f.r * (1.5 + 0.12 * Math.sin(clock * 2 + i));
    const tw = 0.6 + 0.4 * Math.sin(clock * 5 + i * 1.7);
    drawSparkle(
      ctx,
      f.x + Math.cos(a) * rad,
      f.y + Math.sin(a) * rad,
      Math.max(1.5, f.r * 0.07) * tw,
      "#ffffff",
      `rgba(${rgb}, 0.9)`,
      s * climax,
    );
  }
}

function easeOutBounce(x: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

interface MascotState {
  x: number;
  y: number;
  pose: MascotPose;
  alpha: number;
  rotation: number;
}

const ENTER_START = 0.04;
const ENTER_END = 0.38;
const WAVE_START = 0.82;
const LEAVE_START = 0.88;

function mascotState(
  t: number,
  layout: MascotLayout,
  w: number,
  h: number,
  entrance: MascotEntrance,
  clock: number,
): MascotState {
  const rest = { x: layout.x, y: layout.y };
  const origin = { x: rest.x, y: h + layout.size * 1.4 };

  const bob = Math.sin(clock * 3) * layout.size * 0.03;
  const enter = clamp01((t - ENTER_START) / (ENTER_END - ENTER_START));
  const leave = clamp01((t - LEAVE_START) / (1 - LEAVE_START));

  if (t < ENTER_START) return { x: origin.x, y: origin.y, pose: "fly", alpha: 0, rotation: 0 };

  if (enter < 1) {
    switch (entrance) {
      case "drop": {
        const e = easeOutBounce(enter);
        return { x: rest.x, y: lerp(origin.y, rest.y, e), pose: "present", alpha: 1, rotation: 0 };
      }
      case "run": {
        const e = easeOutCubic(enter);
        return {
          x: rest.x,
          y: lerp(origin.y, rest.y, e) - Math.abs(Math.sin(enter * 22)) * layout.size * 0.08,
          pose: "walk",
          alpha: 1,
          rotation: 0,
        };
      }
      case "pixel": {
        const steps = Math.floor(enter * 8) / 8;
        const flick = Math.floor(enter * 18) % 2 === 0 ? 1 : 0.5;
        return {
          x: rest.x,
          y: lerp(origin.y, rest.y, steps),
          pose: "walk",
          alpha: flick,
          rotation: 0,
        };
      }
      case "rocket": {
        const e = easeOutCubic(enter);
        return {
          x: rest.x + Math.sin(enter * 14) * layout.size * 0.2 * (1 - enter),
          y: lerp(origin.y, rest.y, e),
          pose: "fly",
          alpha: 1,
          rotation: Math.sin(enter * 14) * 0.2 * (1 - enter),
        };
      }
      default: {
        const e = easeOutCubic(enter);
        return {
          x: rest.x + Math.sin(enter * 8) * layout.size * 0.15 * (1 - enter),
          y: lerp(origin.y, rest.y, e),
          pose: "fly",
          alpha: 1,
          rotation: Math.sin(enter * 8) * 0.12 * (1 - enter),
        };
      }
    }
  }

  if (leave > 0) {
    const e = leave * leave;
    const target = origin;
    const flick = entrance === "pixel" ? (Math.floor(leave * 14) % 2 === 0 ? 1 : 0.3) : 1;
    return {
      x: lerp(rest.x, target.x, e),
      y: lerp(rest.y, target.y, e),
      pose: "fly",
      alpha: flick * (entrance === "pixel" ? 1 - leave : 1),
      rotation: 0,
    };
  }

  return {
    x: rest.x,
    y: rest.y + bob,
    pose: t >= WAVE_START ? "wave" : "present",
    alpha: 1,
    rotation: 0,
  };
}

/** Everything the engine paints after the theme: carve, stage, mascot. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsedMs: number,
  focus: Focus,
  spec: MascotSpec,
) {
  const t = clamp01(elapsedMs / DURATION_MS);
  const clock = elapsedMs / 1000;
  carveFocus(ctx, focus);
  drawStage(ctx, focus, spec.stage, t, clock);
  const layout = mascotLayout(focus, w, h, spec.restY);
  const st = mascotState(t, layout, w, h, spec.entrance, clock);
  drawMascot(ctx, st.x, st.y, layout.size * (0.85 + 0.15 * easeOutBack(clamp01(t / 0.1))), {
    pose: st.pose,
    costume: spec.costume,
    facing: layout.facing,
    clock,
    alpha: st.alpha,
    rotation: st.rotation,
  });
}

/** 0..1 visibility of the speech bubble over the script. */
export function bubbleOpacity(elapsedMs: number): number {
  const t = elapsedMs / DURATION_MS;
  return smooth((t - 0.36) / 0.07) * (1 - smooth((t - 0.82) / 0.07));
}
