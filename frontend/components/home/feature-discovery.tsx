"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Bookmark,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FilePenLine,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderTree,
  GitCompare,
  HeartPulse,
  Keyboard,
  Languages,
  LayoutTemplate,
  Lightbulb,
  MessageSquare,
  Palette,
  Paperclip,
  Presentation,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Wand2,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { openChat } from "@/lib/ai-chat";
import { openCheatSheet, triggerOpenSearch } from "@/lib/cheat-sheet";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

const SLIDE_DURATION_MS = 10000;
const IMAGE_DIR = "/feature-discovery";
const HELP_IMAGE_DIR = "/help";

type PreviewKind =
  | "ai-chat"
  | "page-templates"
  | "two-factor-auth"
  | "profile-personalization";

interface FeatureSlide {
  id: string;
  /** Real capture of the app in `public/feature-discovery/<id>.png` or `public/help/<name>.png`. */
  image?: string;
  imageAlt: string;
  /** Pixel size of the capture, so the layout does not jump while it loads. */
  imageSize?: [number, number];
  /** Lightweight themed UI preview when a static capture is not bundled yet. */
  previewKind?: PreviewKind;
  icon: React.ReactNode;
  iconColor: string;
  cardBg: string;
  badge: string;
  title: string;
  /** One plain sentence: what you get. */
  desc: string;
  /** Label of the main button (opens the guide). */
  guideLabel: string;
  /** What the quick-action icon does, when there is one. */
  actionLabel: string;
  onDirectAction?: () => void;
  /** "Where to find it": the three shortest steps. */
  steps: string[];
  tip: string;
  shortcut?: string;
  helpTopic: string;
  actionLink?: string;
  actionLinkLabel?: string;
}

/**
 * What each feature is for, in one or two plain sentences with a real situation.
 * Shown above "How to use" in the guide: [English, Vietnamese].
 */
const PURPOSE: Record<string, [string, string]> = {
  search: [
    "Use it when you remember a word but not where it was written. Instead of opening spaces one by one, type the word and jump straight to the page.",
    "Dùng khi bạn nhớ một từ nhưng không nhớ nó nằm ở đâu. Thay vì mở từng space, chỉ cần gõ từ đó và nhảy thẳng tới trang.",
  ],
  "ask-ai": [
    "Use it when you need an answer, not a list of pages. For example, “how often do we release?” gets one sentence and the page it came from.",
    "Dùng khi bạn cần một câu trả lời chứ không phải danh sách trang. Ví dụ hỏi “bao lâu phát hành một lần?” sẽ nhận một câu và trang nguồn.",
  ],
  "attachment-search": [
    "Use it to find a clause, a number or a name that is buried inside a PDF or Office file, without downloading and opening each one.",
    "Dùng để tìm một điều khoản, con số hay tên nằm sâu trong tệp PDF hoặc Office mà không phải tải về mở từng tệp.",
  ],
  "office-editing": [
    "Use it to read or fix a spreadsheet, document or deck right where the team already works, instead of download, edit, upload and risk keeping two versions.",
    "Dùng để xem hoặc sửa bảng tính, tài liệu, bài thuyết trình ngay tại nơi cả nhóm đang làm việc, thay vì tải về, sửa, tải lên và dễ sinh ra hai phiên bản.",
  ],
  "pptx-slideshow": [
    "Use it to present a deck in a meeting straight from the wiki, with no PowerPoint installed on the presenting computer.",
    "Dùng để thuyết trình trong cuộc họp ngay từ wiki mà máy trình chiếu không cần cài PowerPoint.",
  ],
  "rich-editor": [
    "Use it to write structured pages quickly without hunting through toolbars: headings, tables, callouts and code are one slash away.",
    "Dùng để viết trang có cấu trúc thật nhanh mà không phải lục thanh công cụ: tiêu đề, bảng, callout, mã nguồn chỉ cách một dấu / .",
  ],
  diagrams: [
    "Use it to explain how a system or a process flows. Because the diagram is text, anyone can edit it later without redrawing a picture.",
    "Dùng để giải thích một hệ thống hay quy trình vận hành ra sao. Vì sơ đồ là văn bản nên ai cũng sửa được sau này mà không phải vẽ lại ảnh.",
  ],
  "content-health": [
    "Use it for a regular tidy-up of a space. It points at pages likely to be wrong, broken or forgotten, so readers do not trust stale information.",
    "Dùng để dọn dẹp space định kỳ. Nó chỉ ra những trang có thể đã sai, hỏng liên kết hoặc bị bỏ quên để người đọc không tin vào thông tin cũ.",
  ],
  "page-graph": [
    "Use it to understand a space you do not know yet, or to spot pages nothing links to. You see the shape of the knowledge at a glance.",
    "Dùng để hiểu nhanh một space còn xa lạ, hoặc tìm các trang chưa có liên kết nào. Bạn thấy được hình dạng của tri thức chỉ trong một cái nhìn.",
  ],
  "history-diff": [
    "Use it to find out who changed what and why, to review an edit before it matters, or to bring back an earlier version after a mistake.",
    "Dùng để biết ai đã đổi gì và vì sao, rà soát một chỉnh sửa trước khi quan trọng, hoặc khôi phục bản cũ khi lỡ sửa sai.",
  ],
  "page-summary": [
    "Use it when a page is long and you only need to know whether it is the one you want, or what it concludes.",
    "Dùng khi trang dài mà bạn chỉ cần biết đó có phải trang mình cần không, hoặc kết luận của nó là gì.",
  ],
  share: [
    "Use it to get a page to someone: a quick link for a colleague, a notification inside WikiHub, or a public link for a person outside the workspace.",
    "Dùng để đưa trang tới đúng người: liên kết nhanh cho đồng nghiệp, thông báo trong WikiHub, hoặc liên kết công khai cho người ngoài workspace.",
  ],
  watch: [
    "Use it for pages you depend on, such as a runbook or a policy, so you hear about changes without having to keep checking.",
    "Dùng cho những trang bạn phụ thuộc, như runbook hay quy định, để biết khi có thay đổi mà không phải tự vào kiểm tra liên tục.",
  ],
  export: [
    "Use it when the reader is outside the wiki: send a PDF to a customer, hand a Word file to a reviewer, or keep an HTML copy.",
    "Dùng khi người đọc ở ngoài wiki: gửi PDF cho khách hàng, đưa file Word cho người duyệt, hoặc lưu bản HTML.",
  ],
  "quick-shortcuts": [
    "Use it to work faster. One key shows the shortcuts, search filters and editor commands, so you learn them as you go.",
    "Dùng để làm việc nhanh hơn. Một phím hiện các phím tắt, bộ lọc tìm kiếm và lệnh soạn thảo để bạn học dần khi dùng.",
  ],
  "ai-chat": [
    "Use it when a question takes more than one turn. Keep separate threads per topic, queue follow-ups while it replies, and let it draft a space or page with your confirmation.",
    "Dùng khi câu hỏi cần nhiều lượt trao đổi. Giữ từng cuộc trò chuyện riêng theo chủ đề, xếp hàng câu hỏi nối tiếp và nhờ tạo space hoặc trang sau khi bạn xác nhận.",
  ],
  "ai-writing": [
    "Use it when you face a blank section or a rough paragraph. Press Ctrl+Space in the editor to draft a checklist, tighten wording, or expand notes right where your cursor is.",
    "Dùng khi đứng trước đoạn trống hoặc bản nháp còn thô. Nhấn Ctrl+Space trong trình soạn thảo để tạo checklist, trau chuốt câu chữ hoặc mở rộng ý ngay tại con trỏ.",
  ],
  "ai-selection": [
    "Use it when you hit an unfamiliar term or a paragraph in another language. Highlight it to get a plain explanation or translation without switching tabs.",
    "Dùng khi gặp thuật ngữ lạ hoặc đoạn văn bằng ngôn ngữ khác. Bôi đen để xem giải thích dễ hiểu hoặc bản dịch ngay tại chỗ mà không phải chuyển tab.",
  ],
  "ai-create-page": [
    "Use it to get a structured first draft of a runbook, proposal, or guide in seconds. Answer a few quick prompts, preview the result, and refine it before publishing.",
    "Dùng để có bản nháp có cấu trúc cho runbook, đề xuất hay hướng dẫn trong vài giây. Trả lời vài câu hỏi gợi ý, xem trước rồi chỉnh sửa trước khi xuất bản.",
  ],
  "page-templates": [
    "Use it so recurring pages—meeting notes, ADRs, runbooks, post-mortems—always follow the same clear layout, with 18 built-in templates plus your team’s own.",
    "Dùng để các trang lặp lại như biên bản họp, ADR, runbook, hậu kiểm sự cố luôn theo đúng bố cục chuẩn, với 18 mẫu sẵn có cùng mẫu riêng của nhóm.",
  ],
  "import-documents": [
    "Use it when knowledge already lives in Word, PDF, Excel, CSV, Markdown or Google Docs. Bring it into the wiki as an editable page instead of burying it as a file.",
    "Dùng khi tài liệu đã có sẵn ở Word, PDF, Excel, CSV, Markdown hay Google Docs. Đưa thẳng vào wiki thành trang chỉnh sửa được thay vì chỉ đính kèm tệp.",
  ],
  "bookmarks-and-pins": [
    "Use it to keep the pages and spaces you open every week one click away—saved for later, pinned to the sidebar, and collected under My Knowledge on Home.",
    "Dùng để giữ những trang và space bạn mở hằng tuần chỉ cách một cú bấm—lưu xem sau, ghim lên thanh bên và gom gọn trong Kiến thức của tôi trên Trang chủ.",
  ],
  "two-factor-auth": [
    "Use it to add a second layer of protection to your WikiHub account with an authenticator app and one-time recovery codes.",
    "Dùng để thêm lớp bảo vệ thứ hai cho tài khoản WikiHub bằng ứng dụng xác thực TOTP và bộ mã khôi phục dùng một lần.",
  ],
  "profile-personalization": [
    "Use it to let teammates know what you are up to with a status bubble, personalize your profile cover and welcome effect, and keep an eye on upcoming holidays.",
    "Dùng để báo đồng nghiệp bạn đang làm gì qua bong bóng trạng thái, cá nhân hóa ảnh bìa cùng hiệu ứng chào mừng và theo dõi lịch lễ hội sắp tới.",
  ],
};

