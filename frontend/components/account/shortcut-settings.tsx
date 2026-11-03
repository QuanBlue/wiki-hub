"use client";

import { AlertTriangle, Check, Info, Keyboard, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  SHORTCUT_ACTIONS,
  bindingsFor,
  eventToBinding,
  findConflicts,
  formatBinding,
  resetAllShortcuts,
  saveOverrides,
  useShortcutOverrides,
  type ShortcutAction,
  type ShortcutOverrides,
  type ShortcutScope,
} from "@/lib/keyboard-shortcuts";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** A recorded chord, or `null` for the "add a binding" slot. */
type RecordingTarget = { actionId: string; index: number } | null;

const GROUP_KEYS: Record<string, string> = {
  Navigation: "shortcuts.groupNavigation",
  Editing: "shortcuts.groupEditing",
  "Attachment previews": "shortcuts.groupAttachmentPreviews",
};

const SCOPE_KEYS: Record<string, string> = {
  global: "shortcuts.scopeGlobal",
  editor: "shortcuts.scopeEditor",
  preview: "shortcuts.scopePreview",
};

const ACTION_KEY_PARTS: Record<string, string> = {
  "search.open": "SearchOpen",
  "sidebar.toggle": "SidebarToggle",
  "page.copyLink": "PageCopyLink",
  "help.open": "HelpOpen",
  "page.edit": "PageEdit",
  "page.save": "PageSave",
  "page.reload": "PageReload",
  "attachment.find": "AttachmentFind",
  "video.playPause": "VideoPlayPause",
};

function actionLabelKey(action: ShortcutAction): string {
  const part = ACTION_KEY_PARTS[action.id] ?? action.id;
  return `shortcuts.action${part}Label`;
}

function actionDescriptionKey(action: ShortcutAction): string {
  const part = ACTION_KEY_PARTS[action.id] ?? action.id;
  return `shortcuts.action${part}Description`;
}

function isActionCustomised(action: ShortcutAction, currentBindings: string[]): boolean {
  if (currentBindings.length !== action.defaultBindings.length) return true;
  return currentBindings.some((binding, index) => binding !== action.defaultBindings[index]);
}

