"use client";

import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Bookmark,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Compass,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  Feather,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  GraduationCap,
  HelpCircle,
  ImagePlus,
  Info,
  Layers,
  Loader2,
  Moon,
  MoreHorizontal,
  Network,
  Palette,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Terminal,
  Trash2,
  Type,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useState,
  useRef,
  type FormEvent,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { toast } from "sonner";

import { LogoMark, Wordmark } from "@/components/brand/logo";
import { useThemeSettings } from "@/components/theme-color-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FontSpecimenModal } from "@/components/admin/font-specimen-modal";
import { api, ApiError } from "@/lib/api-client";
import {
  FONT_PRESETS,
  type FontPreset,
  getFontFamilyCss,
  getFontPreset,
} from "@/lib/font-presets";
import {
  LOGO_ICON_PRESETS,
  THEME_COLOR_PRESETS,
  getPresetOrCustomPalette,
} from "@/lib/theme-presets";
import { cn } from "@/lib/utils";
import type { AppRole, SidebarPermissions, SiteSettings } from "@/types/api";

const LOGO_ICON_MAP: Record<string, LucideIcon> = {
  default: Layers,
  book: BookOpen,
  layers: Layers,
  compass: Compass,
  sparkles: Sparkles,
  feather: Feather,
  hub: Network,
  graduation: GraduationCap,
  cpu: Cpu,
  shield: ShieldCheck,
};

const NAVIGATION_ITEMS: Array<{
  key: keyof SidebarPermissions;
  label: string;
  description: string;
  fixed?: boolean;
}> = [
  { key: "home", label: "Home", description: "Workspace overview" },
  { key: "spaces", label: "Spaces", description: "Browse team knowledge" },
  { key: "recent", label: "Recent", description: "Recently updated spaces" },
  {
    key: "settings",
    label: "Settings",
    description: "Instance configuration",
    fixed: true,
  },
  {
    key: "backups",
    label: "Backups",
    description: "Export and restore data",
    fixed: true,
  },
];

const ROLE_OPTIONS: Array<{ value: AppRole; label: string }> = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

const SETTINGS_TABS: Array<{
  id: "appearance" | "general" | "sidebar";
  label: string;
  icon: LucideIcon;
}> = [
  { id: "appearance", label: "Theme & Branding", icon: Palette },
  { id: "general", label: "General workspace", icon: SlidersHorizontal },
  { id: "sidebar", label: "Sidebar access", icon: ShieldCheck },
];

