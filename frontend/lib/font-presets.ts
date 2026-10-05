/**
 * Font presets for WikiHub documentation pages.
 *
 * All fonts are bundled at build time with `next/font/google` so they work
 * completely offline on air-gapped instances with zero external CDN network requests.
 */

/**
 * What a typeface looks like, coarsely - used to keep similar fonts together
 * and to filter the picker. "Sans-Serif" is the neutral and humanist text
 * faces; "Geometric Sans" the round, circle-and-line display-leaning ones.
 */
export type FontCategory = "Sans-Serif" | "Geometric Sans" | "Serif";

/** The order groups appear in, which is also the order of the filter chips. */
export const FONT_CATEGORIES: FontCategory[] = ["Sans-Serif", "Geometric Sans", "Serif"];

export interface FontPreset {
  id: string;
  name: string;
  category: FontCategory;
  description: string;
  variable: string;
  cssFamily: string;
  sampleQuote: string;
}

const RAW_FONT_PRESETS: FontPreset[] = [
  {
    id: "inter",
    name: "Inter",
    category: "Sans-Serif",
    description: "Modern, highly-legible default UI & documentation typeface",
    variable: "--font-inter",
    cssFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    sampleQuote: "Clean clarity for modern engineering documentation and runbooks.",
  },
  {
    id: "roboto",
    name: "Roboto",
    category: "Sans-Serif",
    description: "Versatile, geometric yet friendly neo-grotesque sans",
    variable: "--font-roboto",
    cssFamily: "var(--font-roboto), Roboto, -apple-system, BlinkMacSystemFont, sans-serif",
    sampleQuote: "Crisp neutral proportions ideal for technical specifications.",
  },
  {
    id: "open-sans",
    name: "Open Sans",
    category: "Sans-Serif",
    description: "Warm, open sans-serif optimized for comfortable long-form reading",
    variable: "--font-open-sans",
    cssFamily: "var(--font-open-sans), 'Open Sans', -apple-system, sans-serif",
    sampleQuote: "Friendly letterforms designed for high readability across screens.",
  },
  {
    id: "plus-jakarta-sans",
    name: "Plus Jakarta Sans",
    category: "Geometric Sans",
    description: "Contemporary, elegant neo-grotesque with clean geometric rhythm",
    variable: "--font-plus-jakarta-sans",
    cssFamily: "var(--font-plus-jakarta-sans), 'Plus Jakarta Sans', sans-serif",
    sampleQuote: "Sophisticated modern aesthetics for forward-thinking team wikis.",
  },
  {
    id: "outfit",
    name: "Outfit",
    category: "Geometric Sans",
    description: "Futuristic, geometric sans-serif with distinct character",
    variable: "--font-outfit",
    cssFamily: "var(--font-outfit), Outfit, sans-serif",
    sampleQuote: "Distinctive geometric typography for product architecture docs.",
  },
  {
    id: "montserrat",
    name: "Montserrat",
    category: "Geometric Sans",
    description: "Urban-inspired geometric sans with structured presence",
    variable: "--font-montserrat",
    cssFamily: "var(--font-montserrat), Montserrat, sans-serif",
    sampleQuote: "Bold and structured headings with balanced body paragraphs.",
  },
  {
    id: "source-sans-3",
    name: "Source Sans 3",
    category: "Sans-Serif",
    description: "Adobe's workhorse typeface engineered for UI and digital guides",
    variable: "--font-source-sans-3",
    cssFamily: "var(--font-source-sans-3), 'Source Sans 3', sans-serif",
    sampleQuote: "Designed specifically for user interfaces and corporate knowledge bases.",
  },
  {
    id: "nunito",
    name: "Nunito",
    category: "Sans-Serif",
    description: "Rounded, friendly sans-serif offering a soft and welcoming reading experience",
    variable: "--font-nunito",
    cssFamily: "var(--font-nunito), Nunito, sans-serif",
    sampleQuote: "Approachable and clear design for team handbooks and onboarding guides.",
  },
  {
    id: "poppins",
    name: "Poppins",
    category: "Geometric Sans",
    description: "Geometric sans-serif with pure curves and balanced visual weight",
    variable: "--font-poppins",
    cssFamily: "var(--font-poppins), Poppins, sans-serif",
    sampleQuote: "Balanced geometric curves giving pages a vibrant, polished look.",
  },
  {
    id: "lora",
    name: "Lora",
    category: "Serif",
    description: "Contemporary serif with brushed curves, perfect for narrative text",
    variable: "--font-lora",
    cssFamily: "var(--font-lora), Lora, Georgia, serif",
    sampleQuote: "Literary elegance for architectural decision records and essays.",
  },
  {
    id: "merriweather",
    name: "Merriweather",
    category: "Serif",
    description: "High-contrast editorial serif engineered for prolonged screen reading",
    variable: "--font-merriweather",
    cssFamily: "var(--font-merriweather), Merriweather, Georgia, serif",
    sampleQuote: "Deeply comfortable reading measure for extensive technical manuals.",
  },
  {
    id: "playfair-display",
    name: "Playfair Display",
    category: "Serif",
    description: "Classic editorial high-contrast serif with refined aesthetic",
    variable: "--font-playfair-display",
    cssFamily: "var(--font-playfair-display), 'Playfair Display', Georgia, serif",
    sampleQuote: "Distinguished editorial styling for formal executive overviews.",
  },
  {
    id: "lato",
    name: "Lato",
    category: "Sans-Serif",
    description: "Warm, stable humanist sans with a friendly, professional tone",
    variable: "--font-lato",
    cssFamily: "var(--font-lato), 'Lato', sans-serif",
    sampleQuote: "Balanced and approachable for everyday team documentation.",
  },
  {
    id: "noto-sans",
    name: "Noto Sans",
    category: "Sans-Serif",
    description: "Neutral, wide-coverage sans designed for consistent multilingual text",
    variable: "--font-noto-sans",
    cssFamily: "var(--font-noto-sans), 'Noto Sans', sans-serif",
    sampleQuote: "Consistent letterforms across every language your team writes in.",
  },
  {
    id: "work-sans",
    name: "Work Sans",
    category: "Sans-Serif",
    description: "Grotesque sans tuned for on-screen text at body sizes",
    variable: "--font-work-sans",
    cssFamily: "var(--font-work-sans), 'Work Sans', sans-serif",
    sampleQuote: "Sturdy, readable text for process guides and checklists.",
  },
  {
    id: "dm-sans",
    name: "DM Sans",
    category: "Geometric Sans",
    description: "Low-contrast geometric sans with a clean, modern feel",
    variable: "--font-dm-sans",
    cssFamily: "var(--font-dm-sans), 'DM Sans', sans-serif",
    sampleQuote: "Minimal geometry that keeps dense pages calm and scannable.",
  },
  {
    id: "ibm-plex-sans",
    name: "IBM Plex Sans",
    category: "Sans-Serif",
    description: "Engineered corporate sans with a distinct technical character",
    variable: "--font-ibm-plex-sans",
    cssFamily: "var(--font-ibm-plex-sans), 'IBM Plex Sans', sans-serif",
    sampleQuote: "A precise voice for engineering handbooks and API references.",
  },
  {
    id: "manrope",
    name: "Manrope",
    category: "Geometric Sans",
    description: "Modern semi-condensed sans with excellent numeral clarity",
    variable: "--font-manrope",
    cssFamily: "var(--font-manrope), 'Manrope', sans-serif",
    sampleQuote: "Sharp, contemporary text for dashboards, specs and reports.",
  },
  {
    id: "rubik",
    name: "Rubik",
    category: "Sans-Serif",
    description: "Slightly rounded sans with a confident, friendly presence",
    variable: "--font-rubik",
    cssFamily: "var(--font-rubik), 'Rubik', sans-serif",
    sampleQuote: "Soft corners that make long guides feel welcoming.",
  },
  {
    id: "raleway",
    name: "Raleway",
    category: "Geometric Sans",
    description: "Elegant, light-touch sans with refined proportions",
    variable: "--font-raleway",
    cssFamily: "var(--font-raleway), 'Raleway', sans-serif",
    sampleQuote: "Graceful, airy typography for polished knowledge bases.",
  },
  {
    id: "source-serif-4",
    name: "Source Serif 4",
    category: "Serif",
    description: "Adobe's transitional serif made for sustained on-screen reading",
    variable: "--font-source-serif-4",
    cssFamily: "var(--font-source-serif-4), 'Source Serif 4', Georgia, serif",
    sampleQuote: "Quiet, bookish rhythm for long-form articles and policies.",
  },
  {
    id: "noto-serif",
    name: "Noto Serif",
    category: "Serif",
    description: "Neutral, wide-coverage serif that pairs well with multilingual content",
    variable: "--font-noto-serif",
    cssFamily: "var(--font-noto-serif), 'Noto Serif', Georgia, serif",
    sampleQuote: "Dependable serif text across scripts and languages.",
  },
  {
    id: "pt-serif",
    name: "PT Serif",
    category: "Serif",
    description: "Transitional serif with sturdy, humanist details",
    variable: "--font-pt-serif",
    cssFamily: "var(--font-pt-serif), 'PT Serif', Georgia, serif",
    sampleQuote: "Classic readability for manuals, reports and documentation.",
  },
  {
    id: "crimson-pro",
    name: "Crimson Pro",
    category: "Serif",
    description: "Old-style serif inspired by classic book typography",
    variable: "--font-crimson-pro",
    cssFamily: "var(--font-crimson-pro), 'Crimson Pro', Georgia, serif",
    sampleQuote: "A refined, literary tone for essays and decision records.",
  },
];

/**
 * Every preset, similar ones together: grouped by category in
 * `FONT_CATEGORIES` order, and in the order written above within a group (so
 * Inter, the default, still leads the list).
 */
export const FONT_PRESETS: FontPreset[] = FONT_CATEGORIES.flatMap((category) =>
  RAW_FONT_PRESETS.filter((preset) => preset.category === category),
);

export const DEFAULT_FONT_ID = "inter";

export function getFontPreset(fontId?: string | null): FontPreset {
  if (!fontId) return FONT_PRESETS[0];
  const normalized = fontId.trim().toLowerCase();
  return (
    FONT_PRESETS.find(
      (f) =>
        f.id === normalized ||
        f.name.toLowerCase() === normalized ||
        f.id.replace(/-/g, "") === normalized.replace(/-/g, ""),
    ) || FONT_PRESETS[0]
  );
}

export function getFontFamilyCss(fontId?: string | null): string {
  return getFontPreset(fontId).cssFamily;
}
