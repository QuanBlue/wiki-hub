"use client";

import {
  BookOpen,
  Compass,
  Cpu,
  Feather,
  GraduationCap,
  Layers,
  Network,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { useThemeSettings } from "@/components/theme-color-provider";
import { cn } from "@/lib/utils";

/**
 * The WikiHub mark: three stacked knowledge layers converging on a hub,
 * or the administrator-chosen icon/logo.
 */
export function LogoMark({
  className,
  icon: propIcon,
  customLogoUrl: propCustomLogoUrl,
}: {
  className?: string;
  icon?: string;
  customLogoUrl?: string | null;
}) {
  const settings = useThemeSettings();
  const activeIcon = propIcon ?? settings?.logoIcon ?? "default";
  const activeCustomLogo =
    propCustomLogoUrl !== undefined
      ? propCustomLogoUrl
      : propIcon !== undefined
        ? null
        : (settings?.customLogoUrl ?? null);

  if (activeCustomLogo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={activeCustomLogo}
        alt="Logo"
        className={cn("size-6 rounded object-contain", className)}
      />
    );
  }

  if (activeIcon === "book") {
    return (
      <div
        className={cn(
          "bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-[5px] shadow-xs",
          className,
        )}
      >
        <BookOpen className="size-3.5 stroke-[2.4]" aria-hidden="true" />
      </div>
    );
  }

  if (activeIcon === "layers") {
    return (
      <div
        className={cn(
          "bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-[5px] shadow-xs",
          className,
        )}
      >
        <Layers className="size-3.5 stroke-[2.4]" aria-hidden="true" />
      </div>
    );
  }

  if (activeIcon === "compass") {
    return (
      <div
        className={cn(
          "bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-[5px] shadow-xs",
          className,
        )}
      >
        <Compass className="size-3.5 stroke-[2.4]" aria-hidden="true" />
      </div>
    );
  }

  if (activeIcon === "sparkles") {
    return (
      <div
        className={cn(
          "bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-[5px] shadow-xs",
          className,
        )}
      >
        <Sparkles className="size-3.5 stroke-[2.4]" aria-hidden="true" />
      </div>
    );
  }

  if (activeIcon === "feather") {
    return (
      <div
        className={cn(
          "bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-[5px] shadow-xs",
          className,
        )}
      >
        <Feather className="size-3.5 stroke-[2.4]" aria-hidden="true" />
      </div>
    );
  }

  if (activeIcon === "hub") {
    return (
      <div
        className={cn(
          "bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-[5px] shadow-xs",
          className,
        )}
      >
        <Network className="size-3.5 stroke-[2.4]" aria-hidden="true" />
      </div>
    );
  }

  if (activeIcon === "graduation") {
    return (
      <div
        className={cn(
          "bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-[5px] shadow-xs",
          className,
        )}
      >
        <GraduationCap className="size-3.5 stroke-[2.4]" aria-hidden="true" />
      </div>
    );
  }

  if (activeIcon === "cpu") {
    return (
      <div
        className={cn(
          "bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-[5px] shadow-xs",
          className,
        )}
      >
        <Cpu className="size-3.5 stroke-[2.4]" aria-hidden="true" />
      </div>
    );
  }

  if (activeIcon === "shield") {
    return (
      <div
        className={cn(
          "bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-[5px] shadow-xs",
          className,
        )}
      >
        <ShieldCheck className="size-3.5 stroke-[2.4]" aria-hidden="true" />
      </div>
    );
  }

  // Default WikiHub 3-layer mark
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <rect width="24" height="24" rx="5" fill="var(--primary)" />
      {/* Two fainter copies of the W trail below it: the stacked layers. */}
      <path
        d="M6.2 10.3 9.5 17.7 12 12.6 14.5 17.7 17.8 10.3"
        stroke="var(--primary-foreground)"
        strokeOpacity="0.24"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.2 8.6 9.5 16 12 10.9 14.5 16 17.8 8.6"
        stroke="var(--primary-foreground)"
        strokeOpacity="0.5"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The W as a network: linked nodes converging on a central hub. */}
      <path
        d="M6.2 6.9 9.5 14.3 12 9.2 14.5 14.3 17.8 6.9"
        stroke="var(--primary-foreground)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.2" cy="6.9" r="1.4" fill="var(--primary-foreground)" />
      <circle cx="17.8" cy="6.9" r="1.4" fill="var(--primary-foreground)" />
      <circle cx="12" cy="9.2" r="2" fill="var(--primary-foreground)" />
      <circle cx="12" cy="9.2" r="0.85" fill="var(--primary)" />
    </svg>
  );
}

export function Wordmark({
  siteName: propSiteName,
  className,
  icon,
  customLogoUrl,
}: {
  siteName?: string;
  className?: string;
  icon?: string;
  customLogoUrl?: string | null;
}) {
  const settings = useThemeSettings();
  const effectiveSiteName =
    settings?.siteName || propSiteName || "WikiHub";

  return (
    <span
      className={cn(
        "flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight",
        className,
      )}
    >
      <LogoMark icon={icon} customLogoUrl={customLogoUrl} />
      {effectiveSiteName}
    </span>
  );
}
