export interface ThemeColorPreset {
  id: string;
  name: string;
  primary: string;
  palette: {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
  };
}

export const THEME_COLOR_PRESETS: ThemeColorPreset[] = [
  {
    id: "blue",
    name: "WikiHub Blue",
    primary: "#216fc0",
    palette: {
      50: "#edf6ff",
      100: "#d8ecff",
      200: "#b7dcff",
      300: "#8ac8ff",
      400: "#59adf3",
      500: "#2d88db",
      600: "#216fc0",
      700: "#1d579b",
      800: "#1d487e",
      900: "#1c3b65",
    },
  },
  {
    id: "emerald",
    name: "Emerald Green",
    primary: "#16a34a",
    palette: {
      50: "#f0fdf4",
      100: "#dcfce7",
      200: "#bbf7d0",
      300: "#86efac",
      400: "#4ade80",
      500: "#22c55e",
      600: "#16a34a",
      700: "#15803d",
      800: "#166534",
      900: "#14532d",
    },
  },
  {
    id: "indigo",
    name: "Modern Indigo",
    primary: "#4f46e5",
    palette: {
      50: "#eef2ff",
      100: "#e0e7ff",
      200: "#c7d2fe",
      300: "#a5b4fc",
      400: "#818cf8",
      500: "#6366f1",
      600: "#4f46e5",
      700: "#4338ca",
      800: "#3730a3",
      900: "#312e81",
    },
  },
  {
    id: "violet",
    name: "Royal Violet",
    primary: "#7c3aed",
    palette: {
      50: "#f5f3ff",
      100: "#ede9fe",
      200: "#ddd6fe",
      300: "#c4b5fd",
      400: "#a78bfa",
      500: "#8b5cf6",
      600: "#7c3aed",
      700: "#6d28d9",
      800: "#5b21b6",
      900: "#4c1d95",
    },
  },
  {
    id: "rose",
    name: "Ruby Rose",
    primary: "#e11d48",
    palette: {
      50: "#fff1f2",
      100: "#ffe4e6",
      200: "#fecdd3",
      300: "#fda4af",
      400: "#fb7185",
      500: "#f43f5e",
      600: "#e11d48",
      700: "#be123c",
      800: "#9f1239",
      900: "#881337",
    },
  },
  {
    id: "amber",
    name: "Warm Amber",
    primary: "#d97706",
    palette: {
      50: "#fffbeb",
      100: "#fef3c7",
      200: "#fde68a",
      300: "#fcd34d",
      400: "#fbbf24",
      500: "#f59e0b",
      600: "#d97706",
      700: "#b45309",
      800: "#92400e",
      900: "#78350f",
    },
  },
  {
    id: "teal",
    name: "Ocean Teal",
    primary: "#0d9488",
    palette: {
      50: "#f0fdfa",
      100: "#ccfbf1",
      200: "#99f6e4",
      300: "#5eead4",
      400: "#2dd4bf",
      500: "#14b8a6",
      600: "#0d9488",
      700: "#0f766e",
      800: "#115e59",
      900: "#134e4a",
    },
  },
  {
    id: "slate",
    name: "Minimal Slate",
    primary: "#475569",
    palette: {
      50: "#f8fafc",
      100: "#f1f5f9",
      200: "#e2e8f0",
      300: "#cbd5e1",
      400: "#94a3b8",
      500: "#64748b",
      600: "#475569",
      700: "#334155",
      800: "#1e293b",
      900: "#0f172a",
    },
  },
];

export interface LogoIconPreset {
  id: string;
  name: string;
  description: string;
}

export const LOGO_ICON_PRESETS: LogoIconPreset[] = [
  { id: "default", name: "WikiHub Hub", description: "Standard 3-layer knowledge hub" },
  { id: "book", name: "Knowledge Book", description: "Documentation & handbook" },
  { id: "layers", name: "Stacked Layers", description: "Architecture & systems" },
  { id: "compass", name: "Compass", description: "Guides & exploration" },
  { id: "sparkles", name: "Sparkles", description: "Intelligence & discovery" },
  { id: "feather", name: "Feather Quill", description: "Writing & publishing" },
  { id: "hub", name: "Network Mesh", description: "Connected teams & notes" },
  { id: "graduation", name: "Academy Cap", description: "Learning & education" },
  { id: "cpu", name: "Tech Core", description: "Engineering & software" },
  { id: "shield", name: "Shield", description: "Security & governance" },
];