export function SiteSettingsForm({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const themeContext = useThemeSettings();

  // Settings states
  const [siteName, setSiteName] = useState(settings.overrides.site_name ?? "");
  const [themeColor, setThemeColor] = useState(
    settings.overrides.theme_color ?? settings.effective.theme_color ?? "blue",
  );
  const [isCustomHex, setIsCustomHex] = useState(
    Boolean(
      (settings.overrides.theme_color || settings.effective.theme_color) &&
        (settings.overrides.theme_color || settings.effective.theme_color).startsWith("#"),
    ),
  );
  const [customHex, setCustomHex] = useState(
    (settings.overrides.theme_color || settings.effective.theme_color)?.startsWith("#")
      ? (settings.overrides.theme_color || settings.effective.theme_color)
      : "#216fc0",
  );

  const [defaultFont, setDefaultFont] = useState(
    settings.overrides.default_font ?? settings.effective.default_font ?? "inter",
  );
  const [logoIcon, setLogoIcon] = useState(
    settings.overrides.logo_icon ?? settings.effective.logo_icon ?? "default",
  );
  const [customLogoUrl, setCustomLogoUrl] = useState<string | null>(
    settings.overrides.custom_logo_url ?? settings.effective.custom_logo_url ?? null,
  );

  const [sessionTtlHours, setSessionTtlHours] = useState(
    settings.overrides.session_ttl_hours?.toString() ?? "",
  );
  const [sidebarPermissions, setSidebarPermissions] =
    useState<SidebarPermissions>(settings.effective.sidebar_permissions);
  const [activeTab, setActiveTab] = useState<
    "appearance" | "general" | "sidebar"
  >("appearance");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Interactive Modal Preview states
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [specimenModalFont, setSpecimenModalFont] = useState<FontPreset | null>(null);
  const [previewDarkMode, setPreviewDarkMode] = useState(false);
  const [mockNavTab, setMockNavTab] = useState<"spaces" | "recent" | "settings">("spaces");
  const [mockContentTab, setMockContentTab] = useState<"overview" | "spec" | "endpoints">("overview");
  const [mockSearch, setMockSearch] = useState("");
  const [mockStarred, setMockStarred] = useState(false);
  const [mockBookmarked, setMockBookmarked] = useState(true);
  const [mockChecked, setMockChecked] = useState(true);
  const [mockRadio, setMockRadio] = useState("option1");
  const [mockToggle, setMockToggle] = useState(true);
  const [mockActiveTag, setMockActiveTag] = useState("Engineering");
  const [copiedShade, setCopiedShade] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleColorPresetSelect = (id: string) => {
    setIsCustomHex(false);
    setThemeColor(id);
  };

  const handleCustomHexChange = (hex: string) => {
    setIsCustomHex(true);
    setCustomHex(hex);
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      setThemeColor(hex);
    }
  };

  const handleIconSelect = (iconId: string) => {
    setLogoIcon(iconId);
    setCustomLogoUrl(null);
  };

  const handleLogoFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo image size must be under 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setCustomLogoUrl(dataUrl);
      toast.success("Logo image loaded.");
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveCustomLogo = () => {
    setCustomLogoUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  async function save(payload: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const updated = await api.patch<SiteSettings>("/api/v1/settings", payload);
      if (updated?.effective) {
        themeContext.setSiteName(updated.effective.site_name || "WikiHub");
        themeContext.setThemeColor(updated.effective.theme_color || "blue");
        themeContext.setDefaultFont(updated.effective.default_font || "inter");
        themeContext.setLogoIcon(updated.effective.logo_icon || "default");
        themeContext.setCustomLogoUrl(updated.effective.custom_logo_url || null);
      }
      toast.success("Settings saved successfully.");
      setPreviewModalOpen(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not save the settings.",
      );
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const effectiveThemeColor = isCustomHex ? customHex.trim() : themeColor;
    void save({
      site_name: siteName.trim() || null,
      theme_color:
        effectiveThemeColor === "blue" && !settings.overrides.theme_color
          ? null
          : effectiveThemeColor || null,
      default_font:
        defaultFont === "inter" && !settings.overrides.default_font
          ? null
          : defaultFont || null,
      logo_icon:
        logoIcon === "default" && !settings.overrides.logo_icon
          ? null
          : logoIcon || null,
      custom_logo_url: customLogoUrl || null,
      sidebar_permissions: sidebarPermissions,
      session_ttl_hours: sessionTtlHours.trim()
        ? Number(sessionTtlHours)
        : null,
    });
  }

  function toggleNavigationRole(
    item: keyof SidebarPermissions,
    role: AppRole,
    checked: boolean,
  ) {
    setSidebarPermissions((current) => {
      const roles = current[item] || [];
      if (!checked && roles.length === 1) return current;
      return {
        ...current,
        [item]: checked
          ? [...roles, role]
          : roles.filter((candidate) => candidate !== role),
      };
    });
  }

  const inheritedTag = (overridden: boolean) =>
    overridden ? null : (
      <span className="text-muted-foreground text-[11px] font-normal italic">
        (inherited from environment)
      </span>
    );

  const initialThemeColor =
    settings.overrides.theme_color ?? settings.effective.theme_color ?? "blue";
  const initialDefaultFont =
    settings.overrides.default_font ?? settings.effective.default_font ?? "inter";
  const initialLogoIcon =
    settings.overrides.logo_icon ?? settings.effective.logo_icon ?? "default";
  const initialCustomLogoUrl =
    settings.overrides.custom_logo_url ?? settings.effective.custom_logo_url ?? null;

  const initialSiteName = settings.overrides.site_name ?? "";
  const initialSessionTtl = settings.overrides.session_ttl_hours?.toString() ?? "";

  const initialSidebarPermissions = settings.overrides.sidebar_permissions ?? settings.effective.sidebar_permissions;

  const effectiveDisplayName = siteName.trim() || settings.effective.site_name;
  const effectiveDraftColor = isCustomHex ? customHex.trim() : themeColor;
  const previewPalette = getPresetOrCustomPalette(effectiveDraftColor);

  const isThemeChanged =
    effectiveDraftColor !== initialThemeColor ||
    defaultFont !== initialDefaultFont ||
    logoIcon !== initialLogoIcon ||
    customLogoUrl !== initialCustomLogoUrl;

  const isGeneralChanged =
    siteName.trim() !== initialSiteName.trim() ||
    sessionTtlHours.trim() !== initialSessionTtl.trim();

  const isSidebarChanged =
    JSON.stringify(sidebarPermissions) !== JSON.stringify(initialSidebarPermissions);

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside
            role="tablist"
            aria-label="Instance settings"
            className="border-border border-r pr-5 lg:sticky lg:top-24"
          >
            <p className="text-muted-foreground px-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
              Settings sections
            </p>
            <div className="mt-3 space-y-1">
              {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
                const selected = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveTab(id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                      selected
                        ? "bg-surface-selected text-primary font-semibold hover:bg-surface-hover focus-visible:ring-ring"
                        : "text-muted-foreground font-normal hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="border-border text-muted-foreground mt-5 border-t px-2 pt-4 text-xs leading-relaxed">
              Changes apply immediately across the entire workspace after saving.
            </p>
          </aside>

          <div className="min-w-0 space-y-6">
            {/* Card 0: Theme & Branding Settings */}
            <section
              id="appearance-settings"
              role="tabpanel"
              className={cn(
                "border-border bg-surface rounded-xl border shadow-sm",
                activeTab !== "appearance" && "hidden",
              )}
            >
              {/* Sticky Header with Action & Save Buttons - Flush with TopBar */}
              <div className="border-border bg-surface/98 backdrop-blur-md sticky top-topbar z-20 flex flex-wrap items-center justify-between gap-3 border-b -mt-px -mx-px px-6 py-3.5 rounded-t-xl transition-all shadow-xs">
                <div className="flex items-center gap-2.5">
                  <Palette className="text-primary size-5 shrink-0" />
                  <div>
                    <h3 className="text-foreground font-semibold text-sm sm:text-base">
                      Theme &amp; Branding
                    </h3>
                    <p className="text-muted-foreground mt-0.5 text-xs hidden sm:block">
                      Customize brand theme color, application logo icon, and visual appearance.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => setPreviewModalOpen(true)}
                  >
                    <Eye className="size-3.5" />
                    Preview Theme
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8"
                    disabled={
                      pending ||
                      (!isThemeChanged &&
                        themeColor === "blue" &&
                        defaultFont === "inter" &&
                        logoIcon === "default" &&
                        !customLogoUrl)
                    }
                    onClick={() => {
                      handleColorPresetSelect("blue");
                      setDefaultFont("inter");
                      handleIconSelect("default");
                      handleRemoveCustomLogo();
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                    Reset Theme
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    className="text-xs h-8 font-semibold shadow-xs gap-1.5"
                    disabled={pending || !isThemeChanged}
                  >
                    {pending ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="size-3.5" />
                        Save Theme
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Theme Color Palettes */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">
                      Brand Theme Color
                    </Label>
                    {inheritedTag(settings.overrides.theme_color !== null)}
                  </div>
                <p className="text-muted-foreground text-xs">
                  Select a curated color palette or specify a custom brand color.
                </p>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {THEME_COLOR_PRESETS.map((preset) => {
                    const isSelected = !isCustomHex && themeColor === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleColorPresetSelect(preset.id)}
                        className={cn(
                          "hover:border-border-strong relative flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-left transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none",
                          isSelected
                            ? "border-primary ring-primary/20 bg-surface-selected ring-2"
                            : "border-border bg-surface",
                        )}
                      >
                        <span
                          className="size-5 shrink-0 rounded-full shadow-xs"
                          style={{ backgroundColor: preset.primary }}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "truncate text-xs",
                              isSelected
                                ? "font-semibold text-foreground"
                                : "font-normal text-muted-foreground",
                            )}
                          >
                            {preset.name}
                          </p>
                        </div>
                        {isSelected ? (
                          <Check className="text-primary size-4 shrink-0" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Hex Color Picker */}
                <div className="border-border bg-surface-sunken/60 mt-3 flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      id="theme-hex-picker"
                      value={customHex.startsWith("#") ? customHex : "#216fc0"}
                      onChange={(e) => handleCustomHexChange(e.target.value)}
                      className="size-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
                      title="Choose custom color"
                    />
                    <Label
                      htmlFor="theme-hex-input"
                      className="text-xs font-medium cursor-pointer"
                    >
                      Custom Hex Color:
                    </Label>
                  </div>
                  <Input
                    id="theme-hex-input"
                    value={customHex}
                    onChange={(e) => handleCustomHexChange(e.target.value)}
                    placeholder="#216fc0"
                    className="h-8 w-28 font-mono text-xs"
                    maxLength={7}
                  />
                  {isCustomHex ? (
                    <span className="text-primary text-xs font-medium">
                      (Custom hex active)
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Application Logo & Icon Selection */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">
                    Application Logo &amp; Icon
                  </Label>
                  {inheritedTag(
                    settings.overrides.logo_icon !== null ||
                      settings.overrides.custom_logo_url !== null,
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  Pick a built-in icon mark or upload your team&apos;s custom logo image / SVG.
                </p>

                {/* Preset Icons */}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  {LOGO_ICON_PRESETS.map((iconPreset) => {
                    const isSelected =
                      !customLogoUrl && logoIcon === iconPreset.id;
                    return (
                      <button
                        key={iconPreset.id}
                        type="button"
                        onClick={() => handleIconSelect(iconPreset.id)}
                        className={cn(
                          "hover:border-border-strong flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-3 text-center transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none",
                          isSelected
                            ? "border-primary ring-primary/20 bg-surface-selected ring-2"
                            : "border-border bg-surface",
                        )}
                      >
                        <LogoMark
                          icon={iconPreset.id}
                          customLogoUrl={null}
                          className="size-7"
                        />
                        <span
                          className={cn(
                            "truncate text-xs",
                            isSelected
                              ? "font-semibold text-foreground"
                              : "font-normal text-muted-foreground",
                          )}
                        >
                          {iconPreset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Custom Image Upload */}
                <div className="border-border bg-surface-sunken/60 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3.5">
                  <div className="flex items-center gap-3">
                    {customLogoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={customLogoUrl}
                        alt="Custom logo preview"
                        className="size-9 rounded border border-border object-contain bg-surface p-0.5"
                      />
                    ) : (
                      <div className="flex size-9 items-center justify-center rounded border border-dashed border-border bg-surface text-muted-foreground">
                        <ImagePlus className="size-4" />
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {customLogoUrl
                          ? "Custom Logo Uploaded"
                          : "Upload custom logo image / SVG"}
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        PNG, SVG, or JPG under 2MB. Replaces the icon mark across header and login.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/svg+xml,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={handleLogoFileUpload}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImagePlus className="size-3.5" />
                      {customLogoUrl ? "Change logo" : "Upload image"}
                    </Button>
                    {customLogoUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveCustomLogo}
                        className="text-danger hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="size-3.5" />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>

                {/* Global Page Typography Selector */}
                <div className="space-y-3 pt-6 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-semibold flex items-center gap-2">
                        <Type className="size-4 text-primary" />
                        Page Typography & Font Family
                      </Label>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        Choose the default typeface for pages across all spaces. Space owners can also override this per space.
                      </p>
                    </div>
                    {inheritedTag(settings.overrides.default_font !== null)}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {FONT_PRESETS.map((preset) => {
                      const isSelected = defaultFont === preset.id;
                      return (
                        <div
                          key={preset.id}
                          onClick={() => setDefaultFont(preset.id)}
                          className={cn(
                            "relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring select-none",
                            isSelected
                              ? "border-primary ring-2 ring-primary/20 bg-surface-selected/80 shadow-xs"
                              : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover/60",
                          )}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setDefaultFont(preset.id);
                            }
                          }}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="text-foreground text-sm font-semibold truncate"
                                style={{ fontFamily: preset.cssFamily }}
                              >
                                {preset.name}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSpecimenModalFont(preset);
                                  }}
                                  className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                                  title={`Inspect ${preset.name} specimen`}
                                  aria-label={`Inspect ${preset.name} font specimen`}
                                >
                                  <Eye className="size-3.5" />
                                </button>
                                <span className="text-[10px] uppercase font-medium tracking-wider px-1.5 py-0.5 rounded-full bg-surface-sunken border border-border/60 text-muted-foreground">
                                  {preset.category}
                                </span>
                                {isSelected ? (
                                  <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
                                    <Check className="size-2.5 stroke-[3]" />
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <p className="text-muted-foreground text-[11px] mt-1 line-clamp-2 leading-relaxed">
                              {preset.description}
                            </p>
                          </div>

                          <div
                            className="mt-3 pt-2.5 border-t border-border/50 text-foreground/90 text-xs font-normal truncate"
                            style={{ fontFamily: preset.cssFamily }}
                          >
                            {preset.sampleQuote}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-muted-foreground text-[11px] flex items-center gap-1.5 pt-1">
                    <Info className="size-3.5 text-primary shrink-0" />
                    Code blocks, inline code, and syntax highlighting strictly retain monospace typography (JetBrains Mono).
                  </p>
                </div>
              </div>
            </div>
          </section>

            {/* Card 1: General Workspace Settings */}
            <section
              id="general-settings"
              role="tabpanel"
              className={cn(
                "border-border bg-surface rounded-xl border shadow-sm",
                activeTab !== "general" && "hidden",
              )}
            >
              {/* Sticky Header with Action & Save Buttons */}
              <div className="border-border bg-surface/98 backdrop-blur-md sticky top-topbar z-20 flex flex-wrap items-center justify-between gap-3 border-b -mt-px -mx-px px-6 py-3.5 rounded-t-xl transition-all shadow-xs">
                <div className="flex items-center gap-2.5">
                  <SlidersHorizontal className="text-primary size-5 shrink-0" />
                  <div>
                    <h3 className="text-foreground font-semibold text-sm sm:text-base">
                      General Workspace
                    </h3>
                    <p className="text-muted-foreground mt-0.5 text-xs hidden sm:block">
                      Identity and session behaviour for this instance.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8"
                    disabled={pending || (!isGeneralChanged && !siteName && !sessionTtlHours)}
                    onClick={() => {
                      setSiteName("");
                      setSessionTtlHours("");
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                    Reset General
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    className="text-xs h-8 font-semibold shadow-xs gap-1.5"
                    disabled={pending || !isGeneralChanged}
                  >
                    {pending ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="size-3.5" />
                        Save General
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  {/* Site Name */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="site-name" className="text-sm font-semibold">
                        Site Name
                      </Label>
                      {inheritedTag(settings.overrides.site_name !== null)}
                    </div>
                    <Input
                      id="site-name"
                      value={siteName}
                      onChange={(e) => setSiteName(e.target.value)}
                      placeholder={settings.effective.site_name}
                      disabled={pending}
                      className="text-sm"
                    />
                    <p className="text-muted-foreground text-[11px]">
                      Currently showing as{" "}
                      <strong className="text-foreground">
                        {settings.effective.site_name}
                      </strong>
                      . Leave empty for default.
                    </p>
                  </div>

                  {/* Session Lifetime */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="session-ttl-hours"
                        className="text-sm font-semibold"
                      >
                        Session Lifetime (hours)
                      </Label>
                      {inheritedTag(settings.overrides.session_ttl_hours !== null)}
                    </div>
                    <Input
                      id="session-ttl-hours"
                      type="number"
                      min={1}
                      max={8760}
                      value={sessionTtlHours}
                      onChange={(e) => setSessionTtlHours(e.target.value)}
                      placeholder={
                        settings.effective.session_ttl_hours
                          ? String(settings.effective.session_ttl_hours)
                          : "12"
                      }
                      disabled={pending}
                      className="text-sm"
                    />
                    <p className="text-muted-foreground text-[11px]">
                      Duration of user sessions before re-authentication is required.
                      Default: 12h.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Card 3: Sidebar Access Matrix */}
            <section
              id="sidebar-settings"
              role="tabpanel"
              className={cn(
                "border-border bg-surface rounded-xl border shadow-sm",
                activeTab !== "sidebar" && "hidden",
              )}
            >
              {/* Sticky Header with Action & Save Buttons */}
              <div className="border-border bg-surface/98 backdrop-blur-md sticky top-topbar z-20 flex flex-wrap items-center justify-between gap-3 border-b -mt-px -mx-px px-6 py-3.5 rounded-t-xl transition-all shadow-xs">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="text-primary size-5 shrink-0" />
                  <div>
                    <h3 className="text-foreground font-semibold text-sm sm:text-base">
                      Sidebar Access Matrix
                    </h3>
                    <p className="text-muted-foreground mt-0.5 text-xs hidden sm:block">
                      Determine which user roles see specific application navigation links.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8"
                    disabled={pending || !isSidebarChanged}
                    onClick={() => {
                      setSidebarPermissions(settings.effective.sidebar_permissions);
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                    Reset Sidebar
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    className="text-xs h-8 font-semibold shadow-xs gap-1.5"
                    disabled={pending || !isSidebarChanged}
                  >
                    {pending ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="size-3.5" />
                        Save Sidebar
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="divide-border border-border divide-y rounded-lg border text-sm">
                  <div className="bg-surface-sunken text-muted-foreground flex items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wider">
                    <span>Navigation Item</span>
                    <div className="flex gap-6 pr-2">
                      {ROLE_OPTIONS.map((r) => (
                        <span key={r.value} className="w-20 text-center">
                          {r.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {NAVIGATION_ITEMS.map((item) => {
                    const allowedRoles = sidebarPermissions[item.key] || [];
                    return (
                      <div
                        key={item.key}
                        className="hover:bg-surface-hover/50 flex items-center justify-between px-4 py-3 transition-colors"
                      >
                        <div>
                          <p className="text-foreground font-medium">{item.label}</p>
                          <p className="text-muted-foreground text-xs">
                            {item.description}
                          </p>
                        </div>

                        <div className="flex gap-6 pr-2">
                          {ROLE_OPTIONS.map((role) => {
                            const checked = allowedRoles.includes(role.value);
                            const disabled =
                              item.fixed ||
                              pending ||
                              (checked && allowedRoles.length === 1);
                            return (
                              <label
                                key={role.value}
                                className="flex w-20 cursor-pointer justify-center"
                                title={
                                  item.fixed
                                    ? "Administrative navigation is restricted to administrators."
                                    : undefined
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={(event) =>
                                    toggleNavigationRole(
                                      item.key,
                                      role.value,
                                      event.target.checked,
                                    )
                                  }
                                  aria-label={`${role.label} can access ${item.label}`}
                                  className="accent-primary focus-visible:ring-ring border-border size-4 cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Error alert */}
            {error ? (
              <p
                role="alert"
                className="border-danger/30 bg-danger/10 text-danger rounded-lg border px-4 py-2.5 text-xs font-medium"
              >
                {error}
              </p>
            ) : null}

            {settings.updated_at ? (
              <div className="flex items-center justify-between px-1 text-muted-foreground text-[11px]">
                <p suppressHydrationWarning>
                  Last changed{" "}
                  <span suppressHydrationWarning>
                    {new Date(settings.updated_at).toLocaleString()}
                  </span>
                  {settings.updated_by_username
                    ? ` by ${settings.updated_by_username}`
                    : ""}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </form>

      {/* Interactive Theme & Typography Preview Modal */}
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent
          title="Theme & Branding Live Preview"
          description="Interactive workspace simulation using your selected brand palette, logo, and typography."
          className="max-w-5xl h-[92vh] flex flex-col p-5 gap-3.5 overflow-hidden"
        >
          {/* Quick Controls Bar under description */}
          <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 bg-surface-sunken/50 px-2.5 py-1.5 rounded-lg border border-border/70">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Real-time Theme Color Switcher inside Preview */}
              <div className="flex items-center gap-1">
                <Palette className="size-3.5 text-primary shrink-0" />
                <span className="text-muted-foreground text-[11px] font-medium">Color:</span>
                <Select
                  value={isCustomHex ? "custom" : themeColor}
                  onValueChange={(val) => {
                    if (val === "custom") {
                      setIsCustomHex(true);
                    } else {
                      setIsCustomHex(false);
                      setThemeColor(val);
                    }
                  }}
                >
                  <SelectTrigger className="h-7 text-xs w-32 bg-surface px-2">
                    <SelectValue>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="size-2.5 rounded-full shrink-0 shadow-2xs"
                          style={{ backgroundColor: previewPalette[500] }}
                        />
                        <span className="truncate">
                          {isCustomHex
                            ? `Custom (${customHex})`
                            : THEME_COLOR_PRESETS.find((p) => p.id === themeColor)?.name.replace("Green", "").replace("Rose", "").trim() ?? "Blue"}
                        </span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-48">
                    {THEME_COLOR_PRESETS.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        <div className="flex items-center gap-2 py-0.5">
                          <span
                            className="size-3 rounded-full shrink-0 shadow-2xs"
                            style={{ backgroundColor: preset.primary }}
                          />
                          <span className="text-xs">{preset.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                    {isCustomHex && (
                      <SelectItem value="custom">
                        <div className="flex items-center gap-2 py-0.5">
                          <span
                            className="size-3 rounded-full shrink-0 shadow-2xs"
                            style={{ backgroundColor: customHex }}
                          />
                          <span className="text-xs">Custom ({customHex})</span>
                        </div>
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Real-time Logo Icon Switcher inside Preview */}
              <div className="flex items-center gap-1 pl-2 border-l border-border/70">
                <span className="text-muted-foreground text-[11px] font-medium">Icon:</span>
                <Select value={logoIcon} onValueChange={setLogoIcon}>
                  <SelectTrigger className="h-7 text-xs w-32 bg-surface px-2">
                    <SelectValue>
                      {(() => {
                        const IconComp = LOGO_ICON_MAP[logoIcon] || Layers;
                        const iconPreset = LOGO_ICON_PRESETS.find((p) => p.id === logoIcon);
                        return (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div
                              className="size-3.5 rounded flex items-center justify-center text-white shrink-0 shadow-2xs"
                              style={{ backgroundColor: previewPalette[600] }}
                            >
                              <IconComp className="size-2.5 stroke-[2.4]" />
                            </div>
                            <span className="truncate">
                              {iconPreset?.name.replace("Knowledge ", "").replace("Stacked ", "").replace("Feather ", "").replace("Academy ", "").replace("Tech ", "").trim() ?? "Icon"}
                            </span>
                          </div>
                        );
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-52">
                    {LOGO_ICON_PRESETS.map((iconPreset) => {
                      const IconComp = LOGO_ICON_MAP[iconPreset.id] || Layers;
                      return (
                        <SelectItem key={iconPreset.id} value={iconPreset.id}>
                          <div className="flex items-center gap-2 py-0.5">
                            <div
                              className="size-5 rounded flex items-center justify-center text-white shrink-0 shadow-2xs"
                              style={{ backgroundColor: previewPalette[600] }}
                            >
                              <IconComp className="size-3 stroke-[2.4]" />
                            </div>
                            <span className="text-xs">{iconPreset.name}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Real-time Font Family Switcher inside Preview */}
              <div className="flex items-center gap-1 pl-2 border-l border-border/70">
                <Type className="size-3.5 text-primary shrink-0" />
                <span className="text-muted-foreground text-[11px] font-medium">Font:</span>
                <Select value={defaultFont} onValueChange={setDefaultFont}>
                  <SelectTrigger className="h-7 text-xs w-32 bg-surface px-2">
                    <SelectValue>{getFontPreset(defaultFont).name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-48">
                    {FONT_PRESETS.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        <div className="flex items-center justify-between gap-2 py-0.5 w-full">
                          <span className="text-xs" style={{ fontFamily: preset.cssFamily }}>
                            {preset.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {preset.category}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="text-xs h-7 gap-1.5"
                onClick={() => setPreviewDarkMode((prev) => !prev)}
              >
                {previewDarkMode ? (
                  <>
                    <Sun className="size-3.5 text-amber-500" />
                    Light Preview
                  </>
                ) : (
                  <>
                    <Moon className="size-3.5 text-indigo-400" />
                    Dark Preview
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Workspace Shell Viewport */}
          <div
            className={cn(
              "flex-1 min-h-0 rounded-xl border border-border shadow-inner flex flex-col overflow-hidden text-sm transition-colors duration-150 relative",
              previewDarkMode ? "dark bg-neutral-950 text-neutral-100" : "bg-white text-neutral-900",
            )}
            style={
              {
                "--primary": previewDarkMode
                  ? previewPalette[400]
                  : previewPalette[600],
                "--primary-hover": previewDarkMode
                  ? previewPalette[300]
                  : previewPalette[700],
                "--primary-subtle": previewDarkMode
                  ? `color-mix(in oklab, ${previewPalette[500]} 20%, transparent)`
                  : previewPalette[50],
                "--surface-selected": previewDarkMode
                  ? `color-mix(in oklab, ${previewPalette[500]} 25%, transparent)`
                  : previewPalette[50],
                "--ring": previewDarkMode
                  ? previewPalette[400]
                  : previewPalette[500],
                "--wh-brand-500": previewPalette[500],
                "--wh-brand-600": previewPalette[600],
              } as CSSProperties
            }
          >
              {/* Mock Shell TopBar - Matches Real WikiHub TopBar (Image 2) */}
              <div
                className={cn(
                  "shrink-0 flex items-center gap-3 px-4 py-2 border-b transition-colors shadow-xs z-20",
                  previewDarkMode
                    ? "bg-neutral-900 border-neutral-800"
                    : "bg-surface border-border",
                )}
              >
                {/* Left: Sidebar Toggle + Wordmark */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => toast.info("Sidebar toggle clicked in preview")}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover cursor-pointer"
                    title="Toggle navigation"
                  >
                    <PanelLeft className="size-4" />
                  </button>
                  <Wordmark
                    siteName={effectiveDisplayName}
                    icon={logoIcon}
                    customLogoUrl={customLogoUrl}
                    className="text-sm font-semibold"
                  />
                </div>

                {/* Center: Global Search Bar */}
                <div className="mx-auto w-full max-w-md hidden sm:block">
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 h-8 text-xs border w-full transition-colors cursor-pointer",
                      previewDarkMode
                        ? "bg-neutral-800/80 border-neutral-700 text-neutral-300 hover:border-neutral-600"
                        : "bg-surface-sunken border-border text-muted-foreground hover:border-border-strong hover:bg-surface-hover",
                    )}
                  >
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">Search {effectiveDisplayName}</span>
                    <kbd className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-surface text-muted-foreground">
                      ⌘K
                    </kbd>
                  </div>
                </div>

                {/* Right: Theme Toggle + User Menu */}
                <div className="flex items-center gap-2 ml-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewDarkMode((prev) => !prev)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover cursor-pointer"
                    title="Toggle dark mode in preview"
                  >
                    {previewDarkMode ? (
                      <Moon className="size-4 text-indigo-400" />
                    ) : (
                      <Sun className="size-4 text-amber-500" />
                    )}
                  </button>

                  <div
                    onClick={() => toast.info("User menu in preview")}
                    className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-surface-hover cursor-pointer transition-colors"
                  >
                    <span
                      className="size-7 rounded-full flex items-center justify-center text-xs font-semibold text-white shadow-2xs shrink-0"
                      style={{ backgroundColor: previewPalette[600] }}
                    >
                      WA
                    </span>
                    <span className="text-xs text-foreground font-normal hidden md:inline truncate max-w-32">
                      WikiHub Administrator
                    </span>
                    <ChevronDown className="size-3 text-muted-foreground hidden md:inline" />
                  </div>
                </div>
              </div>

              {/* Mock Workspace Body: Split-Pane with Independent Content Scroll */}
              <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* Mock Space Sidebar - Authentic to User's Space Sidebar (Image 1) */}
                <div
                  className={cn(
                    "w-56 shrink-0 border-r flex flex-col justify-between text-xs select-none overflow-hidden",
                    previewDarkMode
                      ? "bg-neutral-900/70 border-neutral-800"
                      : "bg-surface-sunken border-neutral-200",
                  )}
                >
                  {/* Space Top Info + Page Tree Scroll Viewport */}
                  <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
                    {/* Space Avatar & Metadata */}
                    <div className="flex items-start gap-3">
                      <div
                        className="size-12 rounded-lg flex items-center justify-center font-bold text-2xl shadow-2xs shrink-0"
                        style={{
                          backgroundColor: previewDarkMode
                            ? `color-mix(in oklab, ${previewPalette[500]} 25%, transparent)`
                            : previewPalette[50],
                          color: previewDarkMode
                            ? previewPalette[300]
                            : previewPalette[700],
                        }}
                      >
                        Q
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="font-semibold text-sm text-foreground truncate">
                          quantest
                        </div>
                        <div className="text-[11px] text-muted-foreground uppercase tracking-wide mt-0.5">
                          QUANTEST
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toast.info("Favorited space in preview")}
                        className="size-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer pt-0.5"
                        title="Add to favourites"
                      >
                        <Star className="size-4" />
                      </button>
                    </div>

                    {/* Page Tree Section Header */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                        <span>PAGE TREE</span>
                        <button
                          type="button"
                          onClick={() => toast.info("New page clicked in space sidebar")}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer font-normal"
                        >
                          <FilePlus className="size-3.5" />
                          <span>New</span>
                        </button>
                      </div>

                      {/* Hierarchical Page Tree */}
                      <div className="space-y-1">
                        {/* Folder add */}
                        <div
                          onClick={() => toast.info("Clicked folder 'add' in preview")}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-foreground hover:bg-surface-hover cursor-pointer transition-colors"
                        >
                          <Folder className="size-4 text-muted-foreground shrink-0" />
                          <span className="truncate">add</span>
                        </div>

                        {/* Folder dd */}
                        <div className="space-y-1">
                          <div
                            onClick={() => toast.info("Clicked folder 'dd' in preview")}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-foreground hover:bg-surface-hover cursor-pointer transition-colors"
                          >
                            <Folder className="size-4 text-muted-foreground shrink-0" />
                            <span className="truncate">dd</span>
                          </div>

                          {/* Sub-page active 'ddd' */}
                          <div className="pl-4">
                            <div
                              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium cursor-pointer"
                              style={{
                                backgroundColor: previewDarkMode
                                  ? `color-mix(in oklab, ${previewPalette[500]} 25%, transparent)`
                                  : previewPalette[50],
                                color: previewDarkMode
                                  ? previewPalette[300]
                                  : previewPalette[700],
                              }}
                            >
                              <FileText className="size-4 shrink-0" style={{ color: previewDarkMode ? previewPalette[300] : previewPalette[700] }} />
                              <span className="truncate">ddd</span>
                            </div>
                          </div>
                        </div>

                        {/* Sibling page 'ddd' */}
                        <div
                          onClick={() => toast.info("Clicked page 'ddd' in preview")}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-foreground hover:bg-surface-hover cursor-pointer transition-colors"
                        >
                          <FileText className="size-4 text-muted-foreground shrink-0" />
                          <span className="truncate">ddd</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mock Space Page Content (Full Rich Documentation Measure with Independent Scroll & Dynamic Page Font) */}
                <div
                  className="flex-1 overflow-y-auto p-6 space-y-6"
                  style={
                    {
                      fontFamily: getFontFamilyCss(defaultFont),
                      "--wh-page-font": getFontFamilyCss(defaultFont),
                    } as CSSProperties
                  }
                >
                  {/* Space Header & Top Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 border-border/70">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="hover:underline cursor-pointer">Spaces</span>
                        <ChevronRight className="size-3" />
                        <span className="hover:underline cursor-pointer">Core Engineering</span>
                        <ChevronRight className="size-3" />
                        <span className="font-medium text-foreground">Architecture</span>
                      </div>
                      <h1
                        className="text-2xl sm:text-3xl font-bold tracking-tight mt-1 text-foreground"
                        style={{ fontFamily: getFontFamilyCss(defaultFont) }}
                      >
                        System Architecture &amp; Engineering Handbook 2026
                      </h1>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toast.info("Edit page action triggered in preview")}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white shadow-xs transition-all hover:brightness-110 active:scale-95 cursor-pointer"
                        style={{ backgroundColor: previewPalette[600] }}
                      >
                        <FileText className="size-3.5" />
                        <span>Edit Page</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toast.info("Share link copied")}
                        className="p-1.5 rounded-md border border-border hover:bg-neutral-200/50 dark:hover:bg-neutral-800 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                        title="Share document"
                      >
                        <Share2 className="size-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => toast.info("Starred document")}
                        className="p-1.5 rounded-md border border-border hover:bg-neutral-200/50 dark:hover:bg-neutral-800 text-amber-500 cursor-pointer transition-colors"
                        title="Star page"
                      >
                        <Star className="size-3.5 fill-amber-500" />
                      </button>

                      <button
                        type="button"
                        onClick={() => toast.info("Export dialog opened")}
                        className="p-1.5 rounded-md border border-border hover:bg-neutral-200/50 dark:hover:bg-neutral-800 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                        title="Export document"
                      >
                        <Download className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Author Meta Row & Tags */}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground pb-2 border-b border-border/50">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <div className="size-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: previewPalette[600] }}>
                          QB
                        </div>
                        <span className="font-medium text-foreground">QuanBlue</span>
                      </div>
                      <span>&bull;</span>
                      <span>Updated 2 hours ago</span>
                      <span>&bull;</span>
                      <span>8 min read</span>
                      <span>&bull;</span>
                      <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">
                        v2.4.0 (Published)
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {["#architecture", "#backend", "#wikihub", "#microservices"].map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{
                            backgroundColor: previewDarkMode
                              ? `color-mix(in oklab, ${previewPalette[500]} 15%, transparent)`
                              : previewPalette[50],
                            color: previewDarkMode
                              ? previewPalette[300]
                              : previewPalette[700],
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Section 1: Overview & High-Performance Typography */}
                  <div className="space-y-3.5">
                    <h2
                      className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2"
                      style={{ fontFamily: getFontFamilyCss(defaultFont) }}
                    >
                      <span>1. Executive Overview &amp; Architecture Philosophy</span>
                    </h2>

                    <p
                      className="text-sm text-foreground/90 leading-relaxed"
                      style={{ fontFamily: getFontFamilyCss(defaultFont) }}
                    >
                      WikiHub delivers an ultra-responsive, self-hosted internal documentation ecosystem. Every page across your workspace is rendered using the <strong className="font-semibold text-foreground">{getFontPreset(defaultFont).name}</strong> typeface ({getFontPreset(defaultFont).category}) paired with your custom brand identity, providing crisp readability, comfortable scanning measures, and balanced optical weight.
                    </p>

                    {/* KPI Highlight Cards Grid */}
                    <div className="grid gap-3 sm:grid-cols-3 pt-2">
                      <div
                        className="p-3.5 rounded-xl border space-y-1 transition-all"
                        style={{
                          borderColor: previewDarkMode
                            ? `color-mix(in oklab, ${previewPalette[500]} 30%, transparent)`
                            : previewPalette[200],
                          backgroundColor: previewDarkMode
                            ? `color-mix(in oklab, ${previewPalette[500]} 10%, transparent)`
                            : previewPalette[50],
                        }}
                      >
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Uptime SLA
                        </p>
                        <p className="text-xl font-bold" style={{ color: previewPalette[600] }}>
                          99.99%
                        </p>
                        <p className="text-[11px] text-muted-foreground">High availability clustering</p>
                      </div>

                      <div
                        className="p-3.5 rounded-xl border space-y-1 transition-all"
                        style={{
                          borderColor: previewDarkMode
                            ? `color-mix(in oklab, ${previewPalette[500]} 30%, transparent)`
                            : previewPalette[200],
                          backgroundColor: previewDarkMode
                            ? `color-mix(in oklab, ${previewPalette[500]} 10%, transparent)`
                            : previewPalette[50],
                        }}
                      >
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                          P99 Search Latency
                        </p>
                        <p className="text-xl font-bold" style={{ color: previewPalette[600] }}>
                          18ms
                        </p>
                        <p className="text-[11px] text-muted-foreground">Vector-indexed retrieval</p>
                      </div>

                      <div
                        className="p-3.5 rounded-xl border space-y-1 transition-all"
                        style={{
                          borderColor: previewDarkMode
                            ? `color-mix(in oklab, ${previewPalette[500]} 30%, transparent)`
                            : previewPalette[200],
                          backgroundColor: previewDarkMode
                            ? `color-mix(in oklab, ${previewPalette[500]} 10%, transparent)`
                            : previewPalette[50],
                        }}
                      >
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Documents Scaled
                        </p>
                        <p className="text-xl font-bold" style={{ color: previewPalette[600] }}>
                          10M+
                        </p>
                        <p className="text-[11px] text-muted-foreground">Distributed storage volume</p>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Notice Callout */}
                  <div
                    className="p-4 rounded-xl border text-xs flex items-start gap-3"
                    style={{
                      borderColor: previewDarkMode
                        ? `color-mix(in oklab, ${previewPalette[500]} 40%, transparent)`
                        : previewPalette[300],
                      backgroundColor: previewDarkMode
                        ? `color-mix(in oklab, ${previewPalette[500]} 12%, transparent)`
                        : previewPalette[50],
                    }}
                  >
                    <Info className="size-4.5 shrink-0 mt-0.5" style={{ color: previewPalette[600] }} />
                    <div className="space-y-1">
                      <p
                        className="font-semibold text-sm"
                        style={{
                          color: previewDarkMode
                            ? previewPalette[300]
                            : previewPalette[800],
                        }}
                      >
                        Architecture Standard &bull; Production Ready
                      </p>
                      <p className="text-muted-foreground leading-relaxed">
                        All callout notices, interactive badges, selection indicators, and highlighted page markers automatically adopt your selected brand theme and dynamic typography.
                      </p>
                    </div>
                  </div>

                  {/* Section 3: Code Block Monospace Proof */}
                  <div className="space-y-3">
                    <h2
                      className="text-lg font-bold tracking-tight text-foreground"
                      style={{ fontFamily: getFontFamilyCss(defaultFont) }}
                    >
                      2. Monospace Syntax Highlighting (Monokai Pro Octagon)
                    </h2>

                    <div
                      className="rounded-lg border text-xs overflow-hidden shadow-xs"
                      style={{
                        backgroundColor: "var(--wh-code-bg, #282a3a)",
                        borderColor: "var(--wh-code-border, #3d4056)",
                        color: "var(--wh-code-fg, #eaf2f1)",
                        fontFamily: 'var(--font-jetbrains-mono), "JetBrains Mono", Consolas, Menlo, Monaco, monospace',
                      }}
                    >
                      <div
                        className="flex items-center justify-between px-3 py-1.5 border-b text-[11px]"
                        style={{
                          backgroundColor: "var(--wh-code-bg-inset, #2f3247)",
                          borderColor: "var(--wh-code-border, #3d4056)",
                        }}
                      >
                        <span className="flex items-center gap-1.5 text-neutral-300 font-medium">
                          <Code2 className="size-3.5 text-[#9cd1bb]" />
                          <span style={{ fontFamily: 'var(--font-jetbrains-mono), "JetBrains Mono", monospace' }}>
                            config.ts
                          </span>
                        </span>
                        <span
                          className="text-[9px] uppercase px-1.5 py-0.5 rounded font-semibold tracking-wider"
                          style={{
                            backgroundColor: "#3d4056",
                            color: "#ffd76d",
                          }}
                        >
                          Monokai Pro &bull; JetBrains Mono
                        </span>
                      </div>

                      <pre
                        className="p-3.5 text-[11px] leading-relaxed overflow-x-auto"
                        style={{
                          fontFamily: 'var(--font-jetbrains-mono), "JetBrains Mono", Consolas, Menlo, Monaco, monospace',
                          color: "var(--wh-code-fg, #eaf2f1)",
                        }}
                      >
                        <code>
                          <span style={{ color: "#9195ab", fontStyle: "italic" }}>
                            {"// Code blocks always preserve monospace JetBrains Mono\n"}
                          </span>
                          <span style={{ color: "#ff657a" }}>import </span>
                          <span style={{ color: "#eaf2f1" }}>{"{ "}</span>
                          <span style={{ color: "#9cd1bb" }}>WikiHubClient </span>
                          <span style={{ color: "#eaf2f1" }}>{"} "}</span>
                          <span style={{ color: "#ff657a" }}>from </span>
                          <span style={{ color: "#ffd76d" }}>&quot;@wikihub/sdk&quot;</span>
                          <span style={{ color: "#eaf2f1" }}>{";\n\n"}</span>
                          <span style={{ color: "#ff657a" }}>export </span>
                          <span style={{ color: "#ff657a" }}>const </span>
                          <span style={{ color: "#9cd1bb" }}>client </span>
                          <span style={{ color: "#ff657a" }}>= </span>
                          <span style={{ color: "#ff657a" }}>new </span>
                          <span style={{ color: "#9cd1bb" }}>WikiHubClient</span>
                          <span style={{ color: "#eaf2f1" }}>{"({\n"}</span>
                          <span style={{ color: "#eaf2f1" }}>  endpoint</span>
                          <span style={{ color: "#ff657a" }}>: </span>
                          <span style={{ color: "#ffd76d" }}>&quot;https://wiki.internal.net&quot;</span>
                          <span style={{ color: "#eaf2f1" }}>{",\n"}</span>
                          <span style={{ color: "#eaf2f1" }}>  fontFamily</span>
                          <span style={{ color: "#ff657a" }}>: </span>
                          <span style={{ color: "#ffd76d" }}>&quot;{getFontPreset(defaultFont).name}&quot;</span>
                          <span style={{ color: "#eaf2f1" }}>{",\n"}</span>
                          <span style={{ color: "#eaf2f1" }}>{"});"}</span>
                        </code>
                      </pre>
                    </div>
                  </div>

                  {/* Section 4: Blockquote */}
                  <blockquote
                    className="border-l-4 pl-4 py-1 text-sm italic text-muted-foreground my-4"
                    style={{
                      borderColor: previewPalette[600],
                      fontFamily: getFontFamilyCss(defaultFont),
                    }}
                  >
                    &ldquo;Exceptional documentation is the foundation of high-velocity engineering. Clear typography and brand consistency turn complex systems into intuitive knowledge.&rdquo;
                  </blockquote>

                  {/* Section 5: Interactive Component Palette & Accent Showcases */}
                  <div className="space-y-3 pt-2">
                    <h2
                      className="text-lg font-bold tracking-tight text-foreground"
                      style={{ fontFamily: getFontFamilyCss(defaultFont) }}
                    >
                      3. Interactive UI Controls &amp; Accent Palette
                    </h2>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Buttons Box */}
                      <div
                        className={cn(
                          "p-4 rounded-xl border space-y-3",
                          previewDarkMode
                            ? "bg-neutral-900/60 border-neutral-800"
                            : "bg-neutral-50/80 border-neutral-200",
                        )}
                      >
                        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <CheckSquare className="size-3.5" style={{ color: previewPalette[600] }} />
                          Button Variants
                        </p>

                        {/* Tag list */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {["Engineering", "API v2", "Internal", "Draft"].map((tag) => {
                            const isActive = mockActiveTag === tag;
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => setMockActiveTag(tag)}
                                className={cn(
                                  "px-2.5 py-0.5 rounded-full text-[11px] cursor-pointer transition-all duration-150",
                                  isActive
                                    ? "shadow-2xs font-semibold"
                                    : "border border-border font-normal text-muted-foreground hover:text-foreground",
                                )}
                                style={
                                  isActive
                                    ? {
                                        backgroundColor: previewDarkMode
                                          ? `color-mix(in oklab, ${previewPalette[500]} 25%, transparent)`
                                          : previewPalette[50],
                                        color: previewDarkMode
                                          ? previewPalette[300]
                                          : previewPalette[700],
                                        borderColor: previewPalette[300],
                                      }
                                    : undefined
                                }
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </div>

                        {/* Sample Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => toast.info("Primary button clicked")}
                            className="px-3 py-1.5 rounded-md text-xs font-semibold text-white shadow-xs transition-all duration-150 hover:brightness-110 active:scale-95 cursor-pointer"
                            style={{ backgroundColor: previewPalette[600] }}
                          >
                            Primary Action
                          </button>
                          <button
                            type="button"
                            onClick={() => toast.info("Subtle button clicked")}
                            className="px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-all duration-150 active:scale-95"
                            style={{
                              backgroundColor: previewDarkMode
                                ? `color-mix(in oklab, ${previewPalette[500]} 20%, transparent)`
                                : previewPalette[50],
                              color: previewDarkMode
                                ? previewPalette[300]
                                : previewPalette[700],
                            }}
                          >
                            Subtle Button
                          </button>
                          <button
                            type="button"
                            onClick={() => toast.info("Secondary button clicked")}
                            className="px-3 py-1.5 rounded-md text-xs font-medium border border-border cursor-pointer transition-all duration-150 active:scale-95 hover:bg-neutral-200/50 dark:hover:bg-neutral-800"
                          >
                            Outline
                          </button>
                        </div>
                      </div>

                      {/* Form Elements & Palette Strip */}
                      <div
                        className={cn(
                          "p-4 rounded-xl border space-y-3",
                          previewDarkMode
                            ? "bg-neutral-900/60 border-neutral-800"
                            : "bg-neutral-50/80 border-neutral-200",
                        )}
                      >
                        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <SlidersHorizontal className="size-3.5" style={{ color: previewPalette[600] }} />
                          Form Controls &amp; Palette Shades
                        </p>

                        <div className="space-y-2 text-xs">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={mockChecked}
                              onChange={(e) => setMockChecked(e.target.checked)}
                              className="size-3.5 cursor-pointer rounded"
                              style={{ accentColor: previewPalette[600] }}
                            />
                            <span className="text-muted-foreground">
                              Enable real-time notification sync
                            </span>
                          </label>

                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="radio"
                                name="mock-radio"
                                value="option1"
                                checked={mockRadio === "option1"}
                                onChange={() => setMockRadio("option1")}
                                className="size-3.5 cursor-pointer"
                                style={{ accentColor: previewPalette[600] }}
                              />
                              <span>Standard</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="radio"
                                name="mock-radio"
                                value="option2"
                                checked={mockRadio === "option2"}
                                onChange={() => setMockRadio("option2")}
                                className="size-3.5 cursor-pointer"
                                style={{ accentColor: previewPalette[600] }}
                              />
                              <span>Enterprise</span>
                            </label>
                          </div>
                        </div>

                        {/* Interactive Palette Shades Strip */}
                        <div className="pt-1 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground font-medium">Palette Shades (50-900)</span>
                            {copiedShade ? (
                              <span className="text-primary text-[10px] font-semibold">
                                Copied {copiedShade}!
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-[10px]">Click shade to copy</span>
                            )}
                          </div>
                          <div className="flex rounded-md overflow-hidden h-6 shadow-xs border border-border/50">
                            {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map(
                              (shade) => {
                                const hex =
                                  previewPalette[
                                    shade as keyof typeof previewPalette
                                  ];
                                return (
                                  <button
                                    key={shade}
                                    type="button"
                                    onClick={() => {
                                      void navigator.clipboard?.writeText(hex);
                                      setCopiedShade(hex);
                                      toast.success(`Copied shade ${shade} (${hex})`);
                                      setTimeout(() => setCopiedShade(null), 2000);
                                    }}
                                    className="flex-1 cursor-pointer transition-transform hover:scale-110 active:scale-95"
                                    style={{ backgroundColor: hex }}
                                    title={`Shade ${shade}: ${hex} (Click to copy)`}
                                  />
                                );
                              },
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          {/* Modal Footer */}
          <DialogFooter className="px-5 py-3 border-t border-border bg-surface flex items-center justify-between shrink-0">
            <span className="text-muted-foreground text-xs">
              Theme and typography changes will take effect across the workspace when saved.
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPreviewModalOpen(false)}
              >
                Close Preview
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={pending}
                onClick={(e) => {
                  e.preventDefault();
                  handleSubmit(e as unknown as FormEvent<HTMLFormElement>);
                }}
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Save &amp; Apply Theme
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Font Specimen Detail Modal */}
      <FontSpecimenModal
        font={specimenModalFont}
        isOpen={Boolean(specimenModalFont)}
        isSelected={specimenModalFont?.id === defaultFont}
        onClose={() => setSpecimenModalFont(null)}
        onSelect={(fontId) => setDefaultFont(fontId)}
      />
    </>
  );
}
