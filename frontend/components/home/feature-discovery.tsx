"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  FolderTree,
  GitCompare,
  HeartPulse,
  Keyboard,
  Lightbulb,
  Paperclip,
  Presentation,
  Search,
  Share2,
  Sparkles,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { openCheatSheet, triggerOpenSearch } from "@/lib/cheat-sheet";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

const SLIDE_DURATION_MS = 10000;
/** Number of guides; the circular carousel needs it before the slides exist. */
const SLIDE_COUNT = 15;
const IMAGE_DIR = "/feature-discovery";

interface FeatureSlide {
  id: string;
  /** Real capture of the app in `public/feature-discovery/<id>.png`. */
  image: string;
  imageAlt: string;
  /** Pixel size of the capture, so the layout does not jump while it loads. */
  imageSize: [number, number];
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
};

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
    layout(0);
    return () => cancelAnimationFrame(rafRef.current);
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
        cardBg: "bg-blue-50/60 dark:bg-blue-950/25 border-blue-200/60 dark:border-blue-800/40",
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
        cardBg: "bg-violet-50/60 dark:bg-violet-950/25 border-violet-200/60 dark:border-violet-800/40",
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
        cardBg: "bg-cyan-50/60 dark:bg-cyan-950/25 border-cyan-200/60 dark:border-cyan-800/40",
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
        cardBg: "bg-emerald-50/60 dark:bg-emerald-950/25 border-emerald-200/60 dark:border-emerald-800/40",
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
        cardBg: "bg-amber-50/60 dark:bg-amber-950/25 border-amber-200/60 dark:border-amber-800/40",
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
        cardBg: "bg-sky-50/60 dark:bg-sky-950/25 border-sky-200/60 dark:border-sky-800/40",
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
        cardBg: "bg-purple-50/60 dark:bg-purple-950/25 border-purple-200/60 dark:border-purple-800/40",
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
        helpTopic: "tables-and-codeblocks",
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
        cardBg: "bg-rose-50/60 dark:bg-rose-950/25 border-rose-200/60 dark:border-rose-800/40",
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
        cardBg: "bg-indigo-50/60 dark:bg-indigo-950/25 border-indigo-200/60 dark:border-indigo-800/40",
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
        cardBg: "bg-teal-50/60 dark:bg-teal-950/25 border-teal-200/60 dark:border-teal-800/40",
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
        cardBg: "bg-fuchsia-50/60 dark:bg-fuchsia-950/25 border-fuchsia-200/60 dark:border-fuchsia-800/40",
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
        cardBg: "bg-orange-50/60 dark:bg-orange-950/25 border-orange-200/60 dark:border-orange-800/40",
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
        helpTopic: "page-actions-menu",
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
        cardBg: "bg-lime-50/60 dark:bg-lime-950/25 border-lime-200/60 dark:border-lime-800/40",
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
        helpTopic: "notifications",
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
        cardBg: "bg-slate-50/60 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-700/40",
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
        cardBg: "bg-amber-50/60 dark:bg-amber-950/25 border-amber-200/60 dark:border-amber-800/40",
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
                    {/* Real screenshot, cropped to its top */}
                    <div className="border-border/60 bg-surface-sunken mb-2 aspect-[3/1] overflow-hidden rounded-md border">
                      {/* eslint-disable-next-line @next/next/no-img-element -- static capture; no optimisation needed */}
                      <img
                        src={slide.image}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover object-top"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md",
                            slide.iconColor,
                          )}
                        >
                          {slide.icon}
                        </span>
                        <h3 className="text-foreground truncate text-xs font-semibold">
                          {slide.title}
                        </h3>
                      </div>
                      <span className="text-muted-foreground bg-surface/80 border-border/60 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]">
                        {slide.badge}
                      </span>
                    </div>

                    <p className="text-muted-foreground mt-2 line-clamp-3 text-[11px] leading-relaxed">
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
        <div className="text-muted-foreground mt-2.5 flex items-center justify-between pt-0.5 text-[10px]">
          <div className="flex flex-wrap items-center gap-1.5">
            {slides.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => moveTo(() => idx)}
                className={cn(
                  "h-1.5 cursor-pointer rounded-full transition-all duration-300",
                  idx === currentSlide
                    ? "bg-primary w-4"
                    : "bg-muted-foreground/30 hover:bg-muted-foreground/60 w-1.5",
                )}
                aria-label={`Slide ${idx + 1}`}
              />
            ))}
          </div>
          <span className="font-mono text-[10px]">
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
                {/* Real capture of the app */}
                <figure className="border-border bg-surface-sunken overflow-hidden rounded-xl border shadow-xs md:col-span-7">
                  <div className="group overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element -- static capture; no optimisation needed */}
                    <img
                      src={selectedFeature.image}
                      alt={selectedFeature.imageAlt}
                      width={selectedFeature.imageSize[0]}
                      height={selectedFeature.imageSize[1]}
                      className="mx-auto block h-auto max-h-[62vh] w-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  </div>
                  <figcaption className="border-border text-muted-foreground border-t px-3 py-1.5 text-[11px]">
                    {isVi
                      ? "Ảnh chụp thật từ WikiHub (dữ liệu minh họa)"
                      : "Real screenshot from WikiHub (sample data)"}
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
