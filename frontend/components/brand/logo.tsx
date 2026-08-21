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
      <path
        d="M6 8.5 12 5.5l6 3-6 3-6-3Z"
        fill="var(--primary-foreground)"
        fillOpacity="0.95"
      />
      <path
        d="m6 12 6 3 6-3"
        stroke="var(--primary-foreground)"
        strokeOpacity="0.75"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m6 15.5 6 3 6-3"
        stroke="var(--primary-foreground)"
        strokeOpacity="0.5"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
