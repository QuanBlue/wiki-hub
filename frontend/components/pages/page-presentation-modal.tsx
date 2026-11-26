"use client";

import {
  ArrowLeft,
  Bold,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eraser,
  Eye,
  FileDown,
  Grid2X2,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Monitor,
  Palette,
  Pause,
  PencilLine,
  PenTool,
  Play,
  Presentation,
  Printer,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Strikethrough,
  Underline,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { AiNotSetUp } from "@/components/pages/ai-not-set-up";
import {
  PresenterViewHeader,
  PresenterViewRightPanel,
} from "@/components/pages/presenter-dual-view";
import {
  SAMPLE_PREVIEW_SLIDE_COUNT,
  SAMPLE_PREVIEW_TABS,
  ThemeSampleSlideContent,
} from "@/components/pages/theme-sample-slides";
import { Button } from "@/components/ui/button";
import { aiStatus, resetAiStatus, type AiStatus } from "@/lib/ai-summary";
import { ApiError } from "@/lib/api-client";
import { apiBaseUrl } from "@/lib/env";
import {
  FRONTEND_SLIDE_THEMES,
  generatePresenterPopupHtml,
  generateStandaloneFrontendSlidesHtml,
  getSavedSlideThemeId,
  getSlideThemeById,
  saveSlideThemeId,
  type FrontendSlideTheme,
  type FrontendSlideThemeCategory,
  type FrontendSlideThemeId,
} from "@/lib/frontend-slides-themes";
import { useTranslation } from "@/lib/i18n/context";
import {
  buildSlidesFromAiDeck,
  buildSlidesFromPage,
  fetchAiSlideDeck,
  type AiPageSlideDeckResponse,
  type PresentationSlide,
  type SlideGranularity,
  type SlideLanguage,
  type SlideVisualBlock,
} from "@/lib/page-presentation";
import { cn } from "@/lib/utils";

const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;

type PrefixedFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};
type PrefixedFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

function currentFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const doc = document as PrefixedFullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

type PenColorKey = "primary" | "warning" | "danger";

const PEN_COLORS: { key: PenColorKey; hex: string; labelKey: string }[] = [
  { key: "primary", hex: "#38bdf8", labelKey: "present.penBlue" },
  { key: "warning", hex: "#facc15", labelKey: "present.penAmber" },
  { key: "danger", hex: "#f43f5e", labelKey: "present.penRed" },
];

function buildPenCursorUrl(hex: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M18.2 2.8a2.1 2.1 0 0 1 3 3L8.4 18.6 3 21l2.4-5.4L18.2 2.8Z" fill="#ffffff" stroke="#1e293b" stroke-width="1.6" stroke-linejoin="round"/><path d="M5.4 15.6 8.4 18.6 3 21Z" fill="${hex}" stroke="#1e293b" stroke-width="1.3" stroke-linejoin="round"/><path d="M15.6 5.4 18.6 8.4" stroke="#1e293b" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 21, crosshair`;
}

function buildEraserCursorUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="m7.2 20.5-3.9-3.9a1.8 1.8 0 0 1 0-2.5l9.4-9.4a1.8 1.8 0 0 1 2.5 0l5.1 5.1a1.8 1.8 0 0 1 0 2.5L12.1 20.5H7.2Z" fill="#ffffff" stroke="#1e293b" stroke-width="1.6" stroke-linejoin="round"/><path d="m7.5 10 6.5 6.5" stroke="#1e293b" stroke-width="1.5"/><path d="M12.1 20.5H20" stroke="#1e293b" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 6 20, crosshair`;
}

interface StrokeHistory {
  past: DrawStroke[][];
  present: DrawStroke[];
  future: DrawStroke[][];
}

const EMPTY_STROKE_HISTORY: StrokeHistory = {
  past: [],
  present: [],
  future: [],
};

/**
 * Lightweight rich-text Speaker Notes editor supporting Bold, Italic, Underline,
 * Strikethrough, Bullet List, and Numbered List with native selection preservation.
 */
function SpeakerNotesRichEditor({
  slideId,
  value,
  placeholder,
  onChange,
}: {
  slideId: string;
  value: string;
  placeholder: string;
  onChange: (html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastSlideIdRef = useRef<string | null>(null);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    // Sync DOM only when switching slides or hydrating initial saved value
    if (lastSlideIdRef.current !== slideId || (el.innerHTML === "" && value)) {
      lastSlideIdRef.current = slideId;
      el.innerHTML = value;
    }
  }, [slideId, value]);

  const execFormat = (cmd: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      document.execCommand(cmd, false);
    } catch {
      // ignore unsupported command
    }
    const text = (el.textContent ?? "").trim();
    onChange(text ? el.innerHTML : "");
  };

  const isEmpty = !value.replace(/<[^>]*>/g, "").trim();

  const buttons = [
    { cmd: "bold", icon: Bold, label: "Bold (Ctrl+B)" },
    { cmd: "italic", icon: Italic, label: "Italic (Ctrl+I)" },
    { cmd: "underline", icon: Underline, label: "Underline (Ctrl+U)" },
    { cmd: "strikeThrough", icon: Strikethrough, label: "Strikethrough" },
  ] as const;

  const listButtons = [
    { cmd: "insertUnorderedList", icon: List, label: "Bullet list" },
    { cmd: "insertOrderedList", icon: ListOrdered, label: "Numbered list" },
  ] as const;

  return (
    <div className="border-border bg-surface-sunken focus-within:border-primary focus-within:ring-ring/30 mt-3 overflow-hidden rounded-lg border focus-within:ring-2">
      {/* Compact Formatting Toolbar */}
      <div className="border-border bg-surface/80 flex items-center gap-0.5 border-b px-1.5 py-1">
        {buttons.map((btn) => {
          const Icon = btn.icon;
          return (
            <button
              key={btn.cmd}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execFormat(btn.cmd);
              }}
              title={btn.label}
              aria-label={btn.label}
              className="text-muted-foreground hover:bg-surface-hover hover:text-foreground inline-flex size-6.5 cursor-pointer items-center justify-center rounded transition-colors duration-150"
            >
              <Icon className="size-3.5" />
            </button>
          );
        })}
        <span aria-hidden className="bg-border mx-1 h-4 w-px" />
        {listButtons.map((btn) => {
          const Icon = btn.icon;
          return (
            <button
              key={btn.cmd}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execFormat(btn.cmd);
              }}
              title={btn.label}
              aria-label={btn.label}
              className="text-muted-foreground hover:bg-surface-hover hover:text-foreground inline-flex size-6.5 cursor-pointer items-center justify-center rounded transition-colors duration-150"
            >
              <Icon className="size-3.5" />
            </button>
          );
        })}
      </div>

      {/* Rich ContentEditable Area */}
      <div className="relative">
        {isEmpty ? (
          <div className="text-muted-foreground pointer-events-none absolute top-3 left-3 text-xs">
            {placeholder}
          </div>
        ) : null}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          onKeyDown={(e) => {
            if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey) return;
            const sel = window.getSelection();
            if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            const node = range.startContainer;
            if (node.nodeType !== 3) return;
            const parentEl = node.parentElement;
            if (parentEl?.closest("li")) return;

            const textBefore = (node.textContent ?? "").slice(
              0,
              range.startOffset,
            );
            const isBullet = textBefore === "-" || textBefore === "*";
            const isOrdered = /^\d+\.$/.test(textBefore);
            if (!isBullet && !isOrdered) return;

            e.preventDefault();
            const deleteRange = document.createRange();
            deleteRange.setStart(node, 0);
            deleteRange.setEnd(node, range.startOffset);
            deleteRange.deleteContents();

            try {
              document.execCommand(
                isOrdered ? "insertOrderedList" : "insertUnorderedList",
                false,
              );
            } catch {
              // ignore unsupported command
            }
            const el = editorRef.current;
            if (el) {
              const text = (el.textContent ?? "").trim();
              onChange(text ? el.innerHTML : "");
            }
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            const text = (el.textContent ?? "").trim();
            onChange(text ? el.innerHTML : "");
          }}
          className="text-foreground min-h-[150px] max-h-[320px] overflow-y-auto p-3 text-xs leading-relaxed outline-none [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5"
        />
      </div>
    </div>
  );
}

function strokeHitsPoint(
  stroke: DrawStroke,
  pt: { x: number; y: number },
  radius: number,
): boolean {
  const r2 = radius * radius;
  const pts = stroke.points;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const dx = pt.x - a.x;
    const dy = pt.y - a.y;
    if (dx * dx + dy * dy <= r2) return true;
    if (i > 0) {
      const b = pts[i - 1]!;
      const vx = a.x - b.x;
      const vy = a.y - b.y;
      const len2 = vx * vx + vy * vy;
      if (len2 > 0) {
        const t = Math.max(
          0,
          Math.min(1, ((pt.x - b.x) * vx + (pt.y - b.y) * vy) / len2),
        );
        const px = b.x + t * vx;
        const py = b.y + t * vy;
        const ddx = pt.x - px;
        const ddy = pt.y - py;
        if (ddx * ddx + ddy * ddy <= r2) return true;
      }
    }
  }
  return false;
}

interface DrawStroke {
  color: string;
  points: { x: number; y: number }[];
}

interface LaserPoint {
  x: number;
  y: number;
  t: number;
}

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

type SlideMotionStyle = "auto" | "glide" | "cinematic" | "minimal";

const MOTION_STORAGE_KEY = "wikihub.present.motionStyle";

const MOTION_OPTIONS: readonly {
  id: SlideMotionStyle;
  labelKey:
    | "present.motionAuto"
    | "present.motionGlide"
    | "present.motionCinematic"
    | "present.motionMinimal";
}[] = [
  { id: "auto", labelKey: "present.motionAuto" },
  { id: "glide", labelKey: "present.motionGlide" },
  { id: "cinematic", labelKey: "present.motionCinematic" },
  { id: "minimal", labelKey: "present.motionMinimal" },
] as const;

function getSavedMotionStyle(): SlideMotionStyle {
  if (typeof window === "undefined") return "auto";
  const raw = window.localStorage.getItem(MOTION_STORAGE_KEY);
  if (
    raw === "auto" ||
    raw === "cinematic" ||
    raw === "glide" ||
    raw === "minimal"
  ) {
    return raw;
  }
  return "auto";
}

function saveMotionStyle(style: SlideMotionStyle): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOTION_STORAGE_KEY, style);
  } catch {
    // ignore storage errors
  }
}

function resolveSlideMotionClass(
  style: SlideMotionStyle,
  _layout: PresentationSlide["layout"],
  _slideIndex: number,
  direction: 1 | -1,
): string {
  if (style === "minimal") return "wh-motion-minimal";
  if (style === "cinematic") return "wh-motion-cinematic";
  if (style === "glide") {
    return direction >= 0 ? "wh-motion-glide-fwd" : "wh-motion-glide-bwd";
  }
  // Auto (Subtle Default): one calm, cohesive entrance across every slide
  return "wh-motion-subtle";
}

/**
 * Safety net for text/list slide bodies: if an indivisible block is still
 * slightly taller than the 1920x1080 content zone, gently scales it down so
 * slides NEVER show a scrollbar.
 */
function AutoFitSlideBody({
  maxHeight,
  className,
  children,
}: {
  maxHeight: number;
  className?: string;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const recompute = () => {
      const natH = inner.scrollHeight;
      if (natH <= 0) return;
      const nextScale =
        natH > maxHeight ? Math.max(0.68, maxHeight / natH) : 1;
      setScale((prev) => (Math.abs(prev - nextScale) < 0.01 ? prev : nextScale));
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [maxHeight, children]);

  return (
    <div
      ref={outerRef}
      className={cn("relative w-full overflow-hidden", className)}
      style={{ maxHeight: `${maxHeight}px` }}
    >
      <div
        ref={innerRef}
        style={{
          transform: scale < 0.995 ? `scale(${scale})` : undefined,
          transformOrigin: "top left",
          width: scale < 0.995 ? `${100 / scale}%` : "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Scales an oversized table or code block down smoothly to fit the available
 * 1920x1080 slide box without EVER introducing ugly scrollbars.
 */
function AutoFitSlideBlock({
  html,
  maxHeight,
  className,
  style,
  editable = false,
  onBlurHtml,
}: {
  html: string;
  maxHeight: number;
  className?: string;
  style?: CSSProperties;
  editable?: boolean;
  onBlurHtml?: (nextHtml: string) => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; height: number | null }>({
    scale: 1,
    height: null,
  });

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const recompute = () => {
      const availW = outer.clientWidth;
      if (availW <= 0) return;
      const natW = Math.max(inner.scrollWidth, inner.offsetWidth);
      const natH = Math.max(inner.scrollHeight, inner.offsetHeight);
      if (natW <= 0 || natH <= 0) return;

      const scaleW = availW / natW;
      const scaleH = maxHeight / natH;
      const nextScale = Math.max(0.45, Math.min(1, scaleW, scaleH));
      const nextHeight = nextScale < 0.995 ? Math.ceil(natH * nextScale) : null;
      setFit((prev) =>
        Math.abs(prev.scale - nextScale) < 0.01 && prev.height === nextHeight
          ? prev
          : { scale: nextScale, height: nextHeight },
      );
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [html, maxHeight]);

  return (
    <div
      ref={outerRef}
      className="relative w-full overflow-hidden"
      style={{
        height: fit.height != null ? `${fit.height}px` : undefined,
        maxHeight: `${maxHeight}px`,
      }}
    >
      <div
        ref={innerRef}
        contentEditable={editable}
        suppressContentEditableWarning
        onBlur={
          editable && onBlurHtml
            ? (e) => onBlurHtml(e.currentTarget.innerHTML)
            : undefined
        }
        className={cn(
          className,
          editable &&
            "select-text cursor-text outline-none ring-2 ring-inset ring-dashed ring-[var(--fs-accent)]",
        )}
        style={{
          ...style,
          transform: fit.scale < 0.995 ? `scale(${fit.scale})` : undefined,
          transformOrigin: "top left",
          width: fit.scale < 0.995 ? `${100 / fit.scale}%` : "100%",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/**
 * Signature decorative motifs per `zarazhangrui/frontend-slides` STYLE_PRESETS.md.
 * Pure CSS & SVG abstract shapes only — zero external image dependencies.
 */
function ThemeSignatureDecoration({
  theme,
  slideIndex,
  totalSlides,
}: {
  theme: FrontendSlideTheme;
  slideIndex: number;
  totalSlides: number;
}) {
  switch (theme.id) {
    case "notebook-tabs": {
      const tabColors = ["#98d4bb", "#c7b8ea", "#f4b8c5", "#a8d8ea", "#ffe6a7"];
      return (
        <>
          {/* Left binder holes */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 left-7 flex flex-col justify-evenly py-20"
          >
            {Array.from({ length: 7 }).map((_, i) => (
              <span
                key={i}
                className="size-7 rounded-full border-2 shadow-inner"
                style={{
                  backgroundColor: "#2d2d2d",
                  borderColor: "rgba(0,0,0,0.22)",
                }}
              />
            ))}
          </div>
          {/* Right colorful vertical tabs */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-16 right-0 bottom-16 flex flex-col justify-center gap-3"
          >
            {tabColors.map((color, i) => {
              const active = slideIndex % tabColors.length === i;
              return (
                <div
                  key={i}
                  className="flex items-center justify-center rounded-l-xl border border-r-0 shadow-sm transition-transform"
                  style={{
                    backgroundColor: color,
                    borderColor: "rgba(26,26,26,0.16)",
                    width: active ? "36px" : "24px",
                    height: "136px",
                  }}
                >
                  <span
                    style={{
                      writingMode: "vertical-rl",
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#1a1a1a",
                      letterSpacing: "0.08em",
                    }}
                  >
                    0{i + 1}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      );
    }

    case "pastel-geometry": {
      const pills = [
        { color: "#f0b4d4", h: 90 },
        { color: "#a8d4c4", h: 140 },
        { color: "#5a7c6a", h: 200 },
        { color: "#9b8dc4", h: 140 },
        { color: "#7c6aad", h: 90 },
      ];
      return (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 right-7 bottom-0 flex flex-col items-center justify-center gap-4"
        >
          {pills.map((pill, i) => (
            <span
              key={i}
              className="w-5 rounded-full shadow-xs"
              style={{
                backgroundColor: pill.color,
                height: `${pill.h}px`,
                opacity: slideIndex % pills.length === i ? 1 : 0.72,
              }}
            />
          ))}
        </div>
      );
    }

    case "dark-botanical":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-32 -right-24 size-[540px] rounded-full blur-[90px]"
            style={{ background: "radial-gradient(circle, rgba(212,165,116,0.26) 0%, transparent 70%)" }}
          />
          <div
            className="absolute -bottom-36 -left-24 size-[500px] rounded-full blur-[90px]"
            style={{ background: "radial-gradient(circle, rgba(232,180,184,0.2) 0%, transparent 70%)" }}
          />
          <div
            className="absolute top-20 bottom-20 left-16 w-px"
            style={{ backgroundColor: "rgba(212, 165, 116, 0.28)" }}
          />
        </div>
      );

    case "neon-cyber":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(rgba(0, 255, 204, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 204, 0.05) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
          <div
            className="absolute -top-40 right-20 size-[520px] rounded-full blur-[110px]"
            style={{ background: "radial-gradient(circle, rgba(0,255,204,0.22) 0%, transparent 70%)" }}
          />
          <div
            className="absolute -bottom-40 left-20 size-[480px] rounded-full blur-[110px]"
            style={{ background: "radial-gradient(circle, rgba(255,0,170,0.18) 0%, transparent 70%)" }}
          />
          {/* Corner HUD brackets */}
          <div className="absolute top-8 left-8 size-8 border-t-2 border-l-2" style={{ borderColor: "#00ffcc" }} />
          <div className="absolute top-8 right-8 size-8 border-t-2 border-r-2" style={{ borderColor: "#00ffcc" }} />
          <div className="absolute bottom-8 left-8 size-8 border-b-2 border-l-2" style={{ borderColor: "#ff00aa" }} />
          <div className="absolute bottom-8 right-8 size-8 border-b-2 border-r-2" style={{ borderColor: "#ff00aa" }} />
        </div>
      );

    case "terminal-green":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Scanlines */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(57, 211, 83, 0.03) 0px, rgba(57, 211, 83, 0.03) 1px, transparent 1px, transparent 4px)",
            }}
          />
          {/* Terminal top chrome bar */}
          <div
            className="absolute top-0 right-0 left-0 flex h-11 items-center justify-between border-b px-8"
            style={{
              backgroundColor: "#161b22",
              borderColor: "rgba(57, 211, 83, 0.25)",
              fontFamily: theme.fontMono,
              fontSize: "15px",
              color: "#8b949e",
            }}
          >
            <div className="flex items-center gap-2.5">
              <span className="size-3.5 rounded-full bg-[#ff5f56]" />
              <span className="size-3.5 rounded-full bg-[#ffbd2e]" />
              <span className="size-3.5 rounded-full bg-[#27c93f]" />
              <span className="ml-3 text-[#39d353]">wikihub@deck:~ $</span>
              <span>./present --slide {slideIndex + 1}/{totalSlides}</span>
            </div>
            <span>1920×1080 TTY</span>
          </div>
        </div>
      );

    case "swiss-modern":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Bauhaus structural grid lines */}
          <div className="absolute top-0 bottom-0 left-[104px] w-[2px] bg-[#0a0a0a]/12" />
          <div className="absolute top-[168px] right-0 left-0 h-[2px] bg-[#0a0a0a]/12" />
          <div className="absolute top-0 right-[104px] h-[168px] w-[168px] bg-[#ff3300]" />
        </div>
      );

    case "electric-studio":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Vertical electric accent bar on left edge */}
          <div className="absolute top-0 bottom-0 left-0 w-4 bg-[#4361ee]" />
          <div
            className="absolute -right-24 -bottom-24 size-[520px] rounded-full blur-[110px]"
            style={{ background: "radial-gradient(circle, rgba(67,97,238,0.28) 0%, transparent 70%)" }}
          />
        </div>
      );

    case "creative-voltage":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Halftone radial dot pattern in top-right */}
          <div
            className="absolute top-0 right-0 h-[420px] w-[520px] opacity-25"
            style={{
              backgroundImage: "radial-gradient(#d4ff00 2.5px, transparent 2.5px)",
              backgroundSize: "22px 22px",
            }}
          />
          <div className="absolute top-0 bottom-0 left-0 w-3 bg-[#d4ff00]" />
        </div>
      );

    case "vintage-editorial":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Geometric circle outline + line + dot */}
          <div
            className="absolute top-14 right-20 size-36 rounded-full border-2"
            style={{ borderColor: "#1a1a1a", opacity: 0.22 }}
          />
          <div
            className="absolute top-32 right-12 h-0.5 w-44"
            style={{ backgroundColor: "#1a1a1a", opacity: 0.25 }}
          />
          <div
            className="absolute top-[122px] right-56 size-4 rounded-full"
            style={{ backgroundColor: "#8c4a27" }}
          />
        </div>
      );

    case "paper-ink":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Double editorial frame rule */}
          <div
            className="absolute inset-8 border"
            style={{ borderColor: "rgba(26, 26, 26, 0.16)" }}
          />
          <div
            className="absolute top-8 right-24 left-24 h-1"
            style={{ backgroundColor: "#c41e3a" }}
          />
        </div>
      );

    case "split-pastel":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Subtle grid overlay on the right lavender panel */}
          <div
            className="absolute top-0 right-0 bottom-0 w-[42%]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(107, 76, 154, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(107, 76, 154, 0.08) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />
        </div>
      );

    case "bold-signal":
    default:
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Bold Signal signature accent bar & ambient glow */}
          <div
            className="absolute top-0 right-0 h-3 w-full"
            style={{ backgroundColor: theme.accent }}
          />
          <div
            className="absolute -right-32 -bottom-32 size-[560px] rounded-full blur-[120px]"
            style={{
              background: `radial-gradient(circle, ${theme.accent}33 0%, transparent 70%)`,
            }}
          />
        </div>
      );
  }
}

function SlideMermaidDiagram({
  code,
  theme,
  onSpotlight,
}: {
  code: string;
  theme: FrontendSlideTheme;
  onSpotlight?: (svgHtml: string) => void;
}) {
  const { t } = useTranslation();
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [svgHtml, setSvgHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function render() {
      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme.isDark ? "dark" : "default",
          fontFamily: theme.fontBody,
        });
        const renderId = `wh-slide-mmd-${reactId}-${Date.now()}`;
        const { svg } = await mermaid.render(renderId, code);
        if (active) {
          setSvgHtml(svg);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Diagram error");
        }
      }
    }
    void render();
    return () => {
      active = false;
    };
  }, [code, theme.isDark, theme.fontBody, reactId]);

  if (error) {
    return (
      <pre
        className="overflow-auto rounded-2xl border p-6 font-mono text-lg"
        style={{
          backgroundColor: theme.codeBg,
          color: theme.codeFg,
          borderColor: theme.borderColor,
        }}
      >
        {code}
      </pre>
    );
  }

  if (!svgHtml) {
    return (
      <div
        className="flex h-64 items-center justify-center rounded-2xl border text-xl"
        style={{
          backgroundColor: theme.slideSurface,
          color: theme.textSecondary,
          borderColor: theme.borderColor,
        }}
      >
        <Loader2 className="mr-3 size-6 animate-spin" />
        {t("present.renderingDiagram")}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSpotlight?.(svgHtml)}
      title={t("present.clickToSpotlight")}
      className="group relative flex w-full cursor-zoom-in flex-col items-center justify-center overflow-hidden rounded-2xl border-2 p-6 transition-colors duration-150 focus-visible:outline-none"
      style={{
        backgroundColor: theme.slideSurface,
        borderColor: theme.borderColor,
      }}
    >
      <div
        className="flex max-h-[520px] w-full items-center justify-center overflow-hidden [&_svg]:max-h-[500px] [&_svg]:w-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />
      <span
        className="absolute right-4 bottom-4 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-base font-semibold opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100"
        style={{
          backgroundColor: theme.codeBg,
          color: theme.accent,
          borderColor: theme.borderColor,
        }}
      >
        <ZoomIn className="size-4" />
        {t("present.spotlightZoom")}
      </span>
    </button>
  );
}

export interface PagePresentationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: string;
  contentFormat?: "html" | "markdown" | string;
  spaceName: string;
  spaceKey: string;
  pageSlug?: string | null;
  author?: string | null;
  updatedBy?: string | null;
  updatedAtFormatted?: string | null;
  labels?: string[];
  allowAiDeck?: boolean;
}

export function PagePresentationModal({
  open,
  onOpenChange,
  title,
  content,
  contentFormat = "html",
  spaceName,
  spaceKey,
  pageSlug,
  author,
  updatedBy,
  updatedAtFormatted,
  labels = [],
  allowAiDeck = true,
}: PagePresentationModalProps) {
  const { t, locale } = useTranslation();
  const stageRootRef = useRef<HTMLDivElement>(null);
  const viewportBoxRef = useRef<HTMLDivElement>(null);
  const fixedStageRef = useRef<HTMLDivElement>(null);
  const previewModalStageRef = useRef<HTMLDivElement>(null);

  const [granularity, setGranularity] = useState<SlideGranularity>("standard");
  const [themeId, setThemeId] = useState<FrontendSlideThemeId>(() =>
    getSavedSlideThemeId(),
  );
  const [themeGalleryOpen, setThemeGalleryOpen] = useState(false);
  const [previewThemeId, setPreviewThemeId] =
    useState<FrontendSlideThemeId | null>(null);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [themeCategoryFilter, setThemeCategoryFilter] = useState<
    "all" | FrontendSlideThemeCategory
  >("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [slideShowMenuOpen, setSlideShowMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [presenterViewOpen, setPresenterViewOpen] = useState(false);
  const [needsFsPrompt, setNeedsFsPrompt] = useState(false);
  const [audienceConnected, setAudienceConnected] = useState(false);
  const isAudienceFullChrome = isFullscreen || presenterViewOpen;
  const audienceWinRef = useRef<Window | null>(null);
  const audienceChannelRef = useRef<BroadcastChannel | null>(null);
  const audienceChannelNameRef = useRef<string>(
    `wikihub-present-${Math.random().toString(36).slice(2, 10)}`,
  );
  const [fsTopVisible, setFsTopVisible] = useState(false);
  const [fsBottomVisible, setFsBottomVisible] = useState(false);
  const fsHoveringTopRef = useRef(false);
  const fsHoveringBottomRef = useRef(false);
  const [inlineEditMode, setInlineEditMode] = useState(false);
  const [motionStyle, setMotionStyle] = useState<SlideMotionStyle>(() =>
    getSavedMotionStyle(),
  );

  // Per-slide inline edits (persisted to localStorage when user clicks Save)
  const deckStorageKey = `wikihub.present.deck:${spaceKey}:${pageSlug || title}`;
  const [slideEdits, setSlideEdits] = useState<
    Record<
      string,
      {
        title?: string;
        subtitle?: string;
        bodyHtml?: string;
        visualsHtml?: Record<string, string>;
      }
    >
  >({});
  const slideEditsRef = useRef(slideEdits);
  slideEditsRef.current = slideEdits;
  const [saveJustCompleted, setSaveJustCompleted] = useState(false);
  const [unsavedEditPromptOpen, setUnsavedEditPromptOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const pendingInlineInputRef = useRef(false);
  const editSnapshotRef = useRef<{
    slideEditsJson: string;
    themeId: FrontendSlideThemeId;
    motionStyle: SlideMotionStyle;
    granularity: SlideGranularity;
  } | null>(null);

  // Always start on slide 1 (Cover) with default cursor (no Laser/Draw/Eraser) when Present opens
  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    prevSlideIndexRef.current = 0;
    setTimerSeconds(0);
    setLaserActive(false);
    setPenActive(false);
    setEraserActive(false);
    setLaserTrail([]);
    setHoveredEraseIdx(null);
    setInlineEditMode(false);
    setSlideShowMenuOpen(false);
    setOverviewOpen(false);
    setSpotlight(null);
    setExitConfirmOpen(false);
    setStageContextMenu(null);
  }, [open]);

  // Restore saved slide edits & split preference when opening Present
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(deckStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          slideEdits?: typeof slideEdits;
          granularity?: SlideGranularity;
        };
        if (parsed.slideEdits && typeof parsed.slideEdits === "object") {
          setSlideEdits(parsed.slideEdits);
        }
        if (
          parsed.granularity === "standard" ||
          parsed.granularity === "detailed" ||
          parsed.granularity === "divider"
        ) {
          setGranularity(parsed.granularity);
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [open, deckStorageKey]);

  const handleSaveEdits = useCallback(() => {
    // Flush any active contentEditable field before saving
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && activeEl.isContentEditable) {
      activeEl.blur();
    }
    window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          deckStorageKey,
          JSON.stringify({
            slideEdits: slideEditsRef.current,
            granularity: granularity === "ai" ? "standard" : granularity,
          }),
        );
      } catch {
        // ignore storage errors
      }
      saveSlideThemeId(themeId);
      saveMotionStyle(motionStyle);
      pendingInlineInputRef.current = false;
      editSnapshotRef.current = null;
      setUnsavedEditPromptOpen(false);
      setSaveJustCompleted(true);
      window.setTimeout(() => {
        setSaveJustCompleted(false);
        setInlineEditMode(false);
        setThemeGalleryOpen(false);
        setPreviewThemeId(null);
        setMotionMenuOpen(false);
      }, 650);
    }, 0);
  }, [deckStorageKey, granularity, themeId, motionStyle]);

  // Per-slide custom speaker notes (auto-saved to localStorage per page)
  const notesStorageKey = `wikihub.present.notes:${spaceKey}:${pageSlug || title}`;
  const [customNotesBySlide, setCustomNotesBySlide] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(notesStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (parsed && typeof parsed === "object") {
          setCustomNotesBySlide(parsed);
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [open, notesStorageKey]);

  const updateCustomNote = useCallback(
    (slideId: string, value: string) => {
      setCustomNotesBySlide((prev) => {
        const next = { ...prev, [slideId]: value };
        if (!value.trim()) delete next[slideId];
        try {
          window.localStorage.setItem(notesStorageKey, JSON.stringify(next));
        } catch {
          // ignore storage errors
        }
        return next;
      });
    },
    [notesStorageKey],
  );

  const enterEditMode = useCallback(() => {
    editSnapshotRef.current = {
      slideEditsJson: JSON.stringify(slideEditsRef.current),
      themeId,
      motionStyle,
      granularity,
    };
    pendingInlineInputRef.current = false;
    setUnsavedEditPromptOpen(false);
    setInlineEditMode(true);
  }, [themeId, motionStyle, granularity]);

  const exitEditModeCleanly = useCallback(() => {
    pendingInlineInputRef.current = false;
    editSnapshotRef.current = null;
    setUnsavedEditPromptOpen(false);
    setInlineEditMode(false);
    setThemeGalleryOpen(false);
    setPreviewThemeId(null);
    setMotionMenuOpen(false);
  }, []);

  const handleDiscardEdits = useCallback(() => {
    const snap = editSnapshotRef.current;
    if (snap) {
      try {
        setSlideEdits(JSON.parse(snap.slideEditsJson));
      } catch {
        // ignore parse errors
      }
      setThemeId(snap.themeId);
      saveSlideThemeId(snap.themeId);
      setMotionStyle(snap.motionStyle);
      saveMotionStyle(snap.motionStyle);
      setGranularity(snap.granularity);
    }
    exitEditModeCleanly();
  }, [exitEditModeCleanly]);

  const requestExitEditMode = useCallback(() => {
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && activeEl.isContentEditable) {
      activeEl.blur();
    }
    const snap = editSnapshotRef.current;
    const isDirty =
      pendingInlineInputRef.current ||
      (snap !== null &&
        (snap.slideEditsJson !== JSON.stringify(slideEditsRef.current) ||
          snap.themeId !== themeId ||
          snap.motionStyle !== motionStyle ||
          snap.granularity !== granularity));

    if (isDirty) {
      setUnsavedEditPromptOpen(true);
    } else {
      exitEditModeCleanly();
    }
  }, [themeId, motionStyle, granularity, exitEditModeCleanly]);

  const toggleInlineEditMode = useCallback(() => {
    if (inlineEditMode) {
      requestExitEditMode();
    } else {
      enterEditMode();
    }
  }, [inlineEditMode, requestExitEditMode, enterEditMode]);

  // 1920x1080 Fixed Stage scaling transform state
  const [stageTransform, setStageTransform] = useState<{
    scale: number;
    x: number;
    y: number;
  }>({ scale: 0.65, x: 0, y: 0 });

  // Animation trigger key & motion preset so every slide switch replays rich transitions
  const [revealTick, setRevealTick] = useState(0);
  const [motionMenuOpen, setMotionMenuOpen] = useState(false);
  const [stageContextMenu, setStageContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [slideDirection, setSlideDirection] = useState<1 | -1>(1);
  const prevSlideIndexRef = useRef(0);

  // Stage tools
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [bulletReveal, setBulletReveal] = useState(false);
  const [revealedCount, setRevealedCount] = useState(999);
  const [laserActive, setLaserActive] = useState(false);
  const [penActive, setPenActive] = useState(false);
  const [eraserActive, setEraserActive] = useState(false);
  const [penColor, setPenColor] = useState<PenColorKey>("primary");
  const [strokeHistoryBySlide, setStrokeHistoryBySlide] = useState<
    Record<string, StrokeHistory>
  >({});
  const [hoveredEraseIdx, setHoveredEraseIdx] = useState<number | null>(null);
  const activeStrokeRef = useRef<DrawStroke | null>(null);
  const erasedInGestureRef = useRef(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [laserTrail, setLaserTrail] = useState<LaserPoint[]>([]);
  const spotlightCanvasRef = useRef<HTMLDivElement>(null);
  const [spotlightHistory, setSpotlightHistory] =
    useState<StrokeHistory>(EMPTY_STROKE_HISTORY);
  const spotlightStrokes = spotlightHistory.present;
  const [hoveredSpotlightEraseIdx, setHoveredSpotlightEraseIdx] = useState<
    number | null
  >(null);
  const spotlightActiveStrokeRef = useRef<DrawStroke | null>(null);
  const spotlightErasedInGestureRef = useRef(false);
  const [isSpotlightDrawing, setIsSpotlightDrawing] = useState(false);
  const [spotlightLaserTrail, setSpotlightLaserTrail] = useState<LaserPoint[]>(
    [],
  );

  // Pacing timer
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);

  // Spotlight zoom overlay
  const [spotlight, setSpotlight] = useState<{
    kind: "image" | "svg" | "html";
    content: string;
    caption?: string;
    zoom: number;
  } | null>(null);

  // AI Executive Deck state
  const [aiStatusState, setAiStatusState] = useState<AiStatus | null>(null);
  const [aiLanguage, setAiLanguage] = useState<SlideLanguage>("page");
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiDeckResponse, setAiDeckResponse] =
    useState<AiPageSlideDeckResponse | null>(null);

  const activeTheme = useMemo(() => getSlideThemeById(themeId), [themeId]);
  const previewTheme = useMemo(
    () => (previewThemeId ? getSlideThemeById(previewThemeId) : null),
    [previewThemeId],
  );

  const selectTheme = useCallback((id: FrontendSlideThemeId) => {
    setThemeId(id);
    saveSlideThemeId(id);
    setRevealTick((tick) => tick + 1);
  }, []);

  const cycleTheme = useCallback(
    (delta: number) => {
      const idx = FRONTEND_SLIDE_THEMES.findIndex((th) => th.id === themeId);
      const nextIdx =
        (idx + delta + FRONTEND_SLIDE_THEMES.length) %
        FRONTEND_SLIDE_THEMES.length;
      const nextTheme = FRONTEND_SLIDE_THEMES[nextIdx];
      if (nextTheme) selectTheme(nextTheme.id);
    },
    [themeId, selectTheme],
  );

  // Dynamically inject Google Fonts for the chosen frontend-slides preset (and previewed theme)
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const linkId = "wikihub-frontend-slides-font";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    const targetUrl = previewTheme?.googleFontsUrl ?? activeTheme.googleFontsUrl;
    if (link.href !== targetUrl) {
      link.href = targetUrl;
    }
  }, [open, activeTheme.googleFontsUrl, previewTheme?.googleFontsUrl]);

  // Fixed 1920x1080 stage uniform scaling (`viewport-base.css` + `setupStageScale()`)
  useEffect(() => {
    if (!open) return;
    const viewportEl = viewportBoxRef.current;
    if (!viewportEl) return;

    const updateScale = () => {
      const rect = viewportEl.getBoundingClientRect();
      const padX = isAudienceFullChrome ? 0 : 32;
      const padY = isAudienceFullChrome ? 0 : 28;
      const availW = Math.max(320, rect.width - padX);
      const availH = Math.max(180, rect.height - padY);
      const scale = Math.min(availW / STAGE_WIDTH, availH / STAGE_HEIGHT);
      const x = (rect.width - STAGE_WIDTH * scale) / 2;
      const y = (rect.height - STAGE_HEIGHT * scale) / 2;
      setStageTransform({ scale, x, y });
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewportEl);
    window.addEventListener("resize", updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [open, notesOpen, inlineEditMode, isAudienceFullChrome]);

  // Fullscreen auto-hide chrome: slides in on edge hover, starts closing immediately on leave
  // with a longer, silky-smooth glide-out transition.
  const keepFsChromeOpen =
    themeGalleryOpen ||
    overviewOpen ||
    notesOpen ||
    motionMenuOpen ||
    inlineEditMode ||
    penActive;

  useEffect(() => {
    if (!isAudienceFullChrome) {
      fsHoveringTopRef.current = false;
      fsHoveringBottomRef.current = false;
      setFsTopVisible(false);
      setFsBottomVisible(false);
      return;
    }

    const onMouseMove = (e: MouseEvent) => {
      const nearTop = e.clientY <= 60;
      const nearBottom = e.clientY >= window.innerHeight - 60;
      setFsTopVisible(nearTop || fsHoveringTopRef.current);
      setFsBottomVisible(nearBottom || fsHoveringBottomRef.current);
    };

    const onMouseLeaveWindow = () => {
      fsHoveringTopRef.current = false;
      fsHoveringBottomRef.current = false;
      setFsTopVisible(false);
      setFsBottomVisible(false);
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeaveWindow);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeaveWindow);
    };
  }, [isAudienceFullChrome]);

  // Look up AI status when presentation opens
  useEffect(() => {
    if (!open || !allowAiDeck || !pageSlug) return;
    let active = true;
    void aiStatus().then((val) => {
      if (active) setAiStatusState(val);
    });
    return () => {
      active = false;
    };
  }, [open, allowAiDeck, pageSlug]);

  const loadAiDeck = useCallback(
    async (refresh: boolean, lang: SlideLanguage = aiLanguage) => {
      if (!spaceKey || !pageSlug) return;
      setAiPending(true);
      setAiError(null);
      try {
        const res = await fetchAiSlideDeck(spaceKey, pageSlug, {
          lang,
          refresh,
        });
        setAiDeckResponse(res);
        setActiveIndex(0);
      } catch (err) {
        if (
          err instanceof ApiError &&
          err.status === 503 &&
          /not enabled/i.test(err.message)
        ) {
          resetAiStatus();
          setAiStatusState((curr) => ({
            enabled: false,
            can_configure: curr?.can_configure ?? false,
          }));
        } else {
          setAiError(
            err instanceof Error ? err.message : t("present.aiFailed"),
          );
        }
      } finally {
        setAiPending(false);
      }
    },
    [spaceKey, pageSlug, aiLanguage, t],
  );

  useEffect(() => {
    if (
      open &&
      granularity === "ai" &&
      aiStatusState?.enabled &&
      !aiDeckResponse &&
      !aiPending &&
      !aiError
    ) {
      void loadAiDeck(false, aiLanguage);
    }
  }, [
    open,
    granularity,
    aiStatusState?.enabled,
    aiDeckResponse,
    aiPending,
    aiError,
    aiLanguage,
    loadAiDeck,
  ]);

  const deterministicSlides = useMemo(() => {
    const mode = granularity === "ai" ? "standard" : granularity;
    return buildSlidesFromPage({
      title,
      content,
      contentFormat,
      spaceName,
      spaceKey,
      author,
      updatedBy,
      updatedAtFormatted,
      labels,
      granularity: mode,
    });
  }, [
    title,
    content,
    contentFormat,
    spaceName,
    spaceKey,
    author,
    updatedBy,
    updatedAtFormatted,
    labels,
    granularity,
  ]);

  const aiSlides = useMemo(() => {
    if (!aiDeckResponse || aiDeckResponse.slides.length === 0) return [];
    return buildSlidesFromAiDeck(aiDeckResponse.slides, {
      title,
      spaceName,
      spaceKey,
      author,
      updatedAtFormatted,
      labels,
    });
  }, [
    aiDeckResponse,
    title,
    spaceName,
    spaceKey,
    author,
    updatedAtFormatted,
    labels,
  ]);

  const baseSlides: PresentationSlide[] =
    granularity === "ai" && aiSlides.length > 0
      ? aiSlides
      : deterministicSlides;

  const slides: PresentationSlide[] = useMemo(
    () =>
      baseSlides.map((s) => {
        const ed = slideEdits[s.id];
        if (!ed) return s;
        return {
          ...s,
          title: ed.title ?? s.title,
          subtitle: ed.subtitle ?? s.subtitle,
          bodyHtml: ed.bodyHtml ?? s.bodyHtml,
          visuals: ed.visualsHtml
            ? s.visuals.map((v) =>
                ed.visualsHtml?.[v.id] != null
                  ? { ...v, html: ed.visualsHtml[v.id]! }
                  : v,
              )
            : s.visuals,
        };
      }),
    [baseSlides, slideEdits],
  );

  const safeIndex = Math.min(
    Math.max(0, activeIndex),
    Math.max(0, slides.length - 1),
  );
  const currentSlide = slides[safeIndex] ?? slides[0]!;
  const nextSlide = slides[safeIndex + 1] ?? null;

  useEffect(() => {
    const prev = prevSlideIndexRef.current;
    if (safeIndex !== prev) {
      setSlideDirection(safeIndex > prev ? 1 : -1);
      prevSlideIndexRef.current = safeIndex;
    }
    setRevealTick((tick) => tick + 1);
    if (!bulletReveal) {
      setRevealedCount(999);
    } else {
      const total = currentSlide?.bullets.length ?? 0;
      setRevealedCount(total > 0 ? 1 : 999);
    }
  }, [safeIndex, bulletReveal, currentSlide?.id, currentSlide?.bullets.length]);

  useEffect(() => {
    if (!open || !timerRunning) return;
    const id = window.setInterval(() => {
      setTimerSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, timerRunning]);

  const toggleFullscreen = useCallback(() => {
    const container = stageRootRef.current as PrefixedFullscreenElement | null;
    if (!container) return;
    if (currentFullscreenElement() === container) {
      const doc = document as PrefixedFullscreenDocument;
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    } else {
      try {
        const req =
          container.requestFullscreen?.bind(container) ??
          container.webkitRequestFullscreen?.bind(container);
        const res = req?.();
        if (res && typeof (res as Promise<void>).catch === "function") {
          (res as Promise<void>).catch(() => {});
        }
      } catch {
        // Fallback: remains full-window viewport
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const container = stageRootRef.current;
    function syncFs() {
      setIsFullscreen(currentFullscreenElement() === container);
    }
    document.addEventListener("fullscreenchange", syncFs);
    document.addEventListener("webkitfullscreenchange", syncFs);
    return () => {
      document.removeEventListener("fullscreenchange", syncFs);
      document.removeEventListener("webkitfullscreenchange", syncFs);
      if (container && currentFullscreenElement() === container) {
        const doc = document as PrefixedFullscreenDocument;
        if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
        else doc.webkitExitFullscreen?.();
      }
    };
  }, [open]);

  const endPresenterView = useCallback(() => {
    try {
      audienceChannelRef.current?.postMessage({ type: "close" });
      audienceChannelRef.current?.close();
    } catch {
      // ignore
    }
    audienceChannelRef.current = null;
    try {
      if (audienceWinRef.current && !audienceWinRef.current.closed) {
        audienceWinRef.current.close();
      }
    } catch {
      // ignore
    }
    audienceWinRef.current = null;
    setAudienceConnected(false);
    setPresenterViewOpen(false);
    const container = stageRootRef.current;
    if (container && currentFullscreenElement() === container) {
      const doc = document as PrefixedFullscreenDocument;
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    }
  }, []);

  const stepForward = useCallback(() => {
    const totalBullets = currentSlide?.bullets.length ?? 0;
    if (
      bulletReveal &&
      currentSlide?.layout !== "cover" &&
      totalBullets > 1 &&
      revealedCount < totalBullets
    ) {
      setRevealedCount((c) => c + 1);
      return;
    }
    setActiveIndex((i) => Math.min(slides.length - 1, i + 1));
  }, [bulletReveal, currentSlide, revealedCount, slides.length]);

  const stepBackward = useCallback(() => {
    const totalBullets = currentSlide?.bullets.length ?? 0;
    if (
      bulletReveal &&
      currentSlide?.layout !== "cover" &&
      totalBullets > 1 &&
      revealedCount > 1 &&
      revealedCount <= totalBullets
    ) {
      setRevealedCount((c) => c - 1);
      return;
    }
    setActiveIndex((i) => Math.max(0, i - 1));
  }, [bulletReveal, currentSlide, revealedCount]);

  const clearCurrentSlideAnnotations = useCallback(() => {
    if (spotlight) {
      setSpotlightHistory((h) => {
        if (h.present.length === 0) return h;
        return {
          past: [...h.past.slice(-39), h.present],
          present: [],
          future: [],
        };
      });
      setHoveredSpotlightEraseIdx(null);
      return;
    }
    if (!currentSlide) return;
    const slideId = currentSlide.id;
    setStrokeHistoryBySlide((prev) => {
      const h = prev[slideId] ?? EMPTY_STROKE_HISTORY;
      if (h.present.length === 0) return prev;
      return {
        ...prev,
        [slideId]: {
          past: [...h.past.slice(-39), h.present],
          present: [],
          future: [],
        },
      };
    });
    setHoveredEraseIdx(null);
  }, [currentSlide, spotlight]);

  const undoAnnotation = useCallback(() => {
    if (spotlight) {
      setSpotlightHistory((h) => {
        if (h.past.length === 0) return h;
        const previous = h.past[h.past.length - 1]!;
        return {
          past: h.past.slice(0, -1),
          present: previous,
          future: [...h.future.slice(-39), h.present],
        };
      });
      setHoveredSpotlightEraseIdx(null);
      return;
    }
    if (!currentSlide) return;
    const slideId = currentSlide.id;
    setStrokeHistoryBySlide((prev) => {
      const h = prev[slideId] ?? EMPTY_STROKE_HISTORY;
      if (h.past.length === 0) return prev;
      const previous = h.past[h.past.length - 1]!;
      return {
        ...prev,
        [slideId]: {
          past: h.past.slice(0, -1),
          present: previous,
          future: [...h.future.slice(-39), h.present],
        },
      };
    });
    setHoveredEraseIdx(null);
  }, [currentSlide, spotlight]);

  const redoAnnotation = useCallback(() => {
    if (spotlight) {
      setSpotlightHistory((h) => {
        if (h.future.length === 0) return h;
        const nextVal = h.future[h.future.length - 1]!;
        return {
          past: [...h.past.slice(-39), h.present],
          present: nextVal,
          future: h.future.slice(0, -1),
        };
      });
      setHoveredSpotlightEraseIdx(null);
      return;
    }
    if (!currentSlide) return;
    const slideId = currentSlide.id;
    setStrokeHistoryBySlide((prev) => {
      const h = prev[slideId] ?? EMPTY_STROKE_HISTORY;
      if (h.future.length === 0) return prev;
      const nextVal = h.future[h.future.length - 1]!;
      return {
        ...prev,
        [slideId]: {
          past: [...h.past.slice(-39), h.present],
          present: nextVal,
          future: h.future.slice(0, -1),
        },
      };
    });
    setHoveredEraseIdx(null);
  }, [currentSlide, spotlight]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        if (event.key === "Escape" && inlineEditMode) {
          event.preventDefault();
          event.stopImmediatePropagation();
          requestExitEditMode();
        }
        return;
      }

      // Ctrl/Cmd + Z (Undo) & Ctrl/Cmd + Y / Ctrl/Cmd + Shift + Z (Redo) for draw/eraser
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const k = event.key.toLowerCase();
        if (k === "z" && !event.shiftKey) {
          event.preventDefault();
          event.stopImmediatePropagation();
          undoAnnotation();
          return;
        }
        if (k === "y" || (k === "z" && event.shiftKey)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          redoAnnotation();
          return;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (exitConfirmOpen) {
          setExitConfirmOpen(false);
          return;
        }
        if (unsavedEditPromptOpen) {
          setUnsavedEditPromptOpen(false);
          return;
        }
        if (exportMenuOpen) {
          setExportMenuOpen(false);
          return;
        }
        if (slideShowMenuOpen) {
          setSlideShowMenuOpen(false);
          return;
        }
        if (spotlight) {
          setSpotlight(null);
          return;
        }
        if (previewThemeId) {
          setPreviewThemeId(null);
          return;
        }
        if (themeGalleryOpen) {
          setThemeGalleryOpen(false);
          return;
        }
        if (stageContextMenu) {
          setStageContextMenu(null);
          return;
        }
        if (motionMenuOpen) {
          setMotionMenuOpen(false);
          return;
        }
        if (overviewOpen) {
          setOverviewOpen(false);
          return;
        }
        if (inlineEditMode) {
          requestExitEditMode();
          return;
        }
        if (eraserActive) {
          setEraserActive(false);
          return;
        }
        if (penActive) {
          setPenActive(false);
          return;
        }
        if (laserActive) {
          setLaserActive(false);
          return;
        }
        setExitConfirmOpen(true);
        return;
      }

      if (exitConfirmOpen) {
        if (event.key === "Enter") {
          event.preventDefault();
          setExitConfirmOpen(false);
          if (presenterViewOpen) {
            endPresenterView();
          } else {
            onOpenChange(false);
          }
        }
        return;
      }

      if (spotlight) {
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          setSpotlight((s) =>
            s ? { ...s, zoom: Math.min(2.5, s.zoom + 0.25) } : null,
          );
        } else if (event.key === "-") {
          event.preventDefault();
          setSpotlight((s) =>
            s ? { ...s, zoom: Math.max(0.5, s.zoom - 0.25) } : null,
          );
        } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          const k = event.key.toLowerCase();
          if (k === "l") {
            event.preventDefault();
            setLaserActive((v) => {
              if (!v) setPenActive(false);
              return !v;
            });
          } else if (k === "d") {
            event.preventDefault();
            setPenActive((v) => {
              if (!v) setLaserActive(false);
              return !v;
            });
          } else if (k === "c") {
            event.preventDefault();
            clearCurrentSlideAnnotations();
          }
        }
        return;
      }

      if (previewThemeId) {
        if (
          event.key === "ArrowRight" ||
          event.key === "PageDown" ||
          (event.key === " " && !event.shiftKey)
        ) {
          event.preventDefault();
          setPreviewSlideIdx((idx) =>
            Math.min(SAMPLE_PREVIEW_SLIDE_COUNT - 1, idx + 1),
          );
        } else if (
          event.key === "ArrowLeft" ||
          event.key === "PageUp" ||
          (event.key === " " && event.shiftKey)
        ) {
          event.preventDefault();
          setPreviewSlideIdx((idx) => Math.max(0, idx - 1));
        } else if (event.key === "Home") {
          event.preventDefault();
          setPreviewSlideIdx(0);
        } else if (event.key === "End") {
          event.preventDefault();
          setPreviewSlideIdx(SAMPLE_PREVIEW_SLIDE_COUNT - 1);
        }
        return;
      }

      if (
        event.key === "ArrowRight" ||
        event.key === "PageDown" ||
        (event.key === " " && !event.shiftKey)
      ) {
        event.preventDefault();
        stepForward();
      } else if (
        event.key === "ArrowLeft" ||
        event.key === "PageUp" ||
        (event.key === " " && event.shiftKey)
      ) {
        event.preventDefault();
        stepBackward();
      } else if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(slides.length - 1);
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const k = event.key.toLowerCase();
        if (k === "t") {
          if (inlineEditMode) {
            event.preventDefault();
            setThemeGalleryOpen((v) => !v);
          }
        } else if (k === "g") {
          event.preventDefault();
          setOverviewOpen((v) => !v);
        } else if (k === "n") {
          event.preventDefault();
          setNotesOpen((v) => !v);
        } else if (k === "b") {
          event.preventDefault();
          setBulletReveal((v) => !v);
        } else if (k === "e") {
          event.preventDefault();
          toggleInlineEditMode();
        } else if (k === "l") {
          event.preventDefault();
          setLaserActive((v) => {
            if (!v) setPenActive(false);
            return !v;
          });
        } else if (k === "d") {
          event.preventDefault();
          setPenActive((v) => {
            if (!v) setLaserActive(false);
            return !v;
          });
        } else if (k === "c") {
          event.preventDefault();
          clearCurrentSlideAnnotations();
        } else if (k === "f") {
          event.preventDefault();
          toggleFullscreen();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    open,
    spotlight,
    previewThemeId,
    themeGalleryOpen,
    stageContextMenu,
    motionMenuOpen,
    overviewOpen,
    inlineEditMode,
    onOpenChange,
    stepForward,
    stepBackward,
    slides.length,
    clearCurrentSlideAnnotations,
    undoAnnotation,
    redoAnnotation,
    toggleFullscreen,
    toggleInlineEditMode,
    unsavedEditPromptOpen,
    exitConfirmOpen,
    exportMenuOpen,
    slideShowMenuOpen,
    presenterViewOpen,
    endPresenterView,
    eraserActive,
    penActive,
    laserActive,
    requestExitEditMode,
  ]);

  // Wheel navigation matching Home Feature Discovery:
  // a gentle scroll notch moves 1 slide, a fast flick runs through up to 5 slides proportionally.
  useEffect(() => {
    if (!open) return;
    const el = viewportBoxRef.current;
    if (!el) return;

    const PER_SLIDE = 80;
    const MAX_STEPS = 5;
    let acc = 0;
    let lastEvent = 0;

    const onWheel = (e: WheelEvent) => {
      if (
        themeGalleryOpen ||
        overviewOpen ||
        spotlight ||
        stageContextMenu ||
        inlineEditMode
      ) {
        return;
      }
      e.preventDefault();
      const now = Date.now();
      if (now - lastEvent > 200) acc = 0;
      lastEvent = now;
      acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const wanted = Math.trunc(acc / PER_SLIDE);
      const steps = Math.max(-MAX_STEPS, Math.min(MAX_STEPS, wanted));
      if (steps === 0) return;
      acc = steps === wanted ? acc - steps * PER_SLIDE : 0;

      if (bulletReveal && steps === 1) {
        stepForward();
      } else if (bulletReveal && steps === -1) {
        stepBackward();
      } else {
        setActiveIndex((prev) =>
          Math.max(0, Math.min(slides.length - 1, prev + steps)),
        );
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [
    open,
    themeGalleryOpen,
    overviewOpen,
    spotlight,
    stageContextMenu,
    inlineEditMode,
    bulletReveal,
    stepForward,
    stepBackward,
    slides.length,
  ]);

  // Wheel navigation inside the Theme Sample Preview Modal (matching main stage speed)
  useEffect(() => {
    if (!previewThemeId) return;
    const el = previewModalStageRef.current;
    if (!el) return;

    const PER_SLIDE = 80;
    const MAX_STEPS = 3;
    let acc = 0;
    let lastEvent = 0;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastEvent > 200) acc = 0;
      lastEvent = now;
      acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const wanted = Math.trunc(acc / PER_SLIDE);
      const steps = Math.max(-MAX_STEPS, Math.min(MAX_STEPS, wanted));
      if (steps === 0) return;
      acc = steps === wanted ? acc - steps * PER_SLIDE : 0;
      setPreviewSlideIdx((prev) =>
        Math.max(0, Math.min(SAMPLE_PREVIEW_SLIDE_COUNT - 1, prev + steps)),
      );
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [previewThemeId]);

  // Laser trail decay timer (both main stage and spotlight overlay)
  useEffect(() => {
    if (
      !laserActive ||
      (laserTrail.length === 0 && spotlightLaserTrail.length === 0)
    ) {
      return;
    }
    const id = window.setInterval(() => {
      const now = Date.now();
      setLaserTrail((pts) => pts.filter((p) => now - p.t < 320));
      setSpotlightLaserTrail((pts) => pts.filter((p) => now - p.t < 320));
    }, 40);
    return () => window.clearInterval(id);
  }, [laserActive, laserTrail.length, spotlightLaserTrail.length]);

  useEffect(() => {
    if (!spotlight) {
      setSpotlightHistory(EMPTY_STROKE_HISTORY);
      setHoveredSpotlightEraseIdx(null);
      setSpotlightLaserTrail([]);
      spotlightActiveStrokeRef.current = null;
      setIsSpotlightDrawing(false);
    }
  }, [spotlight]);

  useEffect(() => {
    if (!penActive || !eraserActive) {
      setHoveredEraseIdx(null);
      setHoveredSpotlightEraseIdx(null);
    }
  }, [penActive, eraserActive]);

  const relativeSpotlightPoint = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = spotlightCanvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const eraseSpotlightAt = (pt: { x: number; y: number }) => {
    const isFirstInGesture = !spotlightErasedInGestureRef.current;
    setSpotlightHistory((h) => {
      const remaining = h.present.filter((s) => !strokeHitsPoint(s, pt, 22));
      if (remaining.length === h.present.length) return h;
      spotlightErasedInGestureRef.current = true;
      return {
        past: isFirstInGesture ? [...h.past.slice(-39), h.present] : h.past,
        present: remaining,
        future: [],
      };
    });
    setHoveredSpotlightEraseIdx(null);
  };

  const handleSpotlightPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!penActive) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, [role='button']")) return;
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = relativeSpotlightPoint(e);
    if (eraserActive) {
      spotlightErasedInGestureRef.current = false;
      setIsSpotlightDrawing(true);
      eraseSpotlightAt(pt);
      return;
    }
    const hex = PEN_COLORS.find((c) => c.key === penColor)?.hex ?? "#38bdf8";
    const stroke: DrawStroke = { color: hex, points: [pt] };
    spotlightActiveStrokeRef.current = stroke;
    setIsSpotlightDrawing(true);
    setSpotlightHistory((h) => ({
      past: [...h.past.slice(-39), h.present],
      present: [...h.present, stroke],
      future: [],
    }));
  };

  const handleSpotlightPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (laserActive) {
      const pt = relativeSpotlightPoint(e);
      setSpotlightLaserTrail((prev) => [
        ...prev.slice(-18),
        { ...pt, t: Date.now() },
      ]);
    }
    if (penActive && eraserActive && !isSpotlightDrawing) {
      const pt = relativeSpotlightPoint(e);
      let hitIdx: number | null = null;
      for (let i = spotlightStrokes.length - 1; i >= 0; i--) {
        if (strokeHitsPoint(spotlightStrokes[i]!, pt, 22)) {
          hitIdx = i;
          break;
        }
      }
      setHoveredSpotlightEraseIdx((prev) => (prev === hitIdx ? prev : hitIdx));
      return;
    }
    if (!penActive || !isSpotlightDrawing) {
      return;
    }
    const pt = relativeSpotlightPoint(e);
    if (eraserActive) {
      eraseSpotlightAt(pt);
      return;
    }
    if (!spotlightActiveStrokeRef.current) return;
    const stroke = spotlightActiveStrokeRef.current;
    stroke.points.push(pt);
    const updatedStroke = { ...stroke, points: stroke.points.slice() };
    setSpotlightHistory((h) => {
      if (h.present.length === 0) return h;
      const copy = h.present.slice();
      copy[copy.length - 1] = updatedStroke;
      return { ...h, present: copy };
    });
  };

  const handleSpotlightPointerUp = () => {
    if (!isSpotlightDrawing) return;
    const finished = spotlightActiveStrokeRef.current;
    setIsSpotlightDrawing(false);
    spotlightActiveStrokeRef.current = null;
    spotlightErasedInGestureRef.current = false;
    // Drop invisible 1-point clicks so Undo/Redo never steps through phantom strokes
    if (finished && finished.points.length < 2) {
      setSpotlightHistory((h) => {
        if (h.past.length === 0) return h;
        return {
          past: h.past.slice(0, -1),
          present: h.past[h.past.length - 1]!,
          future: h.future,
        };
      });
    }
  };

  const relativeStagePoint = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = fixedStageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * STAGE_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * STAGE_HEIGHT,
    };
  };

  const eraseStageAt = (pt: { x: number; y: number }) => {
    if (!currentSlide) return;
    const slideId = currentSlide.id;
    const isFirstInGesture = !erasedInGestureRef.current;
    setStrokeHistoryBySlide((prev) => {
      const h = prev[slideId] ?? EMPTY_STROKE_HISTORY;
      if (h.present.length === 0) return prev;
      const remaining = h.present.filter((s) => !strokeHitsPoint(s, pt, 36));
      if (remaining.length === h.present.length) return prev;
      erasedInGestureRef.current = true;
      return {
        ...prev,
        [slideId]: {
          past: isFirstInGesture ? [...h.past.slice(-39), h.present] : h.past,
          present: remaining,
          future: [],
        },
      };
    });
    setHoveredEraseIdx(null);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!penActive || !currentSlide) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, [role='button']")) return;
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pt = relativeStagePoint(e);
    if (eraserActive) {
      erasedInGestureRef.current = false;
      setIsDrawing(true);
      eraseStageAt(pt);
      return;
    }
    const slideId = currentSlide.id;
    const strokeColor =
      PEN_COLORS.find((c) => c.key === penColor)?.hex ?? activeTheme.accent;
    const stroke: DrawStroke = { color: strokeColor, points: [pt] };
    activeStrokeRef.current = stroke;
    setIsDrawing(true);
    setStrokeHistoryBySlide((prev) => {
      const h = prev[slideId] ?? EMPTY_STROKE_HISTORY;
      return {
        ...prev,
        [slideId]: {
          past: [...h.past.slice(-39), h.present],
          present: [...h.present, stroke],
          future: [],
        },
      };
    });
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (laserActive) {
      const pt = relativeStagePoint(e);
      const now = Date.now();
      setLaserTrail((prev) => [...prev.slice(-24), { ...pt, t: now }]);
    }
    if (penActive && eraserActive && !isDrawing && currentSlide) {
      const pt = relativeStagePoint(e);
      const list = (strokeHistoryBySlide[currentSlide.id] ?? EMPTY_STROKE_HISTORY).present;
      let hitIdx: number | null = null;
      for (let i = list.length - 1; i >= 0; i--) {
        if (strokeHitsPoint(list[i]!, pt, 36)) {
          hitIdx = i;
          break;
        }
      }
      setHoveredEraseIdx((prev) => (prev === hitIdx ? prev : hitIdx));
      return;
    }
    if (!penActive || !isDrawing || !currentSlide) return;
    const pt = relativeStagePoint(e);
    if (eraserActive) {
      eraseStageAt(pt);
      return;
    }
    if (!activeStrokeRef.current) return;
    const slideId = currentSlide.id;
    activeStrokeRef.current.points.push(pt);
    const updatedStroke = {
      ...activeStrokeRef.current,
      points: activeStrokeRef.current.points.slice(),
    };
    setStrokeHistoryBySlide((prev) => {
      const h = prev[slideId];
      if (!h || h.present.length === 0) return prev;
      return {
        ...prev,
        [slideId]: {
          ...h,
          present: [...h.present.slice(0, -1), updatedStroke],
        },
      };
    });
  };

  const handlePointerUp = () => {
    if (isDrawing) {
      const finished = activeStrokeRef.current;
      const slideId = currentSlide?.id;
      setIsDrawing(false);
      activeStrokeRef.current = null;
      erasedInGestureRef.current = false;
      // Drop invisible 1-point clicks so Undo/Redo never steps through phantom strokes
      if (finished && finished.points.length < 2 && slideId) {
        setStrokeHistoryBySlide((prev) => {
          const h = prev[slideId];
          if (!h || h.past.length === 0) return prev;
          return {
            ...prev,
            [slideId]: {
              past: h.past.slice(0, -1),
              present: h.past[h.past.length - 1]!,
              future: h.future,
            },
          };
        });
      }
    }
  };

  const exportStrokesMap = useMemo(() => {
    const out: Record<string, DrawStroke[]> = {};
    for (const [slideId, hist] of Object.entries(strokeHistoryBySlide)) {
      if (hist.present.length > 0) {
        out[slideId] = hist.present;
      }
    }
    return out;
  }, [strokeHistoryBySlide]);

  // Download single self-contained HTML file (`zarazhangrui/frontend-slides` standard)
  const handleDownloadStandaloneHtml = useCallback(() => {
    const html = generateStandaloneFrontendSlidesHtml({
      title,
      spaceName,
      slides,
      theme: activeTheme,
      strokesBySlide: exportStrokesMap,
    });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "") || "presentation";
    a.href = url;
    a.download = `${slug}-${activeTheme.id}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [title, spaceName, slides, activeTheme, exportStrokesMap]);

  // Dedicated Print Slides (16:9 landscape browser print dialog with drawings)
  const handlePrintSlides = useCallback(() => {
    if (typeof window === "undefined") return;
    const printWin = window.open("", "_blank", "width=1280,height=720");
    if (!printWin) return;
    const html = generateStandaloneFrontendSlidesHtml({
      title,
      spaceName,
      slides,
      theme: activeTheme,
      strokesBySlide: exportStrokesMap,
    }).replace(
      "</body>",
      `<script>window.onload = function() { setTimeout(function() { window.print(); }, 450); };</script></body>`,
    );
    printWin.document.write(html);
    printWin.document.close();
  }, [title, spaceName, slides, activeTheme, exportStrokesMap]);

  // Direct PDF file download via backend Playwright renderer (zero browser print dialog!)
  const handleExportPdf = useCallback(async () => {
    if (typeof window === "undefined" || exportingPdf) return;
    setExportMenuOpen(false);
    const html = generateStandaloneFrontendSlidesHtml({
      title,
      spaceName,
      slides,
      theme: activeTheme,
      strokesBySlide: exportStrokesMap,
    });

    if (!pageSlug) {
      handlePrintSlides();
      return;
    }

    setExportingPdf(true);
    try {
      const res = await fetch(
        `${apiBaseUrl()}/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageSlug)}/export/slides-pdf`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html, title }),
        },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug =
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "") || "presentation";
      a.href = url;
      a.download = `${slug}-slides.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback to print-to-PDF if Playwright renderer is unavailable
      handlePrintSlides();
    } finally {
      setExportingPdf(false);
    }
  }, [
    exportingPdf,
    title,
    spaceName,
    slides,
    activeTheme,
    exportStrokesMap,
    pageSlug,
    spaceKey,
    handlePrintSlides,
  ]);

  // Open the Presenter View (Chế độ Diễn giả) in the 2nd popup window while
  // the default/main window becomes the clean Fullscreen Audience Screen.
  const openPresenterPopupWindow = useCallback(() => {
    if (typeof window === "undefined") return;
    const channelName = audienceChannelNameRef.current;
    if (typeof BroadcastChannel !== "undefined" && !audienceChannelRef.current) {
      const ch = new BroadcastChannel(channelName);
      ch.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type === "ready") {
          setAudienceConnected(true);
        } else if (msg.type === "goto" && typeof msg.index === "number") {
          setActiveIndex(
            Math.max(0, Math.min(slides.length - 1, msg.index)),
          );
        } else if (msg.type === "end") {
          endPresenterView();
        }
      };
      audienceChannelRef.current = ch;
    }

    const appTheme: "light" | "dark" =
      document.documentElement.classList.contains("dark") ||
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "dark"
        : "light";

    const scr = window.screen as Screen & {
      availLeft?: number;
      availTop?: number;
      isExtended?: boolean;
    };
    const availLeft = typeof scr.availLeft === "number" ? scr.availLeft : 0;
    const availTop = typeof scr.availTop === "number" ? scr.availTop : 0;
    const popupLeft = scr.isExtended
      ? availLeft === 0
        ? window.screen.availWidth + 40
        : 40
      : availLeft + 80;
    const popupTop = availTop + 60;

    const win = window.open(
      "",
      "wikihub-presenter-view",
      `popup=yes,width=1180,height=720,left=${popupLeft},top=${popupTop}`,
    );
    if (!win) return false;
    audienceWinRef.current = win;
    const html = generatePresenterPopupHtml({
      title,
      spaceName,
      slides,
      customNotesBySlide,
      strokesBySlide: exportStrokesMap,
      theme: activeTheme,
      channelName,
      initialIndex: safeIndex,
      locale,
      appTheme,
      baseHref: `${window.location.origin}/`,
    });
    win.document.open();
    win.document.write(html);
    win.document.close();
    setAudienceConnected(true);
    return true;
  }, [
    title,
    spaceName,
    slides,
    customNotesBySlide,
    exportStrokesMap,
    activeTheme,
    safeIndex,
    locale,
    endPresenterView,
  ]);

  const startPresenterView = useCallback(() => {
    setSlideShowMenuOpen(false);
    setInlineEditMode(false);
    setOverviewOpen(false);
    setNotesOpen(false);
    setPresenterViewOpen(true);
    setNeedsFsPrompt(false);
    // Open the 2nd Presenter View popup FIRST so Chrome's popup blocker never
    // blocks it (requestFullscreen consumes transient activation in Blink).
    // Then immediately put the main window into edge-to-edge Audience mode and
    // request OS fullscreen; if Chrome rejects the 2nd privileged API in the
    // same click, show a 1-click Fullscreen pill on the Audience screen.
    openPresenterPopupWindow();
    if (!isFullscreen) {
      window.focus();
      toggleFullscreen();
      window.setTimeout(() => {
        if (currentFullscreenElement() !== stageRootRef.current) {
          setNeedsFsPrompt(true);
        }
      }, 220);
    }
  }, [openPresenterPopupWindow, isFullscreen, toggleFullscreen]);

  useEffect(() => {
    if (isFullscreen || !presenterViewOpen) {
      setNeedsFsPrompt(false);
    }
  }, [isFullscreen, presenterViewOpen]);

  // Cleanup audience window when presentation modal closes
  useEffect(() => {
    if (!open && presenterViewOpen) {
      endPresenterView();
    }
  }, [open, presenterViewOpen, endPresenterView]);

  // Live BroadcastChannel sync: slide index, freehand strokes, and laser pointer
  useEffect(() => {
    if (!presenterViewOpen) return;
    audienceChannelRef.current?.postMessage({ type: "goto", index: safeIndex });
  }, [presenterViewOpen, safeIndex]);

  useEffect(() => {
    if (!presenterViewOpen || !currentSlide) return;
    const strokes =
      (strokeHistoryBySlide[currentSlide.id] ?? EMPTY_STROKE_HISTORY).present;
    audienceChannelRef.current?.postMessage({
      type: "strokes",
      slideId: currentSlide.id,
      strokes,
    });
  }, [presenterViewOpen, currentSlide, strokeHistoryBySlide]);

  useEffect(() => {
    if (!presenterViewOpen) return;
    audienceChannelRef.current?.postMessage({
      type: "laser",
      trail: laserActive ? laserTrail : [],
    });
  }, [presenterViewOpen, laserActive, laserTrail]);

  if (!open || typeof document === "undefined") return null;

  const currentStrokes =
    (strokeHistoryBySlide[currentSlide.id] ?? EMPTY_STROKE_HISTORY).present;
  const progressPercent =
    slides.length > 1 ? ((safeIndex + 1) / slides.length) * 100 : 100;
  const slideNumFormatted = String(safeIndex + 1).padStart(2, "0");
  const totalFormatted = String(slides.length).padStart(2, "0");

  const filteredThemes =
    themeCategoryFilter === "all"
      ? FRONTEND_SLIDE_THEMES
      : FRONTEND_SLIDE_THEMES.filter(
          (th) => th.category === themeCategoryFilter,
        );

  const renderVisualBlock = (vis: SlideVisualBlock) => {
    if (vis.kind === "mermaid" && vis.mermaidCode) {
      return (
        <SlideMermaidDiagram
          key={vis.id}
          code={vis.mermaidCode}
          theme={activeTheme}
          onSpotlight={(svg) =>
            setSpotlight({
              kind: "svg",
              content: svg,
              caption: currentSlide.title,
              zoom: 1,
            })
          }
        />
      );
    }
    if (vis.kind === "image" && vis.imageSrc) {
      return (
        <button
          key={vis.id}
          type="button"
          onClick={() =>
            setSpotlight({
              kind: "image",
              content: vis.imageSrc!,
              caption: vis.imageAlt || vis.caption || currentSlide.title,
              zoom: 1,
            })
          }
          title={t("present.clickToSpotlight")}
          className="group relative flex max-h-[580px] w-full cursor-zoom-in flex-col items-center justify-center overflow-hidden rounded-2xl border-2 p-5 transition-colors duration-150 focus-visible:outline-none"
          style={{
            backgroundColor: activeTheme.slideSurface,
            borderColor: activeTheme.borderColor,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={vis.imageSrc}
            alt={vis.imageAlt || ""}
            className="max-h-[510px] w-auto max-w-full rounded-xl object-contain shadow-lg"
          />
          {vis.caption ? (
            <span
              className="mt-3 line-clamp-1 text-lg"
              style={{ color: activeTheme.textSecondary }}
            >
              {vis.caption}
            </span>
          ) : null}
          <span
            className="absolute right-4 bottom-4 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-base font-semibold opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100"
            style={{
              backgroundColor: activeTheme.codeBg,
              color: activeTheme.accent,
              borderColor: activeTheme.borderColor,
            }}
          >
            <ZoomIn className="size-4" />
            {t("present.spotlightZoom")}
          </span>
        </button>
      );
    }
    if (vis.kind === "table") {
      const maxTableHeight = currentSlide.layout === "visual" ? 650 : 560;
      return (
        <div
          key={vis.id}
          className="wh-fs-table-card group relative overflow-hidden rounded-2xl border-2 shadow-lg"
          style={{
            backgroundColor: activeTheme.slideSurface,
            borderColor: activeTheme.borderColor,
          }}
        >
          <AutoFitSlideBlock
            html={vis.html}
            maxHeight={maxTableHeight}
            editable={inlineEditMode}
            onBlurHtml={(nextHtml) =>
              setSlideEdits((prev) => ({
                ...prev,
                [currentSlide.id]: {
                  ...prev[currentSlide.id],
                  visualsHtml: {
                    ...prev[currentSlide.id]?.visualsHtml,
                    [vis.id]: nextHtml,
                  },
                },
              }))
            }
            className="wh-fs-table-host text-[21px] leading-snug"
            style={{ color: activeTheme.textPrimary }}
          />
          <button
            type="button"
            onClick={() =>
              setSpotlight({
                kind: "html",
                content: vis.html,
                caption: currentSlide.title,
                zoom: 1,
              })
            }
            className="absolute top-3.5 right-3.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-base font-semibold opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            style={{
              backgroundColor: activeTheme.codeBg,
              color: activeTheme.accent,
              borderColor: activeTheme.borderColor,
            }}
          >
            <ZoomIn className="size-4" />
            {t("present.spotlightZoom")}
          </button>
        </div>
      );
    }
    if (vis.kind === "code") {
      const maxCodeHeight = currentSlide.layout === "visual" ? 640 : 540;
      return (
        <div
          key={vis.id}
          className="group relative overflow-hidden rounded-2xl border-2 shadow-lg"
          style={{
            backgroundColor: activeTheme.codeBg,
            borderColor: activeTheme.borderColor,
          }}
        >
          <AutoFitSlideBlock
            html={vis.html}
            maxHeight={maxCodeHeight}
            editable={inlineEditMode}
            onBlurHtml={(nextHtml) =>
              setSlideEdits((prev) => ({
                ...prev,
                [currentSlide.id]: {
                  ...prev[currentSlide.id],
                  visualsHtml: {
                    ...prev[currentSlide.id]?.visualsHtml,
                    [vis.id]: nextHtml,
                  },
                },
              }))
            }
            className="p-7 font-mono text-[20px] leading-relaxed [&_pre]:m-0 [&_pre]:whitespace-pre-wrap"
            style={{ color: activeTheme.codeFg }}
          />
          <button
            type="button"
            onClick={() =>
              setSpotlight({
                kind: "html",
                content: vis.html,
                caption: currentSlide.title,
                zoom: 1,
              })
            }
            className="absolute top-3.5 right-3.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-base font-semibold opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            style={{
              backgroundColor: activeTheme.codeBg,
              color: activeTheme.accent,
              borderColor: activeTheme.borderColor,
            }}
          >
            <ZoomIn className="size-4" />
            {t("present.spotlightZoom")}
          </button>
        </div>
      );
    }
    return null;
  };

  return createPortal(
    <div
      ref={stageRootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("present.stageAria", { title })}
      className={cn(
        "bg-background text-foreground fixed inset-0 z-50 flex flex-col overflow-hidden",
        !inlineEditMode && "select-none",
      )}
    >
      {/* Embedded Frontend-Slides Stage Keyframes, Calm Motions & Theme-Native Table Rules */}
      <style>{`
        /* === Calm, Executive-Grade Slide Transitions === */
        @keyframes whSlideRevealUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes whMotionSoftZoom {
          from { opacity: 0; transform: scale(0.985); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes whMotionGlideFwd {
          from { opacity: 0; transform: translateX(22px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes whMotionGlideBwd {
          from { opacity: 0; transform: translateX(-22px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes whMotionMinimalFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        /* Default subtle reveal (also used by sample previews) */
        .wh-fs-reveal-1 { animation: whSlideRevealUp 0.30s cubic-bezier(0.22, 1, 0.36, 1) 0.00s both; }
        .wh-fs-reveal-2 { animation: whSlideRevealUp 0.32s cubic-bezier(0.22, 1, 0.36, 1) 0.04s both; }
        .wh-fs-reveal-3 { animation: whSlideRevealUp 0.32s cubic-bezier(0.22, 1, 0.36, 1) 0.08s both; }
        .wh-fs-reveal-4 { animation: whSlideRevealUp 0.32s cubic-bezier(0.22, 1, 0.36, 1) 0.12s both; }

        /* 1. Subtle Default: gentle unified settle */
        .wh-motion-subtle { animation: whMotionMinimalFade 0.24s ease-out both; }
        .wh-motion-subtle .wh-fs-reveal-1 { animation: whSlideRevealUp 0.30s cubic-bezier(0.22, 1, 0.36, 1) 0.00s both; }
        .wh-motion-subtle .wh-fs-reveal-2 { animation: whSlideRevealUp 0.32s cubic-bezier(0.22, 1, 0.36, 1) 0.04s both; }
        .wh-motion-subtle .wh-fs-reveal-3 { animation: whSlideRevealUp 0.32s cubic-bezier(0.22, 1, 0.36, 1) 0.08s both; }
        .wh-motion-subtle .wh-fs-reveal-4 { animation: whSlideRevealUp 0.32s cubic-bezier(0.22, 1, 0.36, 1) 0.11s both; }

        /* 2. Soft Zoom (no blur) */
        .wh-motion-cinematic { animation: whMotionSoftZoom 0.34s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .wh-motion-cinematic .wh-fs-reveal-1,
        .wh-motion-cinematic .wh-fs-reveal-2,
        .wh-motion-cinematic .wh-fs-reveal-3,
        .wh-motion-cinematic .wh-fs-reveal-4 { animation: none; }

        /* 3. Gentle Directional Glide */
        .wh-motion-glide-fwd { animation: whMotionGlideFwd 0.32s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .wh-motion-glide-bwd { animation: whMotionGlideBwd 0.32s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .wh-motion-glide-fwd .wh-fs-reveal-1,
        .wh-motion-glide-fwd .wh-fs-reveal-2,
        .wh-motion-glide-fwd .wh-fs-reveal-3,
        .wh-motion-glide-fwd .wh-fs-reveal-4,
        .wh-motion-glide-bwd .wh-fs-reveal-1,
        .wh-motion-glide-bwd .wh-fs-reveal-2,
        .wh-motion-glide-bwd .wh-fs-reveal-3,
        .wh-motion-glide-bwd .wh-fs-reveal-4 { animation: none; }

        /* 4. Minimal Fade */
        .wh-motion-minimal { animation: whMotionMinimalFade 0.24s ease-out both; }
        .wh-motion-minimal .wh-fs-reveal-1,
        .wh-motion-minimal .wh-fs-reveal-2,
        .wh-motion-minimal .wh-fs-reveal-3,
        .wh-motion-minimal .wh-fs-reveal-4 { animation: none; }

        @media (prefers-reduced-motion: reduce) {
          .wh-motion-subtle, .wh-motion-cinematic, .wh-motion-glide-fwd, .wh-motion-glide-bwd, .wh-motion-minimal,
          .wh-fs-reveal-1, .wh-fs-reveal-2, .wh-fs-reveal-3, .wh-fs-reveal-4 {
            animation: none !important;
          }
        }
        .wh-fs-prose p { margin-bottom: 22px; }
        .wh-fs-prose ul { list-style-type: disc; padding-left: 44px; margin-bottom: 22px; }
        .wh-fs-prose ol { list-style-type: decimal; padding-left: 44px; margin-bottom: 22px; }
        .wh-fs-prose li { margin-bottom: 16px; padding-left: 6px; }
        .wh-fs-prose li::marker { color: var(--fs-accent); font-weight: bold; }
        .wh-fs-prose h3, .wh-fs-prose h4 {
          font-family: var(--fs-font-display);
          font-size: 1.2em;
          font-weight: 700;
          margin: 24px 0 12px 0;
          color: var(--fs-accent);
        }
        .wh-fs-prose blockquote, .wh-fs-prose div[data-callout] {
          border-left: 6px solid var(--fs-accent);
          background: var(--fs-surface);
          padding: 22px 28px;
          border-radius: 0 16px 16px 0;
          margin: 20px 0;
        }
        .wh-fs-prose code {
          font-family: var(--fs-font-mono);
          background: var(--fs-code-bg);
          color: var(--fs-code-fg);
          padding: 4px 12px;
          border-radius: 8px;
          font-size: 0.86em;
        }
        .wh-fs-prose pre {
          font-family: var(--fs-font-mono);
          background: var(--fs-code-bg);
          color: var(--fs-code-fg);
          border: 2px solid var(--fs-border);
          padding: 24px;
          border-radius: 16px;
          overflow-x: auto;
          font-size: 20px;
        }
        /* === Clean Theme-Native Presentation Tables === */
        .wh-fs-prose table, .wh-fs-table-host table {
          width: 100%;
          border-collapse: collapse;
          border-spacing: 0;
          table-layout: auto;
        }
        .wh-fs-prose th, .wh-fs-prose td, .wh-fs-table-host th, .wh-fs-table-host td {
          border: 0;
          border-bottom: 1px solid var(--fs-border);
          border-right: 1px solid color-mix(in srgb, var(--fs-border) 55%, transparent);
          padding: 15px 20px;
          text-align: left;
          vertical-align: top;
          word-break: break-word;
        }
        .wh-fs-table-host tr > *:last-child,
        .wh-fs-prose tr > *:last-child {
          border-right: 0;
        }
        .wh-fs-table-host tbody tr:last-child > td,
        .wh-fs-table-host tbody tr:last-child > th {
          border-bottom: 0;
        }
        .wh-fs-prose th, .wh-fs-table-host thead th, .wh-fs-table-host th {
          background: color-mix(in srgb, var(--fs-accent) 16%, var(--fs-surface));
          color: var(--fs-text);
          font-family: var(--fs-font-display);
          font-weight: 800;
          font-size: 0.94em;
          letter-spacing: 0.015em;
          border-bottom: 2.5px solid var(--fs-accent);
        }
        .wh-fs-table-host tbody tr:nth-child(even) {
          background: color-mix(in srgb, var(--fs-text) 4%, transparent);
        }
        .wh-fs-table-host td p, .wh-fs-table-host th p {
          margin: 0;
        }
        .wh-fs-table-host td p + p, .wh-fs-table-host th p + p {
          margin-top: 6px;
        }
        .wh-fs-table-host table table {
          border: 1px solid var(--fs-border);
          border-radius: 10px;
          overflow: hidden;
          margin: 6px 0;
        }
      `}</style>

      {/* Top Progress Bar */}
      <div
        className={cn(
          "bg-surface-sunken h-1 w-full shrink-0 overflow-hidden",
          isAudienceFullChrome &&
            "pointer-events-none absolute top-0 right-0 left-0 z-50 h-0.5 bg-transparent",
        )}
      >
        <div
          className="h-full motion-safe:transition-[width] motion-safe:duration-200"
          style={{
            width: `${progressPercent}%`,
            backgroundColor: activeTheme.accent,
          }}
        />
      </div>

      {/* 1-click Fullscreen pill when browser blocks requestFullscreen right after window.open */}
      {presenterViewOpen && !isFullscreen && needsFsPrompt ? (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface/95 px-2 py-1 text-xs font-medium text-foreground shadow-xl backdrop-blur-md">
          <button
            type="button"
            onClick={() => {
              setNeedsFsPrompt(false);
              toggleFullscreen();
            }}
            className="hover:bg-surface-hover flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors duration-150"
          >
            <Maximize2 className="size-3.5 text-primary" />
            <span>{t("present.enterAudienceFullscreenPrompt")}</span>
          </button>
          <button
            type="button"
            onClick={() => setNeedsFsPrompt(false)}
            aria-label={t("common.close")}
            className="text-muted-foreground hover:bg-surface-hover hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded-full transition-colors duration-150"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {/* Top Presenter Control Header (Slides down on hover, silky-smooth glide-up immediately on leave) */}
      <header
        onMouseEnter={() => {
          fsHoveringTopRef.current = true;
          if (isAudienceFullChrome) setFsTopVisible(true);
        }}
        onMouseLeave={() => {
          fsHoveringTopRef.current = false;
          if (isAudienceFullChrome) setFsTopVisible(false);
        }}
        style={
          isAudienceFullChrome
            ? {
                transform:
                  fsTopVisible || keepFsChromeOpen
                    ? "translate3d(0, 0, 0)"
                    : "translate3d(0, -100%, 0)",
                opacity: fsTopVisible || keepFsChromeOpen ? 1 : 0,
                transition:
                  fsTopVisible || keepFsChromeOpen
                    ? "transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out"
                    : "transform 480ms cubic-bezier(0.4, 0, 0.2, 1), opacity 420ms ease-in-out",
              }
            : undefined
        }
        className={cn(
          "border-border bg-surface text-foreground z-40 flex h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 sm:px-6",
          isAudienceFullChrome
            ? cn(
                "bg-surface/95 absolute top-0 right-0 left-0 shadow-lg backdrop-blur-md will-change-transform",
                !(fsTopVisible || keepFsChromeOpen) && "pointer-events-none",
              )
            : "relative",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-md font-bold"
            style={{
              backgroundColor: activeTheme.accent,
              color: activeTheme.textOnAccent,
            }}
          >
            <Presentation className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-foreground max-w-44 truncate text-sm font-semibold sm:max-w-64">
                {title}
              </span>
              <span className="border-border bg-surface-sunken text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
                {safeIndex + 1} / {slides.length}
              </span>
            </div>
            <p className="text-muted-foreground hidden truncate text-xs sm:block">
              {spaceName} ({spaceKey})
            </p>
          </div>
        </div>

        {/* Right: Export Dropdown (HTML / PDF), Print, Slide Show, Exit */}
        <div className="flex items-center gap-1.5">
          {/* Grouped Export Dropdown (HTML & Direct PDF Download) */}
          <div className="relative hidden md:block">
            <Button
              type="button"
              variant={exportMenuOpen ? "primary" : "secondary"}
              size="sm"
              disabled={exportingPdf}
              onClick={() => {
                setSlideShowMenuOpen(false);
                setExportMenuOpen((v) => !v);
              }}
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
              className="h-8 gap-1.5 text-xs font-medium"
            >
              {exportingPdf ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              <span>
                {exportingPdf
                  ? t("present.exportPdfGenerating")
                  : t("present.exportMenuBtn")}
              </span>
              <ChevronDown className="size-3 opacity-75" />
            </Button>

            {exportMenuOpen ? (
              <div
                role="menu"
                className="border-border bg-surface text-foreground absolute top-10 right-0 z-50 w-52 rounded-xl border p-1.5 shadow-2xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportMenuOpen(false);
                    handleDownloadStandaloneHtml();
                  }}
                  title={t("present.downloadHtmlTooltip")}
                  className="text-foreground hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors duration-150"
                >
                  <Download className="text-primary size-3.5" />
                  <span>{t("present.exportHtmlOption")}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleExportPdf()}
                  title={t("present.exportPdfTooltip")}
                  className="text-foreground hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors duration-150"
                >
                  <FileDown className="text-primary size-3.5" />
                  <span>{t("present.exportPdfOption")}</span>
                </button>
              </div>
            ) : null}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handlePrintSlides}
            title={t("present.printSlidesTooltip")}
            aria-label={t("present.printSlidesBtn")}
            className="hidden h-8 gap-1.5 text-xs lg:inline-flex"
          >
            <Printer className="size-3.5" />
            <span>{t("present.printSlidesBtn")}</span>
          </Button>

          {/* Slide Show Menu (Replaces Fullscreen icon: 1-Screen Fullscreen OR 2-Screen Presenter View) */}
          <div className="relative">
            <Button
              type="button"
              variant={
                isFullscreen || presenterViewOpen || slideShowMenuOpen
                  ? "primary"
                  : "secondary"
              }
              size="sm"
              onClick={() => setSlideShowMenuOpen((v) => !v)}
              aria-expanded={slideShowMenuOpen}
              aria-haspopup="menu"
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <Play className="size-3.5" />
              <span className="hidden sm:inline">{t("present.slideShowBtn")}</span>
              <ChevronDown className="size-3 opacity-75" />
            </Button>

            {slideShowMenuOpen ? (
              <div
                role="menu"
                className="border-border bg-surface text-foreground absolute top-10 right-0 z-50 w-60 rounded-xl border p-1.5 shadow-2xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSlideShowMenuOpen(false);
                    toggleFullscreen();
                  }}
                  className="text-foreground hover:bg-surface-hover flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors duration-150"
                >
                  <span className="flex items-center gap-2">
                    {isFullscreen ? (
                      <Minimize2 className="text-primary size-3.5" />
                    ) : (
                      <Maximize2 className="text-primary size-3.5" />
                    )}
                    {isFullscreen
                      ? t("present.exitFullscreen")
                      : t("present.slideShowFullscreen")}
                  </span>
                  <kbd className="border-border bg-surface-sunken text-muted-foreground rounded border px-1 font-mono text-[10px]">
                    F
                  </kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={startPresenterView}
                  className="text-foreground hover:bg-surface-hover flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors duration-150"
                >
                  <span className="flex items-center gap-2">
                    <Monitor className="text-primary size-3.5" />
                    {t("present.slideShowPresenterView")}
                  </span>
                </button>
              </div>
            ) : null}
          </div>

          {/* Dedicated 1-click Fullscreen toggle button */}
          <Button
            type="button"
            variant={isFullscreen ? "primary" : "secondary"}
            size="sm"
            onClick={toggleFullscreen}
            title={
              isFullscreen
                ? t("present.exitFullscreen")
                : t("present.enterFullscreen")
            }
            aria-label={
              isFullscreen
                ? t("present.exitFullscreen")
                : t("present.enterFullscreen")
            }
            className="size-8 p-0"
          >
            {isFullscreen ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>

          <span
            aria-hidden
            className="bg-border mx-0.5 hidden h-5 w-px sm:inline-block"
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExitConfirmOpen(true)}
            title={t("present.exitTooltip")}
            aria-label={t("present.exitTooltip")}
            className="border-danger/25 bg-danger/10 text-danger [&:not(:disabled)]:hover:border-danger [&:not(:disabled)]:hover:bg-danger [&:not(:disabled)]:hover:text-danger-foreground h-8 gap-1.5 border px-2.5 text-xs font-medium"
          >
            <X className="size-3.5" />
            <span className="hidden sm:inline">{t("present.exit")}</span>
          </Button>
        </div>
      </header>

      {/* Main Stage Body: Optional Left Edit Sidebar + 1920x1080 Scaled Deck Stage + Optional Notes Drawer */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Left Slide Editor Sidebar (Opens when Edit mode E is active) */}
        {inlineEditMode ? (
          <aside className="border-border bg-surface text-foreground z-20 flex w-72 shrink-0 flex-col border-r select-text sm:w-80">
            {/* Sidebar Header */}
            <div className="border-border flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <PencilLine className="text-primary size-4" aria-hidden />
                <h3 className="text-foreground text-sm font-semibold">
                  {t("present.editPanelTitle")}
                </h3>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleInlineEditMode}
                title={t("present.close")}
                aria-label={t("present.close")}
                className="size-7"
              >
                <X className="size-3.5" />
              </Button>
            </div>

            {/* Sidebar Body */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              {/* 1. Slide Structure (By section / More slides / Manual breaks / AI Summary) */}
              <div>
                <h4 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
                  {t("present.editSectionStructure")}
                </h4>
                <div
                  role="group"
                  aria-label={t("present.splitModeAria")}
                  className="grid grid-cols-2 gap-1.5"
                >
                  {(
                    [
                      {
                        id: "standard",
                        label: t("present.modeStandard"),
                        note: t("present.modeStandardTooltip"),
                      },
                      {
                        id: "detailed",
                        label: t("present.modeDetailed"),
                        note: t("present.modeDetailedTooltip"),
                      },
                      {
                        id: "divider",
                        label: t("present.modeDivider"),
                        note: t("present.modeDividerTooltip"),
                      },
                    ] as const
                  ).map((item) => {
                    const active = granularity === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setGranularity(item.id);
                          setActiveIndex(0);
                        }}
                        aria-pressed={active}
                        title={item.note}
                        className={cn(
                          "focus-visible:ring-ring cursor-pointer rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                          active
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-surface-sunken text-foreground hover:bg-surface-hover",
                        )}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                  {allowAiDeck && pageSlug ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGranularity("ai");
                        setActiveIndex(0);
                      }}
                      aria-pressed={granularity === "ai"}
                      title={t("present.modeAiDeckTooltip")}
                      className={cn(
                        "focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                        granularity === "ai"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-surface-sunken text-foreground hover:bg-surface-hover hover:text-primary",
                      )}
                    >
                      <Sparkles className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{t("present.modeAiDeck")}</span>
                    </button>
                  ) : null}
                </div>

                <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
                  {granularity === "standard"
                    ? t("present.modeStandardTooltip")
                    : granularity === "detailed"
                      ? t("present.modeDetailedTooltip")
                      : granularity === "divider"
                        ? t("present.modeDividerTooltip")
                        : t("present.modeAiDeckTooltip")}
                </p>

                {granularity === "ai" && aiStatusState?.enabled ? (
                  <div className="border-border bg-surface-sunken mt-2.5 flex items-center justify-between rounded-lg border p-1">
                    <div className="flex items-center gap-1">
                      {(["page", "vi", "en"] as const).map((lang) => (
                        <button
                          key={lang}
                          type="button"
                          disabled={aiPending}
                          onClick={() => {
                            if (lang === aiLanguage) return;
                            setAiLanguage(lang);
                            void loadAiDeck(false, lang);
                          }}
                          className={cn(
                            "focus-visible:ring-ring cursor-pointer rounded px-2 py-1 text-[11px] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
                            aiLanguage === lang
                              ? "bg-surface text-primary shadow-2xs"
                              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                          )}
                        >
                          {lang === "page"
                            ? t("ai.languagePage")
                            : lang === "vi"
                              ? "VI"
                              : "EN"}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={aiPending}
                      onClick={() => void loadAiDeck(true, aiLanguage)}
                      title={t("present.aiRegenerate")}
                      aria-label={t("present.aiRegenerate")}
                      className="text-muted-foreground hover:bg-surface-hover hover:text-foreground cursor-pointer rounded p-1 transition-colors duration-150 disabled:opacity-50"
                    >
                      <RefreshCw
                        className={cn("size-3.5", aiPending && "animate-spin")}
                      />
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="bg-border h-px" />

              {/* 2. Slide Theme */}
              <div>
                <h4 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
                  {t("present.editSectionTheme")}
                </h4>
                <div className="border-border bg-surface-sunken flex items-center justify-between gap-2 rounded-lg border p-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex shrink-0 items-center -space-x-1">
                      {activeTheme.previewSwatches.map((hex, i) => (
                        <span
                          key={i}
                          className="size-3.5 rounded-full border border-black/30"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </span>
                    <span className="truncate text-xs font-semibold">
                      {activeTheme.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => cycleTheme(-1)}
                      title={t("present.prevTheme")}
                      aria-label={t("present.prevTheme")}
                      className="text-muted-foreground hover:bg-surface-hover hover:text-foreground cursor-pointer rounded p-1 transition-colors duration-150"
                    >
                      <ChevronLeft className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => cycleTheme(1)}
                      title={t("present.nextTheme")}
                      aria-label={t("present.nextTheme")}
                      className="text-muted-foreground hover:bg-surface-hover hover:text-foreground cursor-pointer rounded p-1 transition-colors duration-150"
                    >
                      <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPreviewThemeId(null);
                    setThemeGalleryOpen((v) => !v);
                  }}
                  className="mt-2 h-8 w-full justify-between text-xs"
                >
                  <span className="flex items-center gap-1.5">
                    <Palette className="text-primary size-3.5" />
                    {t("present.editBrowseThemes")}
                  </span>
                  <kbd className="border-border bg-surface text-muted-foreground rounded border px-1 font-mono text-[10px]">
                    T
                  </kbd>
                </Button>
              </div>

              <div className="bg-border h-px" />

              {/* 3. Slide Motion */}
              <div>
                <h4 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
                  {t("present.editSectionMotion")}
                </h4>
                <div className="grid grid-cols-2 gap-1.5">
                  {MOTION_OPTIONS.map((opt) => {
                    const selected = motionStyle === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setMotionStyle(opt.id);
                          saveMotionStyle(opt.id);
                          setRevealTick((tick) => tick + 1);
                        }}
                        className={cn(
                          "cursor-pointer truncate rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors duration-150",
                          selected
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-surface-sunken text-foreground hover:bg-surface-hover",
                        )}
                      >
                        {t(opt.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-border h-px" />

              {/* 4. Inline Editing Tip & Reset Current Slide */}
              <div className="border-border bg-surface-sunken/70 rounded-lg border p-3">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t("present.editInlineTip")}
                </p>
                {slideEdits[currentSlide.id] ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSlideEdits((prev) => {
                        const next = { ...prev };
                        delete next[currentSlide.id];
                        return next;
                      })
                    }
                    className="text-danger hover:bg-danger/10 hover:text-danger mt-2 h-7 gap-1.5 px-2 text-xs"
                  >
                    <RotateCcw className="size-3" />
                    {t("present.editResetSlide")}
                  </Button>
                ) : null}
              </div>
            </div>

            {/* Sticky Save Footer */}
            <div className="border-border bg-surface flex items-center gap-2 border-t px-4 py-3">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSaveEdits}
                className="h-9 flex-1 gap-1.5 text-xs font-semibold"
              >
                {saveJustCompleted ? (
                  <>
                    <Check className="size-3.5" />
                    {t("present.editSavedBadge")}
                  </>
                ) : (
                  <>
                    <Save className="size-3.5" />
                    {t("present.editSaveBtn")}
                  </>
                )}
              </Button>
            </div>
          </aside>
        ) : null}

        {/* Full-Viewport Letterboxed Deck Container (`.deck-viewport`) */}
        <div
          ref={viewportBoxRef}
          onClick={(e) => {
            if (stageContextMenu) {
              setStageContextMenu(null);
              return;
            }
            if (e.button !== 0 || penActive || inlineEditMode) return;
            const target = e.target as HTMLElement | null;
            if (
              target?.closest(
                "button, a, input, textarea, [contenteditable='true'], [role='menu']",
              )
            ) {
              return;
            }
            stepForward();
          }}
          onContextMenu={(e) => {
            if (themeGalleryOpen || overviewOpen || spotlight) return;
            e.preventDefault();
            const menuW = 248;
            const menuH = 420;
            const x = Math.max(
              12,
              Math.min(e.clientX, window.innerWidth - menuW - 12),
            );
            const y = Math.max(
              12,
              Math.min(e.clientY, window.innerHeight - menuH - 12),
            );
            setStageContextMenu({ x, y });
          }}
          className="relative flex-1 overflow-hidden transition-colors duration-300"
          style={{ backgroundColor: activeTheme.stageBg }}
        >
          {granularity === "ai" &&
          aiStatusState !== null &&
          !aiStatusState.enabled ? (
            <div className="flex size-full items-center justify-center p-6">
              <div className="border-border bg-surface text-foreground max-w-lg space-y-4 rounded-xl border p-6 shadow-2xl">
                <AiNotSetUp canConfigure={aiStatusState.can_configure} />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setGranularity("standard")}
                  >
                    {t("present.useStandardSlides")}
                  </Button>
                </div>
              </div>
            </div>
          ) : granularity === "ai" && aiPending ? (
            <div className="flex size-full items-center justify-center p-6">
              <div className="border-border bg-surface text-foreground flex max-w-md flex-col items-center rounded-2xl border p-8 text-center shadow-2xl">
                <Loader2 className="text-primary size-9 animate-spin" />
                <p className="mt-4 text-base font-semibold">
                  {t("present.aiGeneratingTitle")}
                </p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {t("present.aiGeneratingHint")}
                </p>
              </div>
            </div>
          ) : granularity === "ai" && aiError ? (
            <div className="flex size-full items-center justify-center p-6">
              <div className="border-border bg-surface text-foreground max-w-md space-y-4 rounded-2xl border p-6 text-center shadow-2xl">
                <p className="text-danger text-sm font-medium">{aiError}</p>
                <div className="flex justify-center gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => void loadAiDeck(true, aiLanguage)}
                  >
                    <RefreshCw className="size-3.5" />
                    {t("common.retry")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setGranularity("standard")}
                  >
                    {t("present.useStandardSlides")}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* =====================================================
               FIXED 1920×1080 STAGE (`.deck-stage` from frontend-slides)
               ===================================================== */
            <div
              ref={fixedStageRef}
              onInput={() => {
                if (inlineEditMode) pendingInlineInputRef.current = true;
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={
                {
                  width: `${STAGE_WIDTH}px`,
                  height: `${STAGE_HEIGHT}px`,
                  transformOrigin: "0 0",
                  transform: `translate(${stageTransform.x}px, ${stageTransform.y}px) scale(${stageTransform.scale})`,
                  background: activeTheme.slideBg,
                  color: activeTheme.textPrimary,
                  fontFamily: activeTheme.fontBody,
                  "--fs-accent": activeTheme.accent,
                  "--fs-surface": activeTheme.slideSurface,
                  "--fs-border": activeTheme.borderColor,
                  "--fs-code-bg": activeTheme.codeBg,
                  "--fs-code-fg": activeTheme.codeFg,
                  "--fs-font-display": activeTheme.fontDisplay,
                  "--fs-font-mono": activeTheme.fontMono,
                  cursor: penActive
                    ? eraserActive
                      ? buildEraserCursorUrl()
                      : buildPenCursorUrl(
                          PEN_COLORS.find((c) => c.key === penColor)?.hex ??
                            "#38bdf8",
                        )
                    : undefined,
                } as CSSProperties
              }
              className={cn(
                "absolute top-0 left-0 overflow-hidden",
                isAudienceFullChrome
                  ? "rounded-none shadow-none"
                  : "rounded-2xl shadow-[0_28px_90px_rgba(0,0,0,0.55)]",
                laserActive && "cursor-crosshair",
              )}
            >
              {/* Theme-specific architectural motifs & atmospheric background */}
              <ThemeSignatureDecoration
                theme={activeTheme}
                slideIndex={safeIndex}
                totalSlides={slides.length}
              />

              {/* Slide Inner 1920x1080 Content Canvas */}
              <div
                key={`${currentSlide.id}-${activeTheme.id}-${motionStyle}-${revealTick}`}
                className={cn(
                  "relative z-10 flex size-full flex-col justify-between",
                  resolveSlideMotionClass(
                    motionStyle,
                    currentSlide.layout,
                    safeIndex,
                    slideDirection,
                  ),
                )}
                style={{
                  padding:
                    activeTheme.id === "notebook-tabs"
                      ? "84px 128px 72px 116px"
                      : activeTheme.id === "terminal-green"
                        ? "96px 104px 72px 104px"
                        : "84px 108px 72px 108px",
                }}
              >
                {currentSlide.layout === "cover" ? (
                  /* === 1920x1080 COVER SLIDE === */
                  <>
                    <div className="wh-fs-reveal-1 flex items-center justify-between">
                      <div className="flex items-center gap-5">
                        <span
                          className="text-4xl font-black tracking-tight"
                          style={{
                            fontFamily: activeTheme.fontDisplay,
                            color: activeTheme.accent,
                          }}
                        >
                          {slideNumFormatted}
                        </span>
                        <span
                          className="rounded-full border-2 px-5 py-1.5 text-lg font-bold tracking-widest uppercase"
                          style={{
                            borderColor: activeTheme.borderColor,
                            backgroundColor: activeTheme.slideSurface,
                            color: activeTheme.accent,
                          }}
                        >
                          {currentSlide.eyebrow}
                        </span>
                        {granularity === "ai" ? (
                          <span
                            className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-base font-bold"
                            style={{
                              backgroundColor: activeTheme.accent,
                              color: activeTheme.textOnAccent,
                            }}
                          >
                            <Sparkles className="size-4" />
                            {t("present.modeAiDeck")}
                          </span>
                        ) : null}
                      </div>

                      {/* Navigation Breadcrumb dots (Bold Signal signature) */}
                      <div className="flex items-center gap-2">
                        {slides.slice(0, 14).map((s, idx) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setActiveIndex(idx)}
                            aria-label={`Slide ${idx + 1}`}
                            className="h-2.5 cursor-pointer rounded-full transition-all"
                            style={{
                              width: idx === safeIndex ? "36px" : "10px",
                              backgroundColor:
                                idx === safeIndex
                                  ? activeTheme.accent
                                  : activeTheme.textSecondary,
                              opacity: idx === safeIndex ? 1 : 0.35,
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Hero Cover Focal Card or Typography Block */}
                    <div
                      className={cn(
                        "wh-fs-reveal-2 my-auto flex flex-col justify-center",
                        activeTheme.id === "bold-signal" &&
                          "rounded-3xl p-14 shadow-2xl",
                      )}
                      style={
                        activeTheme.id === "bold-signal"
                          ? {
                              backgroundColor: activeTheme.cardBg,
                              color: activeTheme.textOnAccent,
                            }
                          : undefined
                      }
                    >
                      <h1
                        contentEditable={inlineEditMode}
                        suppressContentEditableWarning
                        className={cn(
                          "max-w-[1560px] font-black tracking-tight outline-none",
                          inlineEditMode &&
                            "rounded-xl ring-2 ring-dashed ring-[var(--fs-accent)]",
                        )}
                        style={{
                          fontFamily: activeTheme.fontDisplay,
                          fontSize:
                            currentSlide.title.length > 55 ? "72px" : "92px",
                          lineHeight: 1.08,
                          color:
                            activeTheme.id === "bold-signal"
                              ? activeTheme.textOnAccent
                              : activeTheme.textPrimary,
                        }}
                      >
                        {activeTheme.id === "terminal-green" ? ">_ " : ""}
                        {currentSlide.title}
                      </h1>

                      {currentSlide.subtitle ? (
                        <p
                          contentEditable={inlineEditMode}
                          suppressContentEditableWarning
                          className="wh-fs-reveal-3 mt-7 max-w-[1340px] text-[32px] leading-relaxed"
                          style={{
                            color:
                              activeTheme.id === "bold-signal"
                                ? "rgba(26,26,26,0.85)"
                                : activeTheme.textSecondary,
                          }}
                        >
                          {currentSlide.subtitle}
                        </p>
                      ) : null}

                      {currentSlide.bullets.length > 0 ? (
                        <div className="wh-fs-reveal-4 mt-9 flex flex-wrap items-center gap-3.5">
                          {currentSlide.bullets.map((label, idx) => (
                            <span
                              key={`${label}-${idx}`}
                              className="rounded-full border-2 px-5 py-2 text-xl font-semibold"
                              style={{
                                backgroundColor:
                                  activeTheme.id === "bold-signal"
                                    ? "rgba(26,26,26,0.14)"
                                    : activeTheme.slideSurface,
                                borderColor: activeTheme.borderColor,
                                color:
                                  activeTheme.id === "bold-signal"
                                    ? activeTheme.textOnAccent
                                    : activeTheme.textPrimary,
                              }}
                            >
                              #{label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {/* Cover Bottom Metadata */}
                    <div
                      className="wh-fs-reveal-4 flex items-center justify-between border-t-2 pt-6 text-xl font-medium"
                      style={{
                        borderColor: activeTheme.borderColor,
                        color: activeTheme.textSecondary,
                      }}
                    >
                      <span>{currentSlide.callout || spaceName}</span>
                      <span
                        className="font-mono font-bold"
                        style={{ color: activeTheme.accent }}
                      >
                        {slideNumFormatted} / {totalFormatted}
                      </span>
                    </div>
                  </>
                ) : currentSlide.layout === "section" ? (
                  /* === 1920x1080 SECTION BEAT SLIDE === */
                  <div className="my-auto flex flex-col items-start justify-center space-y-6">
                    <span
                      className="wh-fs-reveal-1 text-[148px] leading-none font-black"
                      style={{
                        fontFamily: activeTheme.fontDisplay,
                        color: activeTheme.accent,
                        opacity: 0.9,
                      }}
                    >
                      {slideNumFormatted}
                    </span>
                    <span
                      className="wh-fs-reveal-2 text-xl font-bold tracking-widest uppercase"
                      style={{ color: activeTheme.textSecondary }}
                    >
                      {currentSlide.eyebrow}
                    </span>
                    <h2
                      contentEditable={inlineEditMode}
                      suppressContentEditableWarning
                      className={cn(
                        "wh-fs-reveal-3 max-w-[1520px] text-[80px] leading-[1.1] font-black tracking-tight outline-none",
                        inlineEditMode &&
                          "rounded-xl ring-2 ring-dashed ring-[var(--fs-accent)]",
                      )}
                      style={{
                        fontFamily: activeTheme.fontDisplay,
                        color: activeTheme.textPrimary,
                      }}
                    >
                      {currentSlide.title}
                    </h2>
                    {currentSlide.subtitle ? (
                      <p
                        contentEditable={inlineEditMode}
                        suppressContentEditableWarning
                        className="wh-fs-reveal-4 max-w-[1280px] text-[32px] leading-relaxed"
                        style={{ color: activeTheme.textSecondary }}
                      >
                        {currentSlide.subtitle}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  /* === 1920x1080 CONTENT / SPLIT / VISUAL SLIDE === */
                  <>
                    {/* Slide Header */}
                    <div
                      className="wh-fs-reveal-1 flex shrink-0 items-end justify-between gap-6 border-b-2 pb-6"
                      style={{ borderColor: activeTheme.borderColor }}
                    >
                      <div className="flex items-center gap-7 min-w-0">
                        <span
                          className="flex size-16 shrink-0 items-center justify-center rounded-2xl text-3xl font-black"
                          style={{
                            fontFamily: activeTheme.fontDisplay,
                            backgroundColor: activeTheme.accent,
                            color: activeTheme.textOnAccent,
                          }}
                        >
                          {slideNumFormatted}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <span
                              className="truncate text-base font-bold tracking-widest uppercase"
                              style={{ color: activeTheme.accent }}
                            >
                              {currentSlide.eyebrow}
                            </span>
                            {currentSlide.partTotal ? (
                              <span
                                className="rounded-md border px-2.5 py-0.5 text-sm font-semibold"
                                style={{
                                  borderColor: activeTheme.borderColor,
                                  backgroundColor: activeTheme.slideSurface,
                                  color: activeTheme.textSecondary,
                                }}
                              >
                                {t("present.partOf", {
                                  part: currentSlide.partIndex ?? 1,
                                  total: currentSlide.partTotal,
                                })}
                              </span>
                            ) : null}
                          </div>
                          <h2
                            contentEditable={inlineEditMode}
                            suppressContentEditableWarning
                            onBlur={
                              inlineEditMode
                                ? (e) => {
                                    const nextTitle =
                                      e.currentTarget.textContent?.trim();
                                    if (nextTitle) {
                                      setSlideEdits((prev) => ({
                                        ...prev,
                                        [currentSlide.id]: {
                                          ...prev[currentSlide.id],
                                          title: nextTitle,
                                        },
                                      }));
                                    }
                                  }
                                : undefined
                            }
                            className={cn(
                              "mt-1 truncate font-bold tracking-tight outline-none",
                              inlineEditMode &&
                                "cursor-text select-text rounded-lg ring-2 ring-dashed ring-[var(--fs-accent)]",
                            )}
                            style={{
                              fontFamily: activeTheme.fontDisplay,
                              fontSize:
                                currentSlide.title.length > 48
                                  ? "42px"
                                  : "52px",
                              lineHeight: 1.15,
                              color: activeTheme.textPrimary,
                            }}
                          >
                            {currentSlide.title}
                          </h2>
                        </div>
                      </div>

                      {/* Navigation Breadcrumb dots top-right */}
                      <div className="flex shrink-0 items-center gap-2">
                        {slides.slice(0, 14).map((s, idx) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setActiveIndex(idx)}
                            aria-label={`Slide ${idx + 1}`}
                            className="h-2.5 cursor-pointer rounded-full transition-all"
                            style={{
                              width: idx === safeIndex ? "30px" : "9px",
                              backgroundColor:
                                idx === safeIndex
                                  ? activeTheme.accent
                                  : activeTheme.textSecondary,
                              opacity: idx === safeIndex ? 1 : 0.35,
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Slide Main Body (1920x1080 proportions — strictly zero scrollbars) */}
                    <div
                      className={cn(
                        "wh-fs-reveal-2 my-auto min-h-0 flex-1 overflow-hidden py-6",
                        currentSlide.layout === "split"
                          ? "grid grid-cols-12 items-center gap-12"
                          : "flex flex-col justify-center gap-7",
                      )}
                    >
                      {currentSlide.bodyHtml ||
                      currentSlide.bullets.length > 0 ? (
                        <AutoFitSlideBody
                          maxHeight={currentSlide.visuals.length > 0 ? 300 : 680}
                          className={cn(
                            currentSlide.layout === "split" && "col-span-6",
                          )}
                        >
                          <div
                            contentEditable={inlineEditMode}
                            suppressContentEditableWarning
                            onBlur={
                              inlineEditMode
                                ? (e) => {
                                    const nextHtml = e.currentTarget.innerHTML;
                                    setSlideEdits((prev) => ({
                                      ...prev,
                                      [currentSlide.id]: {
                                        ...prev[currentSlide.id],
                                        bodyHtml: nextHtml,
                                      },
                                    }));
                                  }
                                : undefined
                            }
                            className={cn(
                              "outline-none",
                              inlineEditMode &&
                                "cursor-text select-text rounded-xl p-2 ring-2 ring-dashed ring-[var(--fs-accent)]",
                            )}
                            style={{
                              fontSize:
                                currentSlide.density === "low"
                                  ? "38px"
                                  : currentSlide.density === "medium"
                                    ? "32px"
                                    : "26px",
                              lineHeight: 1.5,
                              color: activeTheme.textPrimary,
                            }}
                          >
                            {!inlineEditMode &&
                            bulletReveal &&
                            currentSlide.bullets.length > 0 ? (
                              <ul className="wh-fs-prose list-disc space-y-5 pl-11">
                                {currentSlide.bullets.map((itemHtml, idx) => {
                                  const isVisible = idx < revealedCount;
                                  const isCurrent = idx === revealedCount - 1;
                                  return (
                                    <li
                                      key={idx}
                                      className="motion-safe:transition-opacity motion-safe:duration-200"
                                      style={{
                                        opacity: isVisible
                                          ? isCurrent
                                            ? 1
                                            : 0.82
                                          : 0.14,
                                      }}
                                      dangerouslySetInnerHTML={{
                                        __html: itemHtml,
                                      }}
                                    />
                                  );
                                })}
                              </ul>
                            ) : (
                              <div
                                className="wh-fs-prose"
                                dangerouslySetInnerHTML={{
                                  __html: currentSlide.bodyHtml,
                                }}
                              />
                            )}
                          </div>
                        </AutoFitSlideBody>
                      ) : null}

                      {currentSlide.visuals.length > 0 ? (
                        <div
                          className={cn(
                            "wh-fs-reveal-3 flex flex-col justify-center gap-6",
                            currentSlide.layout === "split"
                              ? "col-span-6"
                              : "w-full",
                          )}
                        >
                          {currentSlide.visuals.map(renderVisualBlock)}
                        </div>
                      ) : null}
                    </div>

                    {/* Slide Footer */}
                    <div
                      className="flex shrink-0 items-center justify-between border-t-2 pt-4 text-lg font-medium"
                      style={{
                        borderColor: activeTheme.borderColor,
                        color: activeTheme.textSecondary,
                      }}
                    >
                      <span className="truncate">{title}</span>
                      <div className="flex items-center gap-5">
                        {bulletReveal &&
                        currentSlide.bullets.length > 1 ? (
                          <span
                            className="font-bold"
                            style={{ color: activeTheme.accent }}
                          >
                            {t("present.bulletStep", {
                              current: Math.min(
                                revealedCount,
                                currentSlide.bullets.length,
                              ),
                              total: currentSlide.bullets.length,
                            })}
                          </span>
                        ) : null}
                        <span className="font-mono font-bold tabular-nums">
                          {slideNumFormatted} / {totalFormatted}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* SVG Overlay for Freehand Annotations & Laser Pointer Trail (in 1920x1080 space) */}
              <svg
                viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 z-20 size-full"
              >
                {currentStrokes.map((stroke, sIdx) => {
                  if (stroke.points.length < 2) return null;
                  const d = stroke.points
                    .map(
                      (p, i) =>
                        `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
                    )
                    .join(" ");
                  const isHoveredErase =
                    penActive && eraserActive && hoveredEraseIdx === sIdx;
                  return (
                    <g key={sIdx}>
                      {isHoveredErase ? (
                        <path
                          d={d}
                          fill="none"
                          stroke="#f43f5e"
                          strokeWidth="18"
                          strokeOpacity="0.32"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : null}
                      <path
                        d={d}
                        fill="none"
                        stroke={isHoveredErase ? "#f43f5e" : stroke.color}
                        strokeWidth={isHoveredErase ? "9" : "7"}
                        strokeDasharray={isHoveredErase ? "14 10" : undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  );
                })}
                {laserActive && laserTrail.length > 1 ? (
                  <>
                    <path
                      d={laserTrail
                        .map(
                          (p, i) =>
                            `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
                        )
                        .join(" ")}
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeOpacity="0.75"
                    />
                    {laserTrail[laserTrail.length - 1] ? (
                      <circle
                        cx={laserTrail[laserTrail.length - 1]!.x}
                        cy={laserTrail[laserTrail.length - 1]!.y}
                        r="11"
                        fill="#f43f5e"
                      />
                    ) : null}
                  </>
                ) : null}
              </svg>
            </div>
          )}
        </div>

        {/* Right Speaker Notes & Pacing Timer Drawer (Toggled with N) */}
        {notesOpen ? (
          <aside className="border-border bg-surface text-foreground flex w-80 shrink-0 flex-col border-l select-text sm:w-96">
            <div className="border-border flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Clock className="text-primary size-4" aria-hidden />
                <span className="text-foreground font-mono text-lg font-bold tabular-nums">
                  {formatTimer(timerSeconds)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setTimerRunning((r) => !r)}
                  title={
                    timerRunning
                      ? t("present.pauseTimer")
                      : t("present.resumeTimer")
                  }
                  className="size-7"
                >
                  {timerRunning ? (
                    <Pause className="size-3.5" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setTimerSeconds(0)}
                  title={t("present.resetTimer")}
                  className="size-7"
                >
                  <RotateCcw className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setNotesOpen(false)}
                  title={t("present.close")}
                  className="size-7"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    {t("present.speakerNotesTitle")}
                  </h3>
                  {customNotesBySlide[currentSlide.id]?.trim() ? (
                    <span className="text-muted-foreground text-[10px]">
                      {t("present.customNotesSaved")}
                    </span>
                  ) : null}
                </div>

                {currentSlide.speakerNotes.length > 0 ? (
                  <ul className="mt-2.5 space-y-2">
                    {currentSlide.speakerNotes.map((note, idx) => (
                      <li
                        key={idx}
                        className="border-border bg-surface-sunken text-foreground rounded-lg border p-3 text-xs leading-relaxed"
                      >
                        {note}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                    {t("present.noSpeakerNotesHint")}
                  </p>
                )}

                <SpeakerNotesRichEditor
                  slideId={currentSlide.id}
                  value={customNotesBySlide[currentSlide.id] ?? ""}
                  onChange={(nextHtml) =>
                    updateCustomNote(currentSlide.id, nextHtml)
                  }
                  placeholder={t("present.customNotesPlaceholder")}
                />
              </div>

              <div className="border-border border-t pt-4">
                <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  {t("present.upNext")}
                </h3>
                {nextSlide ? (
                  <button
                    type="button"
                    onClick={() => setActiveIndex(safeIndex + 1)}
                    className="border-border bg-surface-sunken hover:bg-surface-hover focus-visible:ring-ring mt-2 w-full cursor-pointer rounded-lg border p-3 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span className="text-primary text-[11px] font-semibold">
                      {t("present.slideNumber", { number: safeIndex + 2 })}
                    </span>
                    <p className="text-foreground mt-0.5 line-clamp-2 text-xs font-semibold">
                      {nextSlide.title}
                    </p>
                  </button>
                ) : (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t("present.endOfDeck")}
                  </p>
                )}
              </div>
            </div>
          </aside>
        ) : null}

        {/* =====================================================
           DOCKED SIDE THEME PICKER PANEL (Opens beside Left Edit Sidebar)
           Lets the user click themes and watch their live slide update immediately
           ===================================================== */}
        {themeGalleryOpen ? (
          <div className="border-border bg-surface text-foreground absolute top-0 bottom-0 left-72 z-30 flex w-80 flex-col overflow-hidden border-r shadow-2xl select-text sm:left-80 sm:w-[360px]">
            {/* Compact Panel Header */}
            <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Palette className="text-primary size-4" />
                <h3 className="text-foreground text-sm font-semibold">
                  {t("present.editSectionTheme")}
                </h3>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setPreviewThemeId(null);
                  setThemeGalleryOpen(false);
                }}
                title={t("present.close")}
                aria-label={t("present.close")}
                className="size-7"
              >
                <X className="size-3.5" />
              </Button>
            </div>

            {/* Category Filter Pills */}
            <div className="border-border bg-surface-sunken/60 flex items-center gap-1 border-b px-3 py-2">
              {(
                [
                  { id: "all", label: t("present.themeCatAll") },
                  { id: "dark", label: t("present.themeCatDark") },
                  { id: "light", label: t("present.themeCatLight") },
                  {
                    id: "specialty",
                    label: t("present.themeCatSpecialty"),
                  },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setThemeCategoryFilter(cat.id)}
                  className={cn(
                    "flex-1 cursor-pointer truncate rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors duration-150",
                    themeCategoryFilter === cat.id
                      ? "bg-surface text-foreground shadow-2xs"
                      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Compact 2-Column Live Theme Grid */}
            <div className="bg-surface-sunken/40 min-h-0 flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-2 gap-2.5">
                {filteredThemes.map((th) => {
                  const isSelected = th.id === themeId;
                  return (
                    <div
                      key={th.id}
                      className={cn(
                        "group bg-surface relative flex flex-col overflow-hidden rounded-xl border transition-colors duration-150",
                        isSelected
                          ? "border-primary ring-primary/25 ring-2"
                          : "border-border hover:border-border-strong",
                      )}
                    >
                      {/* Compact Visual Swatch — click to apply live immediately */}
                      <button
                        type="button"
                        onClick={() => selectTheme(th.id)}
                        className="relative flex aspect-[16/10] w-full cursor-pointer flex-col justify-between overflow-hidden p-2.5 text-left focus-visible:outline-none"
                        style={{
                          background: th.slideBg,
                          color: th.textPrimary,
                        }}
                      >
                        {th.id === "bold-signal" ? (
                          <div
                            className="absolute inset-x-0 top-0 h-1"
                            style={{ backgroundColor: th.accent }}
                          />
                        ) : th.id === "electric-studio" ? (
                          <div
                            className="absolute inset-y-0 left-0 w-1"
                            style={{ backgroundColor: th.accent }}
                          />
                        ) : th.id === "swiss-modern" ? (
                          <div className="absolute top-0 right-2 size-4 bg-[#ff3300]" />
                        ) : th.id === "notebook-tabs" ? (
                          <div className="absolute inset-y-2 right-0 flex flex-col justify-center gap-0.5">
                            {["#98d4bb", "#c7b8ea", "#f4b8c5", "#a8d8ea"].map(
                              (c, i) => (
                                <span
                                  key={i}
                                  className="h-2.5 w-1 rounded-l"
                                  style={{ backgroundColor: c }}
                                />
                              ),
                            )}
                          </div>
                        ) : null}

                        <div
                          className={cn(
                            "my-auto",
                            th.id === "bold-signal" &&
                              "rounded-md px-2 py-1 shadow-xs",
                          )}
                          style={
                            th.id === "bold-signal"
                              ? {
                                  backgroundColor: th.cardBg,
                                  color: th.textOnAccent,
                                }
                              : undefined
                          }
                        >
                          <div
                            className="text-base leading-none font-black tracking-tight"
                            style={{
                              fontFamily: th.fontDisplay,
                              color:
                                th.id === "bold-signal"
                                  ? th.textOnAccent
                                  : th.textPrimary,
                            }}
                          >
                            {th.id === "terminal-green" ? ">_ Aa" : "Aa"}
                          </div>
                          <div className="mt-1.5 flex flex-col gap-0.5">
                            <span
                              className="h-1 w-3/4 rounded-full"
                              style={{
                                backgroundColor:
                                  th.id === "bold-signal"
                                    ? "rgba(26,26,26,0.45)"
                                    : th.accent,
                                opacity: 0.85,
                              }}
                            />
                            <span
                              className="h-0.5 w-1/2 rounded-full"
                              style={{
                                backgroundColor:
                                  th.id === "bold-signal"
                                    ? "rgba(26,26,26,0.28)"
                                    : th.textSecondary,
                                opacity: 0.45,
                              }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          {th.previewSwatches.map((hex, i) => (
                            <span
                              key={i}
                              className="size-2 rounded-full border border-black/25"
                              style={{ backgroundColor: hex }}
                            />
                          ))}
                        </div>
                      </button>

                      {/* Compact Card Footer: Theme Name + Active Check + Preview Icon */}
                      <div className="border-border/70 flex items-center justify-between gap-1 border-t px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => selectTheme(th.id)}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left focus-visible:outline-none"
                        >
                          <span className="text-foreground truncate text-[11px] font-semibold">
                            {th.name}
                          </span>
                          {isSelected ? (
                            <Check
                              className="text-primary size-3 shrink-0"
                              aria-label={t("present.activeThemeBadge")}
                            />
                          ) : null}
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewThemeId(th.id);
                            setPreviewSlideIdx(0);
                          }}
                          title={t("present.previewThemeBtn")}
                          aria-label={`${t("present.previewThemeBtn")} ${th.name}`}
                          className="text-muted-foreground hover:bg-surface-hover hover:text-foreground inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none"
                        >
                          <Eye className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* =====================================================
               DEDICATED THEME SAMPLE PREVIEW MODAL (Over the Gallery)
               Shows 3 curated sample slides (Cover, Content/Metrics, Table/Code)
               ===================================================== */}
            {previewTheme ? (
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`${previewTheme.name} — ${t("present.previewSlideSample")}`}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setPreviewThemeId(null);
                }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs sm:p-8"
              >
                <div className="border-border bg-surface text-foreground flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border shadow-2xl">
                  {/* Modal Header */}
                  <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center -space-x-1">
                        {previewTheme.previewSwatches.map((hex, i) => (
                          <span
                            key={i}
                            className="size-4 rounded-full border border-black/25"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-foreground text-sm font-bold">
                            {previewTheme.name}
                          </h4>
                          <span className="border-border bg-surface-sunken text-muted-foreground rounded-full border px-2 py-0.5 text-[11px] font-medium">
                            {t("present.previewSlideSample")}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {locale === "vi"
                            ? previewTheme.vibeVi
                            : previewTheme.vibeEn}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="border-border bg-surface-sunken text-muted-foreground rounded-md border px-2 py-1 font-mono text-[11px] font-semibold">
                        {previewSlideIdx + 1} / {SAMPLE_PREVIEW_SLIDE_COUNT}
                      </span>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setPreviewThemeId(null)}
                        title={t("present.close")}
                        aria-label={t("present.close")}
                        className="size-8"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Sample Slide Switcher Bar (7 Diverse Layouts) */}
                  <div className="border-border bg-surface-sunken/70 flex items-center gap-1.5 overflow-x-auto border-b px-5 py-2">
                    {SAMPLE_PREVIEW_TABS.map((tab) => (
                      <button
                        key={tab.idx}
                        type="button"
                        onClick={() => setPreviewSlideIdx(tab.idx)}
                        className={cn(
                          "shrink-0 cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                          previewSlideIdx === tab.idx
                            ? "border-primary/40 bg-surface text-foreground shadow-2xs"
                            : "border-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                        )}
                      >
                        {t(tab.labelKey)}
                      </button>
                    ))}
                  </div>

                  {/* Modal Body: Live 16:9 Sample Slide Stage (supports wheel scroll to switch slides) */}
                  <div
                    ref={previewModalStageRef}
                    className="bg-surface-sunken flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5 sm:p-7"
                  >
                    <div
                      key={`${previewTheme.id}-sample-${previewSlideIdx}`}
                      className="border-border relative aspect-video w-full overflow-hidden rounded-xl border shadow-xl"
                      style={{
                        background: previewTheme.slideBg,
                        color: previewTheme.textPrimary,
                        fontFamily: previewTheme.fontBody,
                      }}
                    >
                      <ThemeSignatureDecoration
                        theme={previewTheme}
                        slideIndex={previewSlideIdx}
                        totalSlides={SAMPLE_PREVIEW_SLIDE_COUNT}
                      />

                      <div
                        className="relative z-10 flex size-full flex-col justify-between"
                        style={{
                          padding:
                            previewTheme.id === "notebook-tabs"
                              ? "32px 52px 26px 56px"
                              : previewTheme.id === "terminal-green"
                                ? "52px 44px 28px 44px"
                                : "36px 48px 28px 48px",
                        }}
                      >
                        <ThemeSampleSlideContent
                          theme={previewTheme}
                          slideIndex={previewSlideIdx}
                          locale={locale}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="border-border bg-surface flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={previewSlideIdx <= 0}
                        onClick={() =>
                          setPreviewSlideIdx((idx) => Math.max(0, idx - 1))
                        }
                        className="h-8 gap-1 text-xs"
                      >
                        <ChevronLeft className="size-3.5" />
                        {t("present.prevSlide")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={
                          previewSlideIdx >= SAMPLE_PREVIEW_SLIDE_COUNT - 1
                        }
                        onClick={() =>
                          setPreviewSlideIdx((idx) =>
                            Math.min(SAMPLE_PREVIEW_SLIDE_COUNT - 1, idx + 1),
                          )
                        }
                        className="h-8 gap-1 text-xs"
                      >
                        {t("present.nextSlide")}
                        <ChevronRight className="size-3.5" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewThemeId(null)}
                        className="h-8 gap-1.5 text-xs"
                      >
                        <ArrowLeft className="size-3.5" />
                        {t("present.backToThemesBtn")}
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          selectTheme(previewTheme.id);
                          setPreviewThemeId(null);
                          setThemeGalleryOpen(false);
                        }}
                        className="h-8 gap-1.5 text-xs"
                      >
                        <Check className="size-3.5" />
                        {t("present.useThisThemeBtn")}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Slide Overview Grid Overlay (Toggled with G) */}
        {overviewOpen ? (
          <div className="bg-background text-foreground absolute inset-0 z-20 flex flex-col overflow-hidden">
            <div className="border-border bg-surface flex items-center justify-between border-b px-6 py-3.5">
              <div className="flex items-center gap-2">
                <Grid2X2 className="text-primary size-4" />
                <h3 className="text-foreground text-sm font-semibold">
                  {t("present.overviewTitle", { count: slides.length })}
                </h3>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setOverviewOpen(false)}
                className="h-8 gap-1 text-xs"
              >
                <X className="size-4" />
                {t("present.close")}
              </Button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {slides.map((slide, idx) => {
                const isCurrent = idx === safeIndex;
                return (
                  <button
                    key={slide.id}
                    type="button"
                    onClick={() => {
                      setActiveIndex(idx);
                      setOverviewOpen(false);
                    }}
                    style={{
                      background: activeTheme.slideBg,
                      color: activeTheme.textPrimary,
                    }}
                    className={cn(
                      "focus-visible:ring-ring flex aspect-video cursor-pointer flex-col justify-between rounded-xl border-2 p-4 text-left shadow-md transition-transform duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:outline-none",
                      isCurrent
                        ? "border-primary ring-primary/35 ring-2"
                        : "border-border",
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="font-mono text-sm font-black"
                          style={{ color: activeTheme.accent }}
                        >
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                          style={{
                            backgroundColor: activeTheme.slideSurface,
                            color: activeTheme.textSecondary,
                          }}
                        >
                          {slide.layout}
                        </span>
                      </div>
                      <p
                        className="mt-2 line-clamp-2 text-sm font-bold"
                        style={{ fontFamily: activeTheme.fontDisplay }}
                      >
                        {slide.title}
                      </p>
                    </div>
                    <div
                      className="flex items-center justify-between text-[11px]"
                      style={{ color: activeTheme.textSecondary }}
                    >
                      <span>
                        {slide.bullets.length > 0
                          ? t("present.pointsCount", {
                              count: slide.bullets.length,
                            })
                          : ""}
                      </span>
                      {slide.speakerNotes.length > 0 ? (
                        <MessageSquareText
                          className="size-3.5"
                          style={{ color: activeTheme.accent }}
                          aria-label={t("present.hasSpeakerNotes")}
                        />
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Spotlight Zoom Overlay for Images, Diagrams, Tables, Code */}
        {spotlight ? (
          <div
            onContextMenu={(e) => {
              e.preventDefault();
              const menuW = 248;
              const menuH = 420;
              const x = Math.max(
                12,
                Math.min(e.clientX, window.innerWidth - menuW - 12),
              );
              const y = Math.max(
                12,
                Math.min(e.clientY, window.innerHeight - menuH - 12),
              );
              setStageContextMenu({ x, y });
            }}
            style={
              isAudienceFullChrome
                ? {
                    paddingTop:
                      fsTopVisible || keepFsChromeOpen ? "56px" : "0px",
                    transition:
                      fsTopVisible || keepFsChromeOpen
                        ? "padding-top 280ms cubic-bezier(0.22, 1, 0.36, 1)"
                        : "padding-top 480ms cubic-bezier(0.4, 0, 0.2, 1)",
                  }
                : undefined
            }
            className="bg-background text-foreground absolute inset-0 z-30 flex flex-col overflow-hidden"
          >
            <div className="border-border bg-surface flex items-center justify-between border-b px-6 py-3">
              <span className="text-foreground truncate text-sm font-semibold">
                {spotlight.caption || title}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setSpotlight((s) =>
                      s ? { ...s, zoom: Math.max(0.5, s.zoom - 0.25) } : null,
                    )
                  }
                  title={t("present.zoomOut")}
                  className="size-8"
                >
                  <ZoomOut className="size-4" />
                </Button>
                <span className="text-muted-foreground w-12 text-center font-mono text-xs tabular-nums">
                  {Math.round(spotlight.zoom * 100)}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setSpotlight((s) =>
                      s ? { ...s, zoom: Math.min(2.5, s.zoom + 0.25) } : null,
                    )
                  }
                  title={t("present.zoomIn")}
                  className="size-8"
                >
                  <ZoomIn className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setSpotlight(null)}
                  className="ml-2 h-8 gap-1 text-xs"
                >
                  <X className="size-3.5" />
                  {t("present.close")}
                </Button>
              </div>
            </div>
            <div
              ref={spotlightCanvasRef}
              onPointerDown={handleSpotlightPointerDown}
              onPointerMove={handleSpotlightPointerMove}
              onPointerUp={handleSpotlightPointerUp}
              onPointerCancel={handleSpotlightPointerUp}
              style={{
                cursor: penActive
                  ? eraserActive
                    ? buildEraserCursorUrl()
                    : buildPenCursorUrl(
                        PEN_COLORS.find((c) => c.key === penColor)?.hex ??
                          "#38bdf8",
                      )
                  : undefined,
              }}
              className={cn(
                "relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-8",
                laserActive && "cursor-crosshair",
              )}
            >
              <div
                style={{
                  transform: `scale(${spotlight.zoom})`,
                  transformOrigin: "center center",
                }}
                className="motion-safe:transition-transform motion-safe:duration-150"
              >
                {spotlight.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={spotlight.content}
                    alt={spotlight.caption || ""}
                    className="max-h-[78vh] max-w-[88vw] rounded-xl object-contain shadow-2xl"
                  />
                ) : spotlight.kind === "svg" ? (
                  <div
                    className="border-border bg-surface rounded-xl border p-6 shadow-2xl [&_svg]:max-h-[75vh] [&_svg]:w-auto [&_svg]:max-w-[85vw]"
                    dangerouslySetInnerHTML={{ __html: spotlight.content }}
                  />
                ) : (
                  <div
                    className="wh-fs-table-host border-border bg-surface text-foreground max-w-[88vw] overflow-auto rounded-xl border p-6 text-base shadow-2xl"
                    style={
                      {
                        "--fs-border": "var(--border)",
                        "--fs-code-bg": "var(--surface-sunken)",
                        "--fs-code-fg": "var(--primary)",
                      } as CSSProperties
                    }
                    dangerouslySetInnerHTML={{ __html: spotlight.content }}
                  />
                )}
              </div>

              {/* SVG Overlay for Spotlight Freehand Draw & Laser Pointer */}
              <svg className="pointer-events-none absolute inset-0 z-20 size-full">
                {spotlightStrokes.map((stroke, sIdx) => {
                  if (stroke.points.length < 2) return null;
                  const d = stroke.points
                    .map(
                      (p, i) =>
                        `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
                    )
                    .join(" ");
                  const isHoveredErase =
                    penActive &&
                    eraserActive &&
                    hoveredSpotlightEraseIdx === sIdx;
                  return (
                    <g key={sIdx}>
                      {isHoveredErase ? (
                        <path
                          d={d}
                          fill="none"
                          stroke="#f43f5e"
                          strokeWidth="12"
                          strokeOpacity="0.32"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : null}
                      <path
                        d={d}
                        fill="none"
                        stroke={isHoveredErase ? "#f43f5e" : stroke.color}
                        strokeWidth={isHoveredErase ? "5.5" : "4"}
                        strokeDasharray={isHoveredErase ? "8 6" : undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  );
                })}
                {laserActive && spotlightLaserTrail.length > 1 ? (
                  <>
                    <path
                      d={spotlightLaserTrail
                        .map(
                          (p, i) =>
                            `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
                        )
                        .join(" ")}
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeOpacity="0.8"
                    />
                    {spotlightLaserTrail[spotlightLaserTrail.length - 1] ? (
                      <circle
                        cx={
                          spotlightLaserTrail[spotlightLaserTrail.length - 1]!.x
                        }
                        cy={
                          spotlightLaserTrail[spotlightLaserTrail.length - 1]!.y
                        }
                        r="7"
                        fill="#f43f5e"
                      />
                    ) : null}
                  </>
                ) : null}
              </svg>
            </div>
          </div>
        ) : null}
      </div>

      {/* Exit Presentation Confirmation Modal (Prevents accidental Esc exit) */}
      {exitConfirmOpen ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="wh-present-exit-title"
          aria-describedby="wh-present-exit-desc"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExitConfirmOpen(false);
          }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
        >
          <div className="border-border bg-surface text-foreground w-full max-w-sm rounded-xl border p-5 shadow-2xl">
            <h3
              id="wh-present-exit-title"
              className="text-foreground text-base font-semibold"
            >
              {t("present.exitConfirmTitle")}
            </h3>
            <p
              id="wh-present-exit-desc"
              className="text-muted-foreground mt-1.5 text-sm leading-relaxed"
            >
              {t("present.exitConfirmDescription")}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setExitConfirmOpen(false)}
                className="h-8 text-xs"
              >
                {t("present.exitConfirmStay")}
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  setExitConfirmOpen(false);
                  if (presenterViewOpen) {
                    endPresenterView();
                  } else {
                    onOpenChange(false);
                  }
                }}
                className="h-8 text-xs"
              >
                {t("present.exitConfirmLeave")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Unsaved Edit Changes Confirmation Modal (In-App WikiHub Modal) */}
      {unsavedEditPromptOpen ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="wh-present-unsaved-title"
          aria-describedby="wh-present-unsaved-desc"
          onClick={(e) => {
            if (e.target === e.currentTarget) setUnsavedEditPromptOpen(false);
          }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
        >
          <div className="border-border bg-surface text-foreground w-full max-w-md rounded-xl border p-5 shadow-2xl">
            <h3
              id="wh-present-unsaved-title"
              className="text-foreground text-base font-semibold"
            >
              {t("present.unsavedEditTitle")}
            </h3>
            <p
              id="wh-present-unsaved-desc"
              className="text-muted-foreground mt-1.5 text-sm leading-relaxed"
            >
              {t("present.unsavedEditDescription")}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setUnsavedEditPromptOpen(false)}
                className="h-8 text-xs"
              >
                {t("present.unsavedEditKeepEditing")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleDiscardEdits}
                className="text-danger border-danger/25 hover:border-danger hover:bg-danger/10 hover:text-danger h-8 text-xs"
              >
                {t("present.unsavedEditDiscard")}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSaveEdits}
                className="h-8 gap-1.5 text-xs"
              >
                <Save className="size-3.5" />
                {t("present.editSaveBtn")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Right-Click Stage Context Menu (Quick Presenter Controls) */}
      {stageContextMenu ? (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setStageContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setStageContextMenu(null);
          }}
        >
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              left: `${stageContextMenu.x}px`,
              top: `${stageContextMenu.y}px`,
            }}
            className="border-border bg-surface text-foreground fixed z-50 w-60 rounded-xl border p-1.5 shadow-2xl"
          >
            {/* Quick Prev / Next */}
            <div className="mb-1 grid grid-cols-2 gap-1">
              <button
                type="button"
                role="menuitem"
                disabled={
                  safeIndex === 0 &&
                  (!bulletReveal ||
                    currentSlide.bullets.length <= 1 ||
                    revealedCount <= 1)
                }
                onClick={() => {
                  stepBackward();
                  setStageContextMenu(null);
                }}
                className="border-border bg-surface-sunken text-foreground hover:bg-surface-hover flex cursor-pointer items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ChevronLeft className="size-3.5" />
                {t("present.prevSlide")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={
                  safeIndex >= slides.length - 1 &&
                  (!bulletReveal ||
                    currentSlide.bullets.length <= 1 ||
                    revealedCount >= currentSlide.bullets.length)
                }
                onClick={() => {
                  stepForward();
                  setStageContextMenu(null);
                }}
                className="border-border bg-surface-sunken text-foreground hover:bg-surface-hover flex cursor-pointer items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t("present.nextSlide")}
                <ChevronRight className="size-3.5" />
              </button>
            </div>

            <div className="bg-border my-1 h-px" />

            {/* Overview (G) */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOverviewOpen((v) => !v);
                setStageContextMenu(null);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150",
                overviewOpen
                  ? "bg-primary/12 text-primary"
                  : "text-foreground hover:bg-surface-hover",
              )}
            >
              <span className="flex items-center gap-2">
                <Grid2X2 className="size-3.5" />
                {t("present.overviewBtn")}
              </span>
              <kbd className="border-border bg-surface-sunken text-muted-foreground rounded border px-1 font-mono text-[10px]">
                G
              </kbd>
            </button>

            {/* Step Reveal (B) */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setBulletReveal((v) => !v);
                setStageContextMenu(null);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150",
                bulletReveal
                  ? "bg-primary/12 text-primary"
                  : "text-foreground hover:bg-surface-hover",
              )}
            >
              <span className="flex items-center gap-2">
                <ListChecks className="size-3.5" />
                {t("present.bulletRevealBtn")}
              </span>
              <span className="flex items-center gap-1.5">
                {bulletReveal ? <Check className="size-3" /> : null}
                <kbd className="border-border bg-surface-sunken text-muted-foreground rounded border px-1 font-mono text-[10px]">
                  B
                </kbd>
              </span>
            </button>

            {/* Edit (E) */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                toggleInlineEditMode();
                setStageContextMenu(null);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150",
                inlineEditMode
                  ? "bg-primary/12 text-primary"
                  : "text-foreground hover:bg-surface-hover",
              )}
            >
              <span className="flex items-center gap-2">
                <PencilLine className="size-3.5" />
                {t("present.inlineEditBtn")}
              </span>
              <span className="flex items-center gap-1.5">
                {inlineEditMode ? <Check className="size-3" /> : null}
                <kbd className="border-border bg-surface-sunken text-muted-foreground rounded border px-1 font-mono text-[10px]">
                  E
                </kbd>
              </span>
            </button>

            {/* Laser (L) */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setLaserActive((v) => {
                  if (!v) setPenActive(false);
                  return !v;
                });
                setStageContextMenu(null);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150",
                laserActive
                  ? "bg-danger/12 text-danger"
                  : "text-foreground hover:bg-surface-hover",
              )}
            >
              <span className="flex items-center gap-2">
                <Radio className="size-3.5" />
                {t("present.laserBtn")}
              </span>
              <span className="flex items-center gap-1.5">
                {laserActive ? <Check className="size-3" /> : null}
                <kbd className="border-border bg-surface-sunken text-muted-foreground rounded border px-1 font-mono text-[10px]">
                  L
                </kbd>
              </span>
            </button>

            {/* Draw (D) + Inline Color Picker (active color highlighted) */}
            <div
              className={cn(
                "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors duration-150",
                penActive && !eraserActive
                  ? "bg-primary/12 text-primary"
                  : "text-foreground hover:bg-surface-hover",
              )}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setLaserActive(false);
                  setEraserActive(false);
                  setPenActive((v) => (eraserActive ? true : !v));
                  setStageContextMenu(null);
                }}
                className="flex flex-1 cursor-pointer items-center gap-2 text-left text-xs font-medium focus-visible:outline-none"
              >
                <PenTool className="size-3.5 shrink-0" />
                <span>{t("present.penBtn")}</span>
              </button>
              <div className="flex items-center gap-1.5">
                {PEN_COLORS.map((c) => {
                  const isCurrentColor = penColor === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => {
                        setPenColor(c.key);
                        setLaserActive(false);
                        setEraserActive(false);
                        setPenActive(true);
                        setStageContextMenu(null);
                      }}
                      title={t(c.labelKey)}
                      aria-label={t(c.labelKey)}
                      className={cn(
                        "size-4 cursor-pointer rounded-full border border-black/25 transition-transform duration-150 hover:scale-115",
                        isCurrentColor
                          ? "ring-ring scale-115 ring-2 ring-offset-1 ring-offset-[var(--surface)]"
                          : "opacity-70 hover:opacity-100",
                      )}
                      style={{ backgroundColor: c.hex }}
                    />
                  );
                })}
                <kbd className="border-border bg-surface-sunken text-muted-foreground ml-0.5 rounded border px-1 font-mono text-[10px]">
                  D
                </kbd>
              </div>
            </div>

            {currentStrokes.length > 0 ||
            (spotlight && spotlightStrokes.length > 0) ? (
              <>
                {/* Eraser (only shown when strokes exist) */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setLaserActive(false);
                    setPenActive(true);
                    setEraserActive((v) => !v);
                    setStageContextMenu(null);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150",
                    penActive && eraserActive
                      ? "bg-primary/12 text-primary"
                      : "text-foreground hover:bg-surface-hover",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Eraser className="size-3.5" />
                    {t("present.eraserBtn")}
                  </span>
                  {penActive && eraserActive ? (
                    <Check className="size-3" />
                  ) : null}
                </button>

                {/* Clear all strokes (C) */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    clearCurrentSlideAnnotations();
                    setStageContextMenu(null);
                  }}
                  className="text-danger hover:bg-danger/10 flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150"
                >
                  <span className="flex items-center gap-2">
                    <X className="size-3.5" />
                    {t("present.clearInk")}
                  </span>
                  <kbd className="border-border bg-surface-sunken text-muted-foreground rounded border px-1 font-mono text-[10px]">
                    C
                  </kbd>
                </button>
              </>
            ) : null}

            {/* Notes (N) */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setNotesOpen((v) => !v);
                setStageContextMenu(null);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150",
                notesOpen
                  ? "bg-primary/12 text-primary"
                  : "text-foreground hover:bg-surface-hover",
              )}
            >
              <span className="flex items-center gap-2">
                <MessageSquareText className="size-3.5" />
                {t("present.notesBtn")}
              </span>
              <span className="flex items-center gap-1.5">
                {notesOpen ? <Check className="size-3" /> : null}
                <kbd className="border-border bg-surface-sunken text-muted-foreground rounded border px-1 font-mono text-[10px]">
                  N
                </kbd>
              </span>
            </button>

            {inlineEditMode ? (
              <>
                <div className="bg-border my-1.5 h-px" />

                {/* Inline Motion Selector (only in Edit mode) */}
                <div className="px-2 py-1">
                  <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold">
                    <Wand2 className="size-3" />
                    {t("present.motionBtn")}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {MOTION_OPTIONS.map((opt) => {
                      const selected = motionStyle === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          onClick={() => {
                            setMotionStyle(opt.id);
                            saveMotionStyle(opt.id);
                            setRevealTick((tick) => tick + 1);
                            setStageContextMenu(null);
                          }}
                          className={cn(
                            "cursor-pointer truncate rounded-md border px-2 py-1 text-[11px] font-medium transition-colors duration-150",
                            selected
                              ? "border-primary/40 bg-primary/12 text-primary"
                              : "border-border bg-surface-sunken text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                          )}
                        >
                          {t(opt.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Bottom Stage Controls Dock (Slides up on hover, silky-smooth glide-down immediately on leave) */}
      <footer
        onMouseEnter={() => {
          fsHoveringBottomRef.current = true;
          if (isAudienceFullChrome) setFsBottomVisible(true);
        }}
        onMouseLeave={() => {
          fsHoveringBottomRef.current = false;
          if (isAudienceFullChrome) setFsBottomVisible(false);
        }}
        style={
          isAudienceFullChrome
            ? {
                transform:
                  fsBottomVisible || keepFsChromeOpen
                    ? "translate3d(0, 0, 0)"
                    : "translate3d(0, 100%, 0)",
                opacity: fsBottomVisible || keepFsChromeOpen ? 1 : 0,
                transition:
                  fsBottomVisible || keepFsChromeOpen
                    ? "transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out"
                    : "transform 480ms cubic-bezier(0.4, 0, 0.2, 1), opacity 420ms ease-in-out",
              }
            : undefined
        }
        className={cn(
          "border-border bg-surface text-foreground z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-t px-4 sm:px-6",
          isAudienceFullChrome
            ? cn(
                "bg-surface/95 absolute right-0 bottom-0 left-0 shadow-lg backdrop-blur-md will-change-transform",
                !(fsBottomVisible || keepFsChromeOpen) && "pointer-events-none",
              )
            : "relative",
        )}
      >
        {/* Left: Prev / Next Slide Buttons */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={
              safeIndex === 0 &&
              (!bulletReveal ||
                currentSlide.bullets.length <= 1 ||
                revealedCount <= 1)
            }
            onClick={stepBackward}
            title={t("present.prevSlideTooltip")}
            className="h-8 gap-1 text-xs"
          >
            <ChevronLeft className="size-4" />
            <span className="hidden sm:inline">{t("present.prevSlide")}</span>
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={
              safeIndex >= slides.length - 1 &&
              (!bulletReveal ||
                currentSlide.bullets.length <= 1 ||
                revealedCount >= currentSlide.bullets.length)
            }
            onClick={stepForward}
            title={t("present.nextSlideTooltip")}
            className="h-8 gap-1 text-xs"
          >
            <span className="hidden sm:inline">{t("present.nextSlide")}</span>
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {/* Center: Pro Presenter Stage Tools */}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={overviewOpen ? "primary" : "ghost"}
            size="sm"
            onClick={() => setOverviewOpen((v) => !v)}
            aria-pressed={overviewOpen}
            title={t("present.overviewTooltip")}
            className="h-8 gap-1.5 text-xs"
          >
            <Grid2X2 className="size-3.5" />
            <span className="hidden md:inline">{t("present.overviewBtn")}</span>
            <kbd className="border-border bg-surface-sunken text-muted-foreground hidden rounded border px-1 py-0.2 font-mono text-[10px] lg:inline">
              G
            </kbd>
          </Button>

          <Button
            type="button"
            variant={bulletReveal ? "primary" : "ghost"}
            size="sm"
            onClick={() => setBulletReveal((v) => !v)}
            aria-pressed={bulletReveal}
            title={t("present.bulletRevealTooltip")}
            className="h-8 gap-1.5 text-xs"
          >
            <ListChecks className="size-3.5" />
            <span className="hidden md:inline">
              {t("present.bulletRevealBtn")}
            </span>
            <kbd className="border-border bg-surface-sunken text-muted-foreground hidden rounded border px-1 py-0.2 font-mono text-[10px] lg:inline">
              B
            </kbd>
          </Button>

          <Button
            type="button"
            variant={inlineEditMode ? "primary" : "ghost"}
            size="sm"
            onClick={toggleInlineEditMode}
            aria-pressed={inlineEditMode}
            title={t("present.inlineEditTooltip")}
            className="h-8 gap-1.5 text-xs"
          >
            <PencilLine className="size-3.5" />
            <span className="hidden md:inline">
              {t("present.inlineEditBtn")}
            </span>
            <kbd className="border-border bg-surface-sunken text-muted-foreground hidden rounded border px-1 py-0.2 font-mono text-[10px] lg:inline">
              E
            </kbd>
          </Button>

          <Button
            type="button"
            variant={laserActive ? "danger" : "ghost"}
            size="sm"
            onClick={() =>
              setLaserActive((v) => {
                if (!v) setPenActive(false);
                return !v;
              })
            }
            aria-pressed={laserActive}
            title={t("present.laserTooltip")}
            className="h-8 gap-1.5 text-xs"
          >
            <Radio className="size-3.5" />
            <span className="hidden md:inline">{t("present.laserBtn")}</span>
            <kbd className="border-border bg-surface-sunken text-muted-foreground hidden rounded border px-1 py-0.2 font-mono text-[10px] lg:inline">
              L
            </kbd>
          </Button>

          <Button
            type="button"
            variant={penActive ? "primary" : "ghost"}
            size="sm"
            onClick={() =>
              setPenActive((v) => {
                if (!v) setLaserActive(false);
                return !v;
              })
            }
            aria-pressed={penActive}
            title={t("present.penTooltip")}
            className="h-8 gap-1.5 text-xs"
          >
            <PenTool className="size-3.5" />
            <span className="hidden md:inline">{t("present.penBtn")}</span>
            <kbd className="border-border bg-surface-sunken text-muted-foreground hidden rounded border px-1 py-0.2 font-mono text-[10px] lg:inline">
              D
            </kbd>
          </Button>

          {penActive ? (
            <div className="border-border bg-surface-sunken ml-1 inline-flex items-center gap-1 rounded-lg border px-1.5 py-1">
              {PEN_COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => {
                    setPenColor(c.key);
                    setEraserActive(false);
                  }}
                  aria-label={t(c.labelKey)}
                  title={t(c.labelKey)}
                  className={cn(
                    "size-4 cursor-pointer rounded-full border border-black/25 transition-transform duration-150 hover:scale-110",
                    !eraserActive && penColor === c.key
                      ? "ring-ring scale-110 ring-2"
                      : "opacity-75",
                  )}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
              <span aria-hidden className="bg-border mx-0.5 h-3.5 w-px" />
              <button
                type="button"
                onClick={() => setEraserActive((v) => !v)}
                aria-pressed={eraserActive}
                title={t("present.eraserTooltip")}
                aria-label={t("present.eraserBtn")}
                className={cn(
                  "inline-flex h-5 cursor-pointer items-center gap-1 rounded px-1.5 text-[11px] font-medium transition-colors duration-150",
                  eraserActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Eraser className="size-3" />
                <span className="hidden xl:inline">{t("present.eraserBtn")}</span>
              </button>
            </div>
          ) : null}

          {currentStrokes.length > 0 ||
          (spotlight && spotlightStrokes.length > 0) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearCurrentSlideAnnotations}
              title={t("present.clearInkTooltip")}
              className="text-danger hover:bg-danger/10 hover:text-danger h-8 gap-1.5 text-xs"
            >
              <Eraser className="size-3.5" />
              <span className="hidden lg:inline">{t("present.clearInk")}</span>
              <kbd className="border-danger/30 bg-danger/10 text-danger hidden rounded border px-1 py-0.2 font-mono text-[10px] lg:inline">
                C
              </kbd>
            </Button>
          ) : null}

          <Button
            type="button"
            variant={notesOpen ? "primary" : "ghost"}
            size="sm"
            onClick={() => setNotesOpen((v) => !v)}
            aria-pressed={notesOpen}
            title={t("present.notesTooltip")}
            className="h-8 gap-1.5 text-xs"
          >
            <MessageSquareText className="size-3.5" />
            <span className="hidden md:inline">{t("present.notesBtn")}</span>
            {currentSlide.speakerNotes.length > 0 ||
            customNotesBySlide[currentSlide.id]?.trim() ? (
              <span className="bg-primary text-primary-foreground flex size-4 items-center justify-center rounded-full text-[10px] font-bold">
                {currentSlide.speakerNotes.length +
                  (customNotesBySlide[currentSlide.id]?.trim() ? 1 : 0)}
              </span>
            ) : null}
            <kbd className="border-border bg-surface-sunken text-muted-foreground hidden rounded border px-1 py-0.2 font-mono text-[10px] lg:inline">
              N
            </kbd>
          </Button>
        </div>

        {/* Right: Elapsed Timer Badge */}
        <button
          type="button"
          onClick={() => setNotesOpen((v) => !v)}
          title={t("present.timerClickHint")}
          className="border-border bg-surface-sunken text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring hidden cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs tabular-nums transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none sm:inline-flex"
        >
          <Clock className="text-primary size-3.5" aria-hidden />
          {formatTimer(timerSeconds)}
        </button>
      </footer>
    </div>,
    document.body,
  );
}
