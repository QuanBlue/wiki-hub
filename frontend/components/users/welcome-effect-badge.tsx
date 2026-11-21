"use client";

/**
 * The small effect badge shown in the quick-profile popover. It lives apart from
 * welcome-effect-overlay.tsx on purpose: that module carries every canvas renderer
 * (hundreds of KB), and the popover is used on many pages that never play an effect.
 * Keep `EFFECT_BADGE` in step with `EFFECT_META` there (a test checks it).
 */

import {
  Anchor,
  Candy,
  CloudLightning,
  Cog,
  Cpu,
  Crown,
  Fish,
  Flag,
  Flame,
  Flower2,
  Gamepad2,
  Ghost,
  Gift,
  Heart,
  Lamp,
  Leaf,
  Moon,
  Orbit,
  PartyPopper,
  Pickaxe,
  Rocket,
  Snowflake,
  Sparkles,
  Star,
  Sunset,
  Swords,
  Terminal,
  TreePine,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { WelcomeEffect } from "@/types/api";

export const EFFECT_BADGE: Record<string, { Icon: LucideIcon; badgeIconClass: string }> = {
  phoenix: { Icon: Flame, badgeIconClass: "text-orange-500 dark:text-orange-400" },
  hacker: { Icon: Terminal, badgeIconClass: "text-emerald-600 dark:text-emerald-400" },
  admin: { Icon: Crown, badgeIconClass: "text-amber-500 dark:text-amber-400" },
  aurora: { Icon: Sparkles, badgeIconClass: "text-sky-500 dark:text-sky-400" },
  sakura: { Icon: Flower2, badgeIconClass: "text-pink-500 dark:text-pink-400" },
  fireworks: { Icon: PartyPopper, badgeIconClass: "text-fuchsia-500 dark:text-fuchsia-400" },
  ocean: { Icon: Waves, badgeIconClass: "text-cyan-600 dark:text-cyan-400" },
  neon: { Icon: Zap, badgeIconClass: "text-fuchsia-600 dark:text-fuchsia-400" },
  vice: { Icon: Sunset, badgeIconClass: "text-pink-500 dark:text-pink-400" },
  storm: { Icon: CloudLightning, badgeIconClass: "text-violet-600 dark:text-violet-400" },
  cosmos: { Icon: Orbit, badgeIconClass: "text-indigo-600 dark:text-indigo-400" },
  snow: { Icon: Snowflake, badgeIconClass: "text-sky-500 dark:text-sky-300" },
  lantern: { Icon: Lamp, badgeIconClass: "text-red-500 dark:text-amber-400" },
  arcade: { Icon: Gamepad2, badgeIconClass: "text-violet-600 dark:text-violet-400" },
  koi: { Icon: Fish, badgeIconClass: "text-orange-500 dark:text-orange-400" },
  blockcraft: { Icon: Pickaxe, badgeIconClass: "text-lime-600 dark:text-lime-400" },
  platformer: { Icon: Star, badgeIconClass: "text-yellow-600 dark:text-yellow-400" },
  racing: { Icon: Flag, badgeIconClass: "text-red-600 dark:text-red-400" },
  tet: { Icon: Gift, badgeIconClass: "text-red-600 dark:text-yellow-400" },
  halloween: { Icon: Ghost, badgeIconClass: "text-orange-600 dark:text-orange-400" },
  christmas: { Icon: TreePine, badgeIconClass: "text-green-700 dark:text-green-400" },
  midautumn: { Icon: Moon, badgeIconClass: "text-amber-600 dark:text-amber-300" },
  valentine: { Icon: Heart, badgeIconClass: "text-rose-600 dark:text-rose-400" },
  floral: { Icon: Flower2, badgeIconClass: "text-pink-600 dark:text-pink-300" },
  teachers: { Icon: Star, badgeIconClass: "text-teal-700 dark:text-teal-300" },
  mensday: { Icon: Zap, badgeIconClass: "text-sky-600 dark:text-cyan-400" },
  national: { Icon: Flag, badgeIconClass: "text-red-600 dark:text-yellow-400" },
  heritage: { Icon: Crown, badgeIconClass: "text-amber-700 dark:text-amber-400" },
  lotus: { Icon: Flower2, badgeIconClass: "text-pink-600 dark:text-pink-300" },
  kids: { Icon: PartyPopper, badgeIconClass: "text-orange-600 dark:text-orange-400" },
  easter: { Icon: Sparkles, badgeIconClass: "text-violet-600 dark:text-violet-300" },
  spring: { Icon: Leaf, badgeIconClass: "text-green-700 dark:text-green-400" },
  harvest: { Icon: Leaf, badgeIconClass: "text-orange-700 dark:text-orange-400" },
  memorial: { Icon: Flame, badgeIconClass: "text-amber-700 dark:text-amber-400" },
  pirate: { Icon: Anchor, badgeIconClass: "text-sky-700 dark:text-sky-400" },
  ninja: { Icon: Swords, badgeIconClass: "text-slate-700 dark:text-slate-300" },
  rocket: { Icon: Rocket, badgeIconClass: "text-indigo-600 dark:text-indigo-400" },
  jungle: { Icon: Leaf, badgeIconClass: "text-green-700 dark:text-green-400" },
  cyberpunk: { Icon: Cpu, badgeIconClass: "text-cyan-600 dark:text-cyan-400" },
  steampunk: { Icon: Cog, badgeIconClass: "text-amber-700 dark:text-amber-400" },
  candy: { Icon: Candy, badgeIconClass: "text-pink-600 dark:text-pink-400" },
  kawaii: { Icon: Heart, badgeIconClass: "text-pink-500 dark:text-pink-300" },
};

/**
 * Compact pill naming a member's welcome effect, in WikiHub's surface token
 * aesthetic.
 */
export function WelcomePopoverBadge({ effect }: { effect: WelcomeEffect }) {
  const { t } = useTranslation();
  if (!effect) return null;
  const meta = EFFECT_BADGE[effect];
  if (!meta) return null;
  const Icon = meta.Icon;

  return (
    <span className="border-border/70 bg-surface/85 text-foreground inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shadow-2xs backdrop-blur-sm">
      <Icon className={cn("size-3", meta.badgeIconClass)} aria-hidden />
      {t(`welcomeEffect.presets.${effect}.label`)}
    </span>
  );
}

/**
 * Kept as a lightweight hook point for the quick-profile popover body.
 * Currently returns null to preserve the clean `bg-surface` card body
 * without background gradient washes.
 */
export function WelcomePopoverEffect({ effect: _effect }: { effect: WelcomeEffect }) {
  return null;
}
