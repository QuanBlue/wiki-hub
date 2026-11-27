"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import {
  ArrowUpRight,
  Circle,
  Diamond,
  Download,
  Maximize2,
  Minimize2,
  MousePointer2,
  PenTool,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type ToolKind =
  | "select"
  | "rect"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "pen"
  | "text"
  | "sticky";

type SemanticTone = "foreground" | "primary" | "success" | "warning" | "danger";

interface WhiteboardElement {
  id: string;
  type: Exclude<ToolKind, "select">;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: SemanticTone;
  text?: string;
  points?: Array<{ x: number; y: number }>;
}

interface WhiteboardScene {
  width: number;
  height: number;
  elements: WhiteboardElement[];
}

const DEFAULT_SCENE: WhiteboardScene = {
  width: 800,
  height: 420,
  elements: [],
};

const TONE_PALETTE: Record<
  SemanticTone,
  { stroke: string; fill: string; swatchClass: string; exportStroke: string; exportFill: string }
> = {
  foreground: {
    stroke: "var(--foreground)",
    fill: "var(--surface)",
    swatchClass: "bg-foreground",
    exportStroke: "#1f2937",
    exportFill: "#f8fafc",
  },
  primary: {
    stroke: "var(--primary)",
    fill: "var(--primary-subtle)",
    swatchClass: "bg-primary",
    exportStroke: "#216fc0",
    exportFill: "#e8f2fc",
  },
  success: {
    stroke: "var(--success)",
    fill: "color-mix(in srgb, var(--success) 14%, transparent)",
    swatchClass: "bg-success",
    exportStroke: "#15803d",
    exportFill: "#dcfce7",
  },
  warning: {
    stroke: "var(--warning)",
    fill: "color-mix(in srgb, var(--warning) 16%, transparent)",
    swatchClass: "bg-warning",
    exportStroke: "#b45309",
    exportFill: "#fef3c7",
  },
  danger: {
    stroke: "var(--danger)",
    fill: "color-mix(in srgb, var(--danger) 14%, transparent)",
    swatchClass: "bg-danger",
    exportStroke: "#b91c1c",
    exportFill: "#fee2e2",
  },
};

function parseScene(raw: unknown): WhiteboardScene {
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_SCENE;
  try {
    const parsed = JSON.parse(raw) as Partial<WhiteboardScene>;
    return {
      width: typeof parsed.width === "number" ? parsed.width : 800,
      height: typeof parsed.height === "number" ? parsed.height : 420,
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    };
  } catch {
    return DEFAULT_SCENE;
  }
}

