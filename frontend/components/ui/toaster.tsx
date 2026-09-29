"use client";

import {
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  toast as sonnerToast,
  useSonner,
  type Action,
  type ToastT,
} from "sonner";

import { richText } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

/**
 * WikiHub's notification host. Call sites keep using sonner's `toast()` (it is
 * only the store and API); this component replaces sonner's own <Toaster> so
 * the layout and timers can behave the way the product wants:
 *
 * - At rest the toasts sit in a compact stack: the newest in full, the older
 *   ones peeking out behind it.
 * - Hovering (or focusing) the stack lays every toast out in one vertical
 *   column, none overlapping, so each can be read in full.
 * - Each toast owns its countdown. Hovering a toast pauses that toast alone;
 *   leaving it lets its remaining time run on. The bar under the text is the
 *   same clock, so it stops and resumes with it.
 *
 * Styling lives in globals.css ("Toasts").
 */

const DEFAULT_DURATION = 10_000;
/** Matches the leaving transition in globals.css. */
const LEAVE_MS = 200;
/** Vertical gap between toasts in the expanded column. */
const GAP = 12;
/** How far each older toast peeks out above the one in front while stacked. */
const PEEK_STEP = 10;
/** How many older toasts show as a sliver behind the newest while collapsed. */
const PEEK_LAYERS = 3;

const ICONS = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
  loading: LoaderCircle,
} as const;

function resolve(node: ToastT["title"]) {
  const value = typeof node === "function" ? node() : node;
  // A call site that already built its own JSX (e.g. by calling `richText`
  // itself for an action/link-bearing toast) is left alone; a plain string -
  // the common case, `toast.success("...")` - is run through the same
  // `**bold**`/`` `code` ``/`*italic*` parser so **/`` `` `` `/* markers work
  // the same way everywhere, without every call site having to remember to
  // wrap its own message in `richText()`.
  return typeof value === "string" ? richText(value) : value;
}

function isAction(node: unknown): node is Action {
  return (
    typeof node === "object" &&
    node !== null &&
    !isValidElement(node) &&
    "label" in node &&
    "onClick" in node
  );
}

