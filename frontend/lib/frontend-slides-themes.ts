import type { PresentationSlide } from "./page-presentation";

export type FrontendSlideThemeId =
  | "bold-signal"
  | "electric-studio"
  | "creative-voltage"
  | "dark-botanical"
  | "notebook-tabs"
  | "pastel-geometry"
  | "split-pastel"
  | "vintage-editorial"
  | "neon-cyber"
  | "terminal-green"
  | "swiss-modern"
  | "paper-ink";

export type FrontendSlideThemeCategory = "dark" | "light" | "specialty";

export interface FrontendSlideTheme {
  id: FrontendSlideThemeId;
  name: string;
  category: FrontendSlideThemeCategory;
  isDark: boolean;
  vibeEn: string;
  vibeVi: string;
  googleFontsUrl: string;
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  stageBg: string;
  slideBg: string;
  slideSurface: string;
  cardBg: string;
  textPrimary: string;
  textSecondary: string;
  textOnAccent: string;
  accent: string;
  accentSecondary: string;
  borderColor: string;
  codeBg: string;
  codeFg: string;
  previewSwatches: [string, string, string];
}

export const FRONTEND_SLIDE_THEMES: FrontendSlideTheme[] = [
  {
    id: "bold-signal",
    name: "Bold Signal",
    category: "dark",
    isDark: true,
    vibeEn: "Confident, high-impact dark gradient with vibrant focal card & oversized numbers",
    vibeVi: "Mạnh mẽ, ấn tượng cao với thẻ điểm nhấn cam rực rỡ và số thứ tự khổ lớn",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;700&display=swap",
    fontDisplay: '"Archivo Black", "Arial Black", sans-serif',
    fontBody: '"Space Grotesk", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#111111",
    slideBg: "linear-gradient(135deg, #1a1a1a 0%, #262626 50%, #161616 100%)",
    slideSurface: "#222222",
    cardBg: "#FF5722",
    textPrimary: "#ffffff",
    textSecondary: "#b0b0b0",
    textOnAccent: "#1a1a1a",
    accent: "#FF5722",
    accentSecondary: "#ff8a65",
    borderColor: "rgba(255, 255, 255, 0.14)",
    codeBg: "#121212",
    codeFg: "#f5f5f5",
    previewSwatches: ["#1a1a1a", "#FF5722", "#ffffff"],
  },
  {
    id: "electric-studio",
    name: "Electric Studio",
    category: "dark",
    isDark: true,
    vibeEn: "Clean, high-contrast studio look with electric cobalt accent bar & sharp geometry",
    vibeVi: "Tương phản cao, sắc nét chuyên nghiệp với dải xanh Electric Cobalt",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&display=swap",
    fontDisplay: '"Manrope", system-ui, sans-serif',
    fontBody: '"Manrope", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#050507",
    slideBg: "#0a0a0e",
    slideSurface: "#141622",
    cardBg: "#4361ee",
    textPrimary: "#ffffff",
    textSecondary: "#9ca3af",
    textOnAccent: "#ffffff",
    accent: "#4361ee",
    accentSecondary: "#72efdd",
    borderColor: "rgba(67, 97, 238, 0.35)",
    codeBg: "#0f111a",
    codeFg: "#e2e8f0",
    previewSwatches: ["#0a0a0e", "#4361ee", "#ffffff"],
  },
  {
    id: "creative-voltage",
    name: "Creative Voltage",
    category: "dark",
    isDark: true,
    vibeEn: "Energetic electric blue & deep navy split with neon lime badges & halftone flair",
    vibeVi: "Năng lượng sáng tạo với xanh điện từ, điểm nhấn vàng neon và họa tiết halftone",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap",
    fontDisplay: '"Syne", system-ui, sans-serif',
    fontBody: '"Space Mono", monospace',
    fontMono: '"Space Mono", monospace',
    stageBg: "#0f0f1c",
    slideBg: "linear-gradient(120deg, #151528 0%, #1a1a35 65%, #0047b3 100%)",
    slideSurface: "#20203a",
    cardBg: "#0066ff",
    textPrimary: "#ffffff",
    textSecondary: "#c4d0e6",
    textOnAccent: "#121220",
    accent: "#d4ff00",
    accentSecondary: "#0066ff",
    borderColor: "rgba(212, 255, 0, 0.32)",
    codeBg: "#121222",
    codeFg: "#d4ff00",
    previewSwatches: ["#0066ff", "#1a1a2e", "#d4ff00"],
  },
  {
    id: "dark-botanical",
    name: "Dark Botanical",
    category: "dark",
    isDark: true,
    vibeEn: "Sophisticated editorial serif on obsidian with warm gold & terracotta atmospheric glow",
    vibeVi: "Sang trọng, nghệ thuật với chữ Serif thanh lịch và vầng sáng vàng ấm / đất nung",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,500;0,600;0,700;1,600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap",
    fontDisplay: '"Cormorant", Georgia, serif',
    fontBody: '"IBM Plex Sans", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#080808",
    slideBg: "#0f0f0f",
    slideSurface: "#181716",
    cardBg: "#211f1d",
    textPrimary: "#e8e4df",
    textSecondary: "#9a9590",
    textOnAccent: "#0f0f0f",
    accent: "#d4a574",
    accentSecondary: "#e8b4b8",
    borderColor: "rgba(212, 165, 116, 0.25)",
    codeBg: "#161514",
    codeFg: "#e8e4df",
    previewSwatches: ["#0f0f0f", "#d4a574", "#e8b4b8"],
  },
  {
    id: "notebook-tabs",
    name: "Notebook Tabs",
    category: "light",
    isDark: false,
    vibeEn: "Tactile cream paper on dark desk with colorful section tabs & binder rings",
    vibeVi: "Sổ tay biên tập tinh tế trên nền giấy kem ấm kèm dải tab màu phân mục bên phải",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,600;6..96,700&family=DM+Sans:wght@400;500;700&display=swap",
    fontDisplay: '"Bodoni Moda", Georgia, serif',
    fontBody: '"DM Sans", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#2d2d2d",
    slideBg: "#f8f6f1",
    slideSurface: "#efeae0",
    cardBg: "#ffffff",
    textPrimary: "#1a1a1a",
    textSecondary: "#57534e",
    textOnAccent: "#1a1a1a",
    accent: "#2e6f56",
    accentSecondary: "#98d4bb",
    borderColor: "rgba(26, 26, 26, 0.14)",
    codeBg: "#ece7dc",
    codeFg: "#1a1a1a",
    previewSwatches: ["#2d2d2d", "#f8f6f1", "#98d4bb"],
  },
  {
    id: "pastel-geometry",
    name: "Pastel Geometry",
    category: "light",
    isDark: false,
    vibeEn: "Friendly rounded card on pastel sky backdrop with rhythmic vertical pills",
    vibeVi: "Hiện đại, thân thiện trên nền xanh pastel dịu mắt kèm dải thẻ pill nhịp điệu",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap",
    fontDisplay: '"Plus Jakarta Sans", system-ui, sans-serif',
    fontBody: '"Plus Jakarta Sans", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#c8d9e6",
    slideBg: "#faf9f7",
    slideSurface: "#f0eee9",
    cardBg: "#ffffff",
    textPrimary: "#1e293b",
    textSecondary: "#475569",
    textOnAccent: "#ffffff",
    accent: "#5a7c6a",
    accentSecondary: "#9b8dc4",
    borderColor: "rgba(30, 41, 59, 0.12)",
    codeBg: "#eef2f6",
    codeFg: "#1e293b",
    previewSwatches: ["#c8d9e6", "#faf9f7", "#5a7c6a"],
  },
  {
    id: "split-pastel",
    name: "Split Pastel",
    category: "light",
    isDark: false,
    vibeEn: "Playful warm peach & soft lavender dual canvas with grid overlay & mint badges",
    vibeVi: "Trẻ trung, sáng tạo với nền đôi Đào ấm & Tím Lavender kèm lưới mịn",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;800&display=swap",
    fontDisplay: '"Outfit", system-ui, sans-serif',
    fontBody: '"Outfit", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#e9dfd8",
    slideBg: "linear-gradient(90deg, #f5e6dc 0%, #f5e6dc 58%, #e4dff0 58%, #e4dff0 100%)",
    slideSurface: "rgba(255, 255, 255, 0.78)",
    cardBg: "#ffffff",
    textPrimary: "#1a1a1a",
    textSecondary: "#4a4552",
    textOnAccent: "#1a1a1a",
    accent: "#6b4c9a",
    accentSecondary: "#c8f0d8",
    borderColor: "rgba(26, 26, 26, 0.14)",
    codeBg: "#ffffff",
    codeFg: "#1a1a1a",
    previewSwatches: ["#f5e6dc", "#e4dff0", "#c8f0d8"],
  },
  {
    id: "vintage-editorial",
    name: "Vintage Editorial",
    category: "light",
    isDark: false,
    vibeEn: "Distinctive Fraunces serif on warm cream with geometric circle-line accents",
    vibeVi: "Phong cách tạp chí cổ điển sắc sảo với chữ Fraunces và hình học đường nét",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Work+Sans:wght@400;500;600&display=swap",
    fontDisplay: '"Fraunces", Georgia, serif',
    fontBody: '"Work Sans", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#e5e0d5",
    slideBg: "#f5f3ee",
    slideSurface: "#ebe6dc",
    cardBg: "#e8d4c0",
    textPrimary: "#1a1a1a",
    textSecondary: "#52504c",
    textOnAccent: "#1a1a1a",
    accent: "#8c4a27",
    accentSecondary: "#e8d4c0",
    borderColor: "#1a1a1a",
    codeBg: "#ebe6dc",
    codeFg: "#1a1a1a",
    previewSwatches: ["#f5f3ee", "#1a1a1a", "#e8d4c0"],
  },
  {
    id: "neon-cyber",
    name: "Neon Cyber",
    category: "specialty",
    isDark: true,
    vibeEn: "Futuristic deep-navy cyber deck with cyan/magenta neon glow & precision grid",
    vibeVi: "Tương lai công nghệ trên nền xanh đêm với ánh sáng Cyan / Magenta và lưới tọa độ",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Syne:wght@700;800&display=swap",
    fontDisplay: '"Syne", "Space Grotesk", sans-serif',
    fontBody: '"Space Grotesk", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#050811",
    slideBg: "#0a0f1c",
    slideSurface: "#111a2e",
    cardBg: "#131f38",
    textPrimary: "#ffffff",
    textSecondary: "#94a3b8",
    textOnAccent: "#0a0f1c",
    accent: "#00ffcc",
    accentSecondary: "#ff00aa",
    borderColor: "rgba(0, 255, 204, 0.3)",
    codeBg: "#070b14",
    codeFg: "#00ffcc",
    previewSwatches: ["#0a0f1c", "#00ffcc", "#ff00aa"],
  },
  {
    id: "terminal-green",
    name: "Terminal Green",
    category: "specialty",
    isDark: true,
    vibeEn: "Developer-focused hacker console with JetBrains Mono, scanlines & phosphor green",
    vibeVi: "Phong cách kỹ sư phần mềm / Terminal với font JetBrains Mono và xanh lục phosphor",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap",
    fontDisplay: '"JetBrains Mono", monospace',
    fontBody: '"JetBrains Mono", monospace',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#06090d",
    slideBg: "#0d1117",
    slideSurface: "#161b22",
    cardBg: "#161b22",
    textPrimary: "#e6edf3",
    textSecondary: "#8b949e",
    textOnAccent: "#0d1117",
    accent: "#39d353",
    accentSecondary: "#58a6ff",
    borderColor: "rgba(57, 211, 83, 0.35)",
    codeBg: "#090c10",
    codeFg: "#39d353",
    previewSwatches: ["#0d1117", "#39d353", "#161b22"],
  },
  {
    id: "swiss-modern",
    name: "Swiss Modern",
    category: "specialty",
    isDark: false,
    vibeEn: "Bauhaus-inspired architectural grid with pure white, stark black & Swiss vermilion red",
    vibeVi: "Thiết kế Thụy Sĩ / Bauhaus chuẩn xác với đường lưới kiến trúc và điểm nhấn đỏ cam",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Archivo:wght@700;800;900&family=Nunito:wght@400;600;700&display=swap",
    fontDisplay: '"Archivo", system-ui, sans-serif',
    fontBody: '"Nunito", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#e5e5e5",
    slideBg: "#ffffff",
    slideSurface: "#f5f5f5",
    cardBg: "#ff3300",
    textPrimary: "#0a0a0a",
    textSecondary: "#525252",
    textOnAccent: "#ffffff",
    accent: "#ff3300",
    accentSecondary: "#0a0a0a",
    borderColor: "#0a0a0a",
    codeBg: "#f4f4f4",
    codeFg: "#0a0a0a",
    previewSwatches: ["#ffffff", "#0a0a0a", "#ff3300"],
  },
  {
    id: "paper-ink",
    name: "Paper & Ink",
    category: "specialty",
    isDark: false,
    vibeEn: "Literary monograph with Cormorant Garamond, warm cream paper & crimson editorial rules",
    vibeVi: "Ấn phẩm học thuật / văn chương với chữ Garamond, giấy kem và đường kẻ đỏ thẫm",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap",
    fontDisplay: '"Cormorant Garamond", Georgia, serif',
    fontBody: '"Source Serif 4", Georgia, serif',
    fontMono: '"JetBrains Mono", monospace',
    stageBg: "#e8e4dc",
    slideBg: "#faf9f7",
    slideSurface: "#f2efe9",
    cardBg: "#f2efe9",
    textPrimary: "#1a1a1a",
    textSecondary: "#57534e",
    textOnAccent: "#ffffff",
    accent: "#c41e3a",
    accentSecondary: "#8c1529",
    borderColor: "rgba(26, 26, 26, 0.22)",
    codeBg: "#f0ede6",
    codeFg: "#1a1a1a",
    previewSwatches: ["#faf9f7", "#1a1a1a", "#c41e3a"],
  },
];

