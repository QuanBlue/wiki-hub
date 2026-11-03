"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  BookOpen,
  Code2,
  Command,
  CornerDownLeft,
  ExternalLink,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  FolderTree,
  HelpCircle,
  Keyboard,
  Paperclip,
  Presentation,
  Search,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  CHEAT_SHEET_OPEN_EVENT,
  triggerOpenSearch,
  type CheatSheetOpenDetail,
  type CheatSheetTab,
} from "@/lib/cheat-sheet";
import { useTranslation } from "@/lib/i18n/context";
import { formatBinding, SHORTCUT_ACTIONS } from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/utils";

interface CommandSyntaxItem {
  token: string;
  example: string;
  description: string;
  type: "filter" | "command";
}

const SEARCH_SYNTAX_VI: CommandSyntaxItem[] = [
  {
    token: "space:KEY",
    example: "space:ENG kiến trúc",
    description: "Giới hạn tìm kiếm chỉ trong một space cụ thể theo mã space.",
    type: "filter",
  },
  {
    token: "type:pdf",
    example: "type:pdf hợp đồng",
    description: "Lọc theo định dạng tệp (pdf, docx, xlsx, pptx, html...).",
    type: "filter",
  },
  {
    token: "author:tên",
    example: "author:an báo cáo",
    description: "Tìm kiếm các trang được tạo hoặc sửa đổi bởi người dùng này.",
    type: "filter",
  },
  {
    token: "label:nhãn",
    example: "label:runbook",
    description: "Lọc các trang có gắn nhãn cụ thể.",
    type: "filter",
  },
  {
    token: "updated:thời_gian",
    example: "updated:>2026-01",
    description: "Lọc tài liệu theo khoảng thời gian cập nhật gần nhất.",
    type: "filter",
  },
  {
    token: ":ask câu hỏi",
    example: ":ask quy trình xin nghỉ phép thế nào?",
    description: "Hỏi Trợ lý AI và nhận câu trả lời tổng hợp kèm nguồn trích dẫn từ wiki.",
    type: "command",
  },
  {
    token: ":help chủ đề",
    example: ":help phím tắt",
    description: "Mở hoặc tìm kiếm nhanh các bài hướng dẫn sử dụng trong Help.",
    type: "command",
  },
  {
    token: ":chat",
    example: ":chat",
    description: "Mở cửa sổ Chat AI tương tác trực tiếp với tài liệu.",
    type: "command",
  },
  {
    token: ":users",
    example: ":users",
    description: "Đi nhanh đến danh sách thành viên trong hệ thống.",
    type: "command",
  },
];

const SEARCH_SYNTAX_EN: CommandSyntaxItem[] = [
  {
    token: "space:KEY",
    example: "space:ENG architecture",
    description: "Limit search to a specific space key.",
    type: "filter",
  },
  {
    token: "type:pdf",
    example: "type:pdf contract",
    description: "Filter by attachment file type (pdf, docx, xlsx, pptx, html...).",
    type: "filter",
  },
  {
    token: "author:name",
    example: "author:john report",
    description: "Find pages created or modified by a specific member.",
    type: "filter",
  },
  {
    token: "label:tag",
    example: "label:runbook",
    description: "Filter pages tagged with a specific label.",
    type: "filter",
  },
  {
    token: "updated:date",
    example: "updated:>2026-01",
    description: "Filter pages updated within a time range.",
    type: "filter",
  },
  {
    token: ":ask question",
    example: ":ask what is the deployment procedure?",
    description: "Ask the AI assistant for a synthesized answer with cited sources.",
    type: "command",
  },
  {
    token: ":help topic",
    example: ":help shortcuts",
    description: "Open or search the documentation guides in Help.",
    type: "command",
  },
  {
    token: ":chat",
    example: ":chat",
    description: "Open the interactive AI chat assistant drawer.",
    type: "command",
  },
  {
    token: ":users",
    example: ":users",
    description: "Jump straight to the workspace members directory.",
    type: "command",
  },
];

