"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * On/off toggle. Renders a native `button[role=switch]`, so it is keyboard
 * operable (Space/Enter) and announces its state. Use it for settings that
 * take effect as a whole; use a checkbox inside forms that submit lists.
 */
export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: "sm" | "md";
}

export function Switch({
  checked,
  onCheckedChange,
  size = "md",
  className,
  disabled,
  ...props
}: SwitchProps) {
  const sm = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "focus-visible:ring-ring focus-visible:ring-offset-surface inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        sm ? "h-4 w-7" : "h-5 w-9",
        checked
          ? "bg-primary hover:bg-primary-hover"
          : "bg-muted-foreground/30 hover:bg-muted-foreground/45",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "bg-surface pointer-events-none block rounded-full shadow-sm transition-transform duration-150",
          sm ? "size-3" : "size-4",
          checked ? (sm ? "translate-x-3.5" : "translate-x-4.5") : "translate-x-0.5",
        )}
      />
    </button>
  );
}