function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSceneToStaticSvg(scene: WhiteboardScene): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" style="background:#ffffff;font-family:Inter,system-ui,sans-serif">`,
    `<defs><marker id="wb-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="#334155"/></marker></defs>`,
  ];
  for (const el of scene.elements) {
    const pal = TONE_PALETTE[el.tone] ?? TONE_PALETTE.primary;
    const x = Math.min(el.x, el.x + el.w);
    const y = Math.min(el.y, el.y + el.h);
    const w = Math.abs(el.w);
    const h = Math.abs(el.h);
    if (el.type === "rect" || el.type === "sticky") {
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${el.type === "sticky" ? 4 : 8}" fill="${pal.exportFill}" stroke="${pal.exportStroke}" stroke-width="2"/>`,
      );
    } else if (el.type === "ellipse") {
      parts.push(
        `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${pal.exportFill}" stroke="${pal.exportStroke}" stroke-width="2"/>`,
      );
    } else if (el.type === "diamond") {
      const cx = x + w / 2;
      const cy = y + h / 2;
      parts.push(
        `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${pal.exportFill}" stroke="${pal.exportStroke}" stroke-width="2"/>`,
      );
    } else if (el.type === "arrow") {
      parts.push(
        `<line x1="${el.x}" y1="${el.y}" x2="${el.x + el.w}" y2="${el.y + el.h}" stroke="${pal.exportStroke}" stroke-width="2" marker-end="url(#wb-arrow)"/>`,
      );
    } else if (el.type === "pen" && el.points && el.points.length > 1) {
      parts.push(
        `<path d="${buildSmoothPath(el.points)}" fill="none" stroke="${pal.exportStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
    if (el.text) {
      const tx = el.type === "text" ? el.x : x + w / 2;
      const ty = el.type === "text" ? el.y + 18 : y + h / 2 + 5;
      const anchor = el.type === "text" ? "start" : "middle";
      parts.push(
        `<text x="${tx}" y="${ty}" text-anchor="${anchor}" fill="${pal.exportStroke}" font-size="14" font-weight="500">${escapeXml(el.text)}</text>`,
      );
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

function encodeSvgDataUri(svg: string): string {
  try {
    const bytes = new TextEncoder().encode(svg);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  } catch {
    return "";
  }
}

function WhiteboardNodeView({
  node,
  editor,
  updateAttributes,
  deleteNode,
  selected,
}: NodeViewProps) {
  const { locale } = useTranslation();
  const isVi = locale === "vi";
  const editable = editor.isEditable;

  const initialScene = useMemo(
    () => parseScene(node.attrs.scene),
    [node.attrs.scene],
  );
  const [scene, setScene] = useState<WhiteboardScene>(initialScene);
  const [history, setHistory] = useState<WhiteboardScene[]>([initialScene]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [tool, setTool] = useState<ToolKind>("rect");
  const [tone, setTone] = useState<SemanticTone>("primary");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [caption, setCaption] = useState(String(node.attrs.caption || ""));
  const [textEdit, setTextEdit] = useState<{
    mode: "create" | "edit";
    targetId?: string;
    x: number;
    y: number;
    value: string;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const drawingRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    dragging?: boolean;
    origX?: number;
    origY?: number;
  } | null>(null);

  useEffect(() => {
    setScene(initialScene);
  }, [initialScene]);

  const commitScene = useCallback(
    (next: WhiteboardScene) => {
      setScene(next);
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIdx + 1);
        return [...sliced, next].slice(-30);
      });
      setHistoryIdx((idx) => Math.min(idx + 1, 29));
      const serialized = JSON.stringify(next);
      const staticSvg = renderSceneToStaticSvg(next);
      updateAttributes({
        scene: serialized,
        svg: encodeSvgDataUri(staticSvg),
      });
    },
    [historyIdx, updateAttributes],
  );

  function getSvgPoint(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / Math.max(rect.width, 1)) * scene.width,
      y: ((e.clientY - rect.top) / Math.max(rect.height, 1)) * scene.height,
    };
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!editable) return;
    const pt = getSvgPoint(e);
    if (tool === "select") {
      setSelectedId(null);
      return;
    }
    if (tool === "text") {
      setTextEdit({ mode: "create", x: pt.x, y: pt.y, value: "" });
      return;
    }

    const id = `wb-${Date.now()}`;
    const newEl: WhiteboardElement =
      tool === "pen"
        ? {
            id,
            type: "pen",
            x: pt.x,
            y: pt.y,
            w: 0,
            h: 0,
            tone,
            points: [pt],
          }
        : {
            id,
            type: tool,
            x: pt.x,
            y: pt.y,
            w: tool === "sticky" ? 130 : 4,
            h: tool === "sticky" ? 90 : 4,
            tone: tool === "sticky" ? "warning" : tone,
            text: tool === "sticky" ? (isVi ? "Ghi chú" : "Note") : undefined,
          };

    drawingRef.current = { id, startX: pt.x, startY: pt.y };
    setScene((prev) => ({ ...prev, elements: [...prev.elements, newEl] }));
    setSelectedId(id);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const active = drawingRef.current;
    if (!active || !editable) return;
    const pt = getSvgPoint(e);
    setScene((prev) => ({
      ...prev,
      elements: prev.elements.map((el) => {
        if (el.id !== active.id) return el;
        if (active.dragging) {
          const dx = pt.x - active.startX;
          const dy = pt.y - active.startY;
          if (el.type === "pen" && el.points) {
            return el;
          }
          return {
            ...el,
            x: (active.origX ?? el.x) + dx,
            y: (active.origY ?? el.y) + dy,
          };
        }
        if (el.type === "pen") {
          return { ...el, points: [...(el.points ?? []), pt] };
        }
        return {
          ...el,
          w: pt.x - active.startX,
          h: pt.y - active.startY,
        };
      }),
    }));
  }

  function handlePointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = null;
    commitScene(scene);
  }

  function handleUndo() {
    if (historyIdx <= 0) return;
    const prevIdx = historyIdx - 1;
    const target = history[prevIdx];
    setHistoryIdx(prevIdx);
    setScene(target);
    updateAttributes({
      scene: JSON.stringify(target),
      svg: encodeSvgDataUri(renderSceneToStaticSvg(target)),
    });
  }

  function handleRedo() {
    if (historyIdx >= history.length - 1) return;
    const nextIdx = historyIdx + 1;
    const target = history[nextIdx];
    setHistoryIdx(nextIdx);
    setScene(target);
    updateAttributes({
      scene: JSON.stringify(target),
      svg: encodeSvgDataUri(renderSceneToStaticSvg(target)),
    });
  }

  function handleDownloadSvg() {
    const svg = renderSceneToStaticSvg(scene);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${caption.trim() || "whiteboard"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleEditElementText(el: WhiteboardElement) {
    if (!editable) return;
    setTextEdit({
      mode: "edit",
      targetId: el.id,
      x: el.x,
      y: el.y,
      value: el.text ?? "",
    });
  }

  function commitTextEdit() {
    if (!textEdit) return;
    const trimmed = textEdit.value.trim();
    if (textEdit.mode === "create") {
      if (trimmed) {
        const nextEl: WhiteboardElement = {
          id: `wb-${Date.now()}`,
          type: "text",
          x: textEdit.x,
          y: textEdit.y,
          w: 140,
          h: 28,
          tone,
          text: trimmed,
        };
        commitScene({ ...scene, elements: [...scene.elements, nextEl] });
        setSelectedId(nextEl.id);
      }
    } else if (textEdit.targetId) {
      commitScene({
        ...scene,
        elements: scene.elements.map((item) =>
          item.id === textEdit.targetId
            ? { ...item, text: trimmed || undefined }
            : item,
        ),
      });
    }
    setTextEdit(null);
  }

  const tools: Array<{ id: ToolKind; icon: typeof Square; label: string }> = [
    { id: "select", icon: MousePointer2, label: isVi ? "Chọn / Kéo" : "Select" },
    { id: "rect", icon: Square, label: isVi ? "Hình chữ nhật" : "Rectangle" },
    { id: "ellipse", icon: Circle, label: isVi ? "Hình tròn" : "Ellipse" },
    { id: "diamond", icon: Diamond, label: isVi ? "Hình thoi" : "Diamond" },
    { id: "arrow", icon: ArrowUpRight, label: isVi ? "Mũi tên" : "Arrow" },
    { id: "pen", icon: PenTool, label: isVi ? "Bút vẽ tay" : "Freehand" },
    { id: "text", icon: Type, label: isVi ? "Văn bản" : "Text" },
    { id: "sticky", icon: StickyNote, label: isVi ? "Ghi chú" : "Sticky" },
  ];

  return (
    <NodeViewWrapper
      className={cn(
        "border-border bg-surface my-4 rounded-lg border transition-colors",
        selected && editable && "ring-ring ring-2",
        fullscreen &&
          "fixed inset-4 z-50 my-0 flex flex-col shadow-2xl",
      )}
      contentEditable={false}
    >
      <div className="border-border bg-surface-sunken/70 flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          {editable ? (
            <>
              {tools.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTool(item.id)}
                    title={item.label}
                    className={cn(
                      "flex size-7 cursor-pointer items-center justify-center rounded transition-colors hover:bg-surface-hover",
                      tool === item.id
                        ? "bg-primary-subtle text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                  </button>
                );
              })}

              <span className="bg-border mx-1 h-4 w-px" />

              {(Object.keys(TONE_PALETTE) as SemanticTone[]).map((tKey) => (
                <button
                  key={tKey}
                  type="button"
                  onClick={() => {
                    setTone(tKey);
                    if (selectedId) {
                      commitScene({
                        ...scene,
                        elements: scene.elements.map((el) =>
                          el.id === selectedId ? { ...el, tone: tKey } : el,
                        ),
                      });
                    }
                  }}
                  className={cn(
                    "size-4 cursor-pointer rounded-full border border-border transition-transform hover:scale-110",
                    TONE_PALETTE[tKey].swatchClass,
                    tone === tKey &&
                      "ring-primary ring-2 ring-offset-1 ring-offset-background",
                  )}
                  title={tKey}
                />
              ))}

              <span className="bg-border mx-1 h-4 w-px" />

              <button
                type="button"
                onClick={handleUndo}
                disabled={historyIdx <= 0}
                className="text-muted-foreground hover:bg-surface-hover hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors disabled:opacity-40"
                title={isVi ? "Hoàn tác" : "Undo"}
              >
                <Undo2 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={historyIdx >= history.length - 1}
                className="text-muted-foreground hover:bg-surface-hover hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors disabled:opacity-40"
                title={isVi ? "Làm lại" : "Redo"}
              >
                <Redo2 className="size-3.5" />
              </button>
              {selectedId ? (
                <button
                  type="button"
                  onClick={() => {
                    commitScene({
                      ...scene,
                      elements: scene.elements.filter(
                        (el) => el.id !== selectedId,
                      ),
                    });
                    setSelectedId(null);
                  }}
                  className="text-danger hover:bg-danger/10 flex size-7 cursor-pointer items-center justify-center rounded transition-colors"
                  title={isVi ? "Xóa hình đang chọn" : "Delete selected shape"}
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 font-medium">
              <PenTool className="text-primary size-3.5" />
              {caption || (isVi ? "Bảng vẽ" : "Whiteboard")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleDownloadSvg}
            className="text-muted-foreground hover:bg-surface-hover hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors"
            title={isVi ? "Tải ảnh SVG" : "Download SVG"}
          >
            <Download className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            className="text-muted-foreground hover:bg-surface-hover hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors"
            title={fullscreen ? (isVi ? "Thu nhỏ" : "Exit fullscreen") : (isVi ? "Toàn màn hình" : "Fullscreen")}
          >
            {fullscreen ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </button>
          {editable ? (
            <button
              type="button"
              onClick={deleteNode}
              className="text-muted-foreground hover:bg-danger/10 hover:text-danger flex size-7 cursor-pointer items-center justify-center rounded transition-colors"
              title={isVi ? "Xóa bảng vẽ" : "Delete whiteboard"}
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "bg-background relative overflow-hidden",
          fullscreen ? "flex-1" : "h-[360px]",
        )}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${scene.width} ${scene.height}`}
          className={cn(
            "h-full w-full touch-none select-none",
            editable
              ? tool === "select"
                ? "cursor-default"
                : "cursor-crosshair"
              : "cursor-default",
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <defs>
            <pattern
              id="wikihub-wb-grid"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle
                cx="1"
                cy="1"
                r="1"
                fill="var(--border)"
                opacity="0.7"
              />
            </pattern>
            <marker
              id="wikihub-wb-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" />
            </marker>
          </defs>

          <rect
            width={scene.width}
            height={scene.height}
            fill="url(#wikihub-wb-grid)"
          />

          {scene.elements.map((el) => {
            const pal = TONE_PALETTE[el.tone] ?? TONE_PALETTE.primary;
            const isSel = editable && selectedId === el.id;
            const x = Math.min(el.x, el.x + el.w);
            const y = Math.min(el.y, el.y + el.h);
            const w = Math.abs(el.w);
            const h = Math.abs(el.h);

            const startDrag = (e: React.PointerEvent) => {
              if (!editable || tool !== "select") return;
              e.stopPropagation();
              setSelectedId(el.id);
              const pt = getSvgPoint(
                e as unknown as React.PointerEvent<SVGSVGElement>,
              );
              drawingRef.current = {
                id: el.id,
                startX: pt.x,
                startY: pt.y,
                dragging: true,
                origX: el.x,
                origY: el.y,
              };
            };

            return (
              <g
                key={el.id}
                onPointerDown={startDrag}
                onDoubleClick={() => handleEditElementText(el)}
                style={{ color: pal.stroke }}
                className={cn(editable && tool === "select" && "cursor-move")}
              >
                {el.type === "rect" || el.type === "sticky" ? (
                  <rect
                    x={x}
                    y={y}
                    width={Math.max(w, 2)}
                    height={Math.max(h, 2)}
                    rx={el.type === "sticky" ? 4 : 8}
                    fill={pal.fill}
                    stroke={pal.stroke}
                    strokeWidth={isSel ? 2.5 : 2}
                    strokeDasharray={isSel ? "5 3" : undefined}
                  />
                ) : el.type === "ellipse" ? (
                  <ellipse
                    cx={x + w / 2}
                    cy={y + h / 2}
                    rx={Math.max(w / 2, 2)}
                    ry={Math.max(h / 2, 2)}
                    fill={pal.fill}
                    stroke={pal.stroke}
                    strokeWidth={isSel ? 2.5 : 2}
                    strokeDasharray={isSel ? "5 3" : undefined}
                  />
                ) : el.type === "diamond" ? (
                  <polygon
                    points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
                    fill={pal.fill}
                    stroke={pal.stroke}
                    strokeWidth={isSel ? 2.5 : 2}
                    strokeDasharray={isSel ? "5 3" : undefined}
                  />
                ) : el.type === "arrow" ? (
                  <line
                    x1={el.x}
                    y1={el.y}
                    x2={el.x + el.w}
                    y2={el.y + el.h}
                    stroke={pal.stroke}
                    strokeWidth={isSel ? 2.5 : 2}
                    markerEnd="url(#wikihub-wb-arrow)"
                  />
                ) : el.type === "pen" && el.points && el.points.length > 1 ? (
                  <path
                    d={buildSmoothPath(el.points)}
                    fill="none"
                    stroke={pal.stroke}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}

                {el.text ? (
                  <text
                    x={el.type === "text" ? el.x : x + w / 2}
                    y={el.type === "text" ? el.y + 18 : y + h / 2 + 5}
                    textAnchor={el.type === "text" ? "start" : "middle"}
                    fill={pal.stroke}
                    fontSize="14"
                    fontWeight="500"
                  >
                    {el.text}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {textEdit ? (
          <div className="bg-surface-raised border-border absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 shadow-lg">
            <input
              type="text"
              value={textEdit.value}
              onChange={(e) =>
                setTextEdit((prev) =>
                  prev ? { ...prev, value: e.target.value } : null,
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTextEdit();
                } else if (e.key === "Escape") {
                  setTextEdit(null);
                }
              }}
              placeholder={isVi ? "Nhập nội dung chữ..." : "Enter label..."}
              className="border-border bg-background text-foreground focus-visible:ring-ring h-7 w-48 rounded border px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
              autoFocus
            />
            <button
              type="button"
              onClick={commitTextEdit}
              className="bg-primary text-primary-foreground hover:bg-primary-hover cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors"
            >
              {isVi ? "Lưu" : "OK"}
            </button>
            <button
              type="button"
              onClick={() => setTextEdit(null)}
              className="text-muted-foreground hover:bg-surface-hover cursor-pointer rounded px-1.5 py-1 text-xs transition-colors"
            >
              {isVi ? "Hủy" : "Cancel"}
            </button>
          </div>
        ) : null}

        {scene.elements.length === 0 && editable ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="bg-surface/80 text-muted-foreground rounded-md px-3 py-1.5 text-xs">
              {isVi
                ? "Kéo thả trên khung để vẽ hình, mũi tên hoặc nét bút — nhấp đúp vào hình để thêm chữ"
                : "Click and drag to draw shapes, arrows, or freehand — double-click a shape to add text"}
            </p>
          </div>
        ) : null}
      </div>

      {editable ? (
        <div className="border-border bg-surface-sunken/40 rounded-b-lg border-t px-3 py-1.5">
          <input
            type="text"
            value={caption}
            onChange={(e) => {
              setCaption(e.target.value);
              updateAttributes({ caption: e.target.value });
            }}
            placeholder={
              isVi ? "Chú thích bảng vẽ (tùy chọn)..." : "Whiteboard caption (optional)..."
            }
            className="text-muted-foreground placeholder:text-muted-foreground/60 w-full bg-transparent text-xs outline-none"
          />
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

export const WhiteboardNode = Node.create({
  name: "whiteboard",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      scene: {
        default: JSON.stringify(DEFAULT_SCENE),
        parseHTML: (el) =>
          el.getAttribute("data-scene") || JSON.stringify(DEFAULT_SCENE),
        renderHTML: (attrs) => ({
          "data-scene": attrs.scene || JSON.stringify(DEFAULT_SCENE),
        }),
      },
      svg: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-svg") || "",
        renderHTML: (attrs) => (attrs.svg ? { "data-svg": attrs.svg } : {}),
      },
      caption: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-caption") || "",
        renderHTML: (attrs) =>
          attrs.caption ? { "data-caption": attrs.caption } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="whiteboard"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "whiteboard" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WhiteboardNodeView);
  },
});
