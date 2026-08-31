"use client";

import { AlertTriangle, Keyboard, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_SCOPE_LABELS,
  bindingsFor,
  eventToBinding,
  findConflicts,
  formatBinding,
  resetAllShortcuts,
  setBindings,
  useShortcutOverrides,
  type ShortcutAction,
} from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/utils";

/** A recorded chord, or `null` for the "add a binding" slot. */
type RecordingTarget = { actionId: string; index: number } | null;

function Kbd({ binding }: { binding: string }) {
  return (
    <kbd className="border-border bg-surface-sunken text-foreground rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold">
      {formatBinding(binding)}
    </kbd>
  );
}

export function ShortcutSettings() {
  const overrides = useShortcutOverrides();
  const [recording, setRecording] = useState<RecordingTarget>(null);

  const conflicts = useMemo(() => findConflicts(overrides), [overrides]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, ShortcutAction[]>();
    for (const action of SHORTCUT_ACTIONS) {
      const existing = byGroup.get(action.group);
      if (existing) existing.push(action);
      else byGroup.set(action.group, [action]);
    }
    return [...byGroup.entries()];
  }, []);

  // While recording, this listener owns the keyboard: it runs in the capture
  // phase and stops propagation so the very shortcut being rebound cannot fire
  // on its way through (pressing Mod+K here must not open quick search).
  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(null);
        return;
      }

      const binding = eventToBinding(event);
      // Modifiers on their own are not a shortcut - keep waiting for the key
      // that completes the chord instead of cancelling.
      if (binding === null) return;

      const current = bindingsFor(recording.actionId, overrides);
      const next = [...current];
      if (recording.index >= next.length) next.push(binding);
      else next[recording.index] = binding;

      // The same chord twice on one action is not a second way to trigger it.
      setBindings(recording.actionId, [...new Set(next)]);
      setRecording(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, overrides]);

  const removeBinding = useCallback(
    (actionId: string, index: number) => {
      const next = bindingsFor(actionId, overrides).filter((_, i) => i !== index);
      setBindings(actionId, next);
    },
    [overrides],
  );

  const isCustomised = Object.keys(overrides).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Keyboard shortcuts</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Rebind the app&rsquo;s shortcuts to whatever you prefer. Changes save as you
            make them and apply to this browser.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            resetAllShortcuts();
            setRecording(null);
          }}
          disabled={!isCustomised}
        >
          <RotateCcw aria-hidden />
          Reset all to defaults
        </Button>
      </div>

      {conflicts.size > 0 ? (
        <div className="border-warning/40 bg-warning-bg text-foreground flex items-start gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {conflicts.size === 1 ? "One shortcut is" : `${conflicts.size} shortcuts are`}{" "}
            assigned to more than one action in the same context. Whichever action
            handles the key first will win, so the other may not fire.
          </p>
        </div>
      ) : null}

      {groups.map(([group, actions]) => (
        <section key={group} className="space-y-2">
          <h3 className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
            {group}
          </h3>
          <ul className="border-border divide-border divide-y rounded-md border">
            {actions.map((action) => {
              const bindings = bindingsFor(action.id, overrides);
              const isOverridden = action.id in overrides;

              return (
                <li
                  key={action.id}
                  className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 sm:pr-6">
                    <p className="text-foreground text-sm font-medium">{action.label}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      {action.description}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      {SHORTCUT_SCOPE_LABELS[action.scope]}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {bindings.map((binding, index) => {
                      const isRecording =
                        recording?.actionId === action.id && recording.index === index;
                      const conflicting = conflicts.has(binding);

                      return (
                        <span key={`${binding}-${index}`} className="inline-flex items-center">
                          <button
                            type="button"
                            onClick={() =>
                              setRecording(
                                isRecording ? null : { actionId: action.id, index },
                              )
                            }
                            aria-label={`Change shortcut for ${action.label}`}
                            className={cn(
                              "focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center rounded border px-2 font-mono text-[11px] font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                              isRecording
                                ? "border-primary bg-primary-subtle text-primary animate-pulse"
                                : conflicting
                                  ? "border-warning/60 bg-warning-bg text-foreground hover:border-warning"
                                  : "border-border bg-surface-sunken text-foreground hover:bg-surface-hover hover:border-border-strong",
                            )}
                          >
                            {isRecording ? "Press keys…" : formatBinding(binding)}
                          </button>
                          {bindings.length > 1 && !isRecording ? (
                            <button
                              type="button"
                              onClick={() => removeBinding(action.id, index)}
                              aria-label={`Remove ${formatBinding(binding)} from ${action.label}`}
                              className="text-muted-foreground hover:text-danger focus-visible:ring-ring ml-0.5 cursor-pointer rounded p-0.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                            >
                              <X className="size-3" aria-hidden />
                            </button>
                          ) : null}
                        </span>
                      );
                    })}

                    {recording?.actionId === action.id &&
                    recording.index >= bindings.length ? (
                      <span className="border-primary bg-primary-subtle text-primary inline-flex h-7 animate-pulse items-center rounded border px-2 font-mono text-[11px] font-semibold">
                        Press keys…
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setRecording({ actionId: action.id, index: bindings.length })
                        }
                        aria-label={`Add another shortcut for ${action.label}`}
                        title="Add another shortcut"
                        className="text-muted-foreground hover:text-foreground hover:bg-surface-hover border-border focus-visible:ring-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-dashed transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </button>
                    )}

                    {isOverridden ? (
                      <button
                        type="button"
                        onClick={() => {
                          setBindings(action.id, action.defaultBindings);
                          setRecording(null);
                        }}
                        title={`Reset to ${action.defaultBindings.map(formatBinding).join(" or ")}`}
                        className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                        aria-label={`Reset ${action.label} to its default shortcut`}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="border-border text-muted-foreground flex items-start gap-2 rounded-md border border-dashed p-3 text-xs leading-relaxed">
        <Keyboard className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p>
            Click a shortcut, then press the keys you want. <Kbd binding="Escape" /> cancels
            without changing it.
          </p>
          <p>
            Some combinations are reserved by the browser itself (
            <Kbd binding="Mod+W" />, <Kbd binding="Mod+T" />) and never reach the page,
            so they cannot be bound here.
          </p>
        </div>
      </div>
    </div>
  );
}