/** Number of guides; the circular carousel needs it before the slides exist. */
const SLIDE_COUNT = Object.keys(PURPOSE).length;

function FeaturePreview({
  kind,
  isVi,
  compact = false,
}: {
  kind: PreviewKind;
  isVi: boolean;
  compact?: boolean;
}) {
  const pad = compact ? "p-2 text-[9px]" : "p-5 text-xs";
  if (kind === "ai-chat") {
    return (
      <div className={cn("bg-surface text-foreground flex size-full flex-col justify-between", pad)}>
        <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5">
          <span className="flex items-center gap-1.5 font-semibold">
            <Sparkles className="text-primary size-3 shrink-0" aria-hidden />
            {isVi ? "Trò chuyện với AI" : "Chat with AI"}
          </span>
          <span className="bg-primary-subtle text-primary rounded px-1.5 py-0.5 font-mono text-[8px]">
            {isVi ? "Đa luồng · Mã hóa" : "Threads · Encrypted"}
          </span>
        </div>
        <div className={cn("my-1.5 space-y-1.5", compact && "space-y-1")}>
          <div className="bg-surface-sunken border-border ml-auto max-w-[82%] rounded-lg border px-2 py-1 text-right">
            {isVi ? "Quy trình phát hành hàng tuần là gì?" : "What is our weekly release process?"}
          </div>
          <div className="bg-primary-subtle/60 border-primary/20 max-w-[90%] rounded-lg border px-2 py-1">
            <span className="font-medium">
              {isVi ? "Phát hành mỗi thứ Tư sau khi qua checklist " : "Releases ship every Wednesday after the checklist "}
            </span>
            <span className="bg-primary text-primary-foreground rounded px-1 font-mono text-[8px]">1</span>
          </div>
        </div>
        {!compact && (
          <div className="border-border bg-surface-sunken text-muted-foreground flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px]">
            <span>{isVi ? "Hỏi nối tiếp hoặc đính kèm tệp..." : "Ask a follow-up or attach a file..."}</span>
            <span className="bg-primary text-primary-foreground rounded px-1.5 py-0.5 text-[10px] font-medium">
              Enter
            </span>
          </div>
        )}
      </div>
    );
  }
  if (kind === "page-templates") {
    const items = isVi
      ? ["Biên bản họp", "Runbook vận hành", "ADR kiến trúc", "Hậu kiểm sự cố"]
      : ["Meeting Notes", "Operations Runbook", "Architecture ADR", "Incident Post-mortem"];
    return (
      <div className={cn("bg-surface text-foreground flex size-full flex-col justify-between", pad)}>
        <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5">
          <span className="flex items-center gap-1.5 font-semibold">
            <LayoutTemplate className="text-primary size-3 shrink-0" aria-hidden />
            {isVi ? "Chọn mẫu trang" : "Choose a template"}
          </span>
          <span className="bg-surface-sunken text-muted-foreground rounded px-1.5 py-0.5 text-[8px]">
            {isVi ? "Space · Toàn cục · 18 mẫu sẵn" : "Space · Global · 18 Built-in"}
          </span>
        </div>
        <div className={cn("mt-1.5 grid grid-cols-2 gap-1.5", !compact && "gap-2.5")}>
          {items.map((name, idx) => (
            <div
              key={name}
              className={cn(
                "rounded-md border px-2 py-1.5",
                idx === 0
                  ? "border-primary bg-primary-subtle/50"
                  : "border-border bg-surface-sunken/60",
              )}
            >
              <div className="truncate font-medium">{name}</div>
              {!compact && (
                <div className="bg-border/70 mt-1.5 h-1.5 w-3/4 rounded-full" />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (kind === "two-factor-auth") {
    return (
      <div className={cn("bg-surface text-foreground flex size-full flex-col justify-between", pad)}>
        <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5">
          <span className="flex items-center gap-1.5 font-semibold">
            <ShieldCheck className="text-success size-3.5 shrink-0" aria-hidden />
            {isVi ? "Xác thực hai lớp (2FA)" : "Two-Factor Authentication"}
          </span>
          <span className="bg-success-bg text-success rounded px-1.5 py-0.5 font-mono text-[8px] font-medium">
            TOTP
          </span>
        </div>
        <div className="my-1.5 flex items-center justify-center gap-1.5">
          {["4", "8", "2", "9", "1", "6"].map((digit, i) => (
            <span
              key={i}
              className={cn(
                "border-border bg-surface-sunken flex items-center justify-center rounded-md border font-mono font-semibold",
                compact ? "size-5 text-[10px]" : "size-9 text-base",
              )}
            >
              {digit}
            </span>
          ))}
        </div>
        {!compact && (
          <div className="border-border bg-surface-sunken text-muted-foreground flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px]">
            <span>{isVi ? "10 mã khôi phục dùng một lần (.txt)" : "10 one-time recovery codes (.txt)"}</span>
            <span className="text-success font-medium">{isVi ? "QR tạo tại máy" : "Local QR"}</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={cn("bg-surface text-foreground flex size-full flex-col justify-between", pad)}>
      <div className="flex items-center justify-between gap-2">
        <span className="bg-surface-sunken border-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium">
          <span>💬</span>
          {isVi ? "Đang viết tài liệu..." : "Writing docs..."}
        </span>
        <span className="bg-primary-subtle text-primary rounded px-1.5 py-0.5 font-mono text-[8px]">
          {isVi ? "15 hiệu ứng" : "15 effects"}
        </span>
      </div>
      <div className="my-1.5 flex items-center gap-2.5">
        <span
          className={cn(
            "bg-primary text-primary-foreground flex shrink-0 items-center justify-center rounded-full font-semibold",
            compact ? "size-7 text-[10px]" : "size-11 text-sm",
          )}
        >
          WH
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {isVi ? "Hồ sơ & Hiệu ứng chào mừng" : "Profile & Welcome Effects"}
          </div>
          <div className="text-muted-foreground truncate text-[10px]">
            {isVi ? "Ảnh bìa · Trạng thái · Lịch lễ hội" : "Cover · Status · Holiday calendar"}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Inline markup for guide text: `code`, **bold**, __underline__, *italic*. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
          return (
            <code
              key={i}
              className="bg-surface-sunken border-border text-primary rounded border px-1 py-px font-mono text-[11px]"
            >
              {part.slice(1, -1)}
            </code>
          );
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
          return <strong key={i} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>;
        if (part.startsWith("__") && part.endsWith("__") && part.length > 4)
          return <u key={i} className="underline-offset-2">{part.slice(2, -2)}</u>;
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
          return <em key={i}>{part.slice(1, -1)}</em>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

const size = (w: number, h: number): [number, number] => [w, h];

export function FeatureDiscovery() {
  const [currentSlide, setCurrentSlide] = useState(0);
  // The carousel runs on one continuous position. Every slide is drawn at its
  // distance from that position, wrapped round the loop, and the position eases
  // towards the target on every frame. So the last slide runs on into the
  // first, a fast scroll streams several slides past, and the slides always
  // sit edge to edge: there is never a gap to see.
  const slideEls = useRef<(HTMLDivElement | null)[]>([]);
  const posRef = useRef(0);
  const targetRef = useRef(0);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const wrapDistance = (value: number) => {
    let d = ((value % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT;
    if (d > SLIDE_COUNT / 2) d -= SLIDE_COUNT;
    return d;
  };
  const layout = useCallback((pos: number) => {
    slideEls.current.forEach((el, i) => {
      if (!el) return;
      const offset = wrapDistance(i - pos);
      el.style.transform = `translateX(${offset * 100}%)`;
      // Off-screen slides must not be reachable with Tab.
      (el as HTMLElement & { inert: boolean }).inert = Math.abs(offset) > 0.5;
    });
  }, []);
  const mod = (value: number) =>
    ((value % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT;
  // The frame callback lives in a ref so it can schedule itself.
  const frameRef = useRef<(ts: number) => void>(() => undefined);
  useEffect(() => {
    frameRef.current = (ts: number) => {
      const dt = Math.min(ts - (lastFrameRef.current || ts), 50);
      lastFrameRef.current = ts;
      const diff = targetRef.current - posRef.current;
      if (Math.abs(diff) < 0.002) {
        posRef.current = targetRef.current;
        layout(posRef.current);
        rafRef.current = 0;
        lastFrameRef.current = 0;
        return;
      }
      posRef.current += diff * (1 - Math.exp(-dt / 120));
      layout(posRef.current);
      rafRef.current = requestAnimationFrame((t) => frameRef.current(t));
    };
  }, [layout]);
  const moveTo = useCallback(
    (next: (prev: number) => number) => {
      const from = mod(targetRef.current);
      const delta = wrapDistance(next(from) - from);
      if (delta === 0) return;
      targetRef.current += delta;
      setCurrentSlide(mod(targetRef.current));
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        posRef.current = targetRef.current;
        layout(posRef.current);
      } else if (!rafRef.current) {
        rafRef.current = requestAnimationFrame((t) => frameRef.current(t));
      }
    },
    [layout],
  );
  useEffect(() => {
    posRef.current = targetRef.current;
    layout(posRef.current);
    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      lastFrameRef.current = 0;
    };
  }, [layout]);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<FeatureSlide | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const { t, locale } = useTranslation();
  const isVi = locale === "vi";

  const slides: FeatureSlide[] = useMemo(() => {
    const L = (en: string, vi: string) => (isVi ? vi : en);
    const learn = L("See how it works", "Xem cách dùng");
    const img = (id: string) => `${IMAGE_DIR}/${id}.png`;
    const helpImg = (name: string) => `${HELP_IMAGE_DIR}/${name}.png`;
    return [
      {
        id: "search",
        image: img("search"),
        imageSize: size(600, 570),
        imageAlt: L(
          "Search box with a space filter and matching pages with highlighted words",
          "Hộp tìm kiếm có bộ lọc space và các trang khớp với từ khóa được tô sáng",
        ),
        icon: <Search className="size-3.5" />,
        iconColor: "bg-primary/20 text-primary",
        cardBg: "bg-blue-600 dark:bg-blue-700 border-blue-700 dark:border-blue-600",
        badge: "Ctrl+K",
        title: L("Find anything, fast", "Tìm mọi thứ thật nhanh"),
        desc: L(
          "Search page text and file contents from anywhere. Narrow it with space:KEY, author:, label:, type:pdf.",
          "Tìm trong nội dung trang và tệp đính kèm từ bất kỳ đâu. Thu hẹp bằng space:KEY, author:, label:, type:pdf.",
        ),
        guideLabel: learn,
        actionLabel: L("Try Search (Ctrl+K)", "Thử tìm kiếm (Ctrl+K)"),
        onDirectAction: () => triggerOpenSearch(),
        steps: [
          L("Press `Ctrl + K` on any page.", "Nhấn `Ctrl + K` ở bất kỳ trang nào."),
          L(
            "Type your words. Add `space:KEY` to search one space only.",
            "Gõ từ khóa. Thêm `space:KEY` để chỉ tìm trong một space.",
          ),
          L("Use `↑ ↓` to pick a result and `Enter` to open it.", "Dùng `↑ ↓` chọn kết quả, `Enter` để mở."),
        ],
        tip: L(
          "Matching words are highlighted, so you can see why a page came up before opening it.",
          "Từ khớp được tô sáng, nên bạn biết vì sao trang xuất hiện trước khi mở.",
        ),
        shortcut: "Ctrl + K",
        helpTopic: "getting-started",
      },
      {
        id: "ask-ai",
        image: img("ask-ai"),
        imageSize: size(768, 425),
        imageAlt: L(
          "An AI answer in the search box with the page it was taken from",
          "Câu trả lời AI trong hộp tìm kiếm kèm trang được dùng làm nguồn",
        ),
        icon: <Sparkles className="size-3.5" />,
        iconColor: "bg-violet-500/20 text-violet-600 dark:text-violet-400",
        cardBg: "bg-violet-600 dark:bg-violet-700 border-violet-700 dark:border-violet-600",
        badge: "AI",
        title: L("Ask your wiki a question", "Hỏi wiki như hỏi một người"),
        desc: L(
          "Get a short answer from your own pages, with the source page listed so you can check it.",
          "Nhận câu trả lời ngắn từ chính tài liệu của bạn, kèm trang nguồn để bạn kiểm tra.",
        ),
        guideLabel: learn,
        actionLabel: L("Open search to ask", "Mở tìm kiếm để hỏi"),
        onDirectAction: () => triggerOpenSearch(),
        steps: [
          L("Press `Ctrl + K` to open search, then type your question.", "Nhấn `Ctrl + K` để mở tìm kiếm, rồi gõ câu hỏi."),
          L("With the cursor still in the search box, press `Ctrl + Enter`.", "Khi con trỏ còn trong hộp tìm kiếm, nhấn `Ctrl + Enter`."),
          L("Click the numbered source to open the page.", "Bấm số nguồn để mở trang gốc."),
        ],
        tip: L(
          "If the pages do not contain an answer, WikiHub says so instead of guessing.",
          "Nếu tài liệu không có câu trả lời, WikiHub nói rõ thay vì đoán.",
        ),
        shortcut: L("Ctrl + Enter in the search box", "Ctrl + Enter trong hộp tìm kiếm"),
        helpTopic: "ask-ai-from-search",
      },
      {
        id: "attachment-search",
        image: img("attachment-search"),
        imageSize: size(576, 440),
        imageAlt: L(
          "A search result showing a phrase found inside an attached PDF",
          "Kết quả tìm kiếm hiển thị một cụm từ nằm bên trong tệp PDF đính kèm",
        ),
        icon: <Paperclip className="size-3.5" />,
        iconColor: "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400",
        cardBg: "bg-cyan-700 dark:bg-cyan-800 border-cyan-800 dark:border-cyan-700",
        badge: "PDF · Office",
        title: L("Search inside attached files", "Tìm bên trong tệp đính kèm"),
        desc: L(
          "Words inside PDF, Word, Excel and PowerPoint files are searchable. The result names the file.",
          "Chữ bên trong PDF, Word, Excel, PowerPoint cũng tìm được. Kết quả cho biết tên tệp.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("**Attach** a file to a page.", "Đính kèm tệp vào một trang."),
          L("Press `Ctrl + K` and type a phrase from the file.", "Nhấn `Ctrl + K` và gõ một cụm từ trong tệp."),
          L("Open the result marked “In the attached file”.", "Mở kết quả có dòng “Trong tệp đính kèm”."),
        ],
        tip: L(
          "Add `type:pdf` or `type:docx` to look only in files of that kind. A scanned PDF has no text to search.",
          "Thêm `type:pdf` hoặc `type:docx` để chỉ tìm trong loại tệp đó. PDF dạng ảnh quét không có chữ để tìm.",
        ),
        shortcut: "type:pdf",
        helpTopic: "ask-about-attachments",
      },
      {
        id: "office-editing",
        image: img("office-editing"),
        imageSize: size(768, 480),
        imageAlt: L(
          "An Excel workbook previewed in the page with Download and Edit buttons",
          "Bảng tính Excel được xem trước ngay trong trang, có nút Tải xuống và Chỉnh sửa",
        ),
        icon: <FileSpreadsheet className="size-3.5" />,
        iconColor: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
        cardBg: "bg-emerald-700 dark:bg-emerald-800 border-emerald-800 dark:border-emerald-700",
        badge: "Word · Excel",
        title: L("Open and edit Office files in the page", "Mở và sửa tệp Office ngay trong trang"),
        desc: L(
          "Preview Word, Excel and PowerPoint without downloading. Press Edit to change them in the browser.",
          "Xem trước Word, Excel, PowerPoint mà không cần tải về. Bấm Chỉnh sửa để sửa ngay trên trình duyệt.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("Click the attached file on the page.", "Bấm vào tệp đính kèm trong trang."),
          L("Read it in the preview, or press **Edit**.", "Xem trong cửa sổ xem trước, hoặc bấm **Chỉnh sửa**."),
          L("Close the editor; your changes are saved.", "Đóng trình soạn thảo; thay đổi được lưu."),
        ],
        tip: L(
          "In-browser editing needs the document editor service to be set up by an administrator.",
          "**Chỉnh sửa** trên trình duyệt cần quản trị viên đã cấu hình dịch vụ soạn thảo tài liệu.",
        ),
        helpTopic: "office-editing",
      },
      {
        id: "pptx-slideshow",
        image: img("pptx-slideshow"),
        imageSize: size(1280, 800),
        imageAlt: L(
          "A PowerPoint slide shown full screen with previous and next arrows",
          "Một slide PowerPoint hiển thị toàn màn hình với nút chuyển slide",
        ),
        icon: <Presentation className="size-3.5" />,
        iconColor: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
        cardBg: "bg-amber-700 dark:bg-amber-800 border-amber-800 dark:border-amber-700",
        badge: "Slideshow",
        title: L("Present a PowerPoint from the wiki", "Trình chiếu PowerPoint ngay từ wiki"),
        desc: L(
          "Play a .pptx full screen in the browser and move through it with the arrow keys.",
          "Chiếu tệp .pptx toàn màn hình trên trình duyệt và chuyển slide bằng phím mũi tên.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("Click a `.pptx` file on the page.", "Bấm vào tệp `.pptx` trong trang."),
          L("Press the presentation button in the preview toolbar.", "Bấm nút trình chiếu trên thanh công cụ xem trước."),
          L("Use `← →` to change slides, `Esc` to leave.", "Dùng `← →` để chuyển slide, `Esc` để thoát."),
        ],
        tip: L(
          "The slide counter in the corner shows where you are in the deck.",
          "Bộ đếm ở góc cho biết bạn đang ở slide nào.",
        ),
        shortcut: "← / → / Esc",
        helpTopic: "pptx-slideshow",
      },
      {
        id: "rich-editor",
        image: img("rich-editor"),
        imageSize: size(960, 685),
        imageAlt: L(
          "The page editor with the slash menu listing blocks to insert",
          "Trình soạn thảo trang với menu dấu / liệt kê các khối có thể chèn",
        ),
        icon: <FilePenLine className="size-3.5" />,
        iconColor: "bg-sky-500/20 text-sky-600 dark:text-sky-400",
        cardBg: "bg-sky-600 dark:bg-sky-700 border-sky-700 dark:border-sky-600",
        badge: "/ slash",
        title: L("Write faster with the / menu", "Soạn nhanh với menu dấu /"),
        desc: L(
          "Type / on an empty line to add headings, tables, callouts, code, diagrams and more.",
          "Gõ / ở dòng trống để chèn tiêu đề, bảng, callout, mã nguồn, sơ đồ và nhiều hơn nữa.",
        ),
        guideLabel: learn,
        actionLabel: L("View / commands", "Xem bảng lệnh /"),
        onDirectAction: () => openCheatSheet({ initialTab: "editor" }),
        steps: [
          L("Open a page and choose **Edit**.", "Mở trang và chọn **Chỉnh sửa**."),
          L("On an empty line type `/`, then a few letters.", "Ở dòng trống gõ `/`, rồi vài chữ cái."),
          L("Press `Enter` to insert the block.", "Nhấn `Enter` để chèn khối."),
        ],
        tip: L(
          "Your draft is saved as you type (**Auto-save**), so closing the tab does not lose it.",
          "Bản nháp được lưu khi bạn gõ (**Auto-save**), nên đóng tab cũng không mất.",
        ),
        shortcut: L("Type / on a new line", "Gõ / ở dòng mới"),
        helpTopic: "slash-commands",
      },
      {
        id: "diagrams",
        image: img("diagrams"),
        imageSize: size(960, 504),
        imageAlt: L(
          "A flowchart of a system drawn inside a wiki page",
          "Sơ đồ luồng của một hệ thống được vẽ ngay trong trang wiki",
        ),
        icon: <Workflow className="size-3.5" />,
        iconColor: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
        cardBg: "bg-purple-600 dark:bg-purple-700 border-purple-700 dark:border-purple-600",
        badge: "Mermaid",
        title: L("Draw diagrams from text", "Vẽ sơ đồ từ vài dòng chữ"),
        desc: L(
          "Write a few lines of Mermaid and get a flowchart or sequence diagram that stays sharp at any size.",
          "Viết vài dòng Mermaid để có lưu đồ hoặc sơ đồ tuần tự luôn sắc nét ở mọi kích thước.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("While editing, type `/diagram`.", "Khi đang soạn, gõ `/diagram`."),
          L("Pick a template or paste your Mermaid code.", "Chọn mẫu hoặc dán mã Mermaid của bạn."),
          L("Save the page; the diagram is drawn for readers.", "Lưu trang; sơ đồ được vẽ cho người đọc."),
        ],
        tip: L(
          "The diagram is stored as text, so it is searchable and shows up in page history.",
          "Sơ đồ lưu dưới dạng văn bản, nên tìm kiếm được và xuất hiện trong lịch sử phiên bản.",
        ),
        helpTopic: "diagrams",
      },
      {
        id: "content-health",
        image: img("content-health"),
        imageSize: size(1024, 654),
        imageAlt: L(
          "The Content health panel listing out-of-date pages, broken links, orphans and duplicates",
          "Bảng Sức khỏe nội dung liệt kê trang lỗi thời, liên kết hỏng, trang mồ côi và trùng lặp",
        ),
        icon: <HeartPulse className="size-3.5" />,
        iconColor: "bg-rose-500/20 text-rose-600 dark:text-rose-400",
        cardBg: "bg-rose-600 dark:bg-rose-700 border-rose-700 dark:border-rose-600",
        badge: "Health",
        title: L("Keep a space clean with Content health", "Giữ space gọn gàng với Sức khỏe nội dung"),
        desc: L(
          "See pages that are out of date, links that lead nowhere, pages nothing links to, and duplicates.",
          "Thấy ngay trang đã cũ, liên kết dẫn tới trang không tồn tại, trang không ai liên kết tới và trang trùng lặp.",
        ),
        guideLabel: learn,
        actionLabel: L("Browse spaces", "Khám phá các Space"),
        actionLink: "/spaces",
        actionLinkLabel: L("Browse spaces", "Khám phá các Space"),
        steps: [
          L("Open a space you may manage.", "Mở một space bạn có quyền quản lý."),
          L("Click **Health** at the bottom of its sidebar.", "Bấm **Sức khỏe** ở cuối thanh bên của space."),
          L(
            "Open a list, then fix the page or mark it **Still correct**.",
            "Mở một danh sách, rồi sửa trang hoặc đánh dấu **Vẫn đúng**.",
          ),
        ],
        tip: L(
          "*“Out of date”* means a page was not edited for months while the pages tied to it were. It is a prompt to re-check, not a verdict.",
          "*“Lỗi thời”* nghĩa là trang lâu không sửa trong khi các trang liên quan đã được sửa. Đó là gợi ý để kiểm tra lại, không phải kết luận.",
        ),
        helpTopic: "content-health",
      },
      {
        id: "page-graph",
        image: img("page-graph"),
        imageSize: size(1152, 720),
        imageAlt: L(
          "The Page map: pages drawn as dots joined by lines for links, mentions and the page tree",
          "Bản đồ trang: các trang là những chấm nối với nhau bằng đường cho liên kết, nhắc tên và cây trang",
        ),
        icon: <FolderTree className="size-3.5" />,
        iconColor: "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400",
        cardBg: "bg-indigo-600 dark:bg-indigo-700 border-indigo-700 dark:border-indigo-600",
        badge: "Page map",
        title: L("See how your pages connect", "Nhìn thấy các trang liên kết thế nào"),
        desc: L(
          "A map of a space: each page is a dot, each link, mention or similarity a line. Lonely pages stand out.",
          "Bản đồ của một space: mỗi trang là một chấm, mỗi liên kết, lần nhắc tên hay độ tương đồng là một đường. Trang lẻ loi nổi bật ngay.",
        ),
        guideLabel: learn,
        actionLabel: L("Browse spaces", "Khám phá các Space"),
        actionLink: "/spaces",
        actionLinkLabel: L("Browse spaces", "Khám phá các Space"),
        steps: [
          L("Open any space.", "Mở một space bất kỳ."),
          L("Click **Page map** at the bottom of the sidebar.", "Bấm **Bản đồ trang** ở cuối thanh bên."),
          L(
            "Click a dot to see what it is tied to; use the search box to find a page.",
            "Bấm một chấm để xem nó liên quan tới gì; dùng ô tìm để tìm trang.",
          ),
        ],
        tip: L(
          "The side panel lists *“Pages tied to nothing”*: good candidates to link from a related page.",
          "Bảng bên liệt kê *“Trang chưa liên kết với trang nào”*: nên thêm liên kết từ một trang liên quan.",
        ),
        helpTopic: "related-pages",
      },
      {
        id: "history-diff",
        image: img("history-diff"),
        imageSize: size(1248, 720),
        imageAlt: L(
          "Page history comparing two versions side by side with an AI summary of the change",
          "Lịch sử trang so sánh hai phiên bản cạnh nhau cùng bản tóm tắt thay đổi bằng AI",
        ),
        icon: <GitCompare className="size-3.5" />,
        iconColor: "bg-teal-500/20 text-teal-600 dark:text-teal-400",
        cardBg: "bg-teal-700 dark:bg-teal-800 border-teal-800 dark:border-teal-700",
        badge: "History",
        title: L("See exactly what changed", "Xem chính xác điều gì đã thay đổi"),
        desc: L(
          "Compare two versions of a page side by side, read an AI summary of the change, and go back if needed.",
          "So sánh hai phiên bản của trang cạnh nhau, đọc tóm tắt thay đổi bằng AI và quay lại bản cũ khi cần.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("On a page, open the ⋯ menu.", "Ở trang, mở menu ⋯."),
          L("Choose **Page history**.", "Chọn **Lịch sử trang**."),
          L(
            "Pick a version; press **AI Summary** for a short explanation.",
            "Chọn một phiên bản; bấm **Tóm tắt AI** để có lời giải thích ngắn.",
          ),
        ],
        tip: L(
          "Each version shows who saved it and the note they left, so you can find the change you want quickly.",
          "Mỗi phiên bản cho biết ai đã lưu và ghi chú họ để lại, giúp bạn nhanh chóng tìm đúng thay đổi.",
        ),
        helpTopic: "history-and-export",
      },
      {
        id: "page-summary",
        image: img("page-summary"),
        imageSize: size(672, 404),
        imageAlt: L(
          "The TL;DR dialog with a short bulleted summary of a page",
          "Hộp thoại TL;DR với bản tóm tắt ngắn dạng gạch đầu dòng của một trang",
        ),
        icon: <FileText className="size-3.5" />,
        iconColor: "bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-400",
        cardBg: "bg-fuchsia-600 dark:bg-fuchsia-700 border-fuchsia-700 dark:border-fuchsia-600",
        badge: "TL;DR",
        title: L("Get the gist of a long page", "Nắm ý chính của trang dài"),
        desc: L(
          "One click gives a short summary of the page, in the page's language, English or Vietnamese.",
          "Một cú bấm cho bản tóm tắt ngắn của trang, theo ngôn ngữ của trang, tiếng Anh hoặc tiếng Việt.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("Open a page and click the ⋯ menu.", "Mở trang và bấm menu ⋯."),
          L("Choose **TL;DR**.", "Chọn **TL;DR**."),
          L("Switch the language, or press **Summarize again**.", "Đổi ngôn ngữ, hoặc bấm **Tóm tắt lại**."),
        ],
        tip: L(
          "A summary only covers what the page says, so check the page for details that matter.",
          "Bản tóm tắt chỉ dựa trên nội dung trang, hãy đọc lại trang với những chi tiết quan trọng.",
        ),
        helpTopic: "page-actions-menu",
      },
      {
        id: "share",
        image: img("share"),
        imageSize: size(960, 364),
        imageAlt: L(
          "The Share menu with Copy page link, Share internally and Share publicly",
          "Menu Chia sẻ với Sao chép liên kết, Chia sẻ nội bộ và Chia sẻ công khai",
        ),
        icon: <Share2 className="size-3.5" />,
        iconColor: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
        cardBg: "bg-orange-700 dark:bg-orange-800 border-orange-800 dark:border-orange-700",
        badge: "Share",
        title: L("Share a page the right way", "Chia sẻ trang đúng cách"),
        desc: L(
          "Copy the link, send the page to colleagues inside WikiHub, or share it publicly by link.",
          "Sao chép liên kết, gửi trang cho đồng nghiệp trong WikiHub, hoặc chia sẻ công khai bằng liên kết.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("Open the page and click **Share**.", "Mở trang và bấm **Chia sẻ**."),
          L(
            "Choose **Share internally…** or **Share publicly…**.",
            "Chọn **Chia sẻ nội bộ…** hoặc **Chia sẻ công khai…**.",
          ),
          L("Copy the link and send it.", "Sao chép liên kết và gửi đi."),
        ],
        tip: L(
          "Who can use a public link depends on the options you pick in its dialog and on your administrator’s settings.",
          "Ai dùng được liên kết công khai phụ thuộc vào tùy chọn trong hộp thoại và cài đặt của quản trị viên.",
        ),
        helpTopic: "public-sharing",
      },
      {
        id: "watch",
        image: img("watch"),
        imageSize: size(960, 364),
        imageAlt: L(
          "The Watch menu: watch this page, a page and its children, or the entire space",
          "Menu Theo dõi: theo dõi trang này, trang và các trang con, hoặc cả space",
        ),
        icon: <Eye className="size-3.5" />,
        iconColor: "bg-lime-500/20 text-lime-700 dark:text-lime-400",
        cardBg: "bg-lime-700 dark:bg-lime-800 border-lime-800 dark:border-lime-700",
        badge: "Watch",
        title: L("Get told when a page changes", "Được báo khi trang thay đổi"),
        desc: L(
          "Watch a page, a page with its children, or a whole space and get a notification on updates.",
          "Theo dõi một trang, trang kèm các trang con, hoặc cả space và nhận thông báo khi có cập nhật.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("Open the page and click **Watch**.", "Mở trang và bấm **Theo dõi**."),
          L("Pick page, page and children, or entire space.", "Chọn trang, trang và các trang con, hoặc cả space."),
          L("Updates arrive under the bell icon.", "Cập nhật xuất hiện ở biểu tượng chuông."),
        ],
        tip: L(
          "Choose “page and children” for a handbook section so new sub-pages are covered too.",
          "Chọn “trang và các trang con” cho một mục cẩm nang để các trang con mới cũng được theo dõi.",
        ),
        helpTopic: "watch-and-presence",
      },
      {
        id: "export",
        image: img("export"),
        imageSize: size(960, 544),
        imageAlt: L(
          "The page menu with Export HTML, Export PDF and Export Word",
          "Menu trang với Xuất HTML, Xuất PDF và Xuất Word",
        ),
        icon: <Download className="size-3.5" />,
        iconColor: "bg-slate-500/20 text-slate-600 dark:text-slate-300",
        cardBg: "bg-slate-700 dark:bg-slate-800 border-slate-800 dark:border-slate-600",
        badge: "PDF · Word",
        title: L("Take a page with you", "Mang trang đi nơi khác"),
        desc: L(
          "Export any page as PDF, Word or HTML to send to someone outside the wiki.",
          "Xuất trang thành PDF, Word hoặc HTML để gửi cho người ngoài wiki.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("Open the page and click the ⋯ menu.", "Mở trang và bấm menu ⋯."),
          L("Choose **Export**.", "Chọn **Xuất**."),
          L("Pick **PDF, Word or HTML**.", "Chọn **PDF, Word hoặc HTML**."),
        ],
        tip: L(
          "The Word export uses a real table of contents, so it updates in Word.",
          "Bản Word dùng mục lục thật của Word nên có thể cập nhật trong Word.",
        ),
        helpTopic: "history-and-export",
      },
      {
        id: "quick-shortcuts",
        image: img("quick-shortcuts"),
        imageSize: size(670, 532),
        imageAlt: L(
          "The Quick Guide listing keyboard shortcuts",
          "Bảng Hướng dẫn nhanh liệt kê các phím tắt",
        ),
        icon: <Keyboard className="size-3.5" />,
        iconColor: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
        cardBg: "bg-amber-700 dark:bg-amber-800 border-amber-800 dark:border-amber-700",
        badge: "?",
        title: L("Forgot a shortcut? Press ?", "Quên phím tắt? Nhấn ?"),
        desc: L(
          "One key opens a cheat sheet of shortcuts, search filters and editor commands.",
          "Một phím mở bảng tra cứu phím tắt, bộ lọc tìm kiếm và lệnh soạn thảo.",
        ),
        guideLabel: learn,
        actionLabel: L("Open Cheat Sheet (?)", "Mở bảng tra cứu (?)"),
        onDirectAction: () => openCheatSheet({ initialTab: "shortcuts" }),
        steps: [
          L("Press `?` when you are not typing in a field.", "Nhấn `?` khi không đang gõ trong ô nhập."),
          L(
            "Switch tabs: Shortcuts, Search syntax, Editor commands, Highlights.",
            "Chuyển thẻ: Phím tắt, Cú pháp tìm kiếm, Lệnh soạn thảo, Tính năng nổi bật.",
          ),
          L("Press `Esc` to close.", "Nhấn `Esc` để đóng."),
        ],
        tip: L(
          "You can change shortcut keys to suit you in your account settings.",
          "Bạn có thể đổi phím tắt theo thói quen trong cài đặt tài khoản.",
        ),
        shortcut: "?",
        helpTopic: "keyboard-shortcuts",
      },
      {
        id: "ai-chat",
        previewKind: "ai-chat",
        imageAlt: L(
          "The AI chat panel with threaded conversations, wiki citations and follow-up queue",
          "Khung trò chuyện AI với nhiều luồng hội thoại, trích dẫn wiki và hàng đợi câu hỏi nối tiếp",
        ),
        icon: <MessageSquare className="size-3.5" />,
        iconColor: "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400",
        cardBg: "bg-indigo-600 dark:bg-indigo-700 border-indigo-700 dark:border-indigo-600",
        badge: "AI Chat",
        title: L("Chat with the AI assistant", "Trò chuyện với trợ lý AI"),
        desc: L(
          "Ask follow-ups across separate encrypted threads, attach files, search the web and let AI draft spaces or pages.",
          "Hỏi nối tiếp qua nhiều luồng hội thoại mã hóa, đính kèm tệp, tra cứu web và nhờ AI tạo space hoặc trang.",
        ),
        guideLabel: learn,
        actionLabel: L("Open AI Chat", "Mở Trò chuyện AI"),
        onDirectAction: () => openChat(),
        steps: [
          L("Click the sparkle **Chat with AI** icon in the top bar.", "Bấm biểu tượng **Trò chuyện với AI** trên thanh đầu trang."),
          L(
            "Ask a question or attach files; queue follow-ups while it replies.",
            "Đặt câu hỏi hoặc đính kèm tệp; có thể xếp hàng câu hỏi nối tiếp khi AI đang trả lời.",
          ),
          L(
            "Start a **New chat** (`Ctrl+Shift+O`) per topic, or pin important threads.",
            "Mở **Cuộc trò chuyện mới** (`Ctrl+Shift+O`) cho từng chủ đề, hoặc ghim luồng quan trọng.",
          ),
        ],
        tip: L(
          "You can ask it to create a space or draft a page — it always shows a plan and waits for **Confirm and run**.",
          "Bạn có thể nhờ AI tạo space hoặc soạn trang — nó luôn hiện kế hoạch và chờ bạn bấm **Xác nhận và chạy**.",
        ),
        shortcut: "Ctrl + Shift + O",
        helpTopic: "chat-with-ai",
      },
      {
        id: "ai-writing",
        image: helpImg("ai-writing-result"),
        imageSize: size(1482, 761),
        imageAlt: L(
          "The in-editor AI writing assistant generating a structured checklist ready to insert",
          "Trợ lý viết AI trong trình soạn thảo tạo danh sách kiểm tra sẵn sàng chèn vào trang",
        ),
        icon: <Wand2 className="size-3.5" />,
        iconColor: "bg-violet-500/20 text-violet-600 dark:text-violet-400",
        cardBg: "bg-violet-600 dark:bg-violet-700 border-violet-700 dark:border-violet-600",
        badge: "Ctrl+Space",
        title: L("Write and polish with AI", "Soạn thảo và trau chuốt cùng AI"),
        desc: L(
          "Press Ctrl+Space inside the editor to draft checklists, rewrite paragraphs, expand notes or translate text.",
          "Nhấn Ctrl+Space trong trình soạn thảo để tạo checklist, viết lại đoạn văn, mở rộng ý hoặc dịch nội dung.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("Open a page in **Edit** mode and place the cursor where you want text.", "Mở trang ở chế độ **Chỉnh sửa** và đặt con trỏ tại vị trí cần viết."),
          L("Press `Ctrl + Space` and describe what to write or improve.", "Nhấn `Ctrl + Space` và mô tả nội dung cần viết hoặc cải thiện."),
          L("Review the draft and click **Insert below** or **Edit**.", "Xem bản nháp rồi bấm **Chèn bên dưới** hoặc **Chỉnh sửa**."),
        ],
        tip: L(
          "Works on existing text too: select a paragraph first to shorten, clarify, or change its tone.",
          "Dùng được cả với đoạn đã viết: bôi đen đoạn văn trước để rút gọn, làm rõ ý hoặc đổi giọng văn.",
        ),
        shortcut: "Ctrl + Space",
        helpTopic: "admin-ai",
      },
      {
        id: "ai-selection",
        image: helpImg("ai-selection-explain"),
        imageSize: size(1557, 519),
        imageAlt: L(
          "Highlighting a term on a page to open the instant AI Explain and Translate popover",
          "Bôi đen thuật ngữ trên trang để mở khung Giải thích và Dịch nhanh bằng AI",
        ),
        icon: <Languages className="size-3.5" />,
        iconColor: "bg-sky-500/20 text-sky-600 dark:text-sky-400",
        cardBg: "bg-sky-700 dark:bg-sky-800 border-sky-800 dark:border-sky-700",
        badge: "Explain · VI/EN",
        title: L("Explain or translate any text", "Giải thích hoặc dịch nhanh đoạn chữ"),
        desc: L(
          "Highlight a term or sentence on any page or in AI chat to explain or translate it on the spot.",
          "Bôi đen thuật ngữ hay câu bất kỳ trên trang hoặc trong khung chat AI để giải thích hoặc dịch ngay tại chỗ.",
        ),
        guideLabel: learn,
        actionLabel: learn,
        steps: [
          L("Select any word, phrase, or sentence while reading a page.", "Bôi đen từ, cụm từ hoặc câu bất kỳ khi đang đọc trang."),
          L("Click the small AI sparkle button that appears next to the selection.", "Bấm nút AI nhỏ xuất hiện ngay bên cạnh vùng chọn."),
          L("Switch between **Explain** and **Translate**, or change the target language.", "Chuyển giữa **Giải thích** và **Dịch**, hoặc đổi ngôn ngữ đích."),
        ],
        tip: L(
          "Nothing is sent until you click Explain or Translate, and the explanation uses the surrounding page as context.",
          "Không có gì được gửi cho tới khi bạn bấm Giải thích hoặc Dịch, và AI dùng chính ngữ cảnh của trang để giải thích.",
        ),
        helpTopic: "admin-ai",
      },
      {
        id: "ai-create-page",
        image: helpImg("ai-create-draft"),
        imageSize: size(1344, 951),
        imageAlt: L(
          "The Create page dialog in Write with AI mode showing a prompt and live preview",
          "Hộp thoại Tạo trang ở chế độ Viết cùng AI hiển thị mô tả và bản xem trước trực tiếp",
        ),
        icon: <FilePlus2 className="size-3.5" />,
        iconColor: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
        cardBg: "bg-blue-700 dark:bg-blue-800 border-blue-800 dark:border-blue-700",
        badge: "AI Draft",
        title: L("Draft a new page with AI", "Tạo bản nháp trang mới với AI"),
        desc: L(
          "Describe the guide, runbook or brief you need, preview the generated page and create it in one click.",
          "Mô tả hướng dẫn, runbook hay tóm tắt dự án bạn cần, xem trước trang được tạo và lưu chỉ với một cú bấm.",
        ),
        guideLabel: learn,
        actionLabel: L("Browse spaces", "Khám phá các Space"),
        actionLink: "/spaces",
        actionLinkLabel: L("Browse spaces", "Khám phá các Space"),
        steps: [
          L("Open a space and click **Create** to start a new page.", "Mở một space và bấm **Tạo trang**."),
          L("Switch to the **Write with AI** tab and describe the page you want.", "Chuyển sang thẻ **Viết cùng AI** và mô tả trang bạn muốn tạo."),
          L("Answer any quick questions, inspect the preview, then click **Create page**.", "Trả lời vài câu gợi ý, xem bản xem trước rồi bấm **Tạo trang**."),
        ],
        tip: L(
          "Use the quick starter chips (*Runbook*, *Meeting notes*, *How-to guide*, *Project brief*) for an instant prompt.",
          "Dùng các nút gợi ý nhanh (*Runbook*, *Meeting notes*, *How-to guide*, *Project brief*) để bắt đầu ngay.",
        ),
        helpTopic: "admin-ai",
      },
      {
        id: "page-templates",
        previewKind: "page-templates",
        imageAlt: L(
          "Template picker showing built-in, global and space templates such as Meeting Notes and Runbook",
          "Bộ chọn mẫu trang hiển thị các mẫu sẵn có, toàn cục và của space như Biên bản họp và Runbook",
        ),
        icon: <LayoutTemplate className="size-3.5" />,
        iconColor: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
        cardBg: "bg-emerald-700 dark:bg-emerald-800 border-emerald-800 dark:border-emerald-700",
        badge: "18+ Templates",
        title: L("Start faster with Page Templates", "Tạo trang nhanh hơn với Mẫu trang"),
        desc: L(
          "Pick from 18 built-in templates (Meeting Notes, Runbook, ADR, RFC...) or save any page as a reusable template.",
          "Chọn từ 18 mẫu sẵn có (Biên bản họp, Runbook, ADR, RFC...) hoặc lưu bất kỳ trang nào thành mẫu dùng lại.",
        ),
        guideLabel: learn,
        actionLabel: L("Browse spaces", "Khám phá các Space"),
        actionLink: "/spaces",
        actionLinkLabel: L("Browse spaces", "Khám phá các Space"),
        steps: [
          L("Click **Create page** inside any space.", "Bấm **Tạo trang** trong bất kỳ space nào."),
          L("Filter by **Space**, **Global**, or **Built-in** and preview the layout.", "Lọc theo **Space**, **Toàn cục**, hoặc **Có sẵn** và xem trước bố cục."),
          L("To reuse a page you already wrote, open ⋯ and choose **Save as template**.", "Để dùng lại một trang đã viết, mở menu ⋯ và chọn **Lưu làm mẫu**."),
        ],
        tip: L(
          "Space Owners and Admins can manage custom space templates from **Templates** at the bottom of the space sidebar.",
          "Chủ space và Quản trị viên có thể quản lý mẫu riêng tại mục **Mẫu trang** ở cuối thanh bên của space.",
        ),
        helpTopic: "page-templates",
      },
      {
        id: "import-documents",
        image: helpImg("import-dialog"),
        imageSize: size(2100, 1350),
        imageAlt: L(
          "The Import pages from files dialog supporting Word, PDF, HTML, Markdown and AI review or translation",
          "Hộp thoại Nhập trang từ tệp hỗ trợ Word, PDF, HTML, Markdown cùng tùy chọn rà soát và dịch bằng AI",
        ),
        icon: <FileUp className="size-3.5" />,
        iconColor: "bg-teal-500/20 text-teal-600 dark:text-teal-400",
        cardBg: "bg-teal-700 dark:bg-teal-800 border-teal-800 dark:border-teal-700",
        badge: "DOCX · XLSX · PDF",
        title: L("Import documents as wiki pages", "Nhập tài liệu thành trang wiki"),
        desc: L(
          "Drop Word, PDF, Excel, CSV, Markdown, HTML or Google Docs files to turn them into native pages, with optional AI review.",
          "Kéo thả tệp Word, PDF, Excel, CSV, Markdown, HTML hoặc Google Docs để chuyển thành trang wiki, có thể nhờ AI rà soát và dịch.",
        ),
        guideLabel: learn,
        actionLabel: L("Browse spaces", "Khám phá các Space"),
        actionLink: "/spaces",
        actionLinkLabel: L("Browse spaces", "Khám phá các Space"),
        steps: [
          L("Open a space and click the **Import** icon next to the page tree.", "Mở một space và bấm biểu tượng **Nhập** cạnh cây trang."),
          L("Drop one or more files (`.docx`, `.pdf`, `.xlsx`, `.csv`, `.md`, `.html`...).", "Thả một hoặc nhiều tệp (`.docx`, `.pdf`, `.xlsx`, `.csv`, `.md`, `.html`...)."),
          L("Optionally enable **Review with AI** or **Translate with AI**, then click **Import**.", "Có thể bật **Rà soát bằng AI** hoặc **Dịch bằng AI**, rồi bấm **Nhập**."),
        ],
        tip: L(
          "Each file becomes a clean, editable page in the space — great for migrating existing handbooks or spreadsheets.",
          "Mỗi tệp trở thành một trang chỉnh sửa được trong space — rất tiện để chuyển cẩm nang hoặc bảng tính sẵn có.",
        ),
        helpTopic: "importing-documents",
      },
      {
        id: "bookmarks-and-pins",
        image: helpImg("page-engagement-row"),
        imageSize: size(2100, 375),
        imageAlt: L(
          "Page header actions showing Save for later, Pin page, Share and Favorite space star",
          "Thanh thao tác đầu trang với Lưu xem sau, Ghim trang, Chia sẻ và đánh dấu sao Space yêu thích",
        ),
        icon: <Bookmark className="size-3.5" />,
        iconColor: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
        cardBg: "bg-orange-700 dark:bg-orange-800 border-orange-800 dark:border-orange-700",
        badge: "My Knowledge",
        title: L("Save, pin & star your key pages", "Lưu, ghim và đánh sao trang quan trọng"),
        desc: L(
          "Keep go-to pages one click away with Save for later, Pin page, Favorite spaces and the My Knowledge tab on Home.",
          "Giữ tài liệu hay dùng chỉ cách một cú bấm với Lưu xem sau, Ghim trang, Space yêu thích và thẻ Kiến thức của tôi.",
        ),
        guideLabel: learn,
        actionLabel: L("Browse spaces", "Khám phá các Space"),
        actionLink: "/spaces",
        actionLinkLabel: L("Browse spaces", "Khám phá các Space"),
        steps: [
          L("Click **Save for later** or **Pin page** in any page’s top action bar.", "Bấm **Lưu xem sau** hoặc **Ghim trang** trên thanh thao tác đầu trang."),
          L("Star a space next to its name to add it to **Favorite spaces**.", "Bấm ngôi sao cạnh tên space để thêm vào **Space yêu thích**."),
          L("Open **My Knowledge** on Home to filter everything and pick up to 5 sidebar shortcuts.", "Mở thẻ **Kiến thức của tôi** trên Trang chủ để lọc và chọn tối đa 5 lối tắt trên thanh bên."),
        ],
        tip: L(
          "Pinned pages and favorite spaces stay right in your left sidebar so you can jump back from anywhere.",
          "Trang đã ghim và space yêu thích nằm ngay trên thanh bên trái giúp bạn quay lại từ bất kỳ đâu.",
        ),
        helpTopic: "my-work",
      },
      {
        id: "two-factor-auth",
        previewKind: "two-factor-auth",
        imageAlt: L(
          "Two-factor authentication setup with 6-digit TOTP verification code and recovery codes",
          "Thiết lập xác thực hai lớp với mã TOTP 6 chữ số và mã khôi phục dùng một lần",
        ),
        icon: <ShieldCheck className="size-3.5" />,
        iconColor: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
        cardBg: "bg-emerald-800 dark:bg-emerald-900 border-emerald-900 dark:border-emerald-700",
        badge: "2FA · TOTP",
        title: L("Protect your account with 2FA", "Bảo vệ tài khoản với xác thực 2FA"),
        desc: L(
          "Sign in with any authenticator app (Google Authenticator, 1Password, Bitwarden) plus 10 one-time recovery codes.",
          "Đăng nhập kèm ứng dụng xác thực (Google Authenticator, 1Password, Bitwarden) và 10 mã khôi phục dùng một lần.",
        ),
        guideLabel: learn,
        actionLabel: L("Open Account Security", "Mở Bảo mật tài khoản"),
        actionLink: "/account",
        actionLinkLabel: L("Account security", "Bảo mật tài khoản"),
        steps: [
          L("Go to **Your account → Security** and click **Enable 2FA**.", "Vào **Tài khoản → Bảo mật** và bấm **Bật 2FA**."),
          L("Scan the locally generated QR code with your authenticator app and enter the 6-digit code.", "Quét mã QR tạo trực tiếp trên trình duyệt bằng ứng dụng xác thực và nhập mã 6 số."),
          L("Download your 10 one-time recovery codes (`.txt`) and store them safely.", "Tải về 10 mã khôi phục dùng một lần (`.txt`) và cất giữ cẩn thận."),
        ],
        tip: L(
          "Need to switch phones later? Use **New QR code** in Account Security — your old authenticator stays active until the new one is verified.",
          "Đổi điện thoại sau này? Dùng **Mã QR mới** trong Bảo mật tài khoản — ứng dụng cũ vẫn hoạt động cho đến khi xác nhận thiết bị mới.",
        ),
        helpTopic: "two-factor-auth",
      },
      {
        id: "profile-personalization",
        previewKind: "profile-personalization",
        imageAlt: L(
          "Profile card with a status bubble, welcome effect picker and seasonal holiday calendar",
          "Thẻ hồ sơ với bong bóng trạng thái, bộ chọn hiệu ứng chào mừng và lịch lễ hội theo mùa",
        ),
        icon: <Palette className="size-3.5" />,
        iconColor: "bg-rose-500/20 text-rose-600 dark:text-rose-400",
        cardBg: "bg-rose-700 dark:bg-rose-800 border-rose-800 dark:border-rose-700",
        badge: "Profile",
        title: L("Status bubble, welcome effects & holidays", "Trạng thái, hiệu ứng chào mừng & lịch lễ"),
        desc: L(
          "Share a quick status bubble above your avatar, choose from 15 welcome effects, and browse upcoming workspace holidays.",
          "Chia sẻ bong bóng trạng thái trên ảnh đại diện, chọn từ 15 hiệu ứng chào mừng và xem lịch lễ hội sắp tới.",
        ),
        guideLabel: learn,
        actionLabel: L("Customize profile", "Tùy chỉnh hồ sơ"),
        actionLink: "/account",
        actionLinkLabel: L("Customize profile", "Tùy chỉnh hồ sơ"),
        steps: [
          L("Click **What’s happening?** above your avatar on Home to set a status with an expiry time.", "Bấm **What’s happening?** phía trên ảnh đại diện ở Trang chủ để đặt trạng thái có hạn tự xóa."),
          L("Click the palette icon on your cover card to pick one of 15 interactive welcome effects.", "Bấm biểu tượng bảng màu trên ảnh bìa để chọn 1 trong 15 hiệu ứng chào mừng."),
          L("Use the **Calendar** card under your profile to browse upcoming holidays and seasonal themes.", "Dùng thẻ **Lịch** dưới hồ sơ để xem các ngày lễ và chủ đề mùa lễ hội sắp tới."),
        ],
        tip: L(
          "You can also upload and reposition your avatar and cover image without re-uploading in **Your account**.",
          "Bạn cũng có thể tải lên và căn chỉnh lại vùng hiển thị ảnh đại diện, ảnh bìa ngay trong **Tài khoản**.",
        ),
        helpTopic: "seasonal-effects",
      },
    ];
  }, [isVi]);

  // Auto slide every 5 seconds
  useEffect(() => {
    if (isPaused || selectedFeature !== null) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      moveTo((prev) => (prev + 1) % slides.length);
    }, SLIDE_DURATION_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, selectedFeature, slides.length, moveTo]);

  // Scrolling over the carousel moves the slides instead of the page, and
  // follows the speed of the scroll: a gentle notch is one slide, a fast flick
  // runs through several.
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const PER_SLIDE = 80;
    const MAX_STEPS = 5;
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
      // Past the cap the rest is dropped, so a huge flick does not keep
      // pushing slides after it has ended.
      acc = steps === wanted ? acc - steps * PER_SLIDE : 0;
      moveTo((prev) => (((prev + steps) % slides.length) + slides.length) % slides.length);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [slides.length, moveTo]);

  const nextSlide = () => {
    moveTo((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    moveTo((prev) => (prev - 1 + slides.length) % slides.length);
  };

  // Step through the guides without closing the dialog; the carousel follows.
  const stepGuide = (dir: 1 | -1) => {
    if (!selectedFeature) return;
    const from = slides.findIndex((s) => s.id === selectedFeature.id);
    const to = (from + dir + slides.length) % slides.length;
    setSelectedFeature(slides[to]);
    moveTo(() => to);
  };

  return (
    <>
      <section
        aria-label={t("featureDiscovery.title")}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocus={() => setIsPaused(true)}
        onBlur={() => setIsPaused(false)}
        className="border-border bg-surface relative overflow-hidden rounded-lg border p-3.5 shadow-xs transition-colors duration-150"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-foreground truncate text-sm font-semibold tracking-tight">
            {t("featureDiscovery.title")}
          </h2>

          <div className="flex shrink-0 items-center gap-1">
            <span className="text-muted-foreground mr-1 font-mono text-[10px]">
              {currentSlide + 1}/{slides.length}
            </span>
            <button
              type="button"
              onClick={prevSlide}
              aria-label={isVi ? "Tính năng trước" : "Previous feature"}
              title={isVi ? "Tính năng trước" : "Previous feature"}
              className="hover:bg-surface-hover hover:text-foreground text-muted-foreground focus-visible:ring-ring flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={nextSlide}
              aria-label={isVi ? "Tính năng tiếp theo" : "Next feature"}
              title={isVi ? "Tính năng tiếp theo" : "Next feature"}
              className="hover:bg-surface-hover hover:text-foreground text-muted-foreground focus-visible:ring-ring flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>

        {/* A circular carousel; the slides are positioned by the engine above. */}
        <div
          ref={trackRef}
          data-testid="feature-track"
          className="mt-3 grid grid-cols-[minmax(0,1fr)] overflow-hidden"
        >
          {slides.map((slide, idx) => {
            return (
              <div
                key={slide.id}
                ref={(el) => {
                  slideEls.current[idx] = el;
                }}
                // Constant, so React never overwrites what the engine sets.
                style={{ transform: idx === 0 ? "none" : "translateX(100%)" }}
                className="col-start-1 row-start-1 px-0.5 will-change-transform"
              >
                <div
                  className={cn(
                    "flex h-full flex-col justify-between rounded-lg border p-3 transition-colors",
                    slide.cardBg,
                  )}
                >
                  <div>
                    {/* Real screenshot or themed UI preview */}
                    <div className="border-border/60 bg-surface-sunken mb-2 aspect-[3/1] overflow-hidden rounded-md border">
                      {slide.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element -- static capture; no optimisation needed */
                        <img
                          src={slide.image}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover object-top"
                        />
                      ) : (
                        <FeaturePreview kind={slide.previewKind!} isVi={isVi} compact />
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md bg-white/20 text-white",
                          )}
                        >
                          {slide.icon}
                        </span>
                        <h3 className="truncate text-xs font-semibold text-white">
                          {slide.title}
                        </h3>
                      </div>
                      <span className="shrink-0 rounded border border-white/30 bg-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white">
                        {slide.badge}
                      </span>
                    </div>

                    <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-white/90">
                      {slide.desc}
                    </p>
                  </div>

                  <div className="mt-2.5 flex gap-1.5 pt-0.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedFeature(slide)}
                      className="bg-surface/90 hover:bg-surface border-border/80 h-7 min-w-0 flex-1 cursor-pointer justify-center text-xs shadow-2xs"
                    >
                      <span className="truncate">{slide.guideLabel}</span>
                    </Button>
                    {slide.onDirectAction && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => slide.onDirectAction?.()}
                        aria-label={slide.actionLabel}
                        title={slide.actionLabel}
                        className="bg-surface/90 hover:bg-surface hover:text-primary border-border/80 size-7 shrink-0 cursor-pointer p-0 shadow-2xs"
                      >
                        <Zap className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress dots */}
        <div className="text-muted-foreground mt-2.5 flex items-center justify-between gap-2 pt-0.5 text-[10px]">
          <div className="flex flex-wrap items-center gap-1">
            {slides.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => moveTo(() => idx)}
                className={cn(
                  "h-1.5 cursor-pointer rounded-full transition-all duration-300",
                  idx === currentSlide
                    ? "bg-primary w-3.5"
                    : "bg-muted-foreground/30 hover:bg-muted-foreground/60 w-1.5",
                )}
                aria-label={`Slide ${idx + 1}`}
              />
            ))}
          </div>
          <span className="shrink-0 font-mono text-[10px]">
            {isPaused || selectedFeature !== null
              ? isVi
                ? "Tạm dừng"
                : "Paused"
              : "10s ↻"}
          </span>
        </div>
      </section>

      {/* Learn more: a real screenshot, then three steps */}
      {selectedFeature && (
        <DialogPrimitive.Root
          open={!!selectedFeature}
          onOpenChange={(open) => {
            if (!open) setSelectedFeature(null);
          }}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="bg-background/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 backdrop-blur-xs duration-150" />
            <DialogPrimitive.Content
              className={cn(
                "border-border bg-surface fixed top-[4%] left-[50%] z-50 flex max-h-[92vh] w-[95vw] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border shadow-2xl outline-none duration-200 sm:w-[92vw] md:max-w-4xl lg:max-w-5xl",
                "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
              )}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") stepGuide(1);
                else if (e.key === "ArrowLeft") stepGuide(-1);
              }}
            >
              <div className="border-border bg-surface flex items-start justify-between gap-3 border-b px-6 py-4">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-xs",
                      selectedFeature.iconColor,
                    )}
                  >
                    {selectedFeature.icon}
                  </span>
                  <div className="min-w-0">
                    <DialogPrimitive.Title className="text-foreground text-base font-semibold tracking-tight">
                      {selectedFeature.title}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      {selectedFeature.desc}
                    </DialogPrimitive.Description>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => stepGuide(-1)}
                    aria-label={isVi ? "Hướng dẫn trước" : "Previous guide"}
                    title={isVi ? "Hướng dẫn trước (←)" : "Previous guide (←)"}
                    className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring cursor-pointer rounded-lg p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <ChevronLeft className="size-4.5" />
                  </button>
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {slides.findIndex((s) => s.id === selectedFeature.id) + 1}/{slides.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => stepGuide(1)}
                    aria-label={isVi ? "Hướng dẫn tiếp theo" : "Next guide"}
                    title={isVi ? "Hướng dẫn tiếp theo (→)" : "Next guide (→)"}
                    className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring cursor-pointer rounded-lg p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <ChevronRight className="size-4.5" />
                  </button>
                  <DialogPrimitive.Close asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring cursor-pointer rounded-lg p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      aria-label={t("common.cancel")}
                    >
                      <X className="size-4.5" />
                    </button>
                  </DialogPrimitive.Close>
                </div>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto p-6">
                <div className="grid grid-cols-1 content-start items-start gap-x-6 gap-y-5 md:grid-cols-12">
                {/* Real capture of the app or themed UI preview */}
                <figure className="border-border bg-surface-sunken overflow-hidden rounded-xl border shadow-xs md:col-span-7">
                  <div className="group overflow-hidden">
                    {selectedFeature.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- static capture; no optimisation needed */
                      <img
                        src={selectedFeature.image}
                        alt={selectedFeature.imageAlt}
                        width={selectedFeature.imageSize?.[0]}
                        height={selectedFeature.imageSize?.[1]}
                        className="mx-auto block h-auto max-h-[62vh] w-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      />
                    ) : (
                      <div
                        role="img"
                        aria-label={selectedFeature.imageAlt}
                        className="aspect-[16/10] w-full"
                      >
                        <FeaturePreview kind={selectedFeature.previewKind!} isVi={isVi} />
                      </div>
                    )}
                  </div>
                  <figcaption className="border-border text-muted-foreground border-t px-3 py-1.5 text-[11px]">
                    {selectedFeature.image
                      ? isVi
                        ? "Ảnh chụp thật từ WikiHub (dữ liệu minh họa)"
                        : "Real screenshot from WikiHub (sample data)"
                      : isVi
                        ? "Minh họa tính năng WikiHub"
                        : "WikiHub feature preview"}
                  </figcaption>
                </figure>

                <div className="space-y-5 md:col-span-5">
                  {PURPOSE[selectedFeature.id] && (
                    <div>
                      <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                        {isVi ? "Dùng để làm gì" : "What it is for"}
                      </h4>
                      <p className="text-foreground mt-2 text-xs leading-relaxed">
                        {PURPOSE[selectedFeature.id][isVi ? 1 : 0]}
                      </p>
                    </div>
                  )}
                  <div>
                    <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                      {isVi ? "Hướng dẫn sử dụng" : "How to use"}
                    </h4>
                    <ol className="mt-2 space-y-2.5">
                      {selectedFeature.steps.map((step, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 text-xs">
                          <span className="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold shadow-xs">
                            {idx + 1}
                          </span>
                          <span className="text-foreground pt-0.5 leading-relaxed">
                            <Rich text={step} />
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="space-y-3">
                    <div className="border-border bg-surface-sunken/50 rounded-xl border p-3.5 shadow-2xs">
                      <h5 className="text-foreground flex items-center gap-2 text-xs font-semibold">
                        <Lightbulb className="size-4 shrink-0 text-amber-500" />
                        {isVi ? "Nên biết" : "Good to know"}
                      </h5>
                      <blockquote className="border-primary/40 text-muted-foreground mt-2 border-l-2 pl-3 text-xs leading-relaxed">
                        <Rich text={selectedFeature.tip} />
                      </blockquote>
                    </div>

                    {selectedFeature.shortcut && (
                      <div className="border-border/60 bg-surface flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
                        <span className="text-muted-foreground text-[11px] font-medium">
                          {isVi ? "Phím tắt / Thao tác:" : "Shortcut / Trigger:"}
                        </span>
                        <code className="text-primary bg-primary/10 rounded px-2 py-0.5 font-mono text-[11px] font-semibold">
                          {selectedFeature.shortcut}
                        </code>
                      </div>
                    )}
                  </div>
                </div>
                </div>
              </div>

              <div className="border-border bg-surface-sunken flex items-center justify-between border-t px-6 py-3.5 text-xs">
                <Link
                  href={`/help#${selectedFeature.helpTopic}`}
                  onClick={() => setSelectedFeature(null)}
                  className="text-primary hover:text-primary-hover inline-flex items-center gap-1.5 font-medium transition-colors hover:underline"
                >
                  <BookOpen className="size-4" />
                  <span>{t("cheatSheet.viewFullGuide")}</span>
                  <ExternalLink className="size-3" />
                </Link>

                <div className="flex items-center gap-2.5">
                  {selectedFeature.actionLink && (
                    <Button
                      variant="primary"
                      size="sm"
                      asChild
                      className="h-8.5 cursor-pointer px-3.5 text-xs font-medium"
                    >
                      <Link
                        href={selectedFeature.actionLink}
                        onClick={() => setSelectedFeature(null)}
                      >
                        {selectedFeature.actionLinkLabel}
                      </Link>
                    </Button>
                  )}
                  {selectedFeature.onDirectAction && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        const act = selectedFeature.onDirectAction;
                        setSelectedFeature(null);
                        act?.();
                      }}
                      className="h-8.5 cursor-pointer px-3.5 text-xs font-medium"
                    >
                      <span>{selectedFeature.actionLabel}</span>
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedFeature(null)}
                    className="h-8.5 cursor-pointer px-3 text-xs"
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </>
  );
}
