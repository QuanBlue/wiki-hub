"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  Code2,
  Columns2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileDown,
  Image as ImageIcon,
  Maximize2,
  Network,
  PenTool,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type DiagramLook = "classic" | "handDrawn";
export type DiagramAlignment = "left" | "center" | "right";

export const DEFAULT_MERMAID_CODE = `flowchart TD
    A[Bắt đầu] --> B{Điều kiện?}
    B -- Đúng --> C[Xử lý tác vụ]
    B -- Sai --> D[Thực hiện thay thế]
    C --> E[Hoàn thành]
    D --> E`;

export const DIAGRAM_TEMPLATES: Record<string, { labelKey: string; code: string }> = {
  flowchart: {
    labelKey: "editor.diagramTemplateFlowchart",
    code: `flowchart TD
    Start([Bắt đầu]) --> Step1[Bước 1: Nhận yêu cầu]
    Step1 --> Decision{Hợp lệ?}
    Decision -- Có --> Process[Xử lý quy trình]
    Decision -- Không --> Error[Báo lỗi phản hồi]
    Process --> End([Kết thúc])
    Error --> End`,
  },
  sequence: {
    labelKey: "editor.diagramTemplateSequence",
    code: `sequenceDiagram
    autonumber
    actor User as Người dùng
    participant Client as Web App (WikiHub)
    participant API as Backend API
    participant DB as Database

    User->>Client: Gửi thao tác
    Client->>API: POST /api/v1/resource
    API->>DB: Query / Mutate
    DB-->>API: Result data
    API-->>Client: 200 OK (JSON)
    Client-->>User: Cập nhật giao diện`,
  },
  architecture: {
    labelKey: "editor.diagramTemplateArchitecture",
    code: `flowchart LR
    Client[Web Frontend / Next.js] -->|REST / HTTPS| Gateway[API Gateway / FastAPI]
    Gateway --> Auth[Auth Service]
    Gateway --> Pages[Page & Space Engine]
    Gateway --> Search[Search & AI Service]
    Pages --> Postgres[(PostgreSQL)]
    Pages --> Storage[(MinIO / S3)]
    Search --> VectorDB[(Embeddings Store)]`,
  },
  classDiagram: {
    labelKey: "editor.diagramTemplateClass",
    code: `classDiagram
    class WikiPage {
        +UUID id
        +String title
        +String content
        +DateTime updated_at
        +publish()
        +exportPdf()
    }
    class Space {
        +String key
        +String name
        +List~WikiPage~ pages
    }
    class User {
        +UUID id
        +String email
        +String role
    }
    Space "1" *-- "many" WikiPage : contains
    User "1" --> "many" WikiPage : edits`,
  },
  erDiagram: {
    labelKey: "editor.diagramTemplateER",
    code: `erDiagram
    USERS ||--o{ PAGES : authors
    SPACES ||--|{ PAGES : contains
    PAGES ||--o{ ATTACHMENTS : has
    USERS {
        uuid id PK
        string email
        string display_name
    }
    PAGES {
        uuid id PK
        uuid space_id FK
        string title
        text content
    }`,
  },
  stateDiagram: {
    labelKey: "editor.diagramTemplateState",
    code: `stateDiagram-v2
    [*] --> Draft : Tạo mới
    Draft --> InReview : Gửi duyệt
    InReview --> Approved : Chấp thuận
    InReview --> Rejected : Yêu cầu sửa
    Rejected --> Draft : Chỉnh sửa lại
    Approved --> Published : Xuất bản
    Published --> Archived : Lưu trữ
    Archived --> [*]`,
  },
  gitGraph: {
    labelKey: "editor.diagramTemplateGit",
    code: `gitGraph
    commit
    commit
    branch feature/diagram
    checkout feature/diagram
    commit id: "add-slash-cmd"
    commit id: "add-live-preview"
    checkout main
    merge feature/diagram
    commit id: "release"`,
  },
};

interface DiagramFullscreenModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string | null;
  svgOutput: string;
  onCopyPng?: () => void;
  onDownloadPng?: () => void;
  onDownloadSvg?: () => void;
  onDownloadMmd?: () => void;
}

