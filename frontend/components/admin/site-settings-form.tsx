"use client";

import { Loader2, RotateCcw, ShieldCheck } from "lucide-react";
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
  { key: "favorites", label: "Favorites", description: "Starred spaces" },
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

/**
 * Each field shows its effective value and whether that came from an explicit
 * setting or from the environment. Without that distinction an administrator
 * cannot tell a deliberate choice from a default, and "Reset" would look like a
 * no-op.
 *
 * Sending `null` is how a value is reset — an empty string would be a different
 * (invalid) setting, not an absence.
 */
export function SiteSettingsForm({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const [siteName, setSiteName] = useState(settings.overrides.site_name ?? "");
  const [maxUpload, setMaxUpload] = useState(
    settings.overrides.max_upload_size_mb?.toString() ?? "",
  );
  const [maxBackupImport, setMaxBackupImport] = useState(
    settings.overrides.max_backup_import_size_mb?.toString() ?? "",
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
      toast.success("Settings saved.");
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
    });
  }

  function toggleNavigationRole(
    item: keyof SidebarPermissions,
    role: AppRole,
    checked: boolean,
  ) {
    setSidebarPermissions((current) => {
      const roles = current[item];
      // A sidebar item with no eligible role can never be reached again. Keep
      // one selected directly in the UI as well as in the API validator.
      if (!checked && roles.length === 1) return current;
      return {
        ...current,
        [item]: checked
          ? [...roles, role]
          : roles.filter((candidate) => candidate !== role),
      };
    });
  }

  const inherited = (overridden: boolean) =>
    overridden ? null : (
      <span className="text-muted-foreground text-xs">
        inherited from the environment
      </span>
    );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="site-name">Site name</Label>
          {inherited(settings.overrides.site_name !== null)}
        </div>
        <Input
          id="site-name"
          value={siteName}
          onChange={(e) => setSiteName(e.target.value)}
          placeholder={settings.effective.site_name}
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          Currently showing as <strong>{settings.effective.site_name}</strong>.
          Leave empty to use the environment value.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="max-backup-import">
            Maximum backup/import archive size (MB)
          </Label>
          {inherited(settings.overrides.max_backup_import_size_mb !== null)}
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
          className="max-w-40"
        />
        <p className="text-muted-foreground text-xs">
          Limits large Confluence and backup archives independently from normal attachments.
        </p>
      </div>

      <section
        aria-labelledby="sidebar-permissions-heading"
        className="border-border bg-surface-sunken space-y-4 rounded-lg border p-4"
      >
        <div className="flex gap-3">
          <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <h3 id="sidebar-permissions-heading" className="font-medium">
              Sidebar access
            </h3>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Choose which instance roles can see each navigation item. Space
              membership still controls access to content inside a space.
            </p>
          </div>
        </div>

        <div className="border-border overflow-hidden rounded-md border">
          <div className="bg-surface grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 border-b px-3 py-2 text-xs font-medium">
            <span>Navigation item</span>
            <span className="w-16 text-center">Member</span>
            <span className="w-16 text-center">Admin</span>
          </div>
          {NAVIGATION_ITEMS.map((item) => (
            <div
              key={item.key}
              className="border-border bg-surface grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 border-b px-3 py-2.5 last:border-b-0"
            >
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-muted-foreground text-xs">
                  {item.description}
                </p>
              </div>
              {ROLE_OPTIONS.map((role) => {
                const checked = sidebarPermissions[item.key].includes(
                  role.value,
                );
                const isLastRole = sidebarPermissions[item.key].length === 1;
                const disabled =
                  pending || item.fixed || (checked && isLastRole);
                return (
                  <label
                    key={role.value}
                    className="flex w-16 justify-center"
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
                      className="accent-primary focus-visible:ring-ring border-border size-4 rounded focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Settings and backups remain administrator-only because those routes
          change instance-level data.
        </p>
      </section>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="max-upload">Maximum upload size (MB)</Label>
          {inherited(settings.overrides.max_upload_size_mb !== null)}
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
          className="max-w-40"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="allowed-types">Allowed attachment types</Label>
          {inherited(settings.overrides.allowed_attachment_types !== null)}
        </div>
        <Input
          id="allowed-types"
          value={types}
          onChange={(e) => setTypes(e.target.value)}
          placeholder={settings.effective.allowed_attachment_types.join(", ")}
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          Comma-separated file extensions. SVG is intentionally excluded by
          default — it can execute script when served inline.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save settings
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setSiteName("");
            setMaxUpload("");
            setMaxBackupImport("");
            setTypes("");
            void save({
              site_name: null,
              max_upload_size_mb: null,
              max_backup_import_size_mb: null,
              allowed_attachment_types: null,
              sidebar_permissions: null,
            });
          }}
        >
          <RotateCcw />
          Reset all to environment
        </Button>
      </div>

      {settings.updated_at ? (
        <p className="text-muted-foreground text-xs">
          Last changed {new Date(settings.updated_at).toLocaleString()}
          {settings.updated_by_username
            ? ` by ${settings.updated_by_username}`
            : ""}
          .
        </p>
      ) : null}
    </form>
  );
}