function ToastItem({
  t,
  index,
  expanded,
  offset,
  height,
  frontHeight,
  onHeight,
}: {
  t: ToastT;
  index: number;
  expanded: boolean;
  /** Distance from the bottom of the column, used when expanded. */
  offset: number;
  /** This toast's own natural height (0 until measured). */
  height: number;
  frontHeight: number;
  onHeight: (id: ToastT["id"], height: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(
    typeof document !== "undefined" && document.hidden,
  );
  const [leaving, setLeaving] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  const type = t.type ?? "default";
  const duration =
    type === "loading" ? Infinity : (t.duration ?? DEFAULT_DURATION);
  const timed = Number.isFinite(duration) && duration > 0;
  const paused = hovered || focused || hidden;
  // Anything that changes what the toast says starts its clock over.
  const cycleKey = `${type}|${duration}`;

  const remaining = useRef(duration);
  const lastCycle = useRef(cycleKey);
  const startedAt = useRef(0);
  const [cycle, setCycle] = useState(0);

  const close = useCallback(
    (reason: "auto" | "dismiss") => {
      if (reason === "auto") t.onAutoClose?.(t);
      else t.onDismiss?.(t);
      setLeaving(true);
    },
    [t],
  );

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => sonnerToast.dismiss(t.id), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, t.id]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (lastCycle.current !== cycleKey) {
      lastCycle.current = cycleKey;
      remaining.current = duration;
      setCycle((c) => c + 1);
    }
    if (!timed || paused || leaving) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => close("auto"), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [cycleKey, duration, timed, paused, leaving, close]);

  // Every toast reports its natural height so the column can be laid out (and
  // animated to) without measuring the DOM mid-transition.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const report = () => onHeight(t.id, el.offsetHeight + 2);
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [t.id, onHeight]);

  const Icon = type in ICONS ? ICONS[type as keyof typeof ICONS] : null;
  const title = resolve(t.title);
  const description = resolve(t.description);
  const dismissible = t.dismissible !== false;

  return (
    <li
      className={cn("wh-toast", t.className)}
      style={
        {
          ...t.style,
          "--i": index,
          // Where it sits: lifted a sliver per layer while stacked, or at its
          // slot in the column when expanded. Both animate via transform.
          "--y": `${expanded ? offset : Math.min(index, PEEK_LAYERS) * PEEK_STEP}px`,
          "--s": expanded ? 1 : 1 - Math.min(index, PEEK_LAYERS) * 0.05,
          // Stacked toasts behind the front one are clipped to its height.
          "--h": height
            ? `${expanded || index === 0 ? height : frontHeight}px`
            : "auto",
          "--toast-duration": `${duration}ms`,
        } as React.CSSProperties
      }
      data-type={type}
      data-front={index === 0}
      data-expanded={expanded}
      data-leaving={leaving}
      data-paused={paused}
      data-hidden={index > PEEK_LAYERS && !expanded}
      role={type === "error" ? "alert" : "status"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <div className="wh-toast-inner" ref={innerRef}>
        {t.jsx ? (
          <div className="wh-toast-body">{t.jsx}</div>
        ) : (
          <>
            {(t.icon || Icon) && (
              <span
                className="wh-toast-icon"
                data-spin={type === "loading" || undefined}
                aria-hidden="true"
              >
                {t.icon ?? (Icon && <Icon size={18} />)}
              </span>
            )}
            <div className="wh-toast-content">
              {title && <div className="wh-toast-title">{title}</div>}
              {description && (
                <div className="wh-toast-description">{description}</div>
              )}
            </div>
            {isAction(t.cancel) && (
              <button
                type="button"
                className="wh-toast-button"
                data-variant="cancel"
                onClick={(event) => {
                  t.cancel && isAction(t.cancel) && t.cancel.onClick(event);
                  if (!event.defaultPrevented) close("dismiss");
                }}
              >
                {t.cancel.label}
              </button>
            )}
            {isAction(t.action) ? (
              <button
                type="button"
                className="wh-toast-button"
                onClick={(event) => {
                  isAction(t.action) && t.action.onClick(event);
                  if (!event.defaultPrevented) close("dismiss");
                }}
              >
                {t.action.label}
              </button>
            ) : (
              (t.action as React.ReactNode)
            )}
          </>
        )}
      </div>
      {dismissible && (
        <button
          type="button"
          className="wh-toast-close"
          aria-label="Close"
          onClick={() => close("dismiss")}
        >
          <X size={12} />
        </button>
      )}
      {timed && !leaving && (
        <span
          key={cycle}
          className="wh-toast-bar"
          aria-hidden="true"
          style={{ animationPlayState: paused ? "paused" : "running" }}
        />
      )}
    </li>
  );
}

export function Toaster() {
  const { toasts } = useSonner();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const regionRef = useRef<HTMLElement>(null);
  const expanded = hovered || focused;

  const onHeight = useCallback((id: ToastT["id"], height: number) => {
    setHeights((prev) =>
      prev[id] === height ? prev : { ...prev, [id]: height },
    );
  }, []);

  // Opening the column on a long list starts at the newest, at the bottom.
  useEffect(() => {
    const el = regionRef.current;
    if (expanded && el) el.scrollTop = el.scrollHeight;
  }, [expanded]);

  if (toasts.length === 0) return null;

  // Newest first: index 0 is the front of the stack and the bottom of the column.
  const ordered = [...toasts].reverse();
  const heightOf = (t: ToastT) => heights[t.id] ?? 0;
  const frontHeight = heightOf(ordered[0]);
  let running = 0;
  const offsets = ordered.map((t) => {
    const offset = running;
    running += heightOf(t) + GAP;
    return offset;
  });
  const columnHeight = Math.max(running - GAP, 0);

  return (
    <section
      aria-label="Notifications"
      ref={regionRef}
      className="wh-toaster"
      data-expanded={expanded}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <ol
        className="wh-toaster-list"
        style={{ height: expanded ? columnHeight : frontHeight || undefined }}
      >
        {ordered.map((t, index) => (
          <ToastItem
            key={t.id}
            t={t}
            index={index}
            expanded={expanded}
            offset={offsets[index]}
            height={heightOf(t)}
            frontHeight={frontHeight}
            onHeight={onHeight}
          />
        ))}
      </ol>
    </section>
  );
}