const THEME_STORAGE_KEY = "wikihub:frontend-slides-theme";

export function getSavedSlideThemeId(): FrontendSlideThemeId {
  if (typeof window === "undefined") return "bold-signal";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && FRONTEND_SLIDE_THEMES.some((t) => t.id === saved)) {
      return saved as FrontendSlideThemeId;
    }
  } catch {
    // ignore storage errors
  }
  return "bold-signal";
}

export function saveSlideThemeId(id: FrontendSlideThemeId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // ignore storage errors
  }
}

export function getSlideThemeById(id: FrontendSlideThemeId): FrontendSlideTheme {
  return (
    FRONTEND_SLIDE_THEMES.find((t) => t.id === id) ?? FRONTEND_SLIDE_THEMES[0]!
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generates a zero-dependency, self-contained single HTML presentation file
 * following the exact `zarazhangrui/frontend-slides` specification (`viewport-base.css`,
 * 1920x1080 fixed stage, `.reveal` animations, keyboard/touch controller, inline editing `E`).
 */
export interface SlideDrawStroke {
  color: string;
  points: { x: number; y: number }[];
}

function renderSlideStrokesSvg(strokes: SlideDrawStroke[] | undefined): string {
  if (!strokes || strokes.length === 0) return "";
  const paths = strokes
    .filter((s) => s.points.length >= 2)
    .map((stroke) => {
      const d = stroke.points
        .map(
          (p, i) =>
            `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
        )
        .join(" ");
      return `<path d="${d}" fill="none" stroke="${escapeHtml(stroke.color)}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join("");
  if (!paths) return "";
  return `<svg class="slide-draw-overlay" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>`;
}

function renderSlideSectionHtml({
  slide,
  idx,
  totalSlides,
  title,
  spaceName,
  themeName,
  strokes,
  alwaysVisible = false,
}: {
  slide: PresentationSlide;
  idx: number;
  totalSlides: number;
  title: string;
  spaceName: string;
  themeName: string;
  strokes?: SlideDrawStroke[];
  alwaysVisible?: boolean;
}): string {
  const num = String(idx + 1).padStart(2, "0");
  const total = String(totalSlides).padStart(2, "0");
  const strokesSvg = renderSlideStrokesSvg(strokes);
  const visCls = alwaysVisible || idx === 0 ? " active visible" : "";

  if (slide.layout === "cover") {
    const labelsHtml =
      slide.bullets.length > 0
        ? `<div class="tag-row reveal">${slide.bullets
            .map((l) => `<span class="tag">#${escapeHtml(l)}</span>`)
            .join("")}</div>`
        : "";
    return `
      <!-- === SLIDE ${idx + 1}: COVER === -->
      <section class="slide title-slide${visCls}" data-index="${idx}">
        <div class="slide-inner cover-layout">
          <div class="top-meta reveal">
            <span class="slide-num">${num} / ${total}</span>
            <span class="eyebrow">${escapeHtml(slide.eyebrow || spaceName)}</span>
          </div>
          <div class="hero-block">
            <h1 class="reveal" data-editable="true">${escapeHtml(slide.title)}</h1>
            ${slide.subtitle ? `<p class="subtitle reveal" data-editable="true">${escapeHtml(slide.subtitle)}</p>` : ""}
            ${labelsHtml}
          </div>
          <div class="bottom-meta reveal">
            <span>${escapeHtml(slide.callout || spaceName)}</span>
            <span>${escapeHtml(themeName)}</span>
          </div>
        </div>
        ${strokesSvg}
      </section>`;
  }

  if (slide.layout === "section") {
    return `
      <!-- === SLIDE ${idx + 1}: SECTION === -->
      <section class="slide section-slide${alwaysVisible ? " active visible" : ""}" data-index="${idx}">
        <div class="slide-inner section-layout">
          <div class="big-section-number reveal">${num}</div>
          <span class="eyebrow reveal">${escapeHtml(slide.eyebrow || spaceName)}</span>
          <h2 class="section-heading reveal" data-editable="true">${escapeHtml(slide.title)}</h2>
          ${slide.subtitle ? `<p class="subtitle reveal" data-editable="true">${escapeHtml(slide.subtitle)}</p>` : ""}
        </div>
        ${strokesSvg}
      </section>`;
  }

  const visualsHtml = slide.visuals
    .map((v) => {
      if (v.kind === "image" && v.imageSrc) {
        return `<div class="visual-card reveal"><img src="${escapeHtml(v.imageSrc)}" alt="${escapeHtml(v.imageAlt || "")}" class="slide-image screenshot" /></div>`;
      }
      if (v.kind === "table" || v.kind === "code") {
        return `<div class="visual-card reveal">${v.html}</div>`;
      }
      if (v.kind === "mermaid" && v.mermaidCode) {
        return `<pre class="visual-card reveal"><code>${escapeHtml(v.mermaidCode)}</code></pre>`;
      }
      return "";
    })
    .join("\n");

  return `
      <!-- === SLIDE ${idx + 1}: CONTENT === -->
      <section class="slide content-slide${alwaysVisible ? " active visible" : ""}" data-index="${idx}">
        <div class="slide-inner standard-layout">
          <header class="slide-header reveal">
            <div class="header-left">
              <span class="slide-num">${num}</span>
              <div>
                <span class="eyebrow">${escapeHtml(slide.eyebrow || spaceName)}</span>
                <h2 data-editable="true">${escapeHtml(slide.title)}${slide.partTotal ? ` (${slide.partIndex}/${slide.partTotal})` : ""}</h2>
              </div>
            </div>
            <span class="page-counter">${num} / ${total}</span>
          </header>
          <div class="slide-body ${slide.layout === "split" ? "split-grid" : ""}">
            ${slide.bodyHtml ? `<div class="prose-col reveal" data-editable="true">${slide.bodyHtml}</div>` : ""}
            ${visualsHtml ? `<div class="visual-col">${visualsHtml}</div>` : ""}
          </div>
          <footer class="slide-footer">
            <span>${escapeHtml(title)}</span>
            <span>${escapeHtml(spaceName)}</span>
          </footer>
        </div>
        ${strokesSvg}
      </section>`;
}

export function generateStandaloneFrontendSlidesHtml({
  title,
  spaceName,
  slides,
  theme,
  strokesBySlide,
}: {
  title: string;
  spaceName: string;
  slides: PresentationSlide[];
  theme: FrontendSlideTheme;
  strokesBySlide?: Record<string, SlideDrawStroke[]>;
}): string {
  const slideSections = slides
    .map((slide, idx) =>
      renderSlideSectionHtml({
        slide,
        idx,
        totalSlides: slides.length,
        title,
        spaceName,
        themeName: theme.name,
        strokes: strokesBySlide?.[slide.id],
      }),
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Presentation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${theme.googleFontsUrl}">
  <style>
    /* ===========================================
       CSS CUSTOM PROPERTIES (${theme.name.toUpperCase()})
       =========================================== */
    :root {
      --stage-bg: ${theme.stageBg};
      --slide-bg: ${theme.slideBg};
      --slide-surface: ${theme.slideSurface};
      --card-bg: ${theme.cardBg};
      --text-primary: ${theme.textPrimary};
      --text-secondary: ${theme.textSecondary};
      --text-on-accent: ${theme.textOnAccent};
      --accent: ${theme.accent};
      --accent-secondary: ${theme.accentSecondary};
      --border-color: ${theme.borderColor};
      --code-bg: ${theme.codeBg};
      --code-fg: ${theme.codeFg};
      --font-display: ${theme.fontDisplay};
      --font-body: ${theme.fontBody};
      --font-mono: ${theme.fontMono};
      --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
      --duration-normal: 0.6s;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    /* ===========================================
       FIXED 16:9 STAGE: MANDATORY BASE STYLES (viewport-base.css)
       =========================================== */
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: var(--stage-bg, #000);
      font-family: var(--font-body);
      color: var(--text-primary);
    }
    .deck-viewport {
      position: fixed;
      inset: 0;
      overflow: hidden;
      background: var(--stage-bg, #000);
    }
    .deck-stage {
      position: absolute;
      left: 0;
      top: 0;
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      transform-origin: 0 0;
      background: var(--slide-bg, #fff);
    }
    .slide {
      position: absolute;
      inset: 0;
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      display: block;
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
      background: var(--slide-bg, #fff);
      color: var(--text-primary);
    }
    .slide.active, .slide.visible {
      visibility: visible;
      opacity: 1;
      pointer-events: auto;
      z-index: 1;
    }
    img, video, canvas, svg {
      max-width: 100%;
      max-height: 100%;
    }
    .slide-draw-overlay {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 20;
    }
    .deck-controls {
      position: fixed;
      left: 50%;
      bottom: 22px;
      transform: translateX(-50%);
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(15, 18, 28, 0.82);
      color: #fff;
      padding: 8px 18px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.16);
      backdrop-filter: blur(10px);
      font-size: 13px;
    }
    .deck-controls button {
      background: transparent;
      border: 0;
      color: #fff;
      cursor: pointer;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 6px;
    }
    .deck-controls button:hover {
      background: rgba(255,255,255,0.15);
    }

    /* ===========================================
       STAGGERED REVEAL ANIMATIONS
       =========================================== */
    .reveal {
      opacity: 0;
      transform: translateY(28px);
      transition: opacity var(--duration-normal) var(--ease-out-expo),
                  transform var(--duration-normal) var(--ease-out-expo);
    }
    .slide.visible .reveal {
      opacity: 1;
      transform: translateY(0);
    }
    .reveal:nth-child(1) { transition-delay: 0.08s; }
    .reveal:nth-child(2) { transition-delay: 0.16s; }
    .reveal:nth-child(3) { transition-delay: 0.24s; }
    .reveal:nth-child(4) { transition-delay: 0.32s; }

    /* ===========================================
       1920x1080 AUTHORED LAYOUTS
       =========================================== */
    .slide-inner {
      width: 1920px;
      height: 1080px;
      padding: 84px 108px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .top-meta, .bottom-meta, .slide-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 20px;
      color: var(--text-secondary);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .slide-num {
      font-family: var(--font-display);
      font-size: 38px;
      font-weight: 800;
      color: var(--accent);
    }
    .eyebrow {
      font-size: 18px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--accent);
    }
    .hero-block {
      max-width: 1520px;
      margin: auto 0;
    }
    .hero-block h1 {
      font-family: var(--font-display);
      font-size: 92px;
      line-height: 1.08;
      margin-bottom: 32px;
      color: var(--text-primary);
    }
    .subtitle {
      font-size: 34px;
      line-height: 1.45;
      color: var(--text-secondary);
      max-width: 1280px;
    }
    .tag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 36px;
    }
    .tag {
      background: var(--slide-surface);
      border: 2px solid var(--border-color);
      color: var(--text-primary);
      padding: 10px 22px;
      border-radius: 999px;
      font-size: 20px;
      font-weight: 600;
    }
    .section-layout {
      justify-content: center;
      align-items: flex-start;
    }
    .big-section-number {
      font-family: var(--font-display);
      font-size: 160px;
      line-height: 1;
      color: var(--accent);
      opacity: 0.85;
      margin-bottom: 16px;
    }
    .section-heading {
      font-family: var(--font-display);
      font-size: 84px;
      line-height: 1.1;
      margin-top: 12px;
    }
    .slide-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      border-bottom: 2px solid var(--border-color);
      padding-bottom: 26px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 28px;
    }
    .slide-header h2 {
      font-family: var(--font-display);
      font-size: 52px;
      line-height: 1.15;
      margin-top: 4px;
    }
    .page-counter {
      font-family: var(--font-mono);
      font-size: 22px;
      color: var(--text-secondary);
    }
    .slide-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 32px;
      padding: 36px 0;
      overflow: hidden;
    }
    .slide-body.split-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: center;
      gap: 56px;
    }
    .prose-col {
      font-size: 28px;
      line-height: 1.55;
      color: var(--text-primary);
    }
    .prose-col p { margin-bottom: 20px; }
    .prose-col ul, .prose-col ol { padding-left: 42px; margin-bottom: 20px; }
    .prose-col li { margin-bottom: 16px; }
    .prose-col code {
      font-family: var(--font-mono);
      background: var(--code-bg);
      color: var(--code-fg);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.88em;
    }
    .visual-card {
      background: var(--slide-surface);
      border: 2px solid var(--border-color);
      border-radius: 20px;
      padding: 28px;
      max-height: 640px;
      overflow: auto;
    }
    .visual-card table {
      width: 100%;
      border-collapse: collapse;
      font-size: 21px;
    }
    .visual-card th, .visual-card td {
      border: 1px solid var(--border-color);
      padding: 12px 16px;
      text-align: left;
    }
    .visual-card th {
      background: var(--code-bg);
      color: var(--code-fg);
      font-weight: 700;
    }

    /* Inline edit hotzone */
    .edit-hotzone {
      position: fixed; top: 0; left: 0;
      width: 80px; height: 80px;
      z-index: 10000;
      cursor: pointer;
    }
    .edit-toggle {
      position: fixed; top: 18px; left: 18px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
      z-index: 10001;
      background: var(--accent);
      color: var(--text-on-accent);
      border: 0;
      border-radius: 8px;
      padding: 8px 14px;
      font-weight: 700;
      cursor: pointer;
    }
    .edit-toggle.show, .edit-toggle.active {
      opacity: 1;
      pointer-events: auto;
    }

    @media print {
      @page { size: 1920px 1080px landscape; margin: 0; }
      html, body { width: 1920px; height: auto; overflow: visible; background: #fff; }
      .deck-viewport { position: static; overflow: visible; background: #fff; }
      .deck-stage { position: static; width: auto; height: auto; transform: none !important; background: none; }
      .slide {
        position: relative;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        width: 1920px;
        height: 1080px;
        break-after: page;
        page-break-after: always;
      }
      .slide:last-child { break-after: auto; page-break-after: auto; }
      .reveal, .slide .reveal {
        opacity: 1 !important;
        transform: none !important;
        transition: none !important;
      }
      .deck-controls, .edit-hotzone, .edit-toggle { display: none !important; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.2s !important;
      }
    }
  </style>
</head>
<body>
  <div class="edit-hotzone" id="editHotzone"></div>
  <button class="edit-toggle" id="editToggle" title="Edit mode (E)">✏️ Edit (E)</button>

  <div class="deck-viewport">
    <main class="deck-stage" id="deckStage">
      ${slideSections}
    </main>
  </div>

  <nav class="deck-controls" aria-label="Slide controls">
    <button type="button" id="prevBtn">← Prev</button>
    <span id="counterLabel">1 / ${slides.length}</span>
    <button type="button" id="nextBtn">Next →</button>
  </nav>

  <script>
    class SlidePresentation {
      constructor() {
        this.slides = Array.from(document.querySelectorAll('.slide'));
        this.currentSlide = 0;
        this.stage = document.getElementById('deckStage');
        this.counter = document.getElementById('counterLabel');
        this.editing = false;
        this.setupStageScale();
        this.setupKeyboardNav();
        this.setupTouchNav();
        this.setupEditor();
        this.showSlide(0);
      }
      setupStageScale() {
        const scale = () => {
          const factor = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
          const x = (window.innerWidth - 1920 * factor) / 2;
          const y = (window.innerHeight - 1080 * factor) / 2;
          this.stage.style.transform = \`translate(\${x}px, \${y}px) scale(\${factor})\`;
        };
        scale();
        window.addEventListener('resize', scale);
      }
      setupKeyboardNav() {
        document.getElementById('prevBtn').addEventListener('click', () => this.showSlide(this.currentSlide - 1));
        document.getElementById('nextBtn').addEventListener('click', () => this.showSlide(this.currentSlide + 1));
        window.addEventListener('keydown', (e) => {
          if (e.target.getAttribute && e.target.getAttribute('contenteditable') === 'true') return;
          if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
            e.preventDefault();
            this.showSlide(this.currentSlide + 1);
          } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault();
            this.showSlide(this.currentSlide - 1);
          } else if (e.key === 'e' || e.key === 'E') {
            this.toggleEditMode();
          }
        });
      }
      setupTouchNav() {
        let startX = 0;
        window.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
        window.addEventListener('touchend', (e) => {
          const dx = e.changedTouches[0].clientX - startX;
          if (Math.abs(dx) > 50) this.showSlide(this.currentSlide + (dx < 0 ? 1 : -1));
        }, { passive: true });
      }
      setupEditor() {
        const hotzone = document.getElementById('editHotzone');
        const toggle = document.getElementById('editToggle');
        let hideTimeout = null;
        hotzone.addEventListener('mouseenter', () => { clearTimeout(hideTimeout); toggle.classList.add('show'); });
        hotzone.addEventListener('mouseleave', () => {
          hideTimeout = setTimeout(() => { if (!this.editing) toggle.classList.remove('show'); }, 400);
        });
        toggle.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
        toggle.addEventListener('mouseleave', () => {
          hideTimeout = setTimeout(() => { if (!this.editing) toggle.classList.remove('show'); }, 400);
        });
        hotzone.addEventListener('click', () => this.toggleEditMode());
        toggle.addEventListener('click', () => this.toggleEditMode());
      }
      toggleEditMode() {
        this.editing = !this.editing;
        const toggle = document.getElementById('editToggle');
        toggle.classList.toggle('active', this.editing);
        document.querySelectorAll('[data-editable="true"]').forEach((el) => {
          el.setAttribute('contenteditable', this.editing ? 'true' : 'false');
          el.style.outline = this.editing ? '2px dashed var(--accent)' : 'none';
        });
      }
      showSlide(index) {
        this.currentSlide = Math.max(0, Math.min(index, this.slides.length - 1));
        this.slides.forEach((slide, i) => {
          slide.classList.toggle('active', i === this.currentSlide);
          slide.classList.toggle('visible', i === this.currentSlide);
        });
        this.counter.textContent = \`\${this.currentSlide + 1} / \${this.slides.length}\`;
      }
    }
    new SlidePresentation();
  </script>
</body>
</html>`;
}

/**
 * Generates the clean Audience Display HTML window for Dual-Screen Presenter View.
 * Syncs slide index, live freehand strokes, and laser pointer over BroadcastChannel.
 */
export function generateAudienceSyncHtml({
  title,
  spaceName,
  slides,
  theme,
  strokesBySlide,
  channelName,
  initialIndex = 0,
}: {
  title: string;
  spaceName: string;
  slides: PresentationSlide[];
  theme: FrontendSlideTheme;
  strokesBySlide?: Record<string, SlideDrawStroke[]>;
  channelName: string;
  initialIndex?: number;
}): string {
  const baseHtml = generateStandaloneFrontendSlidesHtml({
    title,
    spaceName,
    slides,
    theme,
    strokesBySlide,
  });

  const slideIdsJson = JSON.stringify(slides.map((s) => s.id));
  const safeChannel = JSON.stringify(channelName);

  const syncSnippet = `
  <style>
    .deck-controls {
      left: 20px !important;
      bottom: 18px !important;
      transform: none !important;
      opacity: 0;
      transition: opacity 220ms ease;
    }
    body:hover .deck-controls,
    .deck-controls:hover {
      opacity: 0.92;
    }
    .audience-laser-svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 30;
    }
  </style>
  <script>
    (function() {
      var slideIds = ${slideIdsJson};
      var slides = Array.from(document.querySelectorAll(".slide"));
      var stage = document.getElementById("deckStage");
      var channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(${safeChannel}) : null;
      var currentIdx = ${Math.max(0, initialIndex)};

      var laserSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      laserSvg.setAttribute("viewBox", "0 0 1920 1080");
      laserSvg.setAttribute("preserveAspectRatio", "none");
      laserSvg.setAttribute("class", "audience-laser-svg");
      if (stage) stage.appendChild(laserSvg);

      function renderSlideOverlay(slideEl, strokes) {
        if (!slideEl) return;
        var existing = slideEl.querySelector(".slide-draw-overlay");
        if (existing) existing.remove();
        if (!strokes || !strokes.length) return;
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "slide-draw-overlay");
        svg.setAttribute("viewBox", "0 0 1920 1080");
        svg.setAttribute("preserveAspectRatio", "none");
        strokes.forEach(function(st) {
          if (!st.points || st.points.length < 2) return;
          var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          var d = st.points.map(function(p, i) { return (i === 0 ? "M " : "L ") + p.x.toFixed(1) + " " + p.y.toFixed(1); }).join(" ");
          path.setAttribute("d", d);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", st.color || "#38bdf8");
          path.setAttribute("stroke-width", "7");
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          svg.appendChild(path);
        });
        slideEl.appendChild(svg);
      }

      function renderLaser(trail) {
        while (laserSvg.firstChild) laserSvg.removeChild(laserSvg.firstChild);
        if (!trail || trail.length < 2) return;
        var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        var d = trail.map(function(p, i) { return (i === 0 ? "M " : "L ") + p.x.toFixed(1) + " " + p.y.toFixed(1); }).join(" ");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#f43f5e");
        path.setAttribute("stroke-width", "6");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("stroke-opacity", "0.75");
        laserSvg.appendChild(path);
        var last = trail[trail.length - 1];
        if (last) {
          var c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          c.setAttribute("cx", last.x.toFixed(1));
          c.setAttribute("cy", last.y.toFixed(1));
          c.setAttribute("r", "11");
          c.setAttribute("fill", "#f43f5e");
          laserSvg.appendChild(c);
        }
      }

      function jumpTo(idx) {
        currentIdx = Math.max(0, Math.min(slides.length - 1, idx));
        slides.forEach(function(s, i) {
          s.classList.toggle("active", i === currentIdx);
          s.classList.toggle("visible", i === currentIdx);
        });
        var counter = document.getElementById("slideCounter");
        if (counter) counter.textContent = (currentIdx + 1) + " / " + slides.length;
      }

      if (currentIdx > 0) jumpTo(currentIdx);

      document.addEventListener("dblclick", function() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(function() {});
        } else {
          document.exitFullscreen && document.exitFullscreen().catch(function() {});
        }
      });

      var dock = document.querySelector(".deck-controls");
      if (dock) {
        var fsBtn = document.createElement("button");
        fsBtn.textContent = "⛶ Fullscreen";
        fsBtn.onclick = function() {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(function() {});
          } else {
            document.exitFullscreen && document.exitFullscreen().catch(function() {});
          }
        };
        dock.appendChild(fsBtn);
      }

      if (channel) {
        channel.onmessage = function(ev) {
          var msg = ev.data || {};
          if (msg.type === "goto" && typeof msg.index === "number") {
            jumpTo(msg.index);
          } else if (msg.type === "strokes" && msg.slideId) {
            var sIdx = slideIds.indexOf(msg.slideId);
            if (sIdx >= 0) renderSlideOverlay(slides[sIdx], msg.strokes);
          } else if (msg.type === "laser") {
            renderLaser(msg.trail || []);
          } else if (msg.type === "close") {
            window.close();
          }
        };
        channel.postMessage({ type: "ready" });
      }
    })();
  </script>
</body>`;

  return baseHtml.replace("</body>", syncSnippet);
}

/**
 * Generates a clean, self-contained Presenter View popup window (2nd screen)
 * with Current Slide, Next Slide, Speaker Notes (with A-/A+ zoom), Elapsed Timer,
 * Wall Clock, Prev/Next controls, and bi-directional BroadcastChannel sync to the
 * main Audience Screen.
 */
export function generatePresenterPopupHtml({
  title,
  spaceName = "",
  slides,
  customNotesBySlide,
  strokesBySlide,
  theme,
  channelName,
  initialIndex = 0,
  locale = "en",
  appTheme = "light",
  baseHref = "",
}: {
  title: string;
  spaceName?: string;
  slides: PresentationSlide[];
  customNotesBySlide?: Record<string, string>;
  strokesBySlide?: Record<string, SlideDrawStroke[]>;
  theme: FrontendSlideTheme;
  channelName: string;
  initialIndex?: number;
  locale?: string;
  appTheme?: "light" | "dark";
  baseHref?: string;
}): string {
  const vi = locale === "vi";
  const isDark = appTheme === "dark";
  const ui = isDark
    ? {
        bg: "#111318",
        surface: "#181b22",
        sunken: "#0f1116",
        text: "#f1f5f9",
        muted: "#94a3b8",
        border: "rgba(255,255,255,0.1)",
        btnBg: "#232734",
        btnHover: "#2e3446",
        btnBorder: "rgba(255,255,255,0.14)",
        noteAutoBg: "rgba(255,255,255,0.05)",
        cardShadow: "0 18px 40px rgba(0,0,0,0.4)",
      }
    : {
        bg: "#f8fafc",
        surface: "#ffffff",
        sunken: "#f1f5f9",
        text: "#0f172a",
        muted: "#64748b",
        border: "#e2e8f0",
        btnBg: "#f1f5f9",
        btnHover: "#e2e8f0",
        btnBorder: "#cbd5e1",
        noteAutoBg: "#f8fafc",
        cardShadow: "0 12px 30px rgba(15,23,42,0.10)",
      };

  const payload = JSON.stringify(
    slides.map((s, i) => ({
      index: i,
      id: s.id,
      html: renderSlideSectionHtml({
        slide: s,
        idx: i,
        totalSlides: slides.length,
        title,
        spaceName,
        themeName: theme.name,
        strokes: strokesBySlide?.[s.id],
        alwaysVisible: true,
      }),
      speakerNotes: s.speakerNotes,
      customNoteHtml: customNotesBySlide?.[s.id] || "",
    })),
  ).replace(/</g, "\\u003c");

  const safeChannel = JSON.stringify(channelName);

  return `<!DOCTYPE html>
<html lang="${vi ? "vi" : "en"}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${baseHref ? `<base href="${escapeHtml(baseHref)}" />` : ""}
  <title>${escapeHtml(vi ? "Chế độ Diễn giả" : "Presenter View")} — ${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="${theme.googleFontsUrl}" />
  <style>
    :root {
      --stage-bg: ${theme.stageBg};
      --slide-bg: ${theme.slideBg};
      --slide-surface: ${theme.slideSurface};
      --card-bg: ${theme.cardBg};
      --text-primary: ${theme.textPrimary};
      --text-secondary: ${theme.textSecondary};
      --text-on-accent: ${theme.textOnAccent};
      --accent: ${theme.accent};
      --accent-secondary: ${theme.accentSecondary};
      --border-color: ${theme.borderColor};
      --code-bg: ${theme.codeBg};
      --code-fg: ${theme.codeFg};
      --font-display: ${theme.fontDisplay};
      --font-body: ${theme.fontBody};
      --font-mono: ${theme.fontMono};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: ${ui.bg};
      color: ${ui.text};
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      height: 52px;
      background: ${ui.surface};
      border-bottom: 1px solid ${ui.border};
      padding: 0 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-shrink: 0;
    }
    .hdr-title { font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 8px; min-width: 0; }
    .hdr-sub { color: ${ui.muted}; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .timer-pill {
      display: flex; align-items: center; gap: 10px;
      background: ${ui.sunken}; border: 1px solid ${ui.border};
      padding: 4px 12px; border-radius: 8px; font-family: ui-monospace, monospace; font-size: 13px;
    }
    .btn {
      border: 1px solid ${ui.btnBorder};
      background: ${ui.btnBg}; color: ${ui.text};
      border-radius: 7px; padding: 6px 12px; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: background 140ms ease;
    }
    .btn:hover { background: ${ui.btnHover}; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-danger { background: rgba(244,63,94,0.12); border-color: rgba(244,63,94,0.35); color: #e11d48; }
    .btn-danger:hover { background: #e11d48; border-color: #e11d48; color: #fff; }
    .btn-icon { padding: 4px 8px; font-size: 11px; }
    main {
      flex: 1; min-height: 0;
      display: grid; grid-template-columns: 1.35fr 1fr;
      overflow: hidden;
    }
    .left-pane {
      display: flex; flex-direction: column;
      border-right: 1px solid ${ui.border};
      padding: 18px; gap: 14px; min-height: 0;
    }
    .right-pane {
      display: flex; flex-direction: column;
      background: ${ui.surface};
      min-height: 0; overflow: hidden;
    }
    .label {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: ${ui.muted};
      display: flex; align-items: center; justify-content: space-between;
    }
    .slide-card {
      position: relative;
      aspect-ratio: 16 / 9;
      width: 100%;
      border-radius: 12px;
      border: 1px solid ${ui.border};
      background: var(--slide-bg);
      color: var(--text-primary);
      overflow: hidden;
      box-shadow: ${ui.cardShadow};
    }
    .slide-card.mini { box-shadow: none; cursor: pointer; }
    .mini-stage {
      position: absolute;
      left: 0;
      top: 0;
      width: 1920px;
      height: 1080px;
      transform-origin: 0 0;
      pointer-events: none;
      font-family: var(--font-body);
      color: var(--text-primary);
      background: var(--slide-bg);
    }
    .mini-empty {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${ui.muted};
      font-size: 13px;
      background: ${ui.sunken};
    }
    /* Exact 1920x1080 slide styles so Current & Next Slide match the Audience Screen */
    .mini-stage .slide {
      position: relative;
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      display: block;
      visibility: visible;
      opacity: 1;
      background: var(--slide-bg, #fff);
      color: var(--text-primary);
    }
    .mini-stage .reveal {
      opacity: 1 !important;
      transform: none !important;
    }
    .mini-stage img, .mini-stage video, .mini-stage canvas, .mini-stage svg {
      max-width: 100%;
      max-height: 100%;
    }
    .mini-stage .slide-draw-overlay {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 20;
    }
    .mini-stage .slide-inner {
      width: 1920px;
      height: 1080px;
      padding: 84px 108px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .mini-stage .top-meta, .mini-stage .bottom-meta, .mini-stage .slide-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 20px;
      color: var(--text-secondary);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .mini-stage .slide-num {
      font-family: var(--font-display);
      font-size: 38px;
      font-weight: 800;
      color: var(--accent);
    }
    .mini-stage .eyebrow {
      font-size: 18px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--accent);
    }
    .mini-stage .hero-block {
      max-width: 1520px;
      margin: auto 0;
    }
    .mini-stage .hero-block h1 {
      font-family: var(--font-display);
      font-size: 92px;
      line-height: 1.08;
      margin-bottom: 32px;
      color: var(--text-primary);
    }
    .mini-stage .subtitle {
      font-size: 34px;
      line-height: 1.45;
      color: var(--text-secondary);
      max-width: 1280px;
    }
    .mini-stage .tag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 36px;
    }
    .mini-stage .tag {
      background: var(--slide-surface);
      border: 2px solid var(--border-color);
      color: var(--text-primary);
      padding: 10px 22px;
      border-radius: 999px;
      font-size: 20px;
      font-weight: 600;
    }
    .mini-stage .section-layout {
      justify-content: center;
      align-items: flex-start;
    }
    .mini-stage .big-section-number {
      font-family: var(--font-display);
      font-size: 160px;
      line-height: 1;
      color: var(--accent);
      opacity: 0.85;
      margin-bottom: 16px;
    }
    .mini-stage .section-heading {
      font-family: var(--font-display);
      font-size: 84px;
      line-height: 1.1;
      margin-top: 12px;
    }
    .mini-stage .slide-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      border-bottom: 2px solid var(--border-color);
      padding-bottom: 26px;
    }
    .mini-stage .header-left {
      display: flex;
      align-items: center;
      gap: 28px;
    }
    .mini-stage .slide-header h2 {
      font-family: var(--font-display);
      font-size: 52px;
      line-height: 1.15;
      margin-top: 4px;
    }
    .mini-stage .page-counter {
      font-family: var(--font-mono);
      font-size: 22px;
      color: var(--text-secondary);
    }
    .mini-stage .slide-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 32px;
      padding: 36px 0;
      overflow: hidden;
    }
    .mini-stage .slide-body.split-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: center;
      gap: 56px;
    }
    .mini-stage .prose-col {
      font-size: 28px;
      line-height: 1.55;
      color: var(--text-primary);
    }
    .mini-stage .prose-col p { margin-bottom: 20px; }
    .mini-stage .prose-col ul, .mini-stage .prose-col ol { padding-left: 42px; margin-bottom: 20px; }
    .mini-stage .prose-col li { margin-bottom: 16px; }
    .mini-stage .prose-col code {
      font-family: var(--font-mono);
      background: var(--code-bg);
      color: var(--code-fg);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.88em;
    }
    .mini-stage .visual-card {
      background: var(--slide-surface);
      border: 2px solid var(--border-color);
      border-radius: 20px;
      padding: 28px;
      max-height: 640px;
      overflow: hidden;
    }
    .mini-stage .visual-card table {
      width: 100%;
      border-collapse: collapse;
      font-size: 21px;
    }
    .mini-stage .visual-card th, .mini-stage .visual-card td {
      border: 1px solid var(--border-color);
      padding: 12px 16px;
      text-align: left;
    }
    .mini-stage .visual-card th {
      background: var(--code-bg);
      color: var(--code-fg);
      font-weight: 700;
    }
    .nav-row {
      margin-top: auto;
      display: flex; align-items: center; justify-content: center; gap: 14px;
      padding-top: 6px;
    }
    .next-box { padding: 16px 18px; border-bottom: 1px solid ${ui.border}; }
    .notes-box { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 16px 18px; gap: 10px; }
    .notes-scroll {
      flex: 1; min-height: 0; overflow-y: auto;
      background: ${ui.sunken}; border: 1px solid ${ui.border};
      border-radius: 10px; padding: 14px 16px; line-height: 1.6;
    }
    .notes-scroll ul { padding-left: 20px; margin: 6px 0; }
    .notes-scroll ol { padding-left: 20px; margin: 6px 0; }
    .note-auto {
      background: ${ui.noteAutoBg}; border-left: 3px solid var(--accent);
      padding: 8px 12px; border-radius: 0 6px 6px 0; margin-bottom: 10px;
    }
    .empty-notes { color: ${ui.muted}; font-style: italic; }
  </style>
</head>
<body>
  <header>
    <div class="hdr-title">
      <span>${escapeHtml(vi ? "Chế độ Diễn giả" : "Presenter View")}</span>
      <span class="hdr-sub">— ${escapeHtml(title)}</span>
    </div>
    <div class="timer-pill">
      <span id="elapsed">00:00</span>
      <button type="button" class="btn btn-icon" id="toggleTimer">${vi ? "Tạm dừng" : "Pause"}</button>
      <button type="button" class="btn btn-icon" id="resetTimer">↺</button>
      <span style="opacity:0.35">|</span>
      <span id="clock">--:--</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <button type="button" class="btn" id="fsBtn" title="${escapeHtml(vi ? "Toàn màn hình (F)" : "Fullscreen (F)")}">⛶ ${escapeHtml(vi ? "Toàn màn hình" : "Fullscreen")}</button>
      <button type="button" class="btn btn-danger" id="endBtn">${escapeHtml(vi ? "Kết thúc trình chiếu" : "End Slide Show")}</button>
    </div>
  </header>

  <main>
    <section class="left-pane">
      <div class="label">
        <span>${escapeHtml(vi ? "Slide đang chiếu" : "Current Slide")}</span>
        <span id="counter">1 / ${slides.length}</span>
      </div>
      <div class="slide-card" id="currentCard"></div>
      <div class="nav-row">
        <button type="button" class="btn" id="prevBtn">◀ ${escapeHtml(vi ? "Trước" : "Prev")}</button>
        <span id="counterBottom" style="font-family:ui-monospace,monospace;font-size:13px;min-width:72px;text-align:center;">1 / ${slides.length}</span>
        <button type="button" class="btn btn-primary" id="nextBtn">${escapeHtml(vi ? "Tiếp" : "Next")} ▶</button>
      </div>
    </section>

    <aside class="right-pane">
      <div class="next-box">
        <div class="label" style="margin-bottom:8px;">
          <span>${escapeHtml(vi ? "Slide tiếp theo" : "Next Slide")}</span>
          <span id="nextCounter"></span>
        </div>
        <div class="slide-card mini" id="nextCard"></div>
      </div>
      <div class="notes-box">
        <div class="label">
          <span>${escapeHtml(vi ? "Ghi chú diễn giả" : "Speaker Notes")}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <button type="button" class="btn btn-icon" id="fontDown">A−</button>
            <span id="fontVal" style="font-family:ui-monospace,monospace;font-size:11px;">15px</span>
            <button type="button" class="btn btn-icon" id="fontUp">A+</button>
          </div>
        </div>
        <div class="notes-scroll" id="notesContent" style="font-size:15px;"></div>
      </div>
    </aside>
  </main>

  <script>
    (function() {
      var slides = ${payload};
      var strokesBySlideId = {};
      var idx = ${Math.max(0, Math.min(slides.length - 1, initialIndex))};
      var fontSize = 15;
      var elapsed = 0;
      var running = true;
      var channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(${safeChannel}) : null;
      var currentCard = document.getElementById("currentCard");
      var nextCard = document.getElementById("nextCard");

      function esc(s) {
        return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      }

      function applyScale(cardEl) {
        if (!cardEl) return;
        var stage = cardEl.querySelector(".mini-stage");
        if (!stage) return;
        var w = cardEl.clientWidth;
        if (w > 0) {
          stage.style.transform = "scale(" + (w / 1920) + ")";
        }
      }

      function applyLiveStrokes(cardEl, slideId) {
        if (!cardEl || !slideId || !(slideId in strokesBySlideId)) return;
        var slideEl = cardEl.querySelector(".slide");
        if (!slideEl) return;
        var existing = slideEl.querySelector(".slide-draw-overlay");
        if (existing) existing.remove();
        var strokes = strokesBySlideId[slideId];
        if (!strokes || !strokes.length) return;
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "slide-draw-overlay");
        svg.setAttribute("viewBox", "0 0 1920 1080");
        svg.setAttribute("preserveAspectRatio", "none");
        strokes.forEach(function(st) {
          if (!st.points || st.points.length < 2) return;
          var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          var d = st.points.map(function(p, i) { return (i === 0 ? "M " : "L ") + p.x.toFixed(1) + " " + p.y.toFixed(1); }).join(" ");
          path.setAttribute("d", d);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", st.color || "#38bdf8");
          path.setAttribute("stroke-width", "7");
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          svg.appendChild(path);
        });
        slideEl.appendChild(svg);
      }

      function renderCard(el, slide) {
        if (!slide) {
          el.innerHTML = '<div class="mini-empty">${escapeHtml(vi ? "Hết bài thuyết trình" : "End of presentation")}</div>';
          return;
        }
        el.innerHTML = '<div class="mini-stage">' + slide.html + '</div>';
        applyLiveStrokes(el, slide.id);
        applyScale(el);
      }

      function render() {
        var cur = slides[idx];
        var next = slides[idx + 1] || null;
        renderCard(currentCard, cur);
        renderCard(nextCard, next);
        document.getElementById("counter").textContent = (idx + 1) + " / " + slides.length;
        document.getElementById("counterBottom").textContent = (idx + 1) + " / " + slides.length;
        document.getElementById("nextCounter").textContent = next ? (idx + 2) + " / " + slides.length : "";
        document.getElementById("prevBtn").disabled = idx <= 0;
        document.getElementById("nextBtn").disabled = idx >= slides.length - 1;

        var notesEl = document.getElementById("notesContent");
        var html = "";
        if (cur && cur.speakerNotes && cur.speakerNotes.length) {
          html += cur.speakerNotes.map(function(n) { return '<div class="note-auto">' + esc(n) + '</div>'; }).join("");
        }
        if (cur && cur.customNoteHtml) {
          html += '<div>' + cur.customNoteHtml + '</div>';
        }
        notesEl.innerHTML = html || '<p class="empty-notes">${escapeHtml(vi ? "Không có ghi chú cho slide này." : "No notes for this slide.")}</p>';
      }

      if (typeof ResizeObserver !== "undefined") {
        var ro = new ResizeObserver(function() {
          applyScale(currentCard);
          applyScale(nextCard);
        });
        ro.observe(currentCard);
        ro.observe(nextCard);
      }
      window.addEventListener("resize", function() {
        applyScale(currentCard);
        applyScale(nextCard);
      });

      function goTo(nextIdx, broadcast) {
        idx = Math.max(0, Math.min(slides.length - 1, nextIdx));
        render();
        if (broadcast && channel) channel.postMessage({ type: "goto", index: idx });
      }

      document.getElementById("prevBtn").onclick = function() { goTo(idx - 1, true); };
      document.getElementById("nextBtn").onclick = function() { goTo(idx + 1, true); };
      nextCard.onclick = function() { if (idx < slides.length - 1) goTo(idx + 1, true); };
      document.getElementById("endBtn").onclick = function() {
        if (channel) channel.postMessage({ type: "end" });
        window.close();
      };
      var fsBtn = document.getElementById("fsBtn");
      function togglePopupFs() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(function() {});
        } else {
          document.exitFullscreen && document.exitFullscreen().catch(function() {});
        }
      }
      if (fsBtn) {
        fsBtn.onclick = togglePopupFs;
        document.addEventListener("fullscreenchange", function() {
          fsBtn.textContent = document.fullscreenElement
            ? "⤢ " + ${JSON.stringify(vi ? "Thu nhỏ" : "Exit Fullscreen")}
            : "⛶ " + ${JSON.stringify(vi ? "Toàn màn hình" : "Fullscreen")};
        });
      }
      document.getElementById("fontDown").onclick = function() {
        fontSize = Math.max(11, fontSize - 2);
        document.getElementById("notesContent").style.fontSize = fontSize + "px";
        document.getElementById("fontVal").textContent = fontSize + "px";
      };
      document.getElementById("fontUp").onclick = function() {
        fontSize = Math.min(28, fontSize + 2);
        document.getElementById("notesContent").style.fontSize = fontSize + "px";
        document.getElementById("fontVal").textContent = fontSize + "px";
      };
      document.getElementById("toggleTimer").onclick = function() {
        running = !running;
        this.textContent = running ? ${JSON.stringify(vi ? "Tạm dừng" : "Pause")} : ${JSON.stringify(vi ? "Tiếp tục" : "Resume")};
      };
      document.getElementById("resetTimer").onclick = function() {
        elapsed = 0;
        document.getElementById("elapsed").textContent = "00:00";
      };

      document.addEventListener("keydown", function(e) {
        if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) {
          e.preventDefault(); goTo(idx + 1, true);
        } else if (e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) {
          e.preventDefault(); goTo(idx - 1, true);
        } else if (e.key === "Escape") {
          if (channel) channel.postMessage({ type: "end" });
          window.close();
        }
      });

      function tickClock() {
        var now = new Date();
        document.getElementById("clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
      tickClock();
      setInterval(function() {
        if (running) {
          elapsed++;
          var m = String(Math.floor(elapsed / 60)).padStart(2, "0");
          var s = String(elapsed % 60).padStart(2, "0");
          document.getElementById("elapsed").textContent = m + ":" + s;
        }
        tickClock();
      }, 1000);

      if (channel) {
        channel.onmessage = function(ev) {
          var msg = ev.data || {};
          if (msg.type === "goto" && typeof msg.index === "number") {
            goTo(msg.index, false);
          } else if (msg.type === "strokes" && msg.slideId) {
            strokesBySlideId[msg.slideId] = msg.strokes || [];
            var cur = slides[idx];
            var next = slides[idx + 1] || null;
            if (cur && cur.id === msg.slideId) applyLiveStrokes(currentCard, cur.id);
            if (next && next.id === msg.slideId) applyLiveStrokes(nextCard, next.id);
          } else if (msg.type === "close") {
            window.close();
          }
        };
        channel.postMessage({ type: "ready" });
      }

      render();
    })();
  </script>
</body>
</html>`;
}
