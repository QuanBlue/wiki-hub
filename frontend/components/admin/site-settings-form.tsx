"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import type { SiteSettings } from "@/types/api";

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
  const [types, setTypes] = useState(
    settings.overrides.allowed_attachment_types?.join(", ") ?? "",
  );
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
      allowed_attachment_types: types.trim()
        ? types
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : null,
    });
  }

  const inherited = (overridden: boolean) =>
    overridden ? null : (
      <span className="text-muted-foreground text-xs">
        inherited from the environment
      </span>
    );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
            setTypes("");
            void save({
              site_name: null,
              max_upload_size_mb: null,
              allowed_attachment_types: null,
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
