"use client";

import type { FrontendSlideTheme } from "@/lib/frontend-slides-themes";
import { cn } from "@/lib/utils";

export const SAMPLE_PREVIEW_SLIDE_COUNT = 7;

export interface SamplePreviewTabDef {
  idx: number;
  labelKey:
    | "present.previewTabCover"
    | "present.previewTabAgenda"
    | "present.previewTabHighlights"
    | "present.previewTabDiagram"
    | "present.previewTabCompare"
    | "present.previewTabTableCode"
    | "present.previewTabTimeline";
}

export const SAMPLE_PREVIEW_TABS: readonly SamplePreviewTabDef[] = [
  { idx: 0, labelKey: "present.previewTabCover" },
  { idx: 1, labelKey: "present.previewTabAgenda" },
  { idx: 2, labelKey: "present.previewTabHighlights" },
  { idx: 3, labelKey: "present.previewTabDiagram" },
  { idx: 4, labelKey: "present.previewTabCompare" },
  { idx: 5, labelKey: "present.previewTabTableCode" },
  { idx: 6, labelKey: "present.previewTabTimeline" },
] as const;

function SlideHeader({
  theme,
  index,
  eyebrow,
  title,
}: {
  theme: FrontendSlideTheme;
  index: number;
  eyebrow: string;
  title: string;
}) {
  const num = String(index + 1).padStart(2, "0");
  const total = String(SAMPLE_PREVIEW_SLIDE_COUNT).padStart(2, "0");
  return (
    <div
      className="wh-fs-reveal-1 flex items-end justify-between border-b pb-2.5"
      style={{ borderColor: theme.borderColor }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-black sm:size-9 sm:text-base"
          style={{
            fontFamily: theme.fontDisplay,
            backgroundColor: theme.accent,
            color: theme.textOnAccent,
          }}
        >
          {num}
        </span>
        <div className="min-w-0">
          <span
            className="block text-[10px] font-bold tracking-widest uppercase"
            style={{ color: theme.accent }}
          >
            {eyebrow}
          </span>
          <h3
            className="truncate text-base font-bold sm:text-2xl"
            style={{ fontFamily: theme.fontDisplay }}
          >
            {title}
          </h3>
        </div>
      </div>
      <span
        className="shrink-0 font-mono text-xs"
        style={{ color: theme.textSecondary }}
      >
        {num} / {total}
      </span>
    </div>
  );
}

function SlideFooter({
  theme,
  index,
  vi,
}: {
  theme: FrontendSlideTheme;
  index: number;
  vi: boolean;
}) {
  const num = String(index + 1).padStart(2, "0");
  const total = String(SAMPLE_PREVIEW_SLIDE_COUNT).padStart(2, "0");
  return (
    <div
      className="flex items-center justify-between border-t pt-2.5 text-xs"
      style={{
        borderColor: theme.borderColor,
        color: theme.textSecondary,
      }}
    >
      <span>
        {vi
          ? "Chiến lược Kiến trúc Nền tảng 2026"
          : "Platform Architecture Strategy 2026"}
      </span>
      <span className="font-mono font-bold" style={{ color: theme.accent }}>
        {num} / {total}
      </span>
    </div>
  );
}

export function ThemeSampleSlideContent({
  theme,
  slideIndex,
  locale,
}: {
  theme: FrontendSlideTheme;
  slideIndex: number;
  locale: string;
}) {
  const vi = locale === "vi";

  /* === 01: COVER === */
  if (slideIndex === 0) {
    return (
      <>
        <div className="wh-fs-reveal-1 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className="text-xl font-black"
              style={{
                fontFamily: theme.fontDisplay,
                color: theme.accent,
              }}
            >
              01
            </span>
            <span
              className="rounded-full border px-3 py-0.5 text-[11px] font-bold tracking-widest uppercase"
              style={{
                borderColor: theme.borderColor,
                backgroundColor: theme.slideSurface,
                color: theme.accent,
              }}
            >
              {vi ? "Kỹ thuật Nền tảng (ENG)" : "Platform Engineering (ENG)"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: SAMPLE_PREVIEW_SLIDE_COUNT }).map((_, dot) => (
              <span
                key={dot}
                className="h-1.5 rounded-full"
                style={{
                  width: dot === 0 ? "22px" : "6px",
                  backgroundColor:
                    dot === 0 ? theme.accent : theme.textSecondary,
                  opacity: dot === 0 ? 1 : 0.35,
                }}
              />
            ))}
          </div>
        </div>

        <div
          className={cn(
            "wh-fs-reveal-2 my-auto",
            theme.id === "bold-signal" && "rounded-2xl p-7 shadow-xl",
          )}
          style={
            theme.id === "bold-signal"
              ? {
                  backgroundColor: theme.cardBg,
                  color: theme.textOnAccent,
                }
              : undefined
          }
        >
          <h2
            className="text-2xl leading-tight font-black tracking-tight sm:text-4xl"
            style={{
              fontFamily: theme.fontDisplay,
              color:
                theme.id === "bold-signal"
                  ? theme.textOnAccent
                  : theme.textPrimary,
            }}
          >
            {theme.id === "terminal-green" ? ">_ " : ""}
            {vi
              ? "Chiến lược Kiến trúc Nền tảng 2026"
              : "Platform Architecture Strategy 2026"}
          </h2>
          <p
            className="wh-fs-reveal-3 mt-3 max-w-2xl text-sm leading-relaxed sm:text-base"
            style={{
              color:
                theme.id === "bold-signal"
                  ? "rgba(26,26,26,0.85)"
                  : theme.textSecondary,
            }}
          >
            {vi
              ? "Xây dựng hệ thống tri thức tập trung, tìm kiếm ngữ nghĩa tức thì và sẵn sàng mở rộng cho toàn tổ chức."
              : "Building a unified knowledge hub with instant semantic search and resilient scale across every team."}
          </p>
          <div className="wh-fs-reveal-4 mt-5 flex flex-wrap gap-2">
            {(vi
              ? ["#KiếnTrúc", "#HiệuNăng", "#BảoMật", "#AI"]
              : ["#Architecture", "#Performance", "#Security", "#AI"]
            ).map((tag) => (
              <span
                key={tag}
                className="rounded-full border px-3 py-1 text-xs font-semibold"
                style={{
                  borderColor: theme.borderColor,
                  backgroundColor:
                    theme.id === "bold-signal"
                      ? "rgba(26,26,26,0.14)"
                      : theme.slideSurface,
                  color:
                    theme.id === "bold-signal"
                      ? theme.textOnAccent
                      : theme.textPrimary,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div
          className="flex items-center justify-between border-t pt-3 text-xs"
          style={{
            borderColor: theme.borderColor,
            color: theme.textSecondary,
          }}
        >
          <span>
            {vi ? "Nhóm Sản phẩm • Quý 4, 2026" : "Product Team • Q4 2026"}
          </span>
          <span className="font-mono font-bold" style={{ color: theme.accent }}>
            01 / 0{SAMPLE_PREVIEW_SLIDE_COUNT}
          </span>
        </div>
      </>
    );
  }

  /* === 02: AGENDA / CHAPTER OVERVIEW === */
  if (slideIndex === 1) {
    const agendaItems = vi
      ? [
          {
            no: "01",
            title: "Bối cảnh & Mục tiêu",
            desc: "Chỉ số vận hành hiện tại, điểm nghẽn tìm kiếm và mục tiêu SLA.",
            time: "5 phút",
          },
          {
            no: "02",
            title: "Kiến trúc Tìm kiếm Lai",
            desc: "Kết hợp Full-Text PostgreSQL với Vector Embedding & AI reranking.",
            time: "10 phút",
          },
          {
            no: "03",
            title: "So sánh Hiệu quả",
            desc: "Đối chiếu trải nghiệm trước và sau khi hợp nhất tài liệu vào WikiHub.",
            time: "5 phút",
          },
          {
            no: "04",
            title: "Lộ trình & Triển khai",
            desc: "Kế hoạch rollout theo từng quý, cấu hình Docker và bàn giao nhóm.",
            time: "8 phút",
          },
        ]
      : [
          {
            no: "01",
            title: "Context & Objectives",
            desc: "Baseline metrics, discovery bottlenecks, and target reliability SLAs.",
            time: "5 min",
          },
          {
            no: "02",
            title: "Hybrid Search Architecture",
            desc: "Combining PostgreSQL full-text search with vector embeddings & AI.",
            time: "10 min",
          },
          {
            no: "03",
            title: "Impact Comparison",
            desc: "Before vs. after consolidation into a single living knowledge hub.",
            time: "5 min",
          },
          {
            no: "04",
            title: "Roadmap & Rollout",
            desc: "Quarterly milestones, Docker deployment steps, and team handoff.",
            time: "8 min",
          },
        ];

    return (
      <>
        <SlideHeader
          theme={theme}
          index={1}
          eyebrow={vi ? "Nội dung Buổi trình bày" : "Session Overview"}
          title={vi ? "Mục lục & Cấu trúc Thảo luận" : "Agenda & Discussion Flow"}
        />

        <div className="wh-fs-reveal-2 my-auto grid grid-cols-2 gap-3.5 py-3">
          {agendaItems.map((item) => (
            <div
              key={item.no}
              className="flex flex-col justify-between rounded-xl border p-4"
              style={{
                borderColor: theme.borderColor,
                backgroundColor: theme.slideSurface,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-lg font-black"
                  style={{
                    fontFamily: theme.fontDisplay,
                    color: theme.accent,
                  }}
                >
                  {item.no}
                </span>
                <span
                  className="rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold"
                  style={{
                    borderColor: theme.borderColor,
                    color: theme.textSecondary,
                  }}
                >
                  {item.time}
                </span>
              </div>
              <div className="mt-2">
                <div
                  className="text-sm font-bold sm:text-base"
                  style={{ fontFamily: theme.fontDisplay }}
                >
                  {item.title}
                </div>
                <p
                  className="mt-1 text-xs leading-relaxed"
                  style={{ color: theme.textSecondary }}
                >
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        <SlideFooter theme={theme} index={1} vi={vi} />
      </>
    );
  }

  /* === 03: CONTENT, CALLOUT & KPI METRICS === */
  if (slideIndex === 2) {
    return (
      <>
        <SlideHeader
          theme={theme}
          index={2}
          eyebrow={vi ? "Tổng quan Kết quả" : "Executive Highlights"}
          title={
            vi
              ? "Mục tiêu Cốt lõi & Chỉ số Đạt được"
              : "Core Objectives & Impact Metrics"
          }
        />

        <div className="wh-fs-reveal-2 my-auto grid grid-cols-12 items-center gap-5 py-3">
          <div className="col-span-7 space-y-3 text-xs sm:text-sm">
            <ul className="list-disc space-y-2.5 pl-5 leading-relaxed">
              <li>
                <strong>{vi ? "Tìm kiếm kết hợp:" : "Hybrid Search:"}</strong>{" "}
                {vi
                  ? "Kết hợp từ khóa không dấu và vector ngữ nghĩa ngay trong "
                  : "Combines accent-insensitive full-text and vector search via "}
                <code
                  className="rounded px-1.5 py-0.5 font-mono text-[11px]"
                  style={{
                    backgroundColor: theme.codeBg,
                    color: theme.codeFg,
                  }}
                >
                  Ctrl+K
                </code>
                .
              </li>
              <li>
                <strong>
                  {vi ? "Phân quyền đa tầng:" : "Fine-Grained RBAC:"}
                </strong>{" "}
                {vi
                  ? "Kiểm soát truy cập theo Space, nhóm và từng trang riêng lẻ."
                  : "Scoped access across spaces, groups, and individual pages."}
              </li>
              <li>
                <strong>
                  {vi ? "Trình chiếu 1-click:" : "One-Click Slides:"}
                </strong>{" "}
                {vi
                  ? "Chuyển trực tiếp tài liệu thành slide thuyết trình không cần soạn lại."
                  : "Present directly from living documentation with zero rework."}
              </li>
            </ul>

            <div
              className="rounded-r-lg border-l-4 px-3.5 py-2.5 text-xs italic"
              style={{
                borderColor: theme.accent,
                backgroundColor: theme.slideSurface,
                color: theme.textSecondary,
              }}
            >
              {vi
                ? "“Tri thức chỉ thực sự có giá trị khi cả đội ngũ có thể tìm thấy và trình bày trong vài giây.”"
                : "“Knowledge compounds fastest when teams can find it and present it in seconds.”"}
            </div>
          </div>

          <div className="wh-fs-reveal-3 col-span-5 grid grid-cols-1 gap-2.5">
            {(vi
              ? [
                  { val: "99.95%", lbl: "Độ sẵn sàng hệ thống" },
                  { val: "< 120ms", lbl: "Độ trễ tìm kiếm P95" },
                  { val: "3.2x", lbl: "Tốc độ onboarding nhân sự" },
                ]
              : [
                  { val: "99.95%", lbl: "Platform Availability" },
                  { val: "< 120ms", lbl: "P95 Search Latency" },
                  { val: "3.2x", lbl: "Faster Team Onboarding" },
                ]
            ).map((kpi) => (
              <div
                key={kpi.lbl}
                className="rounded-xl border px-4 py-2.5"
                style={{
                  borderColor: theme.borderColor,
                  backgroundColor: theme.slideSurface,
                }}
              >
                <div
                  className="text-xl font-black sm:text-2xl"
                  style={{
                    fontFamily: theme.fontDisplay,
                    color: theme.accent,
                  }}
                >
                  {kpi.val}
                </div>
                <div
                  className="text-[11px]"
                  style={{ color: theme.textSecondary }}
                >
                  {kpi.lbl}
                </div>
              </div>
            ))}
          </div>
        </div>

        <SlideFooter theme={theme} index={2} vi={vi} />
      </>
    );
  }

  /* === 04: ARCHITECTURE / VISUAL DIAGRAM === */
  if (slideIndex === 3) {
    const nodes = vi
      ? [
          { tag: "CLIENT", title: "WikiHub Web", sub: "Next.js • Editor • Present" },
          { tag: "GATEWAY", title: "FastAPI Core", sub: "Auth • RBAC • REST/SSE" },
          { tag: "DATA", title: "Postgres + pgvector", sub: "Full-text • Embeddings" },
          { tag: "STORAGE", title: "MinIO + Redis", sub: "Media • Cache • Jobs" },
        ]
      : [
          { tag: "CLIENT", title: "WikiHub Web", sub: "Next.js • Editor • Present" },
          { tag: "GATEWAY", title: "FastAPI Core", sub: "Auth • RBAC • REST/SSE" },
          { tag: "DATA", title: "Postgres + pgvector", sub: "Full-text • Embeddings" },
          { tag: "STORAGE", title: "MinIO + Redis", sub: "Media • Cache • Jobs" },
        ];

    return (
      <>
        <SlideHeader
          theme={theme}
          index={3}
          eyebrow={vi ? "Kiến trúc Hệ thống" : "System Architecture"}
          title={
            vi
              ? "Luồng Dữ liệu & Tìm kiếm Ngữ nghĩa"
              : "Data Pipeline & Semantic Search Flow"
          }
        />

        <div className="wh-fs-reveal-2 my-auto flex flex-col gap-4 py-3">
          {/* Flow Diagram Row */}
          <div className="flex items-stretch gap-1.5">
            {nodes.map((node, idx) => (
              <div key={node.tag} className="contents">
                <div
                  className="flex min-w-0 flex-1 flex-col justify-between rounded-xl border p-3 shadow-xs"
                  style={{
                    borderColor:
                      idx === 1 ? theme.accent : theme.borderColor,
                    backgroundColor: theme.slideSurface,
                  }}
                >
                  <span
                    className="font-mono text-[10px] font-bold tracking-wider"
                    style={{ color: theme.accent }}
                  >
                    {node.tag}
                  </span>
                  <div
                    className="mt-1.5 text-xs font-bold sm:text-sm"
                    style={{ fontFamily: theme.fontDisplay }}
                  >
                    {node.title}
                  </div>
                  <div
                    className="mt-1 text-[10px] leading-snug"
                    style={{ color: theme.textSecondary }}
                  >
                    {node.sub}
                  </div>
                </div>
                {idx < nodes.length - 1 ? (
                  <div
                    aria-hidden
                    className="flex w-5 shrink-0 items-center justify-center"
                  >
                    <div className="flex w-full items-center">
                      <div
                        className="h-0.5 flex-1"
                        style={{ backgroundColor: theme.accent, opacity: 0.65 }}
                      />
                      <span
                        className="text-xs font-black"
                        style={{ color: theme.accent }}
                      >
                        ▸
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {/* 3 Architecture Highlights below diagram */}
          <div className="wh-fs-reveal-3 grid grid-cols-3 gap-3">
            {(vi
              ? [
                  {
                    label: "Đồng bộ tức thì",
                    detail: "Tự động lập chỉ mục văn bản & vector ngay sau mỗi lần lưu trang.",
                  },
                  {
                    label: "An toàn dữ liệu",
                    detail: "Lưu trữ tập trung trên hạ tầng nội bộ, sao lưu định kỳ tự động.",
                  },
                  {
                    label: "Tối ưu độ trễ",
                    detail: "Cache Redis cho kết quả tìm kiếm nóng và bản tóm tắt AI.",
                  },
                ]
              : [
                  {
                    label: "Real-Time Indexing",
                    detail: "Automatic full-text and vector indexing on every page save.",
                  },
                  {
                    label: "Self-Hosted Security",
                    detail: "Full data sovereignty with scheduled encrypted backups.",
                  },
                  {
                    label: "Low-Latency Caching",
                    detail: "Redis caches hot search queries and generated AI slide decks.",
                  },
                ]
            ).map((cap) => (
              <div
                key={cap.label}
                className="rounded-xl border px-3.5 py-2.5"
                style={{
                  borderColor: theme.borderColor,
                  backgroundColor: theme.slideSurface,
                }}
              >
                <div
                  className="text-xs font-bold"
                  style={{ color: theme.accent }}
                >
                  {cap.label}
                </div>
                <p
                  className="mt-1 text-[11px] leading-relaxed"
                  style={{ color: theme.textSecondary }}
                >
                  {cap.detail}
                </p>
              </div>
            ))}
          </div>
        </div>

        <SlideFooter theme={theme} index={3} vi={vi} />
      </>
    );
  }

  /* === 05: TWO-COLUMN COMPARISON (BEFORE VS AFTER) === */
  if (slideIndex === 4) {
    const beforeItems = vi
      ? [
          "Tài liệu rải rác trên nhiều file Word, PDF và tin nhắn chat.",
          "Phải copy thủ công sang PowerPoint trước mỗi buổi họp.",
          "Khó kiểm soát phiên bản mới nhất khi nhiều nhóm cùng sửa.",
        ]
      : [
          "Docs scattered across static Word files, PDFs, and chat threads.",
          "Manual copy-pasting into slide decks before every review.",
          "Version drift whenever multiple teams update specs in parallel.",
        ];

    const afterItems = vi
      ? [
          "Một nguồn sự thật duy nhất với lịch sử phiên bản rõ ràng.",
          "Bấm Present để biến tài liệu thành slide 16:9 ngay lập tức.",
          "Hỗ trợ AI tóm tắt, kiểm tra mâu thuẫn và xuất HTML độc lập.",
        ]
      : [
          "Single source of truth with full revision history and diffs.",
          "Click Present to turn any living page into a 16:9 deck instantly.",
          "AI summaries, conflict checks, and standalone HTML slide export.",
        ];

    return (
      <>
        <SlideHeader
          theme={theme}
          index={4}
          eyebrow={vi ? "Phân tích Đối chiếu" : "Side-by-Side Comparison"}
          title={
            vi
              ? "Quy trình Cũ vs. WikiHub Thống nhất"
              : "Legacy Workflow vs. Unified WikiHub"
          }
        />

        <div className="wh-fs-reveal-2 my-auto grid grid-cols-2 gap-4 py-3">
          {/* Left: Before */}
          <div
            className="flex flex-col rounded-xl border p-4"
            style={{
              borderColor: theme.borderColor,
              backgroundColor: theme.slideSurface,
            }}
          >
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: theme.borderColor }}>
              <span
                className="text-sm font-bold sm:text-base"
                style={{ fontFamily: theme.fontDisplay }}
              >
                {vi ? "Trước đây" : "Before"}
              </span>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase"
                style={{
                  borderColor: theme.borderColor,
                  color: theme.textSecondary,
                }}
              >
                {vi ? "Phân mảnh" : "Fragmented"}
              </span>
            </div>
            <ul
              className="mt-3 space-y-2.5 text-xs leading-relaxed sm:text-sm"
              style={{ color: theme.textSecondary }}
            >
              {beforeItems.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <span className="mt-0.5 font-mono font-bold opacity-70">−</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: After (Highlighted with theme accent) */}
          <div
            className="flex flex-col rounded-xl border-2 p-4 shadow-sm"
            style={{
              borderColor: theme.accent,
              backgroundColor: theme.slideSurface,
            }}
          >
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: theme.borderColor }}>
              <span
                className="text-sm font-bold sm:text-base"
                style={{
                  fontFamily: theme.fontDisplay,
                  color: theme.accent,
                }}
              >
                {vi ? "Với WikiHub" : "With WikiHub"}
              </span>
              <span
                className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  backgroundColor: theme.accent,
                  color: theme.textOnAccent,
                }}
              >
                {vi ? "Khuyên dùng" : "Recommended"}
              </span>
            </div>
            <ul className="mt-3 space-y-2.5 text-xs leading-relaxed sm:text-sm">
              {afterItems.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <span
                    className="mt-0.5 font-mono font-black"
                    style={{ color: theme.accent }}
                  >
                    ✓
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <SlideFooter theme={theme} index={4} vi={vi} />
      </>
    );
  }

  /* === 06: TABLE & CODE SPLIT === */
  if (slideIndex === 5) {
    return (
      <>
        <SlideHeader
          theme={theme}
          index={5}
          eyebrow={vi ? "Triển khai Kỹ thuật" : "Technical Rollout"}
          title={
            vi
              ? "Bảng Theo dõi & Cấu hình Khởi chạy"
              : "Delivery Matrix & Quick Deploy"
          }
        />

        <div className="wh-fs-reveal-2 my-auto grid grid-cols-12 items-center gap-5 py-3">
          {/* Sample Table */}
          <div
            className="col-span-7 overflow-hidden rounded-xl border"
            style={{
              borderColor: theme.borderColor,
              backgroundColor: theme.slideSurface,
            }}
          >
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr
                  style={{
                    backgroundColor: theme.codeBg,
                    color: theme.codeFg,
                  }}
                >
                  <th className="p-2.5 font-bold">
                    {vi ? "Giai đoạn" : "Phase"}
                  </th>
                  <th className="p-2.5 font-bold">
                    {vi ? "Hạng mục chính" : "Deliverable"}
                  </th>
                  <th className="p-2.5 font-bold">
                    {vi ? "Trạng thái" : "Status"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(vi
                  ? [
                      ["Q1", "Chuyển đổi dữ liệu Confluence", "Hoàn tất"],
                      ["Q2", "Tìm kiếm ngữ nghĩa & AI Chat", "Đang chạy"],
                      ["Q3", "Trình chiếu Slide 1-Click", "Ra mắt"],
                      ["Q4", "Phân tích Sức khỏe Nội dung", "Kế hoạch"],
                    ]
                  : [
                      ["Q1", "Confluence Space Migration", "Done"],
                      ["Q2", "Semantic Search & AI Chat", "Live"],
                      ["Q3", "One-Click Slide Deck", "Shipped"],
                      ["Q4", "Content Health Analytics", "Planned"],
                    ]
                ).map(([phase, item, st]) => (
                  <tr
                    key={phase}
                    className="border-t"
                    style={{ borderColor: theme.borderColor }}
                  >
                    <td
                      className="p-2.5 font-mono font-bold"
                      style={{ color: theme.accent }}
                    >
                      {phase}
                    </td>
                    <td className="p-2.5">{item}</td>
                    <td className="p-2.5 font-semibold">{st}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sample Code Block */}
          <div
            className="wh-fs-reveal-3 col-span-5 rounded-xl border p-4 font-mono text-[11px] leading-relaxed"
            style={{
              borderColor: theme.borderColor,
              backgroundColor: theme.codeBg,
              color: theme.codeFg,
            }}
          >
            <div className="mb-2 flex items-center justify-between text-[10px] opacity-65">
              <span># deploy.sh</span>
              <span>bash</span>
            </div>
            <pre className="whitespace-pre-wrap">{`./scripts/run.sh --build
docker compose ps
curl -fsS localhost:3000/api/health
# Status: OK (42ms)`}</pre>
          </div>
        </div>

        <SlideFooter theme={theme} index={5} vi={vi} />
      </>
    );
  }

  /* === 07: ROADMAP TIMELINE & CLOSING QUOTE === */
  const milestones = vi
    ? [
        { q: "Q1", title: "Hợp nhất", desc: "Nhập 100% space kỹ thuật" },
        { q: "Q2", title: "Tăng tốc AI", desc: "Hỏi đáp & tóm tắt trang" },
        { q: "Q3", title: "Trình chiếu", desc: "12 theme & xuất HTML" },
        { q: "Q4", title: "Mở rộng", desc: "Đồng bộ đa chi nhánh" },
      ]
    : [
        { q: "Q1", title: "Consolidate", desc: "Import 100% eng spaces" },
        { q: "Q2", title: "AI Assist", desc: "Page Q&A & TL;DR" },
        { q: "Q3", title: "Present", desc: "12 themes & HTML export" },
        { q: "Q4", title: "Scale", desc: "Multi-region rollout" },
      ];

  return (
    <>
      <SlideHeader
        theme={theme}
        index={6}
        eyebrow={vi ? "Lộ trình & Kết luận" : "Roadmap & Closing"}
        title={
          vi
            ? "Các Cột mốc 2026 & Bước Tiếp theo"
            : "2026 Milestones & Next Steps"
        }
      />

      <div className="wh-fs-reveal-2 my-auto flex flex-col gap-5 py-3">
        {/* 4-Step Horizontal Timeline */}
        <div className="relative grid grid-cols-4 gap-3">
          <div
            aria-hidden
            className="pointer-events-none absolute top-4 right-8 left-8 h-0.5"
            style={{ backgroundColor: theme.borderColor }}
          />
          {milestones.map((m, i) => (
            <div key={m.q} className="relative flex flex-col items-start">
              <div
                className="relative z-10 flex size-8 items-center justify-center rounded-full font-mono text-xs font-black shadow-xs"
                style={{
                  backgroundColor:
                    i <= 2 ? theme.accent : theme.slideSurface,
                  color: i <= 2 ? theme.textOnAccent : theme.textPrimary,
                  border: `2px solid ${theme.accent}`,
                }}
              >
                {m.q}
              </div>
              <div
                className="mt-2.5 w-full rounded-xl border p-3"
                style={{
                  borderColor: theme.borderColor,
                  backgroundColor: theme.slideSurface,
                }}
              >
                <div
                  className="text-xs font-bold sm:text-sm"
                  style={{ fontFamily: theme.fontDisplay }}
                >
                  {m.title}
                </div>
                <p
                  className="mt-0.5 text-[11px] leading-snug"
                  style={{ color: theme.textSecondary }}
                >
                  {m.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Closing Statement Banner */}
        <div
          className="wh-fs-reveal-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-3.5"
          style={{
            borderColor: theme.accent,
            backgroundColor: theme.slideSurface,
          }}
        >
          <div>
            <div
              className="text-sm font-bold sm:text-base"
              style={{ fontFamily: theme.fontDisplay }}
            >
              {vi
                ? "Sẵn sàng áp dụng giao diện này cho bộ slide của bạn?"
                : "Ready to apply this theme to your presentation?"}
            </div>
            <p className="text-xs" style={{ color: theme.textSecondary }}>
              {vi
                ? "Mọi tiêu đề, bảng biểu, khối code và sơ đồ trong trang sẽ tự động đồng bộ theo phong cách này."
                : "Every heading, table, code block, and diagram on your page will adapt automatically."}
            </p>
          </div>
          <span
            className="rounded-lg px-3 py-1.5 font-mono text-xs font-bold"
            style={{
              backgroundColor: theme.accent,
              color: theme.textOnAccent,
            }}
          >
            {vi ? "Q&A • Cảm ơn" : "Q&A • Thank You"}
          </span>
        </div>
      </div>

      <SlideFooter theme={theme} index={6} vi={vi} />
    </>
  );
}
