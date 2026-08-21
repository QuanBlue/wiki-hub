"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getFontFamilyCss } from "@/lib/font-presets";
import {
  getPresetOrCustomPalette,
  renderFaviconPngDataUrl,
} from "@/lib/theme-presets";
import type { InstanceInfo } from "@/types/api";

interface ThemeSettingsContextValue {
  siteName: string;
  themeColor: string;
  defaultFont: string;
  logoIcon: string;
  customLogoUrl: string | null;
  setSiteName: (name: string) => void;
  setThemeColor: (color: string) => void;
  setDefaultFont: (font: string) => void;
  setLogoIcon: (icon: string) => void;
  setCustomLogoUrl: (url: string | null) => void;
}

const ThemeSettingsContext = createContext<ThemeSettingsContextValue>({
  siteName: "WikiHub",
  themeColor: "blue",
  defaultFont: "inter",
  logoIcon: "default",
  customLogoUrl: null,
  setSiteName: () => {},
  setThemeColor: () => {},
  setDefaultFont: () => {},
  setLogoIcon: () => {},
  setCustomLogoUrl: () => {},
});

export function useThemeSettings() {
  return useContext(ThemeSettingsContext);
}

export function ThemeColorProvider({
  initialSiteName = "WikiHub",
  initialThemeColor = "blue",
  initialDefaultFont = "inter",
  initialLogoIcon = "default",
  initialCustomLogoUrl = null,
  children,
}: {
  initialSiteName?: string;
  initialThemeColor?: string;
  initialDefaultFont?: string;
  initialLogoIcon?: string;
  initialCustomLogoUrl?: string | null;
  children: ReactNode;
}) {
  const [siteName, setSiteNameState] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("wikihub:site-name");
      if (stored) return stored;
    }
    return initialSiteName;
  });

  const [themeColor, setThemeColorState] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("wikihub:theme-color");
      if (stored) return stored;
    }
    return initialThemeColor;
  });

  const [defaultFont, setDefaultFontState] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("wikihub:default-font");
      if (stored) return stored;
    }
    return initialDefaultFont;
  });

  const [logoIcon, setLogoIconState] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("wikihub:logo-icon");
      if (stored) return stored;
    }
    return initialLogoIcon;
  });

  const [customLogoUrl, setCustomLogoUrlState] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("wikihub:custom-logo-url");
      if (stored) return stored;
    }
    return initialCustomLogoUrl;
  });

  const setSiteName = (name: string) => {
    const nextName = name.trim() || "WikiHub";
    setSiteNameState(nextName);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("wikihub:site-name", nextName);
      document.cookie = `wikihub_site_name=${encodeURIComponent(nextName)}; path=/; max-age=31536000; SameSite=Lax`;
    }
  };

  const setThemeColor = (color: string) => {
    setThemeColorState(color);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("wikihub:theme-color", color);
      document.cookie = `wikihub_theme_color=${encodeURIComponent(color)}; path=/; max-age=31536000; SameSite=Lax`;
    }
  };

  const setDefaultFont = (font: string) => {
    setDefaultFontState(font);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("wikihub:default-font", font);
      document.cookie = `wikihub_default_font=${encodeURIComponent(font)}; path=/; max-age=31536000; SameSite=Lax`;
    }
  };

  const setLogoIcon = (icon: string) => {
    setLogoIconState(icon);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("wikihub:logo-icon", icon);
      document.cookie = `wikihub_logo_icon=${encodeURIComponent(icon)}; path=/; max-age=31536000; SameSite=Lax`;
    }
  };

  const setCustomLogoUrl = (url: string | null) => {
    setCustomLogoUrlState(url);
    if (typeof window !== "undefined") {
      if (url) {
        window.localStorage.setItem("wikihub:custom-logo-url", url);
      } else {
        window.localStorage.removeItem("wikihub:custom-logo-url");
      }
    }
  };

  const palette = useMemo(
    () => getPresetOrCustomPalette(themeColor),
    [themeColor],
  );

  // Sync state if props change from server
  useEffect(() => {
    if (initialSiteName) setSiteNameState(initialSiteName);
  }, [initialSiteName]);

  useEffect(() => {
    if (initialThemeColor) setThemeColorState(initialThemeColor);
  }, [initialThemeColor]);

  useEffect(() => {
    if (initialDefaultFont) setDefaultFontState(initialDefaultFont);
  }, [initialDefaultFont]);

  useEffect(() => {
    if (initialLogoIcon) setLogoIconState(initialLogoIcon);
  }, [initialLogoIcon]);

  useEffect(() => {
    setCustomLogoUrlState(initialCustomLogoUrl);
  }, [initialCustomLogoUrl]);

  // Fetch meta on mount to ensure cache is updated with latest server state
  useEffect(() => {
    let active = true;
    fetch("/api/v1/meta")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: InstanceInfo | null) => {
        if (!active || !data) return;
        if (data.site_name) {
          setSiteNameState(data.site_name);
          window.localStorage.setItem("wikihub:site-name", data.site_name);
          document.cookie = `wikihub_site_name=${encodeURIComponent(data.site_name)}; path=/; max-age=31536000; SameSite=Lax`;
        }
        if (data.theme_color) {
          setThemeColorState(data.theme_color);
          window.localStorage.setItem("wikihub:theme-color", data.theme_color);
          document.cookie = `wikihub_theme_color=${encodeURIComponent(data.theme_color)}; path=/; max-age=31536000; SameSite=Lax`;
        }
        if (data.default_font) {
          setDefaultFontState(data.default_font);
          window.localStorage.setItem("wikihub:default-font", data.default_font);
          document.cookie = `wikihub_default_font=${encodeURIComponent(data.default_font)}; path=/; max-age=31536000; SameSite=Lax`;
        }
        if (data.logo_icon) {
          setLogoIconState(data.logo_icon);
          window.localStorage.setItem("wikihub:logo-icon", data.logo_icon);
          document.cookie = `wikihub_logo_icon=${encodeURIComponent(data.logo_icon)}; path=/; max-age=31536000; SameSite=Lax`;
        }
        if (data.custom_logo_url !== undefined) {
          setCustomLogoUrlState(data.custom_logo_url);
          if (data.custom_logo_url) {
            window.localStorage.setItem("wikihub:custom-logo-url", data.custom_logo_url);
          } else {
            window.localStorage.removeItem("wikihub:custom-logo-url");
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Dynamically update CSS font variable on root
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--wh-page-font", getFontFamilyCss(defaultFont));
  }, [defaultFont]);

  // Dynamically update CSS variables on root
  useEffect(() => {
    const root = document.documentElement;
    const isCustom = themeColor !== "blue";

    if (!isCustom) {
      root.style.removeProperty("--wh-brand-50");
      root.style.removeProperty("--wh-brand-100");
      root.style.removeProperty("--wh-brand-200");
      root.style.removeProperty("--wh-brand-300");
      root.style.removeProperty("--wh-brand-400");
      root.style.removeProperty("--wh-brand-500");
      root.style.removeProperty("--wh-brand-600");
      root.style.removeProperty("--wh-brand-700");
      root.style.removeProperty("--wh-brand-800");
      root.style.removeProperty("--wh-brand-900");
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-hover");
      root.style.removeProperty("--primary-subtle");
      root.style.removeProperty("--surface-selected");
      root.style.removeProperty("--ring");
      return;
    }

    root.style.setProperty("--wh-brand-50", palette[50]);
    root.style.setProperty("--wh-brand-100", palette[100]);
    root.style.setProperty("--wh-brand-200", palette[200]);
    root.style.setProperty("--wh-brand-300", palette[300]);
    root.style.setProperty("--wh-brand-400", palette[400]);
    root.style.setProperty("--wh-brand-500", palette[500]);
    root.style.setProperty("--wh-brand-600", palette[600]);
    root.style.setProperty("--wh-brand-700", palette[700]);
    root.style.setProperty("--wh-brand-800", palette[800]);
    root.style.setProperty("--wh-brand-900", palette[900]);

    // Apply active primary theme values
    const isDark = root.classList.contains("dark");
    if (isDark) {
      root.style.setProperty("--primary", palette[400]);
      root.style.setProperty("--primary-hover", palette[300]);
      root.style.setProperty(
        "--primary-subtle",
        `color-mix(in oklab, ${palette[500]} 18%, transparent)`,
      );
      root.style.setProperty(
        "--surface-selected",
        `color-mix(in oklab, ${palette[500]} 22%, transparent)`,
      );
      root.style.setProperty("--ring", palette[400]);
    } else {
      root.style.setProperty("--primary", palette[600]);
      root.style.setProperty("--primary-hover", palette[700]);
      root.style.setProperty("--primary-subtle", palette[50]);
      root.style.setProperty("--surface-selected", palette[50]);
      root.style.setProperty("--ring", palette[500]);
    }
  }, [themeColor, palette]);

  // Observer to re-apply light/dark variations on dark mode toggle
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const root = document.documentElement;
      if (themeColor === "blue") return;
      const isDark = root.classList.contains("dark");
      if (isDark) {
        root.style.setProperty("--primary", palette[400]);
        root.style.setProperty("--primary-hover", palette[300]);
        root.style.setProperty(
          "--primary-subtle",
          `color-mix(in oklab, ${palette[500]} 18%, transparent)`,
        );
        root.style.setProperty(
          "--surface-selected",
          `color-mix(in oklab, ${palette[500]} 22%, transparent)`,
        );
        root.style.setProperty("--ring", palette[400]);
      } else {
        root.style.setProperty("--primary", palette[600]);
        root.style.setProperty("--primary-hover", palette[700]);
        root.style.setProperty("--primary-subtle", palette[50]);
        root.style.setProperty("--surface-selected", palette[50]);
        root.style.setProperty("--ring", palette[500]);
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [themeColor, palette]);

  // Update dynamic browser tab favicon safely in-place
  useEffect(() => {
    if (typeof document === "undefined") return;

    let cancelled = false;

    const applyFavicon = async () => {
      const primaryColor = palette[600] || "#216fc0";
      const pngHref = await renderFaviconPngDataUrl(
        logoIcon,
        primaryColor,
        customLogoUrl,
      );

      if (cancelled) return;

      // Safely update or create the favicon link element without detaching nodes
      let link =
        document.querySelector<HTMLLinkElement>("link#dynamic-favicon") ||
        document.querySelector<HTMLLinkElement>("link[rel~='icon']");

      if (!link) {
        link = document.createElement("link");
        link.id = "dynamic-favicon";
        link.rel = "icon";
        document.head.appendChild(link);
      }

      link.type = "image/png";
      link.href = pngHref;

      const shortcut = document.querySelector<HTMLLinkElement>(
        "link[rel='shortcut icon']",
      );
      if (shortcut) {
        shortcut.type = "image/png";
        shortcut.href = pngHref;
      }
    };

    void applyFavicon();

    return () => {
      cancelled = true;
    };
  }, [themeColor, logoIcon, customLogoUrl, palette]);

  const value = useMemo(
    () => ({
      siteName,
      themeColor,
      defaultFont,
      logoIcon,
      customLogoUrl,
      setSiteName,
      setThemeColor,
      setDefaultFont,
      setLogoIcon,
      setCustomLogoUrl,
    }),
    [siteName, themeColor, defaultFont, logoIcon, customLogoUrl],
  );

  return (
    <ThemeSettingsContext.Provider value={value}>
      {children}
    </ThemeSettingsContext.Provider>
  );
}