const SLASH_COMMANDS_VI = [
  { command: "/table", desc: "Chèn bảng dữ liệu kèm hàng tiêu đề và menu thao tác cột/dòng" },
  { command: "/callout", desc: "Khung ghi chú nổi bật (Note, Tip, Warning, Caution, Info)" },
  { command: "/code", desc: "Khối mã nguồn đa ngôn ngữ với tô màu cú pháp và số dòng" },
  { command: "/diagram", desc: "Sơ đồ tương tác (Mermaid, Flowchart, Sequence, Architecture)" },
  { command: "/math", desc: "Công thức toán học định dạng KaTeX/LaTeX" },
  { command: "/toc", desc: "Mục lục tự động (Table of Contents) theo các tiêu đề H1-H6" },
  { command: "/quote", desc: "Trích dẫn khối (Blockquote) trang trọng" },
  { command: "/attach", desc: "Tải lên và nhúng tệp đính kèm (Office, PDF, hình ảnh, video)" },
];

const SLASH_COMMANDS_EN = [
  { command: "/table", desc: "Insert a data table with header rows and column/row controls" },
  { command: "/callout", desc: "Highlighted callout box (Note, Tip, Warning, Caution, Info)" },
  { command: "/code", desc: "Syntax-highlighted code block with language selection" },
  { command: "/diagram", desc: "Interactive diagram (Mermaid flowchart, sequence, graph)" },
  { command: "/math", desc: "Mathematical formulas formatted with KaTeX/LaTeX" },
  { command: "/toc", desc: "Automatic Table of Contents from headings H1-H6" },
  { command: "/quote", desc: "Formatted blockquote block" },
  { command: "/attach", desc: "Upload and embed attachments (Office, PDF, image, video)" },
];

const HIDDEN_GEMS_VI = [
  {
    icon: <FileSpreadsheet className="size-4 text-emerald-500 shrink-0" />,
    title: "Chỉnh sửa Word, Excel, PowerPoint tại chỗ",
    desc: "Bấm vào tệp đính kèm trong trang để mở trình sửa trực tiếp mà không cần tải về hay cài ứng dụng bên ngoài.",
  },
  {
    icon: <Presentation className="size-4 text-amber-500 shrink-0" />,
    title: "Trình chiếu slide PowerPoint toàn màn hình",
    desc: "Mở xem trước tệp .pptx rồi nhấn biểu tượng Trình chiếu để thuyết trình slide trực tiếp trên trình duyệt.",
  },
  {
    icon: <Paperclip className="size-4 text-blue-500 shrink-0" />,
    title: "Tìm kiếm toàn văn trong tệp đính kèm",
    desc: "Tìm kiếm toàn cầu (Ctrl+K) quét cả nội dung văn bản bên trong tệp PDF, Word, Excel, PowerPoint đính kèm.",
  },
  {
    icon: <FolderTree className="size-4 text-purple-500 shrink-0" />,
    title: "Bản đồ trang (Page Graph) & Sức khỏe nội dung",
    desc: "Vào Space > Liên kết hoặc Sức khỏe để xem biểu đồ kết nối giữa các bài viết và phát hiện tài liệu cần cập nhật.",
  },
  {
    icon: <FilePenLine className="size-4 text-rose-500 shrink-0" />,
    title: "Tự động lưu bản nháp & So sánh lịch sử (Visual Diff)",
    desc: "Bản nháp được tự động lưu liên tục. Xem Lịch sử phiên bản để so sánh trực quan từng dòng thay đổi giữa các lần sửa.",
  },
];

const HIDDEN_GEMS_EN = [
  {
    icon: <FileSpreadsheet className="size-4 text-emerald-500 shrink-0" />,
    title: "In-place Word, Excel & PowerPoint Editing",
    desc: "Click attached Office documents to edit them directly without downloading or installing desktop software.",
  },
  {
    icon: <Presentation className="size-4 text-amber-500 shrink-0" />,
    title: "Fullscreen PowerPoint Slideshow",
    desc: "Preview any .pptx file and hit Present to give a seamless slideshow presentation right from WikiHub.",
  },
  {
    icon: <Paperclip className="size-4 text-blue-500 shrink-0" />,
    title: "Full-text Search in Attachments",
    desc: "Quick search (Ctrl+K) indexes and searches inside attached PDFs, Word documents, spreadsheets, and slide decks.",
  },
  {
    icon: <FolderTree className="size-4 text-purple-500 shrink-0" />,
    title: "Page Graph & Content Health",
    desc: "Open any Space to inspect the visual dependency graph of pages and identify stale, orphaned, or unverified documents.",
  },
  {
    icon: <FilePenLine className="size-4 text-rose-500 shrink-0" />,
    title: "Autosaved Drafts & Visual Revision Diff",
    desc: "Drafts are safely autosaved. Inspect revision history with a visual side-by-side diff of every single edit.",
  },
];

