"use client";

import {
  Anchor,
  Ban,
  Check,
  CloudLightning,
  Crown,
  Fish,
  Flame,
  Flower2,
  Gamepad2,
  Lamp,
  Loader2,
  Orbit,
  PartyPopper,
  Play,
  RotateCcw,
  Snowflake,
  Sparkles,
  Sunset,
  Terminal,
  UserRound,
  Waves,
  Zap,
  Candy,
  Cog,
  Cpu,
  Flag,
  Heart,
  Leaf,
  Pickaxe,
  Rocket,
  Star,
  Swords,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { getUserAvatarColor } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WelcomeEffectOverlay } from "@/components/users/welcome-effect-overlay";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { PublicUser, User, WelcomeEffect } from "@/types/api";

interface WelcomeEffectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUserId?: string;
  targetName: string;
  targetUsername?: string;
  targetAvatarUrl?: string | null;
  targetCoverUrl?: string | null;
  isOwner: boolean;
  initialEffect: WelcomeEffect;
  initialMessage: string;
  onPreview?: (effect: WelcomeEffect, message: string) => void;
  onSaved: (effect: WelcomeEffect, message: string) => void;
}

interface ThemePreset {
  id: Exclude<WelcomeEffect, "">;
  icon: ReactNode;
  bannerClass: string;
  decorClass: string;
  iconWrapClass: string;
  motif: ReactNode;
}

