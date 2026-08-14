"use client";

import { HardDrive, Loader2, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
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

export function SiteSettingsForm({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const [siteName, setSiteName] = useState(settings.overrides.site_name ?? "");
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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(payload: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      await api.patch<SiteSettings>("/api/v1/settings", payload);
      toast.success("Settings saved successfully.");
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
    void save({
      site_name: siteName.trim() || null,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Card 1: General Workspace Settings */}
      <section className="border-border bg-surface rounded-xl border p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <SlidersHorizontal className="size-4 text-primary" />
          <h3 className="font-semibold text-foreground text-sm">General Workspace</h3>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {/* Site Name */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="site-name" className="text-xs font-semibold">
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
              className="text-xs"
            />
            <p className="text-muted-foreground text-[11px]">
              Currently showing as <strong className="text-foreground">{settings.effective.site_name}</strong>. Leave empty for default.
            </p>
          </div>

          {/* Session Lifetime */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="session-ttl-hours" className="text-xs font-semibold">
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
              className="text-xs"
            />
            <p className="text-muted-foreground text-[11px]">
              Duration of user sessions before re-authentication is required. Default: 12h.
            </p>
          </div>
        </div>
      </section>

      {/* Card 2: Storage & File Quotas */}
      <section className="border-border bg-surface rounded-xl border p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <HardDrive className="size-4 text-info" />
          <h3 className="font-semibold text-foreground text-sm">Storage &amp; File Quotas</h3>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {/* Max Backup Import */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="max-backup-import" className="text-xs font-semibold">
                Max Confluence / Backup Archive (MB)
              </Label>
              {inheritedTag(settings.overrides.max_backup_import_size_mb !== null)}
            </div>
            <Input
              id="max-backup-import"
              type="number"
              min={1}
              max={102400}
              value={maxBackupImport}
              onChange={(e) => setMaxBackupImport(e.target.value)}
              placeholder={String(settings.effective.max_backup_import_size_mb)}
              disabled={pending}
              className="text-xs"
            />
            <p className="text-muted-foreground text-[11px]">
              Limits large Confluence backup imports independently from standard attachments.
            </p>
          </div>

          {/* Max Upload */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="max-upload" className="text-xs font-semibold">
                Max Single Attachment Upload (MB)
              </Label>
              {inheritedTag(settings.overrides.max_upload_size_mb !== null)}
            </div>
            <Input
              id="max-upload"
              type="number"
              min={1}
              max={10240}
              value={maxUpload}
              onChange={(e) => setMaxUpload(e.target.value)}
              placeholder={String(settings.effective.max_upload_size_mb)}
              disabled={pending}
              className="text-xs"
            />
            <p className="text-muted-foreground text-[11px]">
              Maximum allowed size per individual attachment upload.
            </p>
          </div>
        </div>

        {/* Allowed Types */}
        <div className="space-y-1.5 pt-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="allowed-types" className="text-xs font-semibold">
              Allowed Attachment Extensions
            </Label>
            {inheritedTag(settings.overrides.allowed_attachment_types !== null)}
          </div>
          <Input
            id="allowed-types"
            value={types}
            onChange={(e) => setTypes(e.target.value)}
            placeholder={settings.effective.allowed_attachment_types.join(", ")}
            disabled={pending}
            className="text-xs"
          />
          <p className="text-muted-foreground text-[11px]">
            Comma-separated file extensions. (SVG is excluded by default for script security).
          </p>
        </div>
      </section>

      {/* Card 3: Sidebar Navigation Access Control */}
      <section
        aria-labelledby="sidebar-permissions-heading"
        className="border-border bg-surface space-y-4 rounded-xl border p-5"
      >
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <ShieldCheck className="size-4 text-warning" />
          <div>
            <h3 id="sidebar-permissions-heading" className="font-semibold text-foreground text-sm">
              Sidebar Access Control
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Configure navigation item visibility per instance role. Space permissions still apply inside spaces.
            </p>
          </div>
        </div>

        <div className="border-border overflow-hidden rounded-lg border">
          <div className="bg-surface-sunken grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 border-b border-border px-4 py-2.5 text-xs font-semibold text-foreground">
            <span>Navigation Area</span>
            <span className="w-20 text-center">Member</span>
            <span className="w-20 text-center">Admin</span>
          </div>
          {NAVIGATION_ITEMS.map((item) => {
            const roles = sidebarPermissions[item.key] || [];
            return (
              <div
                key={item.key}
                className="border-border bg-surface grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-b px-4 py-3 last:border-b-0"
              >
                <div>
                  <p className="text-xs font-semibold text-foreground">{item.label}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {item.description}
                  </p>
                </div>
                {ROLE_OPTIONS.map((role) => {
                  const checked = roles.includes(role.value);
                  const isLastRole = roles.length === 1;
                  const disabled =
                    pending || item.fixed || (checked && isLastRole);
                  return (
                    <label
                      key={role.value}
                      className="flex w-20 justify-center cursor-pointer"
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
                        className="accent-primary focus-visible:ring-ring border-border size-4 rounded cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                  );
                })}
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
      <div className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save settings
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => {
              setSiteName("");
              setMaxUpload("");
              setMaxBackupImport("");
              setTypes("");
              setSessionTtlHours("");
              void save({
                site_name: null,
                max_upload_size_mb: null,
                max_backup_import_size_mb: null,
                allowed_attachment_types: null,
                sidebar_permissions: null,
                session_ttl_hours: null,
              });
            }}
          >
            <RotateCcw className="size-3.5" />
            Reset all to environment
          </Button>
        </div>

        {settings.updated_at ? (
          <p className="text-muted-foreground text-[11px]">
            Last changed {new Date(settings.updated_at).toLocaleString()}
            {settings.updated_by_username
              ? ` by ${settings.updated_by_username}`
              : ""}
          </p>
        ) : null}
      </div>
    </form>
  );
}
