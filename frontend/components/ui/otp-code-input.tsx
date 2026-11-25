"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

export interface OtpCodeInputProps {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (code: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  className?: string;
}

function emptySlots(length: number): string[] {
  return Array.from({ length }, () => "");
}

function slotsFromValue(value: string, length: number): string[] {
  const digits = value.replace(/\D/g, "").slice(0, length);
  return Array.from({ length }, (_, idx) => digits[idx] ?? "");
}

/**
 * Accessible 6-box positional numeric OTP input.
 *
 * Each box keeps its fixed position: deleting a digit clears only that box
 * without shifting neighbouring digits, arrow keys (`←`/`→`/`Home`/`End`) and
 * clicks jump to any box, and typing a digit replaces the current box and
 * advances to the next one.
 */
export function OtpCodeInput({
  id,
  name,
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  autoFocus = false,
  required = false,
  className,
}: OtpCodeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [slots, setSlots] = useState<string[]>(() => slotsFromValue(value, length));

  // Keep positional slots in sync if the parent resets or externally changes `value`.
  const externalDigits = value.replace(/\D/g, "").slice(0, length);
  const currentJoined = slots.join("");
  const displaySlots =
    externalDigits === "" && currentJoined !== ""
      ? emptySlots(length)
      : externalDigits !== currentJoined
        ? slotsFromValue(externalDigits, length)
        : slots;

  function commitSlots(
    nextSlots: string[],
    nextCursor: number,
    options: { editedIndex?: number; viaPaste?: boolean } = {},
  ) {
    const prevWasComplete = displaySlots.every((ch) => ch.length === 1);
    const prevJoined = displaySlots.join("");
    const nextIsComplete = nextSlots.every((ch) => ch.length === 1);
    const nextJoined = nextSlots.join("");
    setSlots(nextSlots);
    setActiveIndex(Math.max(0, Math.min(nextCursor, length - 1)));
    if (nextJoined !== prevJoined) {
      onChange(nextJoined);
    }
    const shouldAutoComplete =
      !disabled &&
      nextIsComplete &&
      nextJoined.length === length &&
      nextJoined !== prevJoined &&
      (!prevWasComplete ||
        Boolean(options.viaPaste) ||
        options.editedIndex === length - 1);
    if (shouldAutoComplete) {
      onComplete?.(nextJoined);
    }
  }

  function focusSlot(index: number) {
    if (disabled) return;
    setActiveIndex(Math.max(0, Math.min(index, length - 1)));
    inputRef.current?.focus();
  }

  function applyPastedDigits(raw: string) {
    const pasted = raw.replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    const nextSlots = [...displaySlots];
    // Full-length paste fills from box 0; partial paste fills starting at the active box.
    const start = pasted.length >= length ? 0 : activeIndex;
    let lastFilled = start;
    for (let i = 0; i < pasted.length && start + i < length; i += 1) {
      nextSlots[start + i] = pasted[i]!;
      lastFilled = start + i;
    }
    const nextCursor = Math.min(lastFilled + 1, length - 1);
    commitSlots(nextSlots, nextCursor, { viaPaste: true });
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    if (disabled) return;
    const text = event.clipboardData.getData("text");
    if (!text) return;
    event.preventDefault();
    applyPastedDigits(text);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(length - 1, prev + 1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(length - 1);
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      const nextSlots = [...displaySlots];
      if (nextSlots[activeIndex]) {
        // Clear current box in place without shifting other digits.
        nextSlots[activeIndex] = "";
        commitSlots(nextSlots, activeIndex);
      } else if (activeIndex > 0) {
        const prevIdx = activeIndex - 1;
        nextSlots[prevIdx] = "";
        commitSlots(nextSlots, prevIdx);
      }
      return;
    }

    if (event.key === "Delete") {
      event.preventDefault();
      if (displaySlots[activeIndex]) {
        const nextSlots = [...displaySlots];
        nextSlots[activeIndex] = "";
        commitSlots(nextSlots, activeIndex);
      }
      return;
    }

    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      const nextSlots = [...displaySlots];
      nextSlots[activeIndex] = event.key;
      commitSlots(nextSlots, Math.min(activeIndex + 1, length - 1), {
        editedIndex: activeIndex,
      });
    }
  }

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        required={required}
        disabled={disabled}
        value={displaySlots.join("")}
        onChange={(e) => {
          // Fallback path for mobile virtual keyboards / OS OTP autofill
          // that bypass `onKeyDown` with a digit key.
          const raw = e.target.value.replace(/\D/g, "");
          if (!raw) {
            commitSlots(emptySlots(length), 0);
            return;
          }
          if (raw.length >= length) {
            applyPastedDigits(raw);
            return;
          }
          const lastChar = raw[raw.length - 1];
          if (lastChar) {
            const nextSlots = [...displaySlots];
            nextSlots[activeIndex] = lastChar;
            commitSlots(nextSlots, Math.min(activeIndex + 1, length - 1), {
              editedIndex: activeIndex,
            });
          }
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={() => {
          setFocused(true);
          if (displaySlots.every((ch) => !ch)) {
            setActiveIndex(0);
          }
        }}
        onBlur={() => setFocused(false)}
        className="sr-only"
      />

      <div
        aria-hidden="true"
        className="flex items-center justify-between gap-1.5 sm:gap-2"
      >
        {displaySlots.map((char, index) => {
          const isActive = focused && !disabled && index === activeIndex;
          const isFilled = Boolean(char);
          return (
            <div key={index} className="contents">
              {length === 6 && index === 3 ? (
                <span className="text-muted-foreground/50 select-none text-sm font-medium">
                  –
                </span>
              ) : null}
              <div
                onMouseDown={(e) => {
                  // Prevent input blur before focusing the clicked slot.
                  e.preventDefault();
                  focusSlot(index);
                }}
                className={cn(
                  "flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg border font-mono text-lg font-semibold transition-all select-none",
                  "bg-surface text-foreground shadow-2xs",
                  disabled
                    ? "bg-surface-sunken text-muted-foreground cursor-not-allowed opacity-60"
                    : "cursor-text",
                  !disabled && !isActive && "border-border/80 hover:border-border-strong",
                  isFilled && !isActive && !disabled && "border-border-strong",
                  isActive && "border-primary ring-2 ring-primary/20",
                )}
              >
                {char ? (
                  char
                ) : isActive ? (
                  <span className="bg-primary h-5 w-0.5 animate-pulse rounded-full" />
                ) : (
                  <span className="text-muted-foreground/30 text-sm">•</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