const THEME_PRESETS: ThemePreset[] = [
  {
    id: "phoenix",
    icon: <Flame className="size-4 text-amber-200" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-red-950 via-orange-600 to-amber-500",
    decorClass:
      "bg-[radial-gradient(circle_at_25%_115%,rgba(254,240,138,0.55),transparent_55%),radial-gradient(circle_at_85%_15%,rgba(251,146,60,0.45),transparent_50%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-amber-200/40",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full opacity-75"
        preserveAspectRatio="none"
      >
        <path
          d="M120 56 C92 38, 60 22, 24 16 M120 56 C86 46, 52 38, 18 40 M120 56 C148 38, 180 22, 216 16 M120 56 C154 46, 188 38, 222 40"
          fill="none"
          stroke="rgba(254, 240, 138, 0.55)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="56" cy="24" r="1.8" fill="#fef08a" />
        <circle cx="178" cy="20" r="2" fill="#fed7aa" />
        <circle cx="145" cy="14" r="1.4" fill="#fef08a" />
      </svg>
    ),
  },
  {
    id: "hacker",
    icon: <Terminal className="size-4 text-emerald-400" aria-hidden />,
    bannerClass: "bg-zinc-950",
    decorClass:
      "bg-[radial-gradient(rgba(16,185,129,0.35)_1px,transparent_1px)] bg-[size:10px_10px]",
    iconWrapClass: "bg-emerald-950/85 ring-1 ring-emerald-400/45",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <g fill="none" stroke="rgba(52, 211, 153, 0.85)" strokeWidth="1.5">
          <path d="M60 8 H52 V16 M228 8 H236 V16 M60 56 H52 V48 M228 56 H236 V48" />
        </g>
        <rect
          x="96"
          y="40"
          width="112"
          height="14"
          rx="7"
          fill="rgba(9, 9, 11, 0.8)"
          stroke="rgba(52, 211, 153, 0.7)"
        />
        <text
          x="152"
          y="50"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="8"
          fontWeight="700"
          fill="#6ee7b7"
        >
          {"> ACCESS GRANTED_"}
        </text>
        <line x1="0" y1="24" x2="240" y2="24" stroke="rgba(34, 211, 238, 0.45)" />
      </svg>
    ),
  },
  {
    id: "admin",
    icon: <Crown className="size-4 text-amber-200" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-amber-950 via-amber-800 to-amber-500",
    decorClass:
      "bg-[radial-gradient(circle_at_50%_30%,rgba(253,230,138,0.5),transparent_60%)]",
    iconWrapClass: "bg-black/35 ring-1 ring-amber-300/45",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <g fill="none" stroke="#fcd34d" strokeWidth="1">
          {[14, 26, 38, 50].map((r) => (
            <g key={r}>
              <path d={`M0 ${r} A${r} ${r} 0 0 0 ${r} 0`} />
              <path d={`M240 ${r} A${r} ${r} 0 0 1 ${240 - r} 0`} />
            </g>
          ))}
          <path d="M0 0 L40 40 M0 0 L52 22 M0 0 L22 52 M240 0 L200 40 M240 0 L188 22 M240 0 L218 52" />
        </g>
        <g fill="#fde047" stroke="#78350f" strokeWidth="0.6">
          <path d="M104 40 L108 26 L114 34 L120 22 L126 34 L132 26 L136 40 Z" />
          <rect x="104" y="40" width="32" height="5" rx="1" />
        </g>
        <g fill="#fff7c2">
          <rect x="70" y="46" width="2.5" height="2.5" transform="rotate(45 71 47)" />
          <rect x="168" y="48" width="2.5" height="2.5" transform="rotate(45 169 49)" />
          <rect x="176" y="22" width="2" height="2" transform="rotate(45 177 23)" />
        </g>
      </svg>
    ),
  },
  {
id: "aurora",
    icon: <Sparkles className="size-4 text-sky-100" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-slate-950 via-indigo-950 to-sky-900",
    decorClass:
      "bg-[radial-gradient(circle_at_30%_30%,rgba(52,211,153,0.28),transparent_55%),radial-gradient(circle_at_75%_65%,rgba(192,132,252,0.32),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-sky-200/35",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <path
          d="M0 44 Q60 14, 120 36 T240 22 L240 64 L0 64 Z"
          fill="rgba(52, 211, 153, 0.28)"
        />
        <path
          d="M0 52 Q70 24, 145 42 T240 30 L240 64 L0 64 Z"
          fill="rgba(167, 139, 250, 0.28)"
        />
        <circle cx="64" cy="14" r="1.3" fill="#e0f2fe" />
        <circle cx="148" cy="12" r="1.5" fill="#ffffff" />
        <circle cx="192" cy="18" r="1.2" fill="#e0f2fe" />
      </svg>
    ),
  },
  {
    id: "sakura",
    icon: <Flower2 className="size-4 text-pink-100" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-rose-950 via-pink-700 to-pink-300",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,241,242,0.45),transparent_55%)]",
    iconWrapClass: "bg-black/25 ring-1 ring-pink-100/40",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <path
          d="M240 2 C210 8, 196 18, 170 16"
          fill="none"
          stroke="#5b3a29"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <g fill="#fbcfe8" stroke="rgba(190, 24, 93, 0.6)" strokeWidth="0.6">
          <ellipse cx="186" cy="14" rx="4" ry="2.4" />
          <ellipse cx="120" cy="30" rx="3.4" ry="2" transform="rotate(30 120 30)" />
          <ellipse cx="150" cy="48" rx="3" ry="1.8" transform="rotate(-20 150 48)" />
          <ellipse cx="92" cy="12" rx="3" ry="1.8" transform="rotate(50 92 12)" />
          <ellipse cx="212" cy="44" rx="3.4" ry="2" transform="rotate(10 212 44)" />
        </g>
      </svg>
    ),
  },
  {
    id: "fireworks",
    icon: <PartyPopper className="size-4 text-fuchsia-100" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-slate-950 via-indigo-950 to-fuchsia-900",
    decorClass: "",
    iconWrapClass: "bg-black/30 ring-1 ring-fuchsia-200/40",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="xMidYMid slice"
      >
        {[
          { cx: 120, cy: 24, r: 16, c: "#f472b6" },
          { cx: 190, cy: 20, r: 12, c: "#fbbf24" },
          { cx: 80, cy: 18, r: 10, c: "#38bdf8" },
        ].map((b) => (
          <g key={b.cx} stroke={b.c} strokeWidth="1.4" strokeLinecap="round">
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i / 12) * Math.PI * 2;
              return (
                <line
                  key={i}
                  x1={b.cx + Math.cos(a) * b.r * 0.4}
                  y1={b.cy + Math.sin(a) * b.r * 0.4}
                  x2={b.cx + Math.cos(a) * b.r}
                  y2={b.cy + Math.sin(a) * b.r}
                />
              );
            })}
          </g>
        ))}
      </svg>
    ),
  },
  {
    id: "ocean",
    icon: <Waves className="size-4 text-cyan-50" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-sky-400 via-sky-700 to-blue-950",
    decorClass:
      "bg-[linear-gradient(110deg,transparent_20%,rgba(255,255,255,0.18)_30%,transparent_40%,transparent_60%,rgba(255,255,255,0.14)_68%,transparent_76%)]",
    iconWrapClass: "bg-black/25 ring-1 ring-cyan-100/40",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <path d="M0 48 Q30 40, 60 48 T120 48 T180 48 T240 48 V64 H0 Z" fill="rgba(45, 212, 191, 0.45)" />
        <path d="M0 54 Q40 46, 80 54 T160 54 T240 54 V64 H0 Z" fill="rgba(3, 105, 161, 0.7)" />
        <g fill="none" stroke="rgba(224, 242, 254, 0.8)" strokeWidth="1">
          <circle cx="150" cy="30" r="3" />
          <circle cx="170" cy="18" r="2" />
          <circle cx="200" cy="34" r="2.6" />
          <circle cx="110" cy="22" r="1.6" />
        </g>
      </svg>
    ),
  },
  {
    id: "neon",
    icon: <Zap className="size-4 text-cyan-200" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-zinc-950 via-purple-950 to-fuchsia-900",
    decorClass: "",
    iconWrapClass: "bg-black/40 ring-1 ring-fuchsia-400/50",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <g stroke="rgba(232, 121, 249, 0.55)" strokeWidth="1">
          <line x1="0" y1="46" x2="240" y2="46" stroke="#e879f9" strokeWidth="1.5" />
          <line x1="0" y1="52" x2="240" y2="52" />
          <line x1="0" y1="60" x2="240" y2="60" />
          {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((i) => (
            <line key={i} x1={150 + i * 4} y1="46" x2={150 + i * 30} y2="64" />
          ))}
        </g>
        <rect
          x="3"
          y="3"
          width="234"
          height="58"
          rx="6"
          fill="none"
          stroke="#22d3ee"
          strokeWidth="1.5"
        />
      </svg>
    ),
  },
  {
    id: "vice",
    icon: <Sunset className="size-4 text-pink-100" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-fuchsia-600 via-pink-500 to-orange-400",
    decorClass: "",
    iconWrapClass: "bg-black/30 ring-1 ring-pink-100/50",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="vice-sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fde047" />
            <stop offset="0.6" stopColor="#fb923c" />
            <stop offset="1" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        <circle cx="140" cy="44" r="26" fill="url(#vice-sun)" />
        <g fill="#7c1d6f">
          <rect x="110" y="36" width="60" height="1.5" />
          <rect x="110" y="41" width="60" height="2.2" />
          <rect x="110" y="46" width="60" height="3" />
        </g>
        <rect x="0" y="48" width="240" height="16" fill="#4c1d95" opacity="0.85" />
        <line x1="0" y1="48" x2="240" y2="48" stroke="#22d3ee" strokeWidth="1.2" />
        <g stroke="#2e1065" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <path d="M214 64 Q210 38 222 20" />
          <path d="M222 20 q-12 -8 -20 2 M222 20 q10 -10 18 0 M222 20 q-6 -14 -14 -12" />
        </g>
      </svg>
    ),
  },
  {
    id: "storm",
    icon: <CloudLightning className="size-4 text-violet-100" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-slate-800 via-slate-700 to-indigo-950",
    decorClass: "",
    iconWrapClass: "bg-black/35 ring-1 ring-violet-300/50",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <g stroke="rgba(147, 197, 253, 0.55)" strokeWidth="1">
          {[20, 52, 84, 120, 160, 196, 224].map((x) => (
            <line key={x} x1={x} y1="6" x2={x - 5} y2="26" />
          ))}
          {[36, 100, 140, 210].map((x) => (
            <line key={x} x1={x} y1="34" x2={x - 5} y2="54" />
          ))}
        </g>
        <path
          d="M150 0 L140 20 L150 22 L136 46 L154 26 L146 24 L158 0 Z"
          fill="#f5f3ff"
          stroke="#8b5cf6"
          strokeWidth="1.2"
        />
      </svg>
    ),
  },
  {
    id: "cosmos",
    icon: <Orbit className="size-4 text-indigo-100" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-900",
    decorClass:
      "bg-[radial-gradient(circle_at_72%_40%,rgba(192,38,211,0.45),transparent_45%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-indigo-200/40",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <g fill="none" stroke="rgba(216, 180, 254, 0.7)" strokeWidth="1.2">
          <ellipse cx="170" cy="30" rx="34" ry="14" transform="rotate(-18 170 30)" />
          <ellipse cx="170" cy="30" rx="22" ry="9" transform="rotate(-18 170 30)" />
        </g>
        <circle cx="170" cy="30" r="4" fill="#fde047" />
        <circle cx="46" cy="44" r="9" fill="#f97316" />
        <ellipse
          cx="46"
          cy="44"
          rx="17"
          ry="4"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="1.5"
          transform="rotate(-20 46 44)"
        />
        <circle cx="90" cy="12" r="1.2" fill="#e0e7ff" />
        <circle cx="120" cy="52" r="1.4" fill="#e0e7ff" />
        <circle cx="216" cy="10" r="1.2" fill="#e0e7ff" />
      </svg>
    ),
  },
  {
    id: "snow",
    icon: <Snowflake className="size-4 text-sky-100" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-sky-300 via-sky-500 to-blue-800",
    decorClass: "",
    iconWrapClass: "bg-black/25 ring-1 ring-sky-100/50",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <g fill="#ffffff" stroke="rgba(186, 230, 253, 0.9)" strokeWidth="0.8">
          {[10, 30, 52, 76, 100, 124, 150, 176, 200, 226].map((x, i) => (
            <path key={x} d={`M${x - 4} 0 H${x + 4} L${x} ${10 + (i % 3) * 5} Z`} />
          ))}
        </g>
        <g stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round">
          <path d="M150 24 v14 M143 28 l14 6 M143 34 l14 -6" />
          <path d="M196 14 v10 M191 16 l10 6 M191 22 l10 -6" />
          <circle cx="110" cy="30" r="1.8" fill="#ffffff" />
          <circle cx="80" cy="20" r="1.4" fill="#ffffff" />
        </g>
        <path d="M0 64 Q40 44 90 54 T240 50 V64 Z" fill="#f0f9ff" />
      </svg>
    ),
  },
  {
    id: "lantern",
    icon: <Lamp className="size-4 text-amber-100" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-indigo-950 via-red-900 to-orange-600",
    decorClass: "bg-[radial-gradient(circle_at_70%_60%,rgba(251,191,36,0.4),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-amber-200/40",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="xMidYMid slice"
      >
        {[
          { x: 100, y: 30, s: 12, c: "#ef4444" },
          { x: 150, y: 20, s: 16, c: "#f97316" },
          { x: 200, y: 36, s: 11, c: "#f59e0b" },
        ].map((l) => (
          <g key={l.x}>
            <circle cx={l.x} cy={l.y} r={l.s * 1.7} fill={l.c} opacity="0.3" />
            <rect x={l.x - l.s * 0.5} y={l.y - l.s * 0.6} width={l.s} height={l.s * 1.2} rx={l.s * 0.35} fill={l.c} stroke="#7c2d12" strokeWidth="0.8" />
            <line x1={l.x} y1={l.y + l.s * 0.6} x2={l.x} y2={l.y + l.s * 1.1} stroke="#fbbf24" strokeWidth="1" />
          </g>
        ))}
      </svg>
    ),
  },
  {
    id: "arcade",
    icon: <Gamepad2 className="size-4 text-fuchsia-100" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-indigo-950 to-violet-900",
    decorClass:
      "bg-[linear-gradient(to_right,rgba(139,92,246,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(139,92,246,0.18)_1px,transparent_1px)] bg-[size:8px_8px]",
    iconWrapClass: "bg-black/35 ring-1 ring-fuchsia-300/50",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        {[0, 1, 2, 3].map((i) => (
          <g key={i} fill={["#ec4899", "#8b5cf6", "#06b6d4", "#facc15"][i]}>
            <rect x={80 + i * 28} y="10" width="16" height="3" />
            <rect x={78 + i * 28} y="13" width="20" height="5" />
            <rect x={82 + i * 28} y="18" width="3" height="3" />
            <rect x={91 + i * 28} y="18" width="3" height="3" />
          </g>
        ))}
        <rect x="150" y="48" width="10" height="3" fill="#10b981" />
        <rect x="153" y="45" width="4" height="3" fill="#10b981" />
        <rect x="154" y="30" width="2" height="8" fill="#f59e0b" />
      </svg>
    ),
  },
  {
    id: "koi",
    icon: <Fish className="size-4 text-orange-100" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-teal-900 via-teal-700 to-cyan-600",
    decorClass: "",
    iconWrapClass: "bg-black/25 ring-1 ring-orange-200/40",
    motif: (
      <svg
        aria-hidden="true"
        viewBox="0 0 240 64"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <g fill="none" stroke="rgba(204, 251, 241, 0.5)" strokeWidth="1">
          <ellipse cx="150" cy="34" rx="18" ry="9" />
          <ellipse cx="150" cy="34" rx="30" ry="15" />
        </g>
        <path d="M110 30 Q130 18 154 30 Q134 44 110 30 Z" fill="#f97316" stroke="#9a3412" strokeWidth="0.8" />
        <path d="M110 30 L96 22 L98 30 L96 38 Z" fill="#fb923c" />
        <circle cx="136" cy="29" r="4" fill="#dc2626" />
        <path d="M196 46 Q206 40 216 46 Q206 52 196 46 Z" fill="#ffffff" stroke="#9a3412" strokeWidth="0.6" />
        <ellipse cx="210" cy="14" rx="9" ry="5" fill="#16a34a" />
        <circle cx="210" cy="14" r="3" fill="#f9a8d4" />
      </svg>
    ),
  },
  {
    id: "blockcraft",
    icon: <Pickaxe className="size-4 text-lime-200" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-sky-400 via-sky-500 to-lime-600",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-lime-100/50",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><rect y="62" width="240" height="18" fill="#92400e"/><rect y="62" width="240" height="7" fill="#4ade80"/><rect x="0" y="62" width="24" height="18" fill="none" stroke="#14532d" strokeOpacity=".45"/><rect x="24" y="62" width="24" height="18" fill="none" stroke="#14532d" strokeOpacity=".45"/><rect x="48" y="62" width="24" height="18" fill="none" stroke="#14532d" strokeOpacity=".45"/><rect x="72" y="62" width="24" height="18" fill="none" stroke="#14532d" strokeOpacity=".45"/><rect x="96" y="62" width="24" height="18" fill="none" stroke="#14532d" strokeOpacity=".45"/><rect x="120" y="62" width="24" height="18" fill="none" stroke="#14532d" strokeOpacity=".45"/><rect x="144" y="62" width="24" height="18" fill="none" stroke="#14532d" strokeOpacity=".45"/><rect x="168" y="62" width="24" height="18" fill="none" stroke="#14532d" strokeOpacity=".45"/><rect x="192" y="62" width="24" height="18" fill="none" stroke="#14532d" strokeOpacity=".45"/><rect x="216" y="62" width="24" height="18" fill="none" stroke="#14532d" strokeOpacity=".45"/><g stroke="#1f2937" strokeWidth=".8"><polygon points="104,16 120,24 104,32 88,24" fill="#86efac"/><polygon points="88,24 104,32 104,50 88,42" fill="#92400e"/><polygon points="120,24 104,32 104,50 120,42" fill="#78350f"/><polygon points="168,30 178,35 168,40 158,35" fill="#d6d3d1"/><polygon points="158,35 168,40 168,52 158,47" fill="#78716c"/><polygon points="178,35 168,40 168,52 178,47" fill="#57534e"/></g><rect x="196" y="40" width="8" height="8" fill="#67e8f9" stroke="#0e7490" transform="rotate(45 200 44)"/><rect x="60" y="30" width="5" height="5" fill="#fde047"/><rect x="74" y="44" width="4" height="4" fill="#bef264"/></svg>
    ),
  },
  {
    id: "platformer",
    icon: <Star className="size-4 text-yellow-200" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-sky-300 via-sky-500 to-orange-500",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-yellow-100/50",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><ellipse cx="60" cy="14" rx="16" ry="6" fill="#fff" opacity=".9"/><ellipse cx="46" cy="16" rx="9" ry="5" fill="#fff" opacity=".9"/><rect y="66" width="240" height="14" fill="#f97316"/><path d="M0 66H240" stroke="#7c2d12" strokeWidth="1.5"/><rect x="196" y="40" width="30" height="28" fill="#22c55e" stroke="#14532d" strokeWidth="1.5"/><rect x="192" y="34" width="38" height="10" fill="#4ade80" stroke="#14532d" strokeWidth="1.5"/><rect x="100" y="30" width="22" height="22" fill="#fbbf24" stroke="#78350f" strokeWidth="1.5"/><text x="111" y="46" textAnchor="middle" fontSize="15" fontWeight="900" fill="#fff7ed" stroke="#78350f" strokeWidth=".8">?</text><ellipse cx="111" cy="20" rx="4" ry="6" fill="#fde047" stroke="#a16207"/><ellipse cx="150" cy="38" rx="3" ry="5" fill="#fde047" stroke="#a16207"/></svg>
    ),
  },
  {
    id: "racing",
    icon: <Flag className="size-4 text-white" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-zinc-900 via-red-700 to-red-500",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-white/45",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><rect x="0" y="70" width="10" height="5" fill="#111827"/><rect x="0" y="75" width="10" height="5" fill="#fff"/><rect x="10" y="70" width="10" height="5" fill="#fff"/><rect x="10" y="75" width="10" height="5" fill="#111827"/><rect x="20" y="70" width="10" height="5" fill="#111827"/><rect x="20" y="75" width="10" height="5" fill="#fff"/><rect x="30" y="70" width="10" height="5" fill="#fff"/><rect x="30" y="75" width="10" height="5" fill="#111827"/><rect x="40" y="70" width="10" height="5" fill="#111827"/><rect x="40" y="75" width="10" height="5" fill="#fff"/><rect x="50" y="70" width="10" height="5" fill="#fff"/><rect x="50" y="75" width="10" height="5" fill="#111827"/><rect x="60" y="70" width="10" height="5" fill="#111827"/><rect x="60" y="75" width="10" height="5" fill="#fff"/><rect x="70" y="70" width="10" height="5" fill="#fff"/><rect x="70" y="75" width="10" height="5" fill="#111827"/><rect x="80" y="70" width="10" height="5" fill="#111827"/><rect x="80" y="75" width="10" height="5" fill="#fff"/><rect x="90" y="70" width="10" height="5" fill="#fff"/><rect x="90" y="75" width="10" height="5" fill="#111827"/><rect x="100" y="70" width="10" height="5" fill="#111827"/><rect x="100" y="75" width="10" height="5" fill="#fff"/><rect x="110" y="70" width="10" height="5" fill="#fff"/><rect x="110" y="75" width="10" height="5" fill="#111827"/><rect x="120" y="70" width="10" height="5" fill="#111827"/><rect x="120" y="75" width="10" height="5" fill="#fff"/><rect x="130" y="70" width="10" height="5" fill="#fff"/><rect x="130" y="75" width="10" height="5" fill="#111827"/><rect x="140" y="70" width="10" height="5" fill="#111827"/><rect x="140" y="75" width="10" height="5" fill="#fff"/><rect x="150" y="70" width="10" height="5" fill="#fff"/><rect x="150" y="75" width="10" height="5" fill="#111827"/><rect x="160" y="70" width="10" height="5" fill="#111827"/><rect x="160" y="75" width="10" height="5" fill="#fff"/><rect x="170" y="70" width="10" height="5" fill="#fff"/><rect x="170" y="75" width="10" height="5" fill="#111827"/><rect x="180" y="70" width="10" height="5" fill="#111827"/><rect x="180" y="75" width="10" height="5" fill="#fff"/><rect x="190" y="70" width="10" height="5" fill="#fff"/><rect x="190" y="75" width="10" height="5" fill="#111827"/><rect x="200" y="70" width="10" height="5" fill="#111827"/><rect x="200" y="75" width="10" height="5" fill="#fff"/><rect x="210" y="70" width="10" height="5" fill="#fff"/><rect x="210" y="75" width="10" height="5" fill="#111827"/><rect x="220" y="70" width="10" height="5" fill="#111827"/><rect x="220" y="75" width="10" height="5" fill="#fff"/><rect x="230" y="70" width="10" height="5" fill="#fff"/><rect x="230" y="75" width="10" height="5" fill="#111827"/><g stroke="#fff" strokeWidth="2" opacity=".7"><path d="M20 24H70M10 36H56M150 20H200M170 32H228"/></g><path d="M78 56q4-14 22-14l8-10h26l10 12q14 2 14 12z" fill="#ef4444" stroke="#1f2937" strokeWidth="1.5"/><path d="M104 44l6-8h18l7 8z" fill="#bae6fd" stroke="#1f2937"/><circle cx="98" cy="62" r="7" fill="#111827" stroke="#1f2937"/><circle cx="98" cy="62" r="3" fill="#e5e7eb"/><circle cx="146" cy="62" r="7" fill="#111827" stroke="#1f2937"/><circle cx="146" cy="62" r="3" fill="#e5e7eb"/></svg>
    ),
  },
  {
    id: "pirate",
    icon: <Anchor className="size-4 text-sky-100" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-sky-300 via-sky-600 to-slate-900",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-amber-200/50",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><path d="M0 66q15-8 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0V80H0z" fill="#0ea5e9" stroke="#0369a1" strokeWidth="1.5"/><path d="M0 72q15-6 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0V80H0z" fill="#0284c7"/><path d="M96 54h56l-8 12h-40z" fill="#92400e" stroke="#451a03" strokeWidth="1.5"/><line x1="124" y1="20" x2="124" y2="54" stroke="#451a03" strokeWidth="2"/><path d="M126 22q20 14 0 28z" fill="#fef3c7" stroke="#78350f"/><path d="M122 26q-16 12 0 24z" fill="#fde68a" stroke="#78350f"/><path d="M18 74Q60 60 94 56" fill="none" stroke="#b91c1c" strokeWidth="2" strokeDasharray="5 4"/><path d="M186 22l10 10M196 22l-10 10" stroke="#b91c1c" strokeWidth="2.5"/><circle cx="206" cy="58" r="4" fill="#fde047" stroke="#a16207"/></svg>
    ),
  },
  {
    id: "ninja",
    icon: <Swords className="size-4 text-slate-100" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-slate-950 via-slate-800 to-red-700",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-red-200/40",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><circle cx="150" cy="30" r="18" fill="#f8fafc" stroke="#64748b" strokeWidth="1.5"/><path d="M0 60q40-4 60-20q-30 20-60 24z" fill="#1e293b" stroke="#94a3b8"/><path d="M180 64q30-6 60-22v30z" fill="#1e293b" stroke="#94a3b8"/><path d="M60 74L210 12" stroke="#0f172a" strokeWidth="5" strokeLinecap="round"/><path d="M60 74L210 12" stroke="#f8fafc" strokeWidth="1"/><g transform="translate(96 40) rotate(20)"><polygon points="0,-12 4,-4 12,0 4,4 0,12 -4,4 -12,0 -4,-4" fill="#cbd5e1" stroke="#1f2937" strokeWidth="1"/><circle r="2.5" fill="#334155"/></g><path d="M30 24q4 6 0 12q-4-6 0-12M200 56q4 6 0 12q-4-6 0-12" fill="#dc2626" stroke="#7f1d1d"/></svg>
    ),
  },
  {
    id: "rocket",
    icon: <Rocket className="size-4 text-indigo-100" aria-hidden />,
    bannerClass: "bg-gradient-to-b from-indigo-950 via-indigo-700 to-orange-500",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-orange-100/45",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><circle cx="30" cy="20" r="1.8" fill="#fde047" opacity="1"/><circle cx="70" cy="48" r="1.8" fill="#fde047" opacity="1"/><circle cx="200" cy="66" r="1.8" fill="#fde047" opacity="1"/><circle cx="176" cy="14" r="1.8" fill="#fde047" opacity="1"/><circle cx="50" cy="64" r="1.8" fill="#fde047" opacity="1"/><circle cx="110" cy="14" r="1.8" fill="#fde047" opacity="1"/><circle cx="200" cy="30" r="14" fill="#fb923c" stroke="#9a3412" strokeWidth="1.5"/><ellipse cx="200" cy="30" rx="24" ry="5" fill="none" stroke="#fde68a" strokeWidth="2.5" transform="rotate(-20 200 30)"/><g transform="translate(120 40) rotate(40)"><path d="M0-24Q12-8 9 14H-9Q-12-8 0-24z" fill="#f8fafc" stroke="#1f2937" strokeWidth="1.5"/><path d="M0-24Q7-18 8-12H-8Q-7-18 0-24z" fill="#ef4444" stroke="#1f2937"/><circle cy="-2" r="5" fill="#38bdf8" stroke="#1f2937"/><path d="M-9 8l-8 10l8-4zM9 8l8 10l-8-4z" fill="#ef4444" stroke="#1f2937"/><path d="M-5 14Q0 36 5 14" fill="#fb923c" stroke="#b45309"/></g><path d="M60 70Q80 60 100 54" fill="none" stroke="#fb923c" strokeWidth="4" strokeLinecap="round" opacity=".5"/></svg>
    ),
  },
  {
    id: "jungle",
    icon: <Leaf className="size-4 text-lime-100" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-green-950 via-green-700 to-lime-500",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-lime-100/45",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><g stroke="#14532d" strokeWidth="1.2"><ellipse cx="190" cy="58" rx="40" ry="12" fill="#16a34a" transform="rotate(-30 190 58)"/><ellipse cx="220" cy="46" rx="34" ry="10" fill="#22c55e" transform="rotate(-60 220 46)"/><ellipse cx="40" cy="64" rx="36" ry="11" fill="#22c55e" transform="rotate(25 40 64)"/><ellipse cx="14" cy="50" rx="30" ry="9" fill="#16a34a" transform="rotate(60 14 50)"/></g><path d="M110 0q8 20 -2 36" fill="none" stroke="#15803d" strokeWidth="2.5"/><ellipse cx="108" cy="22" rx="6" ry="3" fill="#4ade80" stroke="#14532d" transform="rotate(30 108 22)"/><g transform="translate(130 34)"><ellipse cx="-6" cy="-3" rx="7" ry="9" fill="#f97316" stroke="#1f2937" transform="rotate(-30)"/><ellipse cx="6" cy="-3" rx="7" ry="9" fill="#f97316" stroke="#1f2937" transform="rotate(30)"/><rect x="-1" y="-8" width="2" height="14" fill="#1f2937"/></g><circle cx="90" cy="54" r="2.4" fill="#fde047" opacity="1"/><circle cx="160" cy="22" r="2.4" fill="#fde047" opacity="1"/><circle cx="76" cy="20" r="2.4" fill="#fde047" opacity="1"/></svg>
    ),
  },
  {
    id: "cyberpunk",
    icon: <Cpu className="size-4 text-cyan-200" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-slate-950 via-fuchsia-900 to-cyan-600",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-cyan-200/50",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><g stroke="#22d3ee" strokeWidth="1" opacity=".7"><path d="M88 52L-40 80"/><path d="M96 52L0 80"/><path d="M104 52L40 80"/><path d="M112 52L80 80"/><path d="M120 52L120 80"/><path d="M128 52L160 80"/><path d="M136 52L200 80"/><path d="M144 52L240 80"/><path d="M152 52L280 80"/><path d="M0 58H240M0 66H240M0 75H240"/></g><rect x="96" y="14" width="56" height="26" rx="5" fill="#0f172a" stroke="#f472b6" strokeWidth="2"/><text x="124" y="32" textAnchor="middle" fontSize="15" fontWeight="900" fill="#22d3ee">ネオ</text><g stroke="#ec4899" strokeWidth="1.6" strokeLinecap="round" opacity=".9"><path d="M40 6l-6 20M60 14l-6 20M186 8l-6 20M206 26l-6 20M20 40l-6 20"/></g><rect x="0" y="30" width="46" height="4" fill="#f43f5e" opacity=".6"/><rect x="190" y="50" width="50" height="4" fill="#22d3ee" opacity=".6"/></svg>
    ),
  },
  {
    id: "steampunk",
    icon: <Cog className="size-4 text-amber-200" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-stone-950 via-amber-800 to-amber-500",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-amber-200/50",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><rect y="0" width="240" height="8" fill="#b45309" stroke="#78350f"/><g><circle cx="120" cy="42" r="22" fill="#b45309" stroke="#78350f" strokeWidth="1.5"/><circle cx="120" cy="42" r="23" fill="none" stroke="#fbbf24" strokeWidth="6" strokeDasharray="5 5"/><circle cx="120" cy="42" r="7" fill="#fde68a" stroke="#78350f"/></g><g><circle cx="164" cy="28" r="13" fill="#d97706" stroke="#78350f" strokeWidth="1.5"/><circle cx="164" cy="28" r="14" fill="none" stroke="#fde68a" strokeWidth="5" strokeDasharray="4 4"/><circle cx="164" cy="28" r="4" fill="#fef3c7" stroke="#78350f"/></g><ellipse cx="60" cy="26" rx="26" ry="11" fill="#fbbf24" stroke="#78350f" strokeWidth="1.5"/><rect x="50" y="40" width="20" height="8" fill="#78350f"/><circle cx="200" cy="60" r="7" fill="#e2e8f0" opacity="0.8"/><circle cx="212" cy="48" r="7" fill="#e2e8f0" opacity="0.8"/><circle cx="190" cy="70" r="7" fill="#e2e8f0" opacity="0.8"/></svg>
    ),
  },
  {
    id: "candy",
    icon: <Candy className="size-4 text-pink-100" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-pink-400 via-fuchsia-400 to-sky-300",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-white/55",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><path d="M0 0H240V6q-10 14-20 0t-30 6t-30-4t-30 8t-30-6t-30 4t-30-6t-20 4z" fill="#78350f" stroke="#451a03"/><g stroke="#f8fafc" strokeWidth="3"><path d="M100 40V74M160 44V76"/></g><circle cx="100" cy="34" r="14" fill="#f472b6" stroke="#1f2937" strokeWidth="1.2"/><path d="M100 34m-7 0a7 7 0 1 1 14 0" fill="none" stroke="#fff" strokeWidth="2.5"/><circle cx="160" cy="38" r="14" fill="#38bdf8" stroke="#1f2937" strokeWidth="1.2"/><path d="M160 38m-7 0a7 7 0 1 1 14 0" fill="none" stroke="#fff" strokeWidth="2.5"/><path d="M200 74a12 12 0 0 1 24 0z" fill="#4ade80" stroke="#1f2937"/><path d="M60 74a12 12 0 0 1 24 0z" fill="#fb923c" stroke="#1f2937"/><g strokeWidth="3" strokeLinecap="round"><path d="M30 30l5 -3" stroke="#facc15"/><path d="M130 24l4 4" stroke="#f472b6"/><path d="M190 22l5 -2" stroke="#4ade80"/><path d="M130 62l4 -3" stroke="#38bdf8"/></g></svg>
    ),
  },
  {
    id: "kawaii",
    icon: <Heart className="size-4 text-pink-50" aria-hidden />,
    bannerClass: "bg-gradient-to-br from-pink-300 via-rose-300 to-violet-300",
    decorClass:
      "bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%)]",
    iconWrapClass: "bg-black/30 ring-1 ring-white/60",
    motif: (
      <svg aria-hidden="true" viewBox="0 0 240 80" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full"><g fill="none" strokeWidth="5"><path d="M180 80A60 60 0 0 1 240 20" stroke="#f87171"/><path d="M186 80A54 54 0 0 1 240 26" stroke="#fb923c"/><path d="M192 80A48 48 0 0 1 240 32" stroke="#facc15"/><path d="M198 80A42 42 0 0 1 240 38" stroke="#4ade80"/><path d="M204 80A36 36 0 0 1 240 44" stroke="#38bdf8"/><path d="M210 80A30 30 0 0 1 240 50" stroke="#a78bfa"/></g><path d="M70 44a10 10 0 0 1 4-18a14 14 0 0 1 26 2a9 9 0 0 1 2 16z" fill="#fff" stroke="#7dd3fc" strokeWidth="1.5"/><circle cx="84" cy="38" r="1.6" fill="#1f2937"/><circle cx="96" cy="38" r="1.6" fill="#1f2937"/><path d="M86 42q4 3 8 0" fill="none" stroke="#1f2937"/><circle cx="80" cy="42" r="2" fill="#fb7185" opacity=".6"/><circle cx="100" cy="42" r="2" fill="#fb7185" opacity=".6"/><path d="M150 22c-8-8-14 2-6 8l6 5l6-5c8-6 2-16-6-8z" fill="#f9a8d4" stroke="#be185d"/><polygon points="40,20 43,28 52,28 45,33 48,42 40,37 32,42 35,33 28,28 37,28" fill="#fde68a" stroke="#b45309" strokeWidth=".8"/></svg>
    ),
  },
];

