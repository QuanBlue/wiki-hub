"use client";

import { MoreHorizontal } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type RowAction =
  | { separator: true }
  | {
      label: string;
      icon: ReactNode;
      onSelect: () => void;
      disabled?: boolean;
      destructive?: boolean;
      title?: string;
    };

export function RowActionsMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function reposition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    reposition();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        menuRef.current
          ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
          ?.focus();
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "text-muted-foreground hover:text-foreground cursor-pointer rounded-md p-1.5",
          "transition-colors duration-150 hover:bg-surface-selected active:bg-surface-selected",
          "data-[state=open]:bg-surface-selected data-[state=open]:text-foreground",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        )}
        data-state={open ? "open" : "closed"}
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ top: position.top, right: position.right }}
              className="border-border bg-surface text-foreground fixed z-50 min-w-56 overflow-hidden rounded-lg border p-1 shadow-lg"
            >
              {actions.map((action, index) =>
                "separator" in action ? (
                  <div key={`separator-${index}`} role="separator" className="bg-border -mx-1 my-1 h-px" />
                ) : (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    disabled={action.disabled}
                    title={action.title}
                    onClick={() => {
                      if (action.disabled) return;
                      setOpen(false);
                      action.onSelect();
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none",
                      "transition-colors duration-150 hover:bg-surface-hover focus-visible:bg-surface-hover",
                      "disabled:pointer-events-none disabled:opacity-40",
                      action.destructive ? "text-danger hover:bg-danger-bg" : "text-foreground",
                    )}
                  >
                    {action.icon}
                    {action.label}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