/** Convert any hex string into an approximate 10-shade palette */
export function generatePaletteFromHex(hex: string): ThemeColorPreset["palette"] {
  const cleanHex = hex.replace(/^#/, "").trim();
  const num = parseInt(cleanHex.length === 3 ? cleanHex.split("").map((c) => c + c).join("") : cleanHex, 16);
  if (isNaN(num)) return THEME_COLOR_PRESETS[0].palette;

  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  const mix = (r2: number, g2: number, b2: number, weight: number) => {
    const w = Math.max(0, Math.min(1, weight));
    const nr = Math.round(r * w + r2 * (1 - w));
    const ng = Math.round(g * w + g2 * (1 - w));
    const nb = Math.round(b * w + b2 * (1 - w));
    return `#${((1 << 24) + (nr << 16) + (ng << 8) + nb).toString(16).slice(1)}`;
  };

  return {
    50: mix(255, 255, 255, 0.08),
    100: mix(255, 255, 255, 0.18),
    200: mix(255, 255, 255, 0.35),
    300: mix(255, 255, 255, 0.55),
    400: mix(255, 255, 255, 0.75),
    500: `#${cleanHex.padStart(6, "0")}`,
    600: mix(0, 0, 0, 0.85),
    700: mix(0, 0, 0, 0.7),
    800: mix(0, 0, 0, 0.5),
    900: mix(0, 0, 0, 0.35),
  };
}

export function getPresetOrCustomPalette(themeColor: string | null | undefined): ThemeColorPreset["palette"] {
  if (!themeColor) return THEME_COLOR_PRESETS[0].palette;
  const match = THEME_COLOR_PRESETS.find((p) => p.id === themeColor.toLowerCase());
  if (match) return match.palette;
  if (themeColor.startsWith("#")) {
    return generatePaletteFromHex(themeColor);
  }
  return THEME_COLOR_PRESETS[0].palette;
}

export function generateFaviconSvg(icon: string, primaryColor: string): string {
  const bg = primaryColor || "#216fc0";
  let inner = "";

  switch (icon) {
    case "book":
      inner = `<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H11v15H6.5A2.5 2.5 0 0 0 4 21.5V6.5Z" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 6.5A2.5 2.5 0 0 0 17.5 4H13v15h4.5A2.5 2.5 0 0 1 20 21.5V6.5Z" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case "layers":
      inner = `<polygon points="12 4 4 8 12 12 20 8 12 4" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="4 12 12 16 20 12" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="4 16 12 20 20 16" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case "compass":
      inner = `<circle cx="12" cy="12" r="8" fill="none" stroke="#ffffff" stroke-width="1.8"/><polygon points="14.5 9.5 13 14.5 9.5 14.5 11 9.5 14.5 9.5" fill="#ffffff"/>`;
      break;
    case "sparkles":
      inner = `<path d="m12 4-1.8 5.4a1.8 1.8 0 0 1-1.2 1.2L4 12.4l5 1.8a1.8 1.8 0 0 1 1.2 1.2l1.8 5 1.8-5a1.8 1.8 0 0 1 1.2-1.2l5-1.8-5-1.8a1.8 1.8 0 0 1-1.2-1.2L12 4Z" fill="#ffffff"/>`;
      break;
    case "feather":
      inner = `<path d="M19 5a4 4 0 0 0-5.66 0L5 13.34V19h5.66l8.34-8.34A4 4 0 0 0 19 5Z" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><line x1="15" y1="9" x2="6" y2="18" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>`;
      break;
    case "hub":
      inner = `<circle cx="12" cy="6" r="2.2" fill="#ffffff"/><circle cx="6" cy="17" r="2.2" fill="#ffffff"/><circle cx="18" cy="17" r="2.2" fill="#ffffff"/><path d="M12 8.5v3.5m0 0L7.5 15.5m4.5-3.5 4.5 3.5" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>`;
      break;
    case "graduation":
      inner = `<path d="M21 9.5 12 5 3 9.5 12 14l9-4.5Z" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11.5v4.5c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/><path d="M21 9.5v5" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>`;
      break;
    case "cpu":
      inner = `<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="none" stroke="#ffffff" stroke-width="1.8"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>`;
      break;
    case "shield":
      inner = `<path d="M12 3.5 5 6.5v5.5c0 5 3.5 8.5 7 10 3.5-1.5 7-5 7-10V6.5L12 3.5Z" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="9 12 11 14 15 10" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    default:
      inner = `<path d="M6 8.5 12 5.5l6 3-6 3-6-3Z" fill="#ffffff" fill-opacity="0.95"/><path d="m6 12 6 3 6-3" stroke="#ffffff" stroke-opacity="0.75" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="m6 15.5 6 3 6-3" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><rect width="24" height="24" rx="5" fill="${bg}"/>${inner}</svg>`;
}

/**
 * Scales down an image / data URI to an optimized 64x64 PNG data URL that browsers reliably render on tab bar favicons.
 */
export function createFaviconDataUrl(src: string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(src);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.clearRect(0, 0, 64, 64);
        const hRatio = 64 / img.width;
        const vRatio = 64 / img.height;
        const ratio = Math.min(hRatio, vRatio);
        const centerShiftX = (64 - img.width * ratio) / 2;
        const centerShiftY = (64 - img.height * ratio) / 2;
        ctx.drawImage(
          img,
          0,
          0,
          img.width,
          img.height,
          centerShiftX,
          centerShiftY,
          img.width * ratio,
          img.height * ratio,
        );
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

/**
 * Renders any icon preset or custom logo to an optimized 64x64 PNG data URL that Chromium/Firefox tab bars accept 100% reliably.
 */
export function renderFaviconPngDataUrl(
  icon: string,
  primaryColor: string,
  customLogoUrl?: string | null,
): Promise<string> {
  if (customLogoUrl) {
    return createFaviconDataUrl(customLogoUrl);
  }
  const svg = generateFaviconSvg(icon, primaryColor);
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return createFaviconDataUrl(svgDataUrl);
}