export function QuickShortcutsModal() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<CheatSheetTab>("shortcuts");
  const { t, locale } = useTranslation();
  const isVi = locale === "vi";

  // Listen to custom open event
  useEffect(() => {
    const handleOpen = (e: Event) => {
      const detail = (e as CustomEvent<CheatSheetOpenDetail>).detail;
      if (detail?.initialTab) {
        setActiveTab(detail.initialTab);
      }
      setOpen(true);
    };
    window.addEventListener(CHEAT_SHEET_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(CHEAT_SHEET_OPEN_EVENT, handleOpen);
  }, []);

  // Global '?' key listener (Shift + /)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      // Check if '?' was pressed (without Ctrl, Meta, Alt)
      if (
        event.key === "?" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleTrySearchSyntax = useCallback((example: string) => {
    setOpen(false);
    triggerOpenSearch({ query: example });
  }, []);

  const syntaxItems = isVi ? SEARCH_SYNTAX_VI : SEARCH_SYNTAX_EN;
  const slashItems = isVi ? SLASH_COMMANDS_VI : SLASH_COMMANDS_EN;
  const gemItems = isVi ? HIDDEN_GEMS_VI : HIDDEN_GEMS_EN;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bg-background/80 fixed inset-0 z-50 backdrop-blur-xs duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "border-border bg-surface fixed top-[12%] left-[50%] z-50 flex max-h-[80vh] w-full max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border shadow-2xl duration-150 outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
        >
          {/* Header */}
          <div className="border-border bg-surface flex items-start justify-between border-b px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Sparkles className="size-5" />
              </span>
              <div>
                <DialogPrimitive.Title className="text-foreground text-base font-semibold tracking-tight">
                  {t("cheatSheet.title")}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-muted-foreground mt-0.5 text-xs">
                  {t("cheatSheet.subtitle")}
                </DialogPrimitive.Description>
              </div>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground hover:bg-surface-hover cursor-pointer rounded-md p-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label={t("common.cancel")}
              >
                <X className="size-4" />
              </button>
            </DialogPrimitive.Close>
          </div>

          {/* Navigation Tabs */}
          <div className="border-border bg-surface-sunken/40 flex items-center gap-1 border-b px-5 py-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab("shortcuts")}
              className={cn(
                "hover:bg-surface-hover hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                activeTab === "shortcuts"
                  ? "bg-surface text-primary shadow-xs font-semibold"
                  : "text-muted-foreground",
              )}
            >
              <Keyboard className="size-3.5" />
              <span>{t("cheatSheet.tabShortcuts")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("search")}
              className={cn(
                "hover:bg-surface-hover hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                activeTab === "search"
                  ? "bg-surface text-primary shadow-xs font-semibold"
                  : "text-muted-foreground",
              )}
            >
              <Search className="size-3.5" />
              <span>{t("cheatSheet.tabSearch")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("editor")}
              className={cn(
                "hover:bg-surface-hover hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                activeTab === "editor"
                  ? "bg-surface text-primary shadow-xs font-semibold"
                  : "text-muted-foreground",
              )}
            >
              <FilePenLine className="size-3.5" />
              <span>{t("cheatSheet.tabEditor")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("features")}
              className={cn(
                "hover:bg-surface-hover hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                activeTab === "features"
                  ? "bg-surface text-primary shadow-xs font-semibold"
                  : "text-muted-foreground",
              )}
            >
              <Wand2 className="size-3.5" />
              <span>{t("cheatSheet.tabFeatures")}</span>
            </button>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto p-5 text-sm">
            {/* Tab 1: Keyboard Shortcuts */}
            {activeTab === "shortcuts" && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {SHORTCUT_ACTIONS.map((action) => (
                    <div
                      key={action.id}
                      className="border-border bg-surface hover:border-border-strong flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-xs font-medium">
                          {action.label}
                        </p>
                        <p className="text-muted-foreground line-clamp-1 text-[11px]">
                          {action.description}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {action.defaultBindings.map((binding) => (
                          <kbd
                            key={binding}
                            className="border-border bg-surface-sunken text-foreground rounded border px-2 py-0.5 font-mono text-[11px] font-semibold shadow-xs"
                          >
                            {formatBinding(binding)}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="border-border bg-surface hover:border-border-strong flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-xs font-medium">
                        {isVi ? "Bảng tra cứu nhanh" : "Quick Cheat Sheet"}
                      </p>
                      <p className="text-muted-foreground line-clamp-1 text-[11px]">
                        {isVi
                          ? "Mở bảng tra cứu phím tắt & tính năng này"
                          : "Toggle this quick guide dialog"}
                      </p>
                    </div>
                    <kbd className="border-border bg-surface-sunken text-foreground rounded border px-2 py-0.5 font-mono text-[11px] font-semibold shadow-xs">
                      ?
                    </kbd>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Search Syntax */}
            {activeTab === "search" && (
              <div className="space-y-3">
                <p className="text-muted-foreground text-xs">
                  {isVi
                    ? "Nhập các tiền tố này vào ô tìm kiếm (Ctrl+K) để lọc kết quả chính xác hoặc giao tiếp với AI:"
                    : "Enter these prefixes into the search box (Ctrl+K) to narrow results or prompt the AI:"}
                </p>
                <div className="space-y-2">
                  {syntaxItems.map((item) => (
                    <div
                      key={item.token}
                      className="border-border bg-surface hover:border-border-strong flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <code className="bg-surface-sunken text-primary rounded px-1.5 py-0.5 font-mono text-xs font-semibold">
                            {item.token}
                          </code>
                          <span className="text-muted-foreground text-[11px]">
                            {item.description}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1 text-[11px]">
                          <span className="font-medium text-foreground">
                            {isVi ? "Ví dụ:" : "Example:"}
                          </span>{" "}
                          <span className="font-mono text-xs">{item.example}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTrySearchSyntax(item.example)}
                        className="text-primary hover:bg-primary/10 hover:text-primary-hover focus-visible:ring-ring shrink-0 inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <span>{t("cheatSheet.tryCommand")}</span>
                        <CornerDownLeft className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 3: Slash Commands */}
            {activeTab === "editor" && (
              <div className="space-y-3">
                <p className="text-muted-foreground text-xs">
                  {isVi
                    ? "Trong trình soạn thảo trang, bắt đầu một dòng bằng phím / để kích hoạt menu chèn nhanh:"
                    : "When editing a page, start a line with / to trigger the block insertion menu:"}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {slashItems.map((item) => (
                    <div
                      key={item.command}
                      className="border-border bg-surface flex items-start gap-2.5 rounded-lg border p-3"
                    >
                      <code className="bg-surface-sunken text-primary shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-semibold">
                        {item.command}
                      </code>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 4: Hidden Gems */}
            {activeTab === "features" && (
              <div className="space-y-3">
                <p className="text-muted-foreground text-xs">
                  {isVi
                    ? "Những tính năng đặc biệt được thiết kế để tối ưu hóa năng suất làm việc của nhóm:"
                    : "Powerful built-in features designed to streamline your team's knowledge workflow:"}
                </p>
                <div className="space-y-2.5">
                  {gemItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="border-border bg-surface flex items-start gap-3.5 rounded-lg border p-3.5"
                    >
                      <div className="mt-0.5 shrink-0">{item.icon}</div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-foreground text-xs font-semibold">
                          {item.title}
                        </h4>
                        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-border bg-surface-sunken text-muted-foreground flex items-center justify-between border-t px-5 py-2.5 text-xs">
            <Link
              href="/help"
              onClick={() => setOpen(false)}
              className="text-primary hover:text-primary-hover hover:underline inline-flex items-center gap-1 font-medium transition-colors"
            >
              <BookOpen className="size-3.5" />
              <span>{t("cheatSheet.viewFullGuide")}</span>
              <ExternalLink className="size-3" />
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-[11px]">
                {isVi ? "Nhấn" : "Press"}{" "}
                <kbd className="border-border bg-surface rounded border px-1 font-mono">
                  ?
                </kbd>{" "}
                {isVi ? "để mở lại" : "to toggle"}
              </span>
              <kbd className="border-border bg-surface rounded border px-1 font-mono text-[11px]">
                ESC
              </kbd>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
