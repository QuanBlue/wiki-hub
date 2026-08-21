/**
 * Font presets for WikiHub documentation pages.
 *
 * All fonts are bundled at build time with `next/font/google` so they work
 * completely offline on air-gapped instances with zero external CDN network requests.
 */

export interface FontPreset {
  id: string;
  name: string;
  category: "Sans-Serif" | "Serif";
  description: string;
  variable: string;
  cssFamily: string;
  sampleQuote: string;
}

export const FONT_PRESETS: FontPreset[] = [
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
    category: "Sans-Serif",
    description: "Contemporary, elegant neo-grotesque with clean geometric rhythm",
    variable: "--font-plus-jakarta-sans",
    cssFamily: "var(--font-plus-jakarta-sans), 'Plus Jakarta Sans', sans-serif",
    sampleQuote: "Sophisticated modern aesthetics for forward-thinking team wikis.",
  },
  {
    id: "outfit",
    name: "Outfit",
    category: "Sans-Serif",
    description: "Futuristic, geometric sans-serif with distinct character",
    variable: "--font-outfit",
    cssFamily: "var(--font-outfit), Outfit, sans-serif",
    sampleQuote: "Distinctive geometric typography for product architecture docs.",
  },
  {
    id: "montserrat",
    name: "Montserrat",
    category: "Sans-Serif",
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
    category: "Sans-Serif",
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
];

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