const THEME_GROUPS: { key: string; ids: readonly string[] }[] = [
  {
    key: "classic",
    ids: [
      "phoenix", "hacker", "admin", "aurora", "sakura", "fireworks", "ocean", "neon",
      "vice", "storm", "cosmos", "snow", "lantern", "arcade", "koi",
    ],
  },
  { key: "game", ids: ["blockcraft", "platformer", "racing"] },
  { key: "adventure", ids: ["pirate", "ninja", "rocket", "jungle"] },
  { key: "style", ids: ["cyberpunk", "steampunk", "candy", "kawaii"] },
];

function previewInitials(name: string, username?: string): string {
  return (name.trim() || username || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function WelcomeEffectDialog({
  open,
  onOpenChange,
  targetUserId,
  targetName,
  targetUsername,
  targetAvatarUrl,
  targetCoverUrl,
  isOwner,
  initialEffect,
  initialMessage,
  onPreview,
  onSaved,
}: WelcomeEffectDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<WelcomeEffect>(initialEffect);
  const [message, setMessage] = useState(initialMessage);
  const [saving, setSaving] = useState(false);
  const previewAvatarRef = useRef<HTMLSpanElement | null>(null);

  // Stacked Home preview modal state
  const [previewEffect, setPreviewEffect] = useState<WelcomeEffect | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewRunId, setPreviewRunId] = useState(0);

  const presetKey = (id: WelcomeEffect) => (id === "" ? "none" : id);

  function openThemePreview(effect: WelcomeEffect) {
    if (!effect) return;
    setPreviewEffect(effect);
    setPreviewPlaying(true);
    setPreviewRunId((prev) => prev + 1);
    onPreview?.(effect, message);
  }

  function replayThemePreview() {
    setPreviewPlaying(true);
    setPreviewRunId((prev) => prev + 1);
  }

  /** `override` saves that theme straight away (the preview's "Use this theme"). */
  async function handleSave(override?: Exclude<WelcomeEffect, "">) {
    const effect = override ?? selected;
    setSaving(true);
    try {
      const payload = {
        welcome_effect: effect,
        welcome_message: effect ? message.trim() : "",
      };
      if (isOwner) {
        const updated = await api.patch<User>("/api/v1/users/me", payload);
        onSaved(updated.welcome_effect ?? effect, updated.welcome_message ?? "");
        window.dispatchEvent(
          new CustomEvent("wikihub:user-welcome-changed", {
            detail: {
              username: updated.username,
              welcome_effect: updated.welcome_effect ?? effect,
              welcome_message: updated.welcome_message ?? "",
            },
          }),
        );
      } else if (targetUserId) {
        const updated = await api.patch<PublicUser>(
          `/api/v1/users/${targetUserId}`,
          payload,
        );
        onSaved(updated.welcome_effect ?? effect, updated.welcome_message ?? "");
        window.dispatchEvent(
          new CustomEvent("wikihub:user-welcome-changed", {
            detail: {
              username: updated.username,
              welcome_effect: updated.welcome_effect ?? effect,
              welcome_message: updated.welcome_message ?? "",
            },
          }),
        );
      }
      toast.success(t("welcomeEffect.saved"));
      setPreviewEffect(null);
      setPreviewPlaying(false);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("welcomeEffect.saveError"),
      );
    } finally {
      setSaving(false);
    }
  }

  const previewLabel = previewEffect
    ? t(`welcomeEffect.presets.${presetKey(previewEffect)}.label`)
    : "";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="text-primary size-4" aria-hidden />
              {t("welcomeEffect.title")}
            </span>
          }
          description={
            isOwner
              ? t("welcomeEffect.description")
              : t("welcomeEffect.adminEditing", { name: targetName })
          }
          className="sm:max-w-[min(94vw,82rem)]"
        >
          <div className="space-y-4">
            {/* Compact full-width "None" option */}
            <button
              type="button"
              onClick={() => setSelected("")}
              className={cn(
                "border-border bg-surface hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
                selected === "" &&
                  "border-primary bg-primary-subtle/45 ring-primary/25 ring-1",
              )}
            >
              <span className="bg-surface-sunken text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
                <Ban className="size-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground text-sm font-medium">
                  {t("welcomeEffect.presets.none.label")}
                </span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {t("welcomeEffect.presets.none.desc")}
                </span>
              </span>
              {selected === "" ? (
                <span className="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full">
                  <Check className="size-3" aria-hidden />
                </span>
              ) : null}
            </button>

            {/* Theme gallery: every theme visible at once, no inner scrolling */}
            {THEME_GROUPS.map((group) => (
              <section key={group.key} className="space-y-2">
                <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  {t(`welcomeEffect.groups.${group.key}`)}
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {THEME_PRESETS.filter((p) => group.ids.includes(p.id)).map((preset) => {
                const label = t(`welcomeEffect.presets.${preset.id}.label`);
                const desc = t(`welcomeEffect.presets.${preset.id}.desc`);
                const active = selected === preset.id;
                return (
                  <div
                    key={preset.id}
                    className={cn(
                      "border-border bg-surface group relative overflow-hidden rounded-lg border transition-all duration-150",
                      active
                        ? "border-primary ring-primary/30 shadow-xs ring-2"
                        : "hover:border-border-strong hover:shadow-2xs",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(preset.id)}
                      className="focus-visible:ring-ring flex w-full cursor-pointer flex-col text-left focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                    >
                      {/* Visual theme preview header */}
                      <div
                        className={cn(
                          "relative flex h-20 w-full items-center overflow-hidden px-3",
                          preset.bannerClass,
                        )}
                      >
                        <div
                          aria-hidden="true"
                          className={cn(
                            "pointer-events-none absolute inset-0",
                            preset.decorClass,
                          )}
                        />
                        {preset.motif}
                        <span
                          className={cn(
                            "relative z-10 flex size-8 items-center justify-center rounded-lg backdrop-blur-xs",
                            preset.iconWrapClass,
                          )}
                        >
                          {preset.icon}
                        </span>
                      </div>

                      {/* Card text body */}
                      <div className="flex flex-1 flex-col gap-0.5 px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-foreground text-sm font-semibold">
                            {label}
                          </span>
                          {active ? (
                            <span className="bg-primary text-primary-foreground inline-flex size-4 items-center justify-center rounded-full">
                              <Check className="size-2.5" aria-hidden />
                            </span>
                          ) : null}
                        </div>
                        <span className="text-muted-foreground line-clamp-3 text-[11px] leading-relaxed">
                          {desc}
                        </span>
                      </div>
                    </button>

                    {/* Per-theme Play button */}
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => openThemePreview(preset.id)}
                      aria-label={t("welcomeEffect.previewTheme", { name: label })}
                      title={t("welcomeEffect.previewTheme", { name: label })}
                      className="focus-visible:ring-ring absolute top-2 right-2 z-10 inline-flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-xs transition-all hover:scale-110 hover:bg-black/70 active:bg-black/85 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Play className="size-3 translate-x-px fill-current" aria-hidden />
                    </button>
                  </div>
                );
              })}
                </div>
              </section>
            ))}

            {/* Custom greeting input */}
            {selected ? (
              <div className="border-border bg-surface-sunken/40 space-y-1.5 rounded-lg border p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="welcome-message-input" className="text-xs font-medium">
                    {t("welcomeEffect.messageLabel")}
                  </Label>
                  <span className="text-muted-foreground text-[11px] tabular-nums">
                    {message.length}/140
                  </span>
                </div>
                <Input
                  id="welcome-message-input"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={140}
                  placeholder={t("welcomeEffect.messagePlaceholder")}
                  className="bg-surface"
                />
                <p className="text-muted-foreground text-[11px]">
                  {t("welcomeEffect.messageHint")}
                </p>
              </div>
            ) : null}
          </div>

          <DialogFooter className="border-border mt-2 gap-2 border-t pt-4 sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
                  {t("welcomeEffect.saving")}
                </>
              ) : (
                t("welcomeEffect.save")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stacked Home Preview Modal */}
      <Dialog
        open={Boolean(previewEffect)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPreviewEffect(null);
            setPreviewPlaying(false);
          }
        }}
      >
        <DialogContent
          title={t("welcomeEffect.previewTitle", { name: previewLabel })}
          className="max-w-3xl"
        >
          <div className="border-border bg-background relative h-[22rem] w-full overflow-hidden rounded-lg border shadow-inner">
            {/* Simulated WikiHub top bar */}
            <div className="border-border bg-surface flex h-10 items-center justify-between border-b px-3.5">
              <div className="flex items-center gap-2">
                <span className="bg-primary/20 block size-4 rounded-xs" />
                <span className="bg-muted-foreground/25 block h-2.5 w-16 rounded-full" />
              </div>
              <div className="bg-surface-sunken border-border h-5 w-36 rounded-md border" />
              <span className="bg-primary-subtle block size-5 rounded-full" />
            </div>

            {/* Simulated Home 2-column layout (Activity feed + Profile card) */}
            <div className="grid h-[calc(100%-2.5rem)] grid-cols-[minmax(0,1fr)_14.5rem] gap-3 p-3.5">
              {/* Left mock activity feed */}
              <div className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-3">
                <div className="border-border flex items-center gap-2 border-b pb-2">
                  <span className="bg-primary/20 h-3 w-16 rounded-full" />
                  <span className="bg-muted-foreground/15 h-3 w-14 rounded-full" />
                  <span className="bg-muted-foreground/15 h-3 w-12 rounded-full" />
                </div>
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-start gap-2.5">
                    <span className="bg-surface-sunken mt-0.5 size-6 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <span className="bg-muted-foreground/20 block h-2.5 w-3/5 rounded-full" />
                      <span className="bg-muted-foreground/12 block h-2 w-4/5 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Right mock profile card */}
              <div className="border-border bg-surface overflow-hidden rounded-lg border">
                <div className="bg-primary-subtle aspect-[15/4] w-full overflow-hidden">
                  {targetCoverUrl ? (
                    <img
                      src={targetCoverUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="px-3 pb-3">
                  <div className="flex items-end gap-2">
                    <span
                      ref={previewAvatarRef}
                      className={cn(
                        "ring-surface relative -mt-6 flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold ring-4",
                        targetAvatarUrl
                          ? ""
                          : getUserAvatarColor(targetUsername || targetName),
                      )}
                    >
                      {targetAvatarUrl ? (
                        <img
                          src={targetAvatarUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        previewInitials(targetName, targetUsername) || (
                          <UserRound className="size-5" aria-hidden />
                        )
                      )}
                    </span>
                    <div className="min-w-0 flex-1 pb-0.5">
                      <p className="truncate text-xs font-semibold">{targetName}</p>
                      {targetUsername ? (
                        <p className="text-muted-foreground truncate text-[10px]">
                          @{targetUsername}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="border-border mt-3 space-y-2 border-t pt-2.5">
                    <div className="flex justify-between">
                      <span className="bg-muted-foreground/15 h-2 w-14 rounded-full" />
                      <span className="bg-muted-foreground/20 h-2 w-12 rounded-full" />
                    </div>
                    <div className="flex justify-between">
                      <span className="bg-muted-foreground/15 h-2 w-12 rounded-full" />
                      <span className="bg-muted-foreground/20 h-2 w-16 rounded-full" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Live contained WelcomeEffectOverlay playing inside the mock Home */}
            {previewEffect && previewPlaying ? (
              <WelcomeEffectOverlay
                key={previewRunId}
                contained
                focusRef={previewAvatarRef}
                effect={previewEffect}
                ownerName={targetName}
                message={message}
                onComplete={() => setPreviewPlaying(false)}
              />
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="secondary"
              onClick={replayThemePreview}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t("welcomeEffect.replay")}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPreviewEffect(null);
                  setPreviewPlaying(false);
                }}
              >
                {t("welcomeEffect.close")}
              </Button>
              {previewEffect ? (
                <Button
                  type="button"
                  variant="primary"
                  disabled={saving}
                  onClick={() => {
                    setSelected(previewEffect);
                    void handleSave(previewEffect);
                  }}
                  className="gap-1.5"
                >
                  <Check className="size-3.5" aria-hidden />
                  {t("welcomeEffect.useTheme")}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
