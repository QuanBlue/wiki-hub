"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { inputClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password field with a reveal toggle.
 *
 * Reasons it is a component rather than a prop on a generic input:
 *
 * - The visibility state must reset to hidden whenever the field is disabled or
 *   remounted, so a revealed password cannot linger on screen.
 * - The toggle is a real `<button type="button">`. Inside a form, a bare
 *   `<button>` defaults to `type="submit"` and would submit the login form on
 *   click - a subtle bug worth fixing once, here.
 * - `aria-pressed` plus a label that changes with state is what makes the
 *   control legible to a screen reader; duplicating that at every call site
 *   invites getting it wrong.
 */
export type PasswordInputProps = Omit<
  React.ComponentPropsWithoutRef<"input">,
  "type"
>;

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  PasswordInputProps
>(function PasswordInput({ className, disabled, ...props }, ref) {
  const [visible, setVisible] = React.useState(false);

  // Never leave a password on screen in a field the user can no longer edit.
  const revealed = visible && !disabled;

  return (
    <div className="relative">
      <input
        ref={ref}
        type={revealed ? "text" : "password"}
        disabled={disabled}
        // Shares the exact input styling; only the right padding differs, to
        // leave room for the reveal button.
        className={cn(inputClassName, "pr-10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        // The input already announces itself; this button is a separate control
        // and needs its own name and state.
        aria-label={revealed ? "Hide password" : "Show password"}
        aria-pressed={revealed}
        title={revealed ? "Hide password" : "Show password"}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-surface-hover",
          "focus-visible:ring-ring active:bg-surface-selected",
          "absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md",
          "cursor-pointer transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-60",
        )}
      >
        {revealed ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
});
