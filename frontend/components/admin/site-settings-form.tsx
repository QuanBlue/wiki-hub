"use client";

import {
  Bookmark,
  Check,
  CheckSquare,
  ChevronRight,
  Eye,
  FileText,
  HardDrive,
  ImagePlus,
  Info,
  Loader2,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Sun,
  Trash2,
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
import { api, ApiError } from "@/lib/api-client";
import {
  LOGO_ICON_PRESETS,
  THEME_COLOR_PRESETS,
  getPresetOrCustomPalette,
} from "@/lib/theme-presets";
import { cn } from "@/lib/utils";
import type { AppRole, SidebarPermissions, SiteSettings } from "@/types/api";

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
  id: "appearance" | "general" | "storage" | "sidebar";
  label: string;
  icon: LucideIcon;
}> = [
  { id: "appearance", label: "Theme & Branding", icon: Palette },
  { id: "general", label: "General workspace", icon: SlidersHorizontal },
  { id: "storage", label: "Storage & quotas", icon: HardDrive },
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

  const [logoIcon, setLogoIcon] = useState(
    settings.overrides.logo_icon ?? settings.effective.logo_icon ?? "default",
  );
  const [customLogoUrl, setCustomLogoUrl] = useState<string | null>(
    settings.overrides.custom_logo_url ?? settings.effective.custom_logo_url ?? null,
  );

  const [maxUpload, setMaxUpload] = useState(
    settings.overrides.max_upload_size_mb?.toString() ?? "",
  );
  const [maxBackupImport, setMaxBackupImport] = useState(
    settings.overrides.max_backup_import_size_mb?.toString() ?? "",
  );
  const [sessionTtlHours, setSessionTtlHours] = useState(
    settings.overrides.session_ttl_hours?.toString() ?? "",
  );
  const [types, setTypes] = useState(
    settings.overrides.allowed_attachment_types?.join(", ") ?? "",
  );
  const [sidebarPermissions, setSidebarPermissions] =
    useState<SidebarPermissions>(settings.effective.sidebar_permissions);
  const [activeTab, setActiveTab] = useState<
    "appearance" | "general" | "storage" | "sidebar"
  >("appearance");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Interactive Modal Preview states
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
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
    setThemeColor(hex);
  };

  const handleIconSelect = (iconId: string) => {
    setLogoIcon(iconId);
    setCustomLogoUrl(null);
  };

  const handleLogoFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo image must be smaller than 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUri = event.target?.result as string;
      setCustomLogoUrl(dataUri);
      toast.success("Logo uploaded for preview.");
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveCustomLogo = () => {
    setCustomLogoUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  async function save(payload: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const updated = await api.patch<SiteSettings>("/api/v1/settings", payload);
      if (updated?.effective) {
        themeContext.setThemeColor(updated.effective.theme_color || "blue");
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
      logo_icon:
        logoIcon === "default" && !settings.overrides.logo_icon
          ? null
          : logoIcon || null,
      custom_logo_url: customLogoUrl || null,
      max_upload_size_mb: maxUpload.trim() ? Number(maxUpload) : null,
      max_backup_import_size_mb: maxBackupImport.trim()
        ? Number(maxBackupImport)
        : null,
      allowed_attachment_types: types.trim()
        ? types
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : null,
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

  const effectiveDisplayName = siteName.trim() || settings.effective.site_name;
  const effectiveDraftColor = isCustomHex ? customHex.trim() : themeColor;
  const previewPalette = getPresetOrCustomPalette(effectiveDraftColor);

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
                "border-border bg-surface space-y-6 rounded-xl border p-6 shadow-sm",
                activeTab !== "appearance" && "hidden",
              )}
            >
              <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div className="flex items-center gap-2">
                  <Palette className="text-primary size-5" />
                  <div>
                    <h3 className="text-foreground font-semibold">
                      Theme &amp; Branding
                    </h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      Customize brand theme color, application logo icon, and visual appearance.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="text-xs"
                    onClick={() => setPreviewModalOpen(true)}
                  >
                    <Eye className="size-3.5" />
                    Preview Theme
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      handleColorPresetSelect("blue");
                      handleIconSelect("default");
                      handleRemoveCustomLogo();
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                    Reset Theme
                  </Button>
                </div>
              </div>

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
              </div>
            </section>

            {/* Card 1: General Workspace Settings */}
            <section
              id="general-settings"
              role="tabpanel"
              className={cn(
                "border-border bg-surface space-y-5 rounded-xl border p-6 shadow-sm",
                activeTab !== "general" && "hidden",
              )}
            >
              <div className="border-border flex items-center gap-2 border-b pb-4">
                <SlidersHorizontal className="text-primary size-4" />
                <div>
                  <h3 className="text-foreground font-semibold">
                    General Workspace
                  </h3>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Identity and session behaviour for this instance.
                  </p>
                </div>
              </div>

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
            </section>

            {/* Card 2: Storage & File Quotas */}
            <section
              id="storage-settings"
              role="tabpanel"
              className={cn(
                "border-border bg-surface space-y-5 rounded-xl border p-6 shadow-sm",
                activeTab !== "storage" && "hidden",
              )}
            >
              <div className="border-border flex items-center gap-2 border-b pb-4">
                <HardDrive className="text-info size-4" />
                <div>
                  <h3 className="text-foreground font-semibold">
                    Storage &amp; File Quotas
                  </h3>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Control imports and attachment limits.
                  </p>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                {/* Max Backup Import */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="max-backup-import"
                      className="text-sm font-semibold"
                    >
                      Max Confluence / Backup Archive (MB)
                    </Label>
                    {inheritedTag(
                      settings.overrides.max_backup_import_size_mb !== null,
                    )}
                  </div>
                  <Input
                    id="max-backup-import"
                    type="number"
                    min={1}
                    max={102400}
                    value={maxBackupImport}
                    onChange={(e) => setMaxBackupImport(e.target.value)}
                    placeholder={String(
                      settings.effective.max_backup_import_size_mb,
                    )}
                    disabled={pending}
                    className="text-sm"
                  />
                  <p className="text-muted-foreground text-[11px]">
                    Upper limit for uploaded Confluence spaces or full backups.
                    Default: 1024 MB.
                  </p>
                </div>

                {/* Max Attachment Size */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="max-upload-size"
                      className="text-sm font-semibold"
                    >
                      Max Single Attachment Size (MB)
                    </Label>
                    {inheritedTag(
                      settings.overrides.max_upload_size_mb !== null,
                    )}
                  </div>
                  <Input
                    id="max-upload-size"
                    type="number"
                    min={1}
                    max={10240}
                    value={maxUpload}
                    onChange={(e) => setMaxUpload(e.target.value)}
                    placeholder={String(settings.effective.max_upload_size_mb)}
                    disabled={pending}
                    className="text-sm"
                  />
                  <p className="text-muted-foreground text-[11px]">
                    Upper limit for inline files attached to pages. Default: 50 MB.
                  </p>
                </div>

                {/* Allowed File Types */}
                <div className="space-y-1.5 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="allowed-types"
                      className="text-sm font-semibold"
                    >
                      Allowed Attachment File Extensions
                    </Label>
                    {inheritedTag(
                      settings.overrides.allowed_attachment_types !== null,
                    )}
                  </div>
                  <Input
                    id="allowed-types"
                    value={types}
                    onChange={(e) => setTypes(e.target.value)}
                    placeholder={settings.effective.allowed_attachment_types.join(
                      ", ",
                    )}
                    disabled={pending}
                    className="text-sm font-mono"
                  />
                  <p className="text-muted-foreground text-[11px]">
                    Comma-separated list (e.g.{" "}
                    <code className="text-foreground">png, jpg, pdf, zip</code>). Use{" "}
                    <code className="text-foreground">*</code> to permit all file
                    types.
                  </p>
                </div>
              </div>
            </section>

            {/* Card 3: Sidebar Access Matrix */}
            <section
              id="sidebar-settings"
              role="tabpanel"
              className={cn(
                "border-border bg-surface space-y-5 rounded-xl border p-6 shadow-sm",
                activeTab !== "sidebar" && "hidden",
              )}
            >
              <div className="border-border flex items-center gap-2 border-b pb-4">
                <ShieldCheck className="text-primary size-4" />
                <div>
                  <h3 className="text-foreground font-semibold">
                    Sidebar Access Matrix
                  </h3>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Determine which user roles see specific application navigation links.
                  </p>
                </div>
              </div>

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

            {/* Actions Bar */}
            <div className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={pending}
                >
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Save settings
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => setPreviewModalOpen(true)}
                >
                  <Eye className="size-3.5" />
                  Preview Theme
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setSiteName("");
                    handleColorPresetSelect("blue");
                    handleIconSelect("default");
                    handleRemoveCustomLogo();
                    setMaxUpload("");
                    setMaxBackupImport("");
                    setTypes("");
                    setSessionTtlHours("");
                    void save({
                      site_name: null,
                      theme_color: null,
                      logo_icon: null,
                      custom_logo_url: null,
                      max_upload_size_mb: null,
                      max_backup_import_size_mb: null,
                      allowed_attachment_types: null,
                      sidebar_permissions: null,
                      session_ttl_hours: null,
                    });
                  }}
                >
                  <RotateCcw className="size-3.5" />
                  Reset all to default
                </Button>
              </div>

              {settings.updated_at ? (
                <p
                  className="text-muted-foreground text-[11px]"
                  suppressHydrationWarning
                >
                  Last changed{" "}
                  <span suppressHydrationWarning>
                    {new Date(settings.updated_at).toLocaleString()}
                  </span>
                  {settings.updated_by_username
                    ? ` by ${settings.updated_by_username}`
                    : ""}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </form>

      {/* Full Interactive Theme Preview Modal */}
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent
          title="Theme & Branding Interactive Preview"
          description="Click around tabs, buttons, links, and search to experience the theme in action before saving."
          className="max-w-4xl"
        >
          <div className="space-y-4">
            {/* Modal Toolbar: Theme info + Mode Switch */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Draft Theme:</span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium border border-border"
                  style={{
                    backgroundColor: previewPalette[50],
                    color: previewPalette[700],
                  }}
                >
                  <span
                    className="size-2.5 rounded-full shadow-xs"
                    style={{ backgroundColor: previewPalette[600] }}
                  />
                  {isCustomHex ? `Custom (${customHex})` : themeColor}
                </span>
                <span className="text-muted-foreground ml-2">Icon Mark:</span>
                <span className="font-medium text-foreground">
                  {customLogoUrl ? "Custom Logo Upload" : logoIcon}
                </span>
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

            {/* Simulated Full Workspace Container with Scoped CSS Tokens */}
            <div
              className={cn(
                "rounded-xl border border-border shadow-inner overflow-hidden text-sm transition-colors duration-150",
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
              {/* Mock Shell TopBar */}
              <div
                className={cn(
                  "flex items-center justify-between px-4 py-2.5 border-b",
                  previewDarkMode
                    ? "bg-neutral-900 border-neutral-800"
                    : "bg-neutral-50/90 border-neutral-200",
                )}
              >
                <div className="flex items-center gap-3">
                  <Wordmark
                    siteName={effectiveDisplayName}
                    icon={logoIcon}
                    customLogoUrl={customLogoUrl}
                    className="text-sm font-semibold"
                  />
                </div>

                <div className="flex items-center gap-3">
                  {/* Interactive Search Bar */}
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-1 text-xs border w-48 transition-all focus-within:ring-2",
                      previewDarkMode
                        ? "bg-neutral-800 border-neutral-700 text-neutral-300"
                        : "bg-white border-neutral-200 text-neutral-700",
                    )}
                    style={{
                      outlineColor: previewPalette[500],
                    }}
                  >
                    <Search className="size-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search docs..."
                      value={mockSearch}
                      onChange={(e) => setMockSearch(e.target.value)}
                      className="bg-transparent border-none outline-none w-full text-xs placeholder:text-muted-foreground"
                    />
                    <kbd className="ml-auto text-[10px] font-mono px-1 rounded bg-neutral-200/60 dark:bg-neutral-700 text-muted-foreground">
                      Ctrl K
                    </kbd>
                  </div>

                  {/* Interactive Avatar */}
                  <button
                    type="button"
                    onClick={() => toast.info("User profile clicked in preview")}
                    className="size-7 rounded-full flex items-center justify-center text-xs font-semibold text-white shadow-xs transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                    style={{ backgroundColor: previewPalette[600] }}
                    title="User Profile (Active Theme Accent)"
                  >
                    AD
                  </button>
                </div>
              </div>

              {/* Mock Workspace Body (Sidebar + Content) */}
              <div className="grid grid-cols-[11.5rem_minmax(0,1fr)] min-h-[360px]">
                {/* Mock Left Sidebar */}
                <div
                  className={cn(
                    "border-r p-3 space-y-1.5 text-xs",
                    previewDarkMode
                      ? "bg-neutral-900/60 border-neutral-800"
                      : "bg-neutral-50/50 border-neutral-200",
                  )}
                >
                  <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Navigation
                  </p>
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => setMockNavTab("spaces")}
                      className={cn(
                        "flex w-full items-center gap-2 px-2.5 py-1.5 rounded-md text-left cursor-pointer transition-all duration-150",
                        mockNavTab === "spaces"
                          ? "font-semibold shadow-2xs"
                          : "font-normal text-muted-foreground hover:text-foreground hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40",
                      )}
                      style={
                        mockNavTab === "spaces"
                          ? {
                              backgroundColor: previewDarkMode
                                ? `color-mix(in oklab, ${previewPalette[500]} 25%, transparent)`
                                : previewPalette[50],
                              color: previewDarkMode
                                ? previewPalette[300]
                                : previewPalette[700],
                            }
                          : undefined
                      }
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate">Spaces</span>
                      {mockNavTab === "spaces" ? (
                        <span
                          className="size-1.5 rounded-full ml-auto"
                          style={{ backgroundColor: previewPalette[600] }}
                        />
                      ) : null}
                    </button>

                    <button
                      type="button"
                      onClick={() => setMockNavTab("recent")}
                      className={cn(
                        "flex w-full items-center gap-2 px-2.5 py-1.5 rounded-md text-left cursor-pointer transition-all duration-150",
                        mockNavTab === "recent"
                          ? "font-semibold shadow-2xs"
                          : "font-normal text-muted-foreground hover:text-foreground hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40",
                      )}
                      style={
                        mockNavTab === "recent"
                          ? {
                              backgroundColor: previewDarkMode
                                ? `color-mix(in oklab, ${previewPalette[500]} 25%, transparent)`
                                : previewPalette[50],
                              color: previewDarkMode
                                ? previewPalette[300]
                                : previewPalette[700],
                            }
                          : undefined
                      }
                    >
                      <SlidersHorizontal className="size-3.5 shrink-0" />
                      <span className="truncate">Recent</span>
                      {mockNavTab === "recent" ? (
                        <span
                          className="size-1.5 rounded-full ml-auto"
                          style={{ backgroundColor: previewPalette[600] }}
                        />
                      ) : null}
                    </button>

                    <button
                      type="button"
                      onClick={() => setMockNavTab("settings")}
                      className={cn(
                        "flex w-full items-center gap-2 px-2.5 py-1.5 rounded-md text-left cursor-pointer transition-all duration-150",
                        mockNavTab === "settings"
                          ? "font-semibold shadow-2xs"
                          : "font-normal text-muted-foreground hover:text-foreground hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40",
                      )}
                      style={
                        mockNavTab === "settings"
                          ? {
                              backgroundColor: previewDarkMode
                                ? `color-mix(in oklab, ${previewPalette[500]} 25%, transparent)`
                                : previewPalette[50],
                              color: previewDarkMode
                                ? previewPalette[300]
                                : previewPalette[700],
                            }
                          : undefined
                      }
                    >
                      <ShieldCheck className="size-3.5 shrink-0" />
                      <span className="truncate">Settings</span>
                      {mockNavTab === "settings" ? (
                        <span
                          className="size-1.5 rounded-full ml-auto"
                          style={{ backgroundColor: previewPalette[600] }}
                        />
                      ) : null}
                    </button>
                  </div>

                  <div className="pt-4 space-y-1">
                    <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Starred Spaces
                    </p>
                    <button
                      type="button"
                      onClick={() => toast.info("Navigated to Core Engineering space in preview")}
                      className="flex w-full items-center gap-2 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground rounded hover:bg-neutral-200/30 dark:hover:bg-neutral-800/30 cursor-pointer"
                    >
                      <Star className="size-3 text-amber-500 fill-amber-500" />
                      <span className="truncate">Core Engineering</span>
                    </button>
                  </div>
                </div>

                {/* Mock Space Page Content */}
                <div className="p-5 space-y-4">
                  {/* Space Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 border-border">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="hover:underline cursor-pointer">Engineering</span>
                        <ChevronRight className="size-3" />
                        <span className="hover:underline cursor-pointer">Architecture</span>
                      </div>
                      <h4 className="text-base font-bold mt-1 text-foreground flex items-center gap-2">
                        System Guidelines &amp; Knowledge Base
                      </h4>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMockStarred((prev) => !prev)}
                        className={cn(
                          "p-1.5 rounded-md border border-border cursor-pointer transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800",
                          mockStarred && "text-amber-500 fill-amber-500",
                        )}
                        title="Star Page"
                      >
                        <Star className={cn("size-3.5", mockStarred && "fill-amber-500 text-amber-500")} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setMockBookmarked((prev) => !prev)}
                        className={cn(
                          "p-1.5 rounded-md border border-border cursor-pointer transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800",
                          mockBookmarked && "text-primary",
                        )}
                        style={mockBookmarked ? { color: previewPalette[600] } : undefined}
                        title="Bookmark Page"
                      >
                        <Bookmark className={cn("size-3.5", mockBookmarked && "fill-current")} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toast.info("Simulated Share link copied in preview")}
                        className="p-1.5 rounded-md border border-border cursor-pointer transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        title="Share Page"
                      >
                        <Share2 className="size-3.5 text-muted-foreground" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toast.success("Page published successfully in preview!")}
                        className="px-3 py-1.5 rounded-md text-xs font-semibold text-white shadow-xs transition-all duration-150 hover:brightness-110 active:scale-95 cursor-pointer flex items-center gap-1.5"
                        style={{ backgroundColor: previewPalette[600] }}
                      >
                        <Plus className="size-3.5" />
                        Publish Page
                      </button>
                    </div>
                  </div>

                  {/* Interactive Page Tabs */}
                  <div className="flex items-center gap-4 border-b border-border text-xs">
                    <button
                      type="button"
                      onClick={() => setMockContentTab("overview")}
                      className={cn(
                        "pb-2 cursor-pointer transition-colors border-b-2",
                        mockContentTab === "overview"
                          ? "border-current font-semibold"
                          : "border-transparent font-normal text-muted-foreground hover:text-foreground",
                      )}
                      style={
                        mockContentTab === "overview"
                          ? { color: previewPalette[600] }
                          : undefined
                      }
                    >
                      Overview &amp; Docs
                    </button>
                    <button
                      type="button"
                      onClick={() => setMockContentTab("spec")}
                      className={cn(
                        "pb-2 cursor-pointer transition-colors border-b-2",
                        mockContentTab === "spec"
                          ? "border-current font-semibold"
                          : "border-transparent font-normal text-muted-foreground hover:text-foreground",
                      )}
                      style={
                        mockContentTab === "spec"
                          ? { color: previewPalette[600] }
                          : undefined
                      }
                    >
                      Architecture Spec
                    </button>
                    <button
                      type="button"
                      onClick={() => setMockContentTab("endpoints")}
                      className={cn(
                        "pb-2 cursor-pointer transition-colors border-b-2",
                        mockContentTab === "endpoints"
                          ? "border-current font-semibold"
                          : "border-transparent font-normal text-muted-foreground hover:text-foreground",
                      )}
                      style={
                        mockContentTab === "endpoints"
                          ? { color: previewPalette[600] }
                          : undefined
                      }
                    >
                      API Endpoints
                    </button>
                  </div>

                  {/* Interactive Components & Accents Grid */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* Interactive Buttons & Controls Box */}
                    <div
                      className={cn(
                        "p-3.5 rounded-lg border space-y-3",
                        previewDarkMode
                          ? "bg-neutral-900/60 border-neutral-800"
                          : "bg-neutral-50/80 border-neutral-200",
                      )}
                    >
                      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <CheckSquare className="size-3.5" style={{ color: previewPalette[600] }} />
                        Interactive Buttons &amp; Badges
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
                          className={cn(
                            "px-3 py-1.5 rounded-md text-xs font-medium border border-border cursor-pointer transition-all duration-150 active:scale-95 hover:bg-neutral-200/50 dark:hover:bg-neutral-800",
                          )}
                        >
                          Outline
                        </button>
                      </div>

                      {/* Interactive inline link */}
                      <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                        Documentation link:{" "}
                        <button
                          type="button"
                          onClick={() => toast.info("Inline link clicked in preview")}
                          className="font-medium underline cursor-pointer hover:opacity-80 transition-opacity"
                          style={{
                            color: previewDarkMode
                              ? previewPalette[400]
                              : previewPalette[600],
                          }}
                        >
                          View System Architecture Guide &rarr;
                        </button>
                      </p>
                    </div>

                    {/* Interactive Form Elements & Palette Box */}
                    <div
                      className={cn(
                        "p-3.5 rounded-lg border space-y-3",
                        previewDarkMode
                          ? "bg-neutral-900/60 border-neutral-800"
                          : "bg-neutral-50/80 border-neutral-200",
                      )}
                    >
                      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <SlidersHorizontal className="size-3.5" style={{ color: previewPalette[600] }} />
                        Interactive Form Controls
                      </p>

                      {/* Checkbox & Radio Controls */}
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

                  {/* Sample Callout Note */}
                  <div
                    className="p-3 rounded-lg border text-xs flex items-start gap-2.5"
                    style={{
                      borderColor: previewDarkMode
                        ? `color-mix(in oklab, ${previewPalette[500]} 40%, transparent)`
                        : previewPalette[200],
                      backgroundColor: previewDarkMode
                        ? `color-mix(in oklab, ${previewPalette[500]} 12%, transparent)`
                        : previewPalette[50],
                    }}
                  >
                    <Info
                      className="size-4 shrink-0 mt-0.5"
                      style={{ color: previewPalette[600] }}
                    />
                    <div className="space-y-0.5">
                      <p
                        className="font-semibold"
                        style={{
                          color: previewDarkMode
                            ? previewPalette[300]
                            : previewPalette[800],
                        }}
                      >
                        Theme Integration Complete
                      </p>
                      <p className="text-muted-foreground leading-relaxed">
                        All callout notices, highlighted code markers, and interactive selection indicators automatically adopt your selected brand theme.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-2 border-t border-border flex items-center justify-between">
              <span className="text-muted-foreground text-xs">
                Theme changes will take effect across the workspace when saved.
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