function getSvgDimensions(svgStr: string): { width: number; height: number } {
  if (!svgStr) return { width: 800, height: 600 };
  const viewBoxMatch = svgStr.match(/viewBox=["']\s*([0-9.-]+)[\s,]+([0-9.-]+)[\s,]+([0-9.-]+)[\s,]+([0-9.-]+)\s*["']/i);
  if (viewBoxMatch) {
    const w = parseFloat(viewBoxMatch[3]);
    const h = parseFloat(viewBoxMatch[4]);
    if (w > 0 && h > 0) {
      return { width: Math.round(w), height: Math.round(h) };
    }
  }
  const widthMatch = svgStr.match(/width=["']([0-9.]+)(?:px)?["']/i);
  const heightMatch = svgStr.match(/height=["']([0-9.]+)(?:px)?["']/i);
  if (widthMatch && heightMatch) {
    const w = parseFloat(widthMatch[1]);
    const h = parseFloat(heightMatch[1]);
    if (w > 0 && h > 0) {
      return { width: Math.round(w), height: Math.round(h) };
    }
  }
  return { width: 800, height: 600 };
}

function prepareVectorSvg(svgStr: string): string {
  if (!svgStr) return "";
  return svgStr.replace(/<svg\b([^>]*)>/i, (_match, attrs) => {
    const cleanAttrs = attrs
      .replace(/\b(width|height)=["'][^"']*["']/gi, "")
      .replace(/\bstyle=["'][^"']*["']/gi, "");
    return `<svg ${cleanAttrs} width="100%" height="100%" style="width: 100%; height: 100%; max-width: none; overflow: visible;">`;
  });
}

function DiagramFullscreenModal({
  isOpen,
  onClose,
  title,
  svgOutput,
  onCopyPng,
  onDownloadPng,
  onDownloadSvg,
  onDownloadMmd,
}: DiagramFullscreenModalProps) {
  const [displayScale, setDisplayScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const svgWrapperRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const isPanningRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const baseDims = useMemo(() => getSvgDimensions(svgOutput), [svgOutput]);
  const vectorSvg = useMemo(() => prepareVectorSvg(svgOutput), [svgOutput]);

  const applyTransform = useCallback((withTransition = false) => {
    if (contentRef.current) {
      contentRef.current.style.transition = withTransition
        ? "transform 0.16s cubic-bezier(0.2, 0, 0, 1)"
        : "none";
      contentRef.current.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0)`;
    }
    if (svgWrapperRef.current) {
      svgWrapperRef.current.style.transition = withTransition
        ? "width 0.16s cubic-bezier(0.2, 0, 0, 1), height 0.16s cubic-bezier(0.2, 0, 0, 1)"
        : "none";
      svgWrapperRef.current.style.width = `${Math.round(baseDims.width * scaleRef.current)}px`;
      svgWrapperRef.current.style.height = `${Math.round(baseDims.height * scaleRef.current)}px`;
    }
  }, [baseDims]);

  // Reset zoom & pan whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      scaleRef.current = 1;
      panRef.current = { x: 0, y: 0 };
      setDisplayScale(1);
      requestAnimationFrame(() => applyTransform(false));
    }
  }, [isOpen, applyTransform]);

  // Press ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Mouse wheel zoom centered around mouse pointer
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.88;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);

      const prevScale = scaleRef.current;
      const nextScale = Math.min(6.0, Math.max(0.15, prevScale * zoomFactor));
      const roundedScale = Math.round(nextScale * 100) / 100;
      scaleRef.current = roundedScale;

      const dx = (cx - panRef.current.x) / prevScale;
      const dy = (cy - panRef.current.y) / prevScale;
      panRef.current = {
        x: Math.round(cx - dx * roundedScale),
        y: Math.round(cy - dy * roundedScale),
      };

      applyTransform(false);
      setDisplayScale(roundedScale);
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [isOpen, applyTransform]);

  if (!isOpen) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only primary (left) or middle button initiates panning
    if (e.button !== 0 && e.button !== 1) return;
    isPanningRef.current = true;
    setIsPanning(true);
    startPosRef.current = {
      x: e.clientX - panRef.current.x,
      y: e.clientY - panRef.current.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (contentRef.current) {
      contentRef.current.style.transition = "none";
    }
    if (svgWrapperRef.current) {
      svgWrapperRef.current.style.transition = "none";
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) return;
    panRef.current = {
      x: e.clientX - startPosRef.current.x,
      y: e.clientY - startPosRef.current.y,
    };
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        applyTransform(false);
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      setIsPanning(false);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      applyTransform(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const zoomIn = () => {
    const next = Math.min(6.0, Math.round(scaleRef.current * 1.25 * 100) / 100);
    scaleRef.current = next;
    applyTransform(true);
    setDisplayScale(next);
  };

  const zoomOut = () => {
    const next = Math.max(0.15, Math.round(scaleRef.current * 0.8 * 100) / 100);
    scaleRef.current = next;
    applyTransform(true);
    setDisplayScale(next);
  };

  const resetView = () => {
    scaleRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    applyTransform(true);
    setDisplayScale(1);
  };

  return (
    <div
      contentEditable={false}
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-md"
    >
      {/* Top Header & Controls */}
      <div className="flex items-center justify-between border-b border-border bg-surface/60 px-5 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Network className="size-5 text-primary shrink-0" aria-hidden />
          <span className="truncate max-w-[280px] sm:max-w-md">{title || "Mermaid Diagram"}</span>
        </div>

        {/* Viewport controls */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
            <button
              type="button"
              onClick={zoomOut}
              title="Thu nhỏ (-)"
              className="flex size-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <ZoomOut className="size-4" aria-hidden />
            </button>
            <span className="min-w-12 text-center font-mono text-xs font-medium text-foreground select-none">
              {Math.round(displayScale * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              title="Phóng to (+)"
              className="flex size-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <ZoomIn className="size-4" aria-hidden />
            </button>
          </div>

          <button
            type="button"
            onClick={resetView}
            title="Đặt lại tỉ lệ (100%)"
            className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">100%</span>
          </button>

          {onCopyPng && (
            <button
              type="button"
              onClick={onCopyPng}
              title="Sao chép ảnh PNG"
              className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <ImageIcon className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Sao chép PNG</span>
            </button>
          )}

          {onDownloadPng && (
            <button
              type="button"
              onClick={onDownloadPng}
              title="Tải xuống ảnh PNG"
              className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <Download className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Tải PNG</span>
            </button>
          )}

          {onDownloadSvg && (
            <button
              type="button"
              onClick={onDownloadSvg}
              title="Tải xuống vector SVG"
              className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <FileCode2 className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Tải SVG</span>
            </button>
          )}

          {onDownloadMmd && (
            <button
              type="button"
              onClick={onDownloadMmd}
              title="Tải xuống file Mermaid (.mmd)"
              className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <FileDown className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Tải .mmd</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            title="Đóng (ESC)"
            className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-border text-foreground hover:bg-surface-hover transition-colors ml-1"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Interactive Canvas */}
      <div
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={resetView}
        className={cn(
          "relative flex-1 overflow-hidden select-none touch-none",
          "bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px]",
          isPanning ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <div
          ref={contentRef}
          style={{
            transform: "translate3d(0px, 0px, 0)",
          }}
          className="flex h-full w-full items-center justify-center pointer-events-none"
        >
          <div
            ref={svgWrapperRef}
            style={{
              width: `${baseDims.width}px`,
              height: `${baseDims.height}px`,
            }}
            className="flex items-center justify-center shrink-0 [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-none pointer-events-auto p-6 rounded-lg bg-card/70 border border-border/40 shadow-sm transition-[width,height] duration-75"
            dangerouslySetInnerHTML={{ __html: vectorSvg }}
          />
        </div>

        {/* Bottom Helper Bar */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border/80 bg-background/80 px-3.5 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur-xs select-none">
          Cuộn chuột để phóng to/thu nhỏ • Kéo chuột để di chuyển • Nhấp đúp để đặt lại
        </div>
      </div>
    </div>
  );
}

export function DiagramBlockComponent({
  editor,
  node,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const canEdit = editor.isEditable;

  const rawCode = String(node.attrs.code ?? "");
  const code = rawCode.trim() ? rawCode : DEFAULT_MERMAID_CODE;
  const look: DiagramLook = (node.attrs.look as DiagramLook) || "classic";
  const caption = String(node.attrs.caption ?? "");
  const alignment: DiagramAlignment = (node.attrs.alignment as DiagramAlignment) || "center";
  const savedWidth = node.attrs.width ? Number(node.attrs.width) : null;

  const [viewMode, setViewMode] = useState<"preview" | "split" | "code">(() =>
    canEdit && !node.attrs.code ? "split" : "preview",
  );
  const [codeDraft, setCodeDraft] = useState(code);
  const [captionDraft, setCaptionDraft] = useState(caption);
  const [isCopied, setIsCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Resizing state
  const [pendingWidth, setPendingWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const pendingWidthRef = useRef<number | null>(null);

  const [svgOutput, setSvgOutput] = useState<string>("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState<boolean>(true);

  const uniqueId = useId().replace(/:/g, "diagram_");
  const renderSeqRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // Sync draft if external node.attrs change
  useEffect(() => {
    if (node.attrs.code !== undefined && node.attrs.code !== codeDraft) {
      setCodeDraft(node.attrs.code);
    }
  }, [node.attrs.code]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render diagram via dynamic Mermaid import
  const renderDiagram = useCallback(
    async (codeToRender: string, currentLook: DiagramLook, darkMode: boolean) => {
      const currentSeq = ++renderSeqRef.current;
      setIsRendering(true);

      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;

        const themeVars = darkMode
          ? {
              darkMode: true,
              background: "#1f2330",
              mainBkg: "#272c3b",
              nodeBorder: "#363d50",
              primaryColor: "#272c3b",
              primaryTextColor: "#f1f5f9",
              primaryBorderColor: "#444d64",
              lineColor: "#8b949e",
              secondaryColor: "#191c27",
              tertiaryColor: "#2f3546",
              fontFamily: "var(--font-sans, inherit)",
            }
          : {
              darkMode: false,
              background: "#ffffff",
              mainBkg: "#f7f8fa",
              nodeBorder: "#cbd1da",
              primaryColor: "#f7f8fa",
              primaryTextColor: "#161b24",
              primaryBorderColor: "#9aa3b2",
              lineColor: "#6b7484",
              secondaryColor: "#ffffff",
              tertiaryColor: "#eef0f4",
              fontFamily: "var(--font-sans, inherit)",
            };

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: darkMode ? "dark" : "base",
          themeVariables: themeVars,
          look: currentLook === "handDrawn" ? "handDrawn" : "classic",
          fontFamily: "var(--font-sans, inherit)",
        });

        const elementId = `mermaid_${uniqueId}_${currentSeq}`;
        const cleanCode = codeToRender.trim() || "flowchart TD\n  Empty[Trống]";
        const { svg } = await mermaid.render(elementId, cleanCode);

        if (currentSeq !== renderSeqRef.current) return;

        setSvgOutput(svg);
        setRenderError(null);
      } catch (err: unknown) {
        if (currentSeq !== renderSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setRenderError(msg);
      } finally {
        if (currentSeq === renderSeqRef.current) {
          setIsRendering(false);
          if (containerRef.current) {
            containerRef.current.dataset.diagramPending = "false";
          }
        }
      }
    },
    [uniqueId],
  );

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.dataset.diagramPending = "true";
    }
    const timer = setTimeout(() => {
      renderDiagram(codeDraft, look, isDark);
    }, 180);
    return () => clearTimeout(timer);
  }, [codeDraft, look, isDark, renderDiagram]);

  function toggleLook() {
    const nextLook: DiagramLook = look === "classic" ? "handDrawn" : "classic";
    updateAttributes({ look: nextLook });
  }

  function setDiagramAlignment(nextAlign: DiagramAlignment) {
    updateAttributes({ alignment: nextAlign });
  }

  function applyTemplate(templateKey: string) {
    const template = DIAGRAM_TEMPLATES[templateKey];
    if (!template) return;
    setCodeDraft(template.code);
    updateAttributes({ code: template.code });
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setCodeDraft(val);
    updateAttributes({ code: val });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextVal = codeDraft.substring(0, start) + "  " + codeDraft.substring(end);
      setCodeDraft(nextVal);
      updateAttributes({ code: nextVal });
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(codeDraft);
      setIsCopied(true);
      toast.success(t("editor.diagramCodeCopied"));
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // ignore clipboard error
    }
  }

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  // Close context menu on outside interaction
  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = (e: Event) => {
      if (e instanceof MouseEvent && contextMenuRef.current?.contains(e.target as Node)) {
        return;
      }
      setContextMenu(null);
    };
    window.addEventListener("pointerdown", handleClose);
    window.addEventListener("keydown", handleClose);
    window.addEventListener("scroll", handleClose, true);
    return () => {
      window.removeEventListener("pointerdown", handleClose);
      window.removeEventListener("keydown", handleClose);
      window.removeEventListener("scroll", handleClose, true);
    };
  }, [contextMenu]);

  function getSafeFileName(ext = "") {
    const raw = captionDraft || caption || "diagram";
    const clean = raw.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9-]/g, "_");
    return ext ? `${clean}.${ext}` : clean;
  }

  function downloadBlob(blob: Blob, fileName: string) {
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  async function generatePngBlob(): Promise<Blob | null> {
    if (!svgOutput && !frameRef.current) return null;

    const svgEl = frameRef.current?.querySelector("svg") as SVGSVGElement | null;
    const rawSvg = svgOutput || (svgEl ? new XMLSerializer().serializeToString(svgEl) : "");
    if (!rawSvg) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(rawSvg, "image/svg+xml");
    const rootSvg = doc.querySelector("svg");
    if (!rootSvg) return null;

    if (!rootSvg.getAttribute("xmlns")) {
      rootSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    if (!rootSvg.getAttribute("xmlns:xlink")) {
      rootSvg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    }

    let width = 800;
    let height = 600;

    const viewBox = rootSvg.getAttribute("viewBox");
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        width = parts[2];
        height = parts[3];
      }
    } else if (svgEl) {
      const bcr = svgEl.getBoundingClientRect();
      if (bcr.width > 0 && bcr.height > 0) {
        width = Math.round(bcr.width);
        height = Math.round(bcr.height);
      }
    }

    rootSvg.setAttribute("width", width.toString());
    rootSvg.setAttribute("height", height.toString());
    rootSvg.removeAttribute("style");

    const foreignObjects = Array.from(doc.querySelectorAll("foreignObject"));
    for (const fo of foreignObjects) {
      const textContent = fo.textContent?.trim() || "";
      const foX = parseFloat(fo.getAttribute("x") || "0");
      const foY = parseFloat(fo.getAttribute("y") || "0");
      const foW = parseFloat(fo.getAttribute("width") || "0");
      const foH = parseFloat(fo.getAttribute("height") || "0");

      const textEl = doc.createElementNS("http://www.w3.org/2000/svg", "text");
      textEl.setAttribute("x", (foX + foW / 2).toString());
      textEl.setAttribute("y", (foY + foH / 2).toString());
      textEl.setAttribute("text-anchor", "middle");
      textEl.setAttribute("dominant-baseline", "middle");
      textEl.setAttribute("fill", isDark ? "#f1f5f9" : "#161b24");
      textEl.setAttribute("font-family", "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif");
      textEl.setAttribute("font-size", "13px");
      textEl.setAttribute("font-weight", "500");
      textEl.textContent = textContent;

      fo.parentNode?.replaceChild(textEl, fo);
    }

    const cleanSvgStr = new XMLSerializer().serializeToString(doc);

    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(100, Math.round(width * scale));
    canvas.height = Math.max(100, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = isDark ? "#1e293b" : "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const svgDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(cleanSvgStr);
    const img = new Image();

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Lỗi tải SVG vào ảnh"));
      img.src = svgDataUrl;
    });

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png", 1.0);
    });
  }

  async function copyDiagramAsPng() {
    try {
      const pngBlob = await generatePngBlob();
      if (!pngBlob) {
        toast.error("Không thể tạo tệp PNG");
        return;
      }

      if (typeof window !== "undefined" && navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "image/png": pngBlob,
            }),
          ]);
          toast.success(t("editor.diagramPngCopied"));
          return;
        } catch (clipErr) {
          console.warn("Clipboard write direct failed, falling back to download", clipErr);
        }
      }

      downloadBlob(pngBlob, getSafeFileName("png"));
      toast.success(t("editor.diagramPngDownloaded"));
    } catch (err) {
      console.error("Failed to copy diagram as PNG", err);
      toast.error("Không thể sao chép ảnh PNG: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function downloadDiagramAsPng() {
    try {
      const pngBlob = await generatePngBlob();
      if (!pngBlob) {
        toast.error("Không thể tạo tệp PNG");
        return;
      }
      downloadBlob(pngBlob, getSafeFileName("png"));
      toast.success(t("editor.diagramPngDownloaded"));
    } catch (err) {
      console.error("Failed to download PNG", err);
      toast.error("Lỗi khi tải ảnh PNG");
    }
  }

  function downloadDiagramAsSvg() {
    try {
      if (!svgOutput && !frameRef.current) return;
      const svgEl = frameRef.current?.querySelector("svg") as SVGSVGElement | null;
      const rawSvg = svgOutput || (svgEl ? new XMLSerializer().serializeToString(svgEl) : "");
      if (!rawSvg) return;

      const blob = new Blob([rawSvg], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, getSafeFileName("svg"));
      toast.success(t("editor.diagramSvgDownloaded"));
    } catch (err) {
      console.error("Failed to download SVG", err);
      toast.error("Lỗi khi tải file SVG");
    }
  }

  function downloadMermaidCode() {
    try {
      const blob = new Blob([codeDraft], { type: "text/plain;charset=utf-8" });
      downloadBlob(blob, getSafeFileName("mmd"));
      toast.success(t("editor.diagramMmdDownloaded"));
    } catch (err) {
      console.error("Failed to download Mermaid code", err);
      toast.error("Lỗi khi tải file Mermaid");
    }
  }

  function handleCaptionBlur() {
    const trimmed = captionDraft.trim();
    updateAttributes({ caption: trimmed || null });
  }

  // Width resizing handlers
  function startResize(startX: number, handle: "e" | "w") {
    const frame = frameRef.current;
    if (!frame) return;
    const initialWidth = frame.getBoundingClientRect().width;
    setResizing(true);

    const onPointerMove = (e: PointerEvent) => {
      // If expanding from right (e), dx = e.clientX - startX
      // If expanding from left (w), dx = startX - e.clientX
      // In center alignment, resizing either side expands symmetrically:
      const rawDelta = handle === "e" ? e.clientX - startX : startX - e.clientX;
      const multiplier = alignment === "center" ? 2 : 1;
      const nextWidth = Math.max(240, Math.min(1400, Math.round(initialWidth + rawDelta * multiplier)));
      pendingWidthRef.current = nextWidth;
      setPendingWidth(nextWidth);
    };

    const onPointerUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (pendingWidthRef.current) {
        updateAttributes({ width: pendingWidthRef.current });
      }
      setPendingWidth(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function resetWidth() {
    updateAttributes({ width: null });
    setPendingWidth(null);
  }

  const activeWidth = pendingWidth ?? savedWidth;
  const isCompact = Boolean(activeWidth && activeWidth < 560);

  // -------------------------------------------------------------
  // VIEW MODE (Read-only / No editor frame requested by user)
  // -------------------------------------------------------------
  if (!canEdit) {
    return (
      <NodeViewWrapper
        ref={containerRef}
        data-type="diagram"
        data-engine="mermaid"
        data-look={look}
        data-code={codeDraft}
        data-caption={caption || undefined}
        data-width={savedWidth || undefined}
        data-alignment={alignment}
        data-diagram-pending={isRendering ? "true" : "false"}
        className="group/diagram relative my-6 block w-full select-none"
      >
        <div
          ref={frameRef}
          style={{
            width: activeWidth ? `${activeWidth}px` : "100%",
            maxWidth: "100%",
          }}
          className={cn(
            "relative flex flex-col transition-all",
            alignment === "center" && "mx-auto",
            alignment === "left" && "mr-auto ml-0",
            alignment === "right" && "ml-auto mr-0",
          )}
        >
          {/* Clean Vector SVG output without card frame */}
          <div className="flex w-full items-center justify-center overflow-x-auto py-2">
            {renderError ? (
              <div className="flex w-full flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  <span>{t("editor.diagramSyntaxError")}</span>
                </div>
                <pre className="max-h-24 overflow-y-auto font-mono text-[11px] whitespace-pre-wrap">
                  {renderError}
                </pre>
              </div>
            ) : svgOutput ? (
              <div
                onClick={() => setIsFullscreen(true)}
                onContextMenu={handleContextMenu}
                title="Nhấp để phóng to • Chuột phải để sao chép ảnh PNG"
                className="mermaid-render-output flex w-full cursor-zoom-in justify-center overflow-x-auto [&>svg]:max-w-full [&>svg]:h-auto transition-transform hover:scale-[1.005]"
                dangerouslySetInnerHTML={{ __html: svgOutput }}
              />
            ) : null}
          </div>

          {/* Clean Caption */}
          {caption && (
            <figcaption className="mt-1.5 text-center text-xs italic text-muted-foreground">
              {caption}
            </figcaption>
          )}
        </div>

        {/* Fullscreen Pan & Zoom Overlay Dialog */}
        <DiagramFullscreenModal
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
          title={caption}
          svgOutput={svgOutput}
          onCopyPng={copyDiagramAsPng}
          onDownloadPng={downloadDiagramAsPng}
          onDownloadSvg={downloadDiagramAsSvg}
          onDownloadMmd={downloadMermaidCode}
        />

        {/* Context Menu on Right Click */}
        {contextMenu && (
          <div
            ref={contextMenuRef}
            contentEditable={false}
            style={{
              position: "fixed",
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
              zIndex: 9999,
            }}
            className={cn(
              "min-w-56 overflow-hidden rounded-lg border border-border p-1.5 shadow-xl select-none",
              "bg-white dark:bg-card text-foreground",
              "animate-in fade-in-0 zoom-in-95 duration-100",
            )}
          >
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                copyDiagramAsPng();
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <ImageIcon className="size-4 text-muted-foreground shrink-0" aria-hidden />
              <span>{t("editor.diagramCopyPng")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                copyCode();
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <Copy className="size-4 text-muted-foreground shrink-0" aria-hidden />
              <span>{t("editor.diagramCopyCode")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                setIsFullscreen(true);
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <Maximize2 className="size-4 text-muted-foreground shrink-0" aria-hidden />
              <span>{t("editor.diagramZoom")}</span>
            </button>

            <div className="my-1 border-t border-border" />

            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                downloadDiagramAsPng();
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <Download className="size-4 text-muted-foreground shrink-0" aria-hidden />
              <span>{t("editor.diagramDownloadPng")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                downloadDiagramAsSvg();
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <FileCode2 className="size-4 text-muted-foreground shrink-0" aria-hidden />
              <span>{t("editor.diagramDownloadSvg")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                downloadMermaidCode();
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <FileDown className="size-4 text-muted-foreground shrink-0" aria-hidden />
              <span>{t("editor.diagramDownloadMmd")}</span>
            </button>
          </div>
        )}
      </NodeViewWrapper>
    );
  }

  // -------------------------------------------------------------
  // EDIT MODE (Full control toolbar, resizable edges, split/code)
  // -------------------------------------------------------------
  return (
    <NodeViewWrapper
      ref={containerRef}
      data-type="diagram"
      data-engine="mermaid"
      data-look={look}
      data-code={codeDraft}
      data-caption={caption || undefined}
      data-width={savedWidth || undefined}
      data-alignment={alignment}
      data-diagram-pending={isRendering ? "true" : "false"}
      className="group/diagram relative my-5 block w-full select-none"
    >
      <div
        ref={frameRef}
        style={{
          width: activeWidth ? `${activeWidth}px` : "100%",
          maxWidth: "100%",
        }}
        className={cn(
          "relative flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xs transition-all",
          alignment === "center" && "mx-auto",
          alignment === "left" && "mr-auto ml-0",
          alignment === "right" && "ml-auto mr-0",
          resizing && "ring-2 ring-primary border-primary",
        )}
      >
        {/* Chrome Toolbar */}
        <div
          contentEditable={false}
          className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-border bg-surface-sunken px-2.5 py-1.5 select-none"
        >
          {/* Left: Indicator, Look Toggle & Alignment */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Network className="size-4 text-primary shrink-0" aria-hidden />
              <span className={cn(isCompact ? "text-[11px]" : "text-xs")}>Mermaid</span>
            </div>

            {/* Look Switcher */}
            <button
              type="button"
              onClick={toggleLook}
              title={look === "classic" ? t("editor.diagramLookHandDrawn") : t("editor.diagramLookClassic")}
              className={cn(
                "flex h-6.5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                look === "handDrawn"
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "bg-surface hover:bg-surface-hover text-muted-foreground hover:text-foreground border border-border",
              )}
            >
              <PenTool className="size-3 shrink-0" aria-hidden />
              {!isCompact && (
                <span className="hidden md:inline">
                  {look === "handDrawn" ? t("editor.diagramLookHandDrawn") : t("editor.diagramLookClassic")}
                </span>
              )}
            </button>

            {/* Alignment Options */}
            <div className="flex items-center rounded-md border border-border bg-surface p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setDiagramAlignment("left")}
                title="Căn trái"
                className={cn(
                  "flex size-6 cursor-pointer items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                  alignment === "left"
                    ? "bg-primary text-primary-foreground font-medium shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <AlignLeft className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setDiagramAlignment("center")}
                title="Căn giữa"
                className={cn(
                  "flex size-6 cursor-pointer items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                  alignment === "center"
                    ? "bg-primary text-primary-foreground font-medium shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <AlignCenter className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setDiagramAlignment("right")}
                title="Căn phải"
                className={cn(
                  "flex size-6 cursor-pointer items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                  alignment === "right"
                    ? "bg-primary text-primary-foreground font-medium shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <AlignRight className="size-3.5" aria-hidden />
              </button>
            </div>

            {/* Reset Width button (if customized) */}
            {savedWidth && (
              <button
                type="button"
                onClick={resetWidth}
                title="Đặt lại chiều rộng mặc định (100%)"
                className="flex h-6.5 cursor-pointer items-center gap-1 rounded border border-border bg-surface px-1.5 text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
              >
                <RotateCcw className="size-3 shrink-0" aria-hidden />
                {!isCompact && <span className="hidden xl:inline">{savedWidth}px</span>}
              </button>
            )}
          </div>

          {/* Right Actions */}
          <div className="flex flex-wrap items-center gap-1">
            {/* Templates menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title={t("editor.diagramTemplates")}
                  className="flex h-7 cursor-pointer items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                >
                  <Sparkles className="size-3.5 text-primary shrink-0" aria-hidden />
                  {!isCompact && <span className="hidden lg:inline">{t("editor.diagramTemplates")}</span>}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{t("editor.diagramTemplates")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {Object.entries(DIAGRAM_TEMPLATES).map(([key, item]) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => applyTemplate(key)}
                    className="cursor-pointer text-xs"
                  >
                    {t(item.labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* View mode toggle (Preview / Split / Code) */}
            <div className="flex items-center rounded-md border border-border bg-surface p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                title={t("editor.diagramViewPreview")}
                className={cn(
                  "flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                  viewMode === "preview"
                    ? "bg-primary text-primary-foreground font-medium shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Eye className="size-3 shrink-0" aria-hidden />
                {!isCompact && <span className="hidden md:inline">{t("editor.diagramViewPreview")}</span>}
              </button>
              <button
                type="button"
                onClick={() => setViewMode("split")}
                title={t("editor.diagramViewSplit")}
                className={cn(
                  "flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                  viewMode === "split"
                    ? "bg-primary text-primary-foreground font-medium shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Columns2 className="size-3 shrink-0" aria-hidden />
                {!isCompact && <span className="hidden md:inline">{t("editor.diagramViewSplit")}</span>}
              </button>
              <button
                type="button"
                onClick={() => setViewMode("code")}
                title={t("editor.diagramViewCode")}
                className={cn(
                  "flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                  viewMode === "code"
                    ? "bg-primary text-primary-foreground font-medium shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Code2 className="size-3 shrink-0" aria-hidden />
                {!isCompact && <span className="hidden md:inline">{t("editor.diagramViewCode")}</span>}
              </button>
            </div>

            {/* Delete button */}
            <button
              type="button"
              onClick={deleteNode}
              aria-label={t("editor.diagramDelete")}
              title={t("editor.diagramDelete")}
              className="flex size-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-danger/10 hover:text-danger transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>

        {/* Main Content Body */}
        <div
          contentEditable={false}
          className={cn(
            "relative grid min-h-[160px] transition-all",
            viewMode === "split"
              ? "grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border"
              : "grid-cols-1",
          )}
        >
          {/* Resize Handles (Left & Right) positioned over content area */}
          <div
            onPointerDown={(e) => {
              e.preventDefault();
              startResize(e.clientX, "w");
            }}
            title="Kéo sang hai bên để thu hẹp hoặc mở rộng"
            className="group/handle absolute inset-y-0 left-0 z-20 flex w-3 cursor-ew-resize items-center justify-center hover:bg-primary/20 active:bg-primary/40 transition-colors"
          >
            <div className="h-8 w-1 rounded-full bg-border/80 group-hover/handle:bg-primary transition-colors" />
          </div>
          <div
            onPointerDown={(e) => {
              e.preventDefault();
              startResize(e.clientX, "e");
            }}
            title="Kéo sang hai bên để thu hẹp hoặc mở rộng"
            className="group/handle absolute inset-y-0 right-0 z-20 flex w-3 cursor-ew-resize items-center justify-center hover:bg-primary/20 active:bg-primary/40 transition-colors"
          >
            <div className="h-8 w-1 rounded-full bg-border/80 group-hover/handle:bg-primary transition-colors" />
          </div>
          {/* Code Editor Pane (shown in Split or Code mode) */}
          {(viewMode === "code" || viewMode === "split") && (
            <div className="flex flex-col bg-surface-sunken/50 p-2">
              <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-mono text-muted-foreground">
                <span>Mermaid syntax</span>
                <span>Tab: indent</span>
              </div>
              <textarea
                ref={textareaRef}
                value={codeDraft}
                onChange={handleCodeChange}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                placeholder="Gõ mã Mermaid tại đây..."
                rows={Math.max(8, codeDraft.split("\n").length + 1)}
                className="w-full flex-1 resize-y rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              />
            </div>
          )}

          {/* Live Preview Pane (shown in Preview or Split mode) */}
          {(viewMode === "preview" || viewMode === "split") && (
            <div className="relative flex flex-col items-center justify-center overflow-x-auto bg-card p-4">
              {renderError ? (
                <div className="flex w-full flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden />
                    <span>{t("editor.diagramSyntaxError")}</span>
                  </div>
                  <pre className="max-h-24 overflow-y-auto font-mono text-[11px] whitespace-pre-wrap">
                    {renderError}
                  </pre>
                </div>
              ) : svgOutput ? (
                <div
                  onClick={() => setIsFullscreen(true)}
                  onContextMenu={handleContextMenu}
                  title="Nhấp để phóng to • Chuột phải để sao chép ảnh PNG"
                  className="mermaid-render-output flex w-full cursor-zoom-in justify-center overflow-x-auto [&>svg]:max-w-full [&>svg]:h-auto transition-transform hover:scale-[1.005]"
                  dangerouslySetInnerHTML={{ __html: svgOutput }}
                />
              ) : (
                <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
                  <span>{t("editor.editorPlaceholder")}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Caption Bar */}
        <div contentEditable={false} className="border-t border-border/60 bg-card px-3 py-1.5">
          <input
            type="text"
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            onBlur={handleCaptionBlur}
            placeholder={t("editor.diagramCaptionPlaceholder")}
            className="w-full bg-transparent text-center text-xs text-muted-foreground placeholder:text-muted-foreground/60 focus-visible:outline-hidden"
          />
        </div>
      </div>

      {/* Fullscreen Pan & Zoom Overlay Dialog */}
      <DiagramFullscreenModal
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        title={captionDraft || caption}
        svgOutput={svgOutput}
        onCopyPng={copyDiagramAsPng}
        onDownloadPng={downloadDiagramAsPng}
        onDownloadSvg={downloadDiagramAsSvg}
        onDownloadMmd={downloadMermaidCode}
      />

      {/* Context Menu on Right Click */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          contentEditable={false}
          style={{
            position: "fixed",
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            zIndex: 9999,
          }}
          className={cn(
            "min-w-56 overflow-hidden rounded-lg border border-border p-1.5 shadow-xl select-none",
            "bg-white dark:bg-card text-foreground",
            "animate-in fade-in-0 zoom-in-95 duration-100",
          )}
        >
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              copyDiagramAsPng();
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
          >
            <ImageIcon className="size-4 text-muted-foreground shrink-0" aria-hidden />
            <span>{t("editor.diagramCopyPng")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              copyCode();
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
          >
            <Copy className="size-4 text-muted-foreground shrink-0" aria-hidden />
            <span>{t("editor.diagramCopyCode")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              setIsFullscreen(true);
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
          >
            <Maximize2 className="size-4 text-muted-foreground shrink-0" aria-hidden />
            <span>{t("editor.diagramZoom")}</span>
          </button>

          <div className="my-1 border-t border-border" />

          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              downloadDiagramAsPng();
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
          >
            <Download className="size-4 text-muted-foreground shrink-0" aria-hidden />
            <span>{t("editor.diagramDownloadPng")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              downloadDiagramAsSvg();
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
          >
            <FileCode2 className="size-4 text-muted-foreground shrink-0" aria-hidden />
            <span>{t("editor.diagramDownloadSvg")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              downloadMermaidCode();
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
          >
            <FileDown className="size-4 text-muted-foreground shrink-0" aria-hidden />
            <span>{t("editor.diagramDownloadMmd")}</span>
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