export function ShortcutSettings({ defaultEditing = false }: { defaultEditing?: boolean } = {}) {
  const overrides = useShortcutOverrides();
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(defaultEditing);
  const [draftOverrides, setDraftOverrides] = useState<ShortcutOverrides>(() => ({ ...overrides }));
  const [recording, setRecording] = useState<RecordingTarget>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraftOverrides({ ...overrides });
    }
  }, [overrides, isEditing]);

  const activeOverrides = isEditing ? draftOverrides : overrides;

  const conflicts = useMemo(() => findConflicts(activeOverrides), [activeOverrides]);

  const hasModFBinding = useMemo(() => {
    for (const action of SHORTCUT_ACTIONS) {
      // The preview-scoped "find in file" binding only claims Ctrl+F while a
      // preview is open, so it does not block the browser's find bar elsewhere.
      if (action.scope === "preview") continue;
      const bindings = bindingsFor(action.id, activeOverrides);
      if (bindings.includes("Mod+F")) return true;
    }
    return false;
  }, [activeOverrides]);

  const isCustomised = useMemo(() => {
    return SHORTCUT_ACTIONS.some((action) => {
      const bindings = bindingsFor(action.id, activeOverrides);
      return isActionCustomised(action, bindings);
    });
  }, [activeOverrides]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, ShortcutAction[]>();
    for (const action of SHORTCUT_ACTIONS) {
      const existing = byGroup.get(action.group);
      if (existing) existing.push(action);
      else byGroup.set(action.group, [action]);
    }
    return [...byGroup.entries()];
  }, []);

  const startEditing = useCallback(() => {
    setDraftOverrides({ ...overrides });
    setIsEditing(true);
    setRecording(null);
  }, [overrides]);

  const handleSave = useCallback(() => {
    saveOverrides(draftOverrides);
    setIsEditing(false);
    setRecording(null);
    toast.success(t("shortcuts.savedToast"));
  }, [draftOverrides, t]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setRecording(null);
    setDraftOverrides({ ...overrides });
  }, [overrides]);

  const handleResetAll = useCallback(() => {
    if (isEditing) {
      const resetDraft: ShortcutOverrides = {};
      for (const action of SHORTCUT_ACTIONS) {
        resetDraft[action.id] = [...action.defaultBindings];
      }
      setDraftOverrides(resetDraft);
      setRecording(null);
    } else {
      resetAllShortcuts();
      setRecording(null);
    }
  }, [isEditing]);

  const resetActionDraft = useCallback((action: ShortcutAction) => {
    setDraftOverrides((prev) => ({
      ...prev,
      [action.id]: [...action.defaultBindings],
    }));
    setRecording(null);
  }, []);

  // While recording, this listener owns the keyboard: it runs in the capture
  // phase and stops propagation so the very shortcut being rebound cannot fire
  // on its way through (pressing Mod+K here must not open quick search).
  useEffect(() => {
    if (!recording || !isEditing) return;

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

      const current = bindingsFor(recording.actionId, draftOverrides);
      const next = [...current];
      if (recording.index >= next.length) next.push(binding);
      else next[recording.index] = binding;

      // The same chord twice on one action is not a second way to trigger it.
      setDraftOverrides((prev) => ({
        ...prev,
        [recording.actionId]: [...new Set(next)],
      }));
      setRecording(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, isEditing, draftOverrides]);

  const removeBinding = useCallback(
    (actionId: string, index: number) => {
      const current = bindingsFor(actionId, draftOverrides);
      const next = current.filter((_, i) => i !== index);
      setDraftOverrides((prev) => ({
        ...prev,
        [actionId]: next,
      }));
    },
    [draftOverrides],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t("shortcuts.title")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {isEditing ? t("shortcuts.editingModeHint") : t("shortcuts.hint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isEditing ? (
            <>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSave}
                className="gap-1.5"
              >
                <Check className="size-3.5" aria-hidden />
                {t("shortcuts.saveChanges")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCancel}
                className="gap-1.5"
              >
                <X className="size-3.5" aria-hidden />
                {t("shortcuts.cancelEdit")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleResetAll}
                disabled={!isCustomised}
              >
                <RotateCcw aria-hidden />
                {t("shortcuts.resetAll")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={startEditing}
                className="gap-1.5"
              >
                <Pencil className="size-3.5" aria-hidden />
                {t("shortcuts.editShortcuts")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleResetAll}
                disabled={!isCustomised}
              >
                <RotateCcw aria-hidden />
                {t("shortcuts.resetAll")}
              </Button>
            </>
          )}
        </div>
      </div>

      {conflicts.size > 0 ? (
        <div className="border-warning/40 bg-warning-bg text-foreground flex items-start gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {conflicts.size === 1
              ? t("shortcuts.conflictOne")
              : t("shortcuts.conflictMany", { count: conflicts.size })}{" "}
            {t("shortcuts.conflictSuffix")}
          </p>
        </div>
      ) : null}

      {hasModFBinding ? (
        <div className="border-info/30 bg-info-bg text-foreground flex items-start gap-3 rounded-lg border p-3.5 text-sm shadow-xs">
          <div className="bg-info/15 text-info mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full">
            <Info className="size-3.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground text-sm">
                {t("shortcuts.browserFindNoticeTitle")}
              </span>
              <kbd className="bg-surface-sunken border-border text-foreground font-mono rounded border px-1.5 py-0.5 text-[11px] font-semibold shadow-2xs">
                Ctrl+F
              </kbd>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              <kbd className="border-border bg-surface-sunken text-foreground inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold shadow-2xs">
                Ctrl+F
              </kbd>{" "}
              {t("shortcuts.browserFindNoticeBody")}{" "}
              <span className="border-border bg-surface-sunken text-danger inline-flex size-4 items-center justify-center rounded-full border text-[10px] font-bold">
                ✕
              </span>{" "}
              {t("shortcuts.browserFindNoticeAction")}{" "}
              <kbd className="border-border bg-surface-sunken text-foreground inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold shadow-2xs">
                Ctrl+F
              </kbd>{" "}
              {t("shortcuts.browserFindNoticeRestore")}
            </p>
          </div>
        </div>
      ) : null}

      {groups.map(([group, actions]) => (
        <section key={group} className="space-y-2">
          <h3 className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
            {t(GROUP_KEYS[group] ?? group)}
          </h3>
          <ul className="border-border divide-border divide-y rounded-md border">
            {actions.map((action) => {
              const bindings = bindingsFor(action.id, activeOverrides);
              const isOverridden = isActionCustomised(action, bindings);

              return (
                <li
                  key={action.id}
                  className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 sm:pr-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-foreground text-sm font-medium">{t(actionLabelKey(action))}</p>
                      <span
                        title={t(SCOPE_KEYS[action.scope as ShortcutScope] ?? action.scope)}
                        className="text-muted-foreground/80 bg-surface-sunken border-border/60 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-tight"
                      >
                        {t(SCOPE_KEYS[action.scope as ShortcutScope] ?? action.scope)}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      {t(actionDescriptionKey(action))}
                    </p>
                  </div>

                  {isEditing ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2.5 pt-1">
                      {bindings.length === 0 && !(recording?.actionId === action.id) ? (
                        <span className="text-muted-foreground border-border/60 bg-surface-sunken inline-flex h-7 items-center rounded border border-dashed px-2 font-mono text-[11px] italic">
                          {t("shortcuts.unbound")}
                        </span>
                      ) : null}
                      {bindings.map((binding, index) => {
                        const isRecording =
                          recording?.actionId === action.id && recording.index === index;
                        const conflicting = conflicts.has(binding);
                        const label = t(actionLabelKey(action));

                        return (
                          <span key={`${binding}-${index}`} className="relative inline-flex items-center">
                            <button
                              type="button"
                              onClick={() =>
                                setRecording(
                                  isRecording ? null : { actionId: action.id, index },
                                )
                              }
                              aria-label={t("shortcuts.changeShortcutAria", { label })}
                              className={cn(
                                "focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center rounded border px-2.5 font-mono text-[11px] font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                                isRecording
                                  ? "border-primary bg-primary-subtle text-primary animate-pulse"
                                  : conflicting
                                    ? "border-warning/60 bg-warning-bg text-foreground hover:border-warning"
                                    : "border-border bg-surface-sunken text-foreground hover:bg-surface-hover hover:border-border-strong",
                              )}
                            >
                              {isRecording ? t("shortcuts.pressKeys") : formatBinding(binding)}
                            </button>
                            {!isRecording ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeBinding(action.id, index);
                                }}
                                aria-label={t("shortcuts.removeBindingAria", {
                                  binding: formatBinding(binding),
                                  label,
                                })}
                                title={t("shortcuts.removeBindingAria", {
                                  binding: formatBinding(binding),
                                  label,
                                })}
                                className="bg-background border-border text-muted-foreground hover:text-danger hover:border-danger/40 hover:bg-danger-subtle focus-visible:ring-ring absolute -top-1.5 -right-1.5 size-4 cursor-pointer rounded-full border shadow-xs flex items-center justify-center transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                              >
                                <X className="size-2.5 stroke-[2.5]" aria-hidden />
                              </button>
                            ) : null}
                          </span>
                        );
                      })}

                      {recording?.actionId === action.id &&
                      recording.index >= bindings.length ? (
                        <span className="border-primary bg-primary-subtle text-primary inline-flex h-7 animate-pulse items-center rounded border px-2 font-mono text-[11px] font-semibold">
                          {t("shortcuts.pressKeys")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setRecording({ actionId: action.id, index: bindings.length })
                          }
                          aria-label={t("shortcuts.addShortcutAria", {
                            label: t(actionLabelKey(action)),
                          })}
                          title={t("shortcuts.addShortcut")}
                          className="text-muted-foreground hover:text-foreground hover:bg-surface-hover border-border focus-visible:ring-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-dashed transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <Plus className="size-3.5" aria-hidden />
                        </button>
                      )}

                      {isOverridden ? (
                        <button
                          type="button"
                          onClick={() => resetActionDraft(action)}
                          title={t("shortcuts.resetTitle", {
                            bindings: action.defaultBindings.map(formatBinding).join(" or "),
                          })}
                          className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                          aria-label={t("shortcuts.resetAria", {
                            label: t(actionLabelKey(action)),
                          })}
                        >
                          <RotateCcw className="size-3.5" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {bindings.length === 0 ? (
                        <span className="text-muted-foreground border-border/60 bg-surface-sunken inline-flex h-7 items-center rounded border border-dashed px-2 font-mono text-[11px] italic">
                          {t("shortcuts.unbound")}
                        </span>
                      ) : (
                        bindings.map((binding, index) => (
                          <kbd
                            key={`${binding}-${index}`}
                            className="border-border bg-surface-sunken text-foreground inline-flex h-7 items-center rounded border px-2.5 font-mono text-[11px] font-semibold select-none shadow-2xs"
                          >
                            {formatBinding(binding)}
                          </kbd>
                        ))
                      )}
                    </div>
                  )}
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
            {t("shortcuts.recordHint", { esc: formatBinding("Escape") })}
          </p>
          <p>
            {t("shortcuts.browserReserved", {
              modW: formatBinding("Mod+W"),
              modT: formatBinding("Mod+T"),
            })}
          </p>
          <p>
            {t("shortcuts.browserFindTip", {
              modF: formatBinding("Mod+F"),
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
