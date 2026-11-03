"use client";

import {
  Calendar,
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Link2,
  Loader2,
  Lock,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { formatDate } from "@/lib/i18n/format";
import type {
  PublicShareItem,
  PublicShareListResponse,
  PublicShareUpdatePayload,
} from "@/types/api";

/**
 * PublicShareDialog:
 * Dedicated modal for managing public / external share links.
 * Generates controlled, read-only links with expiration presets
 * and optional password protection for external partners without
 * requiring a WikiHub account.
 */
export function PublicShareDialog({
  spaceKey,
  pageSlug,
  pageTitle,
  open,
  onOpenChange,
}: {
  spaceKey: string;
  pageSlug: string;
  pageTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale, apiErrorText } = useTranslation();
  const base = `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageSlug)}/shares`;

  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [shares, setShares] = useState<PublicShareItem[]>([]);
  const [expiresDays, setExpiresDays] = useState<number | null>(7);
  const [enablePassword, setEnablePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Edit existing share link state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editExpiresAction, setEditExpiresAction] = useState<string>("keep");
  const [editPasswordAction, setEditPasswordAction] = useState<"keep" | "change" | "remove">("keep");
  const [editAddPassword, setEditAddPassword] = useState(false);
  const [editPasswordValue, setEditPasswordValue] = useState("");
  const [editShowPassword, setEditShowPassword] = useState(false);
  const [updating, setUpdating] = useState(false);

  // Revocation confirmation state
  const [targetRevoke, setTargetRevoke] = useState<PublicShareItem | null>(null);
  const [revoking, setRevoking] = useState(false);

  function startEdit(item: PublicShareItem) {
    setEditingId(item.id);
    setEditExpiresAction("keep");
    setEditPasswordAction("keep");
    setEditAddPassword(false);
    setEditPasswordValue("");
    setEditShowPassword(false);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function getCreateExpiresLabel(days: number | null) {
    if (days === 1) return t("share.expires1d");
    if (days === 7) return t("share.expires7d");
    if (days === 30) return t("share.expires30d");
    if (days === 90) return t("share.expires90d");
    return t("share.expiresNever");
  }

  function getEditExpiresLabel(action: string, expiresAt: string | null) {
    if (action === "keep") {
      return expiresAt
        ? `${t("share.keepExpiration")} (${formatDate(expiresAt, locale)})`
        : `${t("share.keepExpiration")} (${t("share.expiresNever")})`;
    }
    if (action === "1") return t("share.expires1d");
    if (action === "7") return t("share.expires7d");
    if (action === "30") return t("share.expires30d");
    if (action === "90") return t("share.expires90d");
    return t("share.expiresNever");
  }

  function getEditPasswordActionLabel(action: "keep" | "change" | "remove") {
    if (action === "keep") return t("share.keepPassword");
    if (action === "change") return t("share.changePassword");
    return t("share.removePassword");
  }

  async function handleUpdateShare(item: PublicShareItem) {
    setUpdating(true);
    try {
      const payload: PublicShareUpdatePayload = {};
      if (editExpiresAction === "never") {
        payload.clear_expiration = true;
      } else if (editExpiresAction !== "keep") {
        payload.expires_in_days = Number(editExpiresAction);
      }

      if (item.has_password) {
        if (editPasswordAction === "remove") {
          payload.clear_password = true;
        } else if (editPasswordAction === "change" && editPasswordValue.trim()) {
          payload.password = editPasswordValue.trim();
        }
      } else {
        if (editAddPassword && editPasswordValue.trim()) {
          payload.password = editPasswordValue.trim();
        }
      }

      const updated = await api.patch<PublicShareItem>(
        `${base}/public/${encodeURIComponent(item.id)}`,
        payload,
      );
      setShares((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setEditingId(null);
      toast.success(t("share.updated"));
    } catch (error) {
      toast.error(apiErrorText(error, "share.error"));
    } finally {
      setUpdating(false);
    }
  }

  async function confirmRevokeShare(shareId: string) {
    setRevoking(true);
    try {
      await api.delete(`${base}/public/${encodeURIComponent(shareId)}`);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      setTargetRevoke(null);
      if (editingId === shareId) setEditingId(null);
      toast.success(t("share.revoked"));
    } catch (error) {
      toast.error(apiErrorText(error, "share.error"));
    } finally {
      setRevoking(false);
    }
  }
  useEffect(() => {
    if (!open) {
      setShowCreateForm(false);
      setEditingId(null);
      setTargetRevoke(null);
      return;
    }
    let active = true;
    async function loadPublicShares() {
      setLoading(true);
      try {
        const res = await api.get<PublicShareListResponse>(`${base}/public`);
        if (active) {
          setEnabled(res.enabled);
          setShares(res.shares);
        }
      } catch {
        if (active) {
          setEnabled(false);
          setShares([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadPublicShares();
    return () => {
      active = false;
    };
  }, [base, open]);

  async function handleCreateShare(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const newShare = await api.post<PublicShareItem>(`${base}/public`, {
        expires_in_days: expiresDays,
        password: enablePassword && password.trim() ? password.trim() : null,
      });
      setShares((prev) => [newShare, ...prev]);
      setPassword("");
      setEnablePassword(false);
      setShowCreateForm(false);
      toast.success(t("share.linkCreated"));
    } catch (error) {
      toast.error(apiErrorText(error, "share.error"));
    } finally {
      setCreating(false);
    }
  }

  function getShareUrl(token: string) {
    return `${window.location.origin}/share/${token}`;
  }

  function copyLink(token: string) {
    const url = getShareUrl(token);
    void navigator.clipboard.writeText(url);
    setCopiedToken(token);
    toast.success(t("share.linkCopied"));
    setTimeout(() => setCopiedToken(null), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("share.publicTitle")}
        description={pageTitle}
        className="sm:max-w-lg"
      >
        <div className="space-y-4 pt-1">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>{t("share.searching")}</span>
            </div>
          ) : !enabled ? (
            /* Public Sharing Disabled by Administrator */
            <div className="border-warning/30 bg-warning-subtle/50 text-warning-foreground rounded-lg border p-4 flex items-start gap-3">
              <ShieldAlert className="size-5 text-warning shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-foreground text-xs font-semibold">
                  {t("share.publicTitle")}
                </h4>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t("share.publicDisabledWarning")}
                </p>
              </div>
            </div>
          ) : (
            /* Public Sharing Content */
            <div className="space-y-4">
              {/* Header bar: Active links count + "+ New link" button (only when active links exist) */}
              {shares.length > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-foreground tracking-tight">
                      {t("share.activeLinks")}
                    </h3>
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-muted-foreground border border-border">
                      {shares.length}
                    </span>
                  </div>

                  {!showCreateForm && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowCreateForm(true)}
                      className="h-7 px-2.5 text-xs font-medium gap-1.5 cursor-pointer hover:bg-surface-hover transition-colors"
                    >
                      <Plus className="size-3.5" />
                      <span>{t("share.createAnotherLink")}</span>
                    </Button>
                  )}
                </div>
              )}

              {/* Create Link Section (shown when no links exist or when user clicks + New Link) */}
              {(showCreateForm || shares.length === 0) && (
                <form
                  onSubmit={handleCreateShare}
                  className="rounded-lg border border-primary/20 bg-surface-sunken/40 p-3.5 space-y-3 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <div className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                        <Globe className="size-3.5" />
                      </div>
                      <div className="space-y-0.5">
                        <h4 className="text-xs font-semibold text-foreground">
                          {t("share.createLinkTitle")}
                        </h4>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {t("share.publicDescription")}
                        </p>
                      </div>
                    </div>
                    {shares.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowCreateForm(false)}
                        className="size-6 p-0 text-muted-foreground hover:text-foreground shrink-0 rounded cursor-pointer"
                        title={t("share.cancel")}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-3 pt-1 border-t border-border/60">
                    {/* Expiration preset */}
                    <div className="space-y-1.5">
                      <label
                        id="public-expires-label"
                        htmlFor="public-expires-select"
                        className="text-muted-foreground text-[11px] font-medium block"
                      >
                        {t("share.expiresIn")}
                      </label>
                      <Select
                        value={expiresDays === null ? "never" : String(expiresDays)}
                        onValueChange={(val) =>
                          setExpiresDays(val === "never" ? null : Number(val))
                        }
                      >
                        <SelectTrigger
                          id="public-expires-select"
                          aria-labelledby="public-expires-label"
                          className="h-8 text-xs"
                        >
                          <SelectValue>
                            {getCreateExpiresLabel(expiresDays)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="1" className="text-xs py-1.5">
                            {t("share.expires1d")}
                          </SelectItem>
                          <SelectItem value="7" className="text-xs py-1.5">
                            {t("share.expires7d")}
                          </SelectItem>
                          <SelectItem value="30" className="text-xs py-1.5">
                            {t("share.expires30d")}
                          </SelectItem>
                          <SelectItem value="90" className="text-xs py-1.5">
                            {t("share.expires90d")}
                          </SelectItem>
                          <SelectItem value="never" className="text-xs py-1.5">
                            {t("share.expiresNever")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Password Protection */}
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={enablePassword}
                          onChange={(e) => setEnablePassword(e.target.checked)}
                          className="rounded border-border text-primary focus:ring-ring size-3.5"
                        />
                        <span className="text-foreground text-xs font-medium">
                          {t("share.passwordProtect")}
                        </span>
                      </label>

                      {enablePassword ? (
                        <div className="relative pt-0.5">
                          <Input
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t("share.passwordPlaceholder")}
                            className="pr-8 text-xs h-8"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="hover:bg-accent hover:text-accent-foreground text-muted-foreground absolute top-2 right-2 rounded p-0.5 transition-colors cursor-pointer"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? (
                              <EyeOff className="size-3.5" />
                            ) : (
                              <Eye className="size-3.5" />
                            )}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/60">
                    {shares.length > 0 && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowCreateForm(false)}
                        className="h-8 px-3 text-xs cursor-pointer hover:bg-surface-hover"
                      >
                        {t("share.cancel")}
                      </Button>
                    )}
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={creating}
                      className="h-8 px-3 text-xs font-medium gap-1.5 cursor-pointer hover:bg-primary-hover active:bg-primary-active transition-colors"
                    >
                      {creating ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Globe className="size-3.5" />
                      )}
                      <span>{creating ? t("share.creatingLink") : t("share.createLink")}</span>
                    </Button>
                  </div>
                </form>
              )}

              {/* Active Links List */}
              {shares.length === 0 ? (
                null
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-2.5 pr-0.5">
                  {shares.map((item) => {
                    const isCopied = copiedToken === item.token;
                    const isEditing = editingId === item.id;
                    const shareUrl = getShareUrl(item.token);

                    if (isEditing) {
                      return (
                        <div
                          key={item.id}
                          className="rounded-lg border-2 border-primary/40 bg-surface p-3.5 space-y-3 text-xs shadow-xs"
                        >
                          <div className="flex items-center justify-between pb-2 border-b border-border">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Pencil className="size-3.5 text-primary shrink-0" />
                              <span className="font-semibold text-foreground text-xs">
                                {t("share.editLink")}
                              </span>
                            </div>
                            <span
                              className="font-mono text-[11px] text-muted-foreground truncate max-w-56 select-all"
                              title={shareUrl}
                            >
                              {shareUrl}
                            </span>
                          </div>

                          <div className="space-y-3 pt-0.5">
                            {/* Expiration preset */}
                            <div className="space-y-1">
                              <label
                                id={`edit-expires-label-${item.id}`}
                                htmlFor={`edit-expires-${item.id}`}
                                className="text-muted-foreground text-[11px] font-medium block"
                              >
                                {t("share.expiresIn")}
                              </label>
                              <Select
                                value={editExpiresAction}
                                onValueChange={setEditExpiresAction}
                              >
                                <SelectTrigger
                                  id={`edit-expires-${item.id}`}
                                  aria-labelledby={`edit-expires-label-${item.id}`}
                                  className="h-8 text-xs"
                                >
                                  <SelectValue>
                                    {getEditExpiresLabel(editExpiresAction, item.expires_at)}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent align="start">
                                  <SelectItem value="keep" className="text-xs py-1.5">
                                    {t("share.keepExpiration")}{" "}
                                    {item.expires_at
                                      ? `(${formatDate(item.expires_at, locale)})`
                                      : `(${t("share.expiresNever")})`}
                                  </SelectItem>
                                  <SelectItem value="1" className="text-xs py-1.5">
                                    {t("share.expires1d")}
                                  </SelectItem>
                                  <SelectItem value="7" className="text-xs py-1.5">
                                    {t("share.expires7d")}
                                  </SelectItem>
                                  <SelectItem value="30" className="text-xs py-1.5">
                                    {t("share.expires30d")}
                                  </SelectItem>
                                  <SelectItem value="90" className="text-xs py-1.5">
                                    {t("share.expires90d")}
                                  </SelectItem>
                                  <SelectItem value="never" className="text-xs py-1.5">
                                    {t("share.expiresNever")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Password options */}
                            <div className="space-y-1.5">
                              {item.has_password ? (
                                <>
                                  <label
                                    id={`edit-pwd-action-label-${item.id}`}
                                    htmlFor={`edit-pwd-action-${item.id}`}
                                    className="text-muted-foreground text-[11px] font-medium block"
                                  >
                                    {t("share.passwordProtect")}
                                  </label>
                                  <Select
                                    value={editPasswordAction}
                                    onValueChange={(val) =>
                                      setEditPasswordAction(
                                        val as "keep" | "change" | "remove",
                                      )
                                    }
                                  >
                                    <SelectTrigger
                                      id={`edit-pwd-action-${item.id}`}
                                      aria-labelledby={`edit-pwd-action-label-${item.id}`}
                                      className="h-8 text-xs"
                                    >
                                      <SelectValue>
                                        {getEditPasswordActionLabel(editPasswordAction)}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent align="start">
                                      <SelectItem value="keep" className="text-xs py-1.5">
                                        {t("share.keepPassword")}
                                      </SelectItem>
                                      <SelectItem value="change" className="text-xs py-1.5">
                                        {t("share.changePassword")}
                                      </SelectItem>
                                      <SelectItem value="remove" className="text-xs py-1.5">
                                        {t("share.removePassword")}
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {editPasswordAction === "change" ? (
                                    <div className="relative pt-1">
                                      <Input
                                        type={editShowPassword ? "text" : "password"}
                                        value={editPasswordValue}
                                        onChange={(e) => setEditPasswordValue(e.target.value)}
                                        placeholder={t("share.passwordPlaceholder")}
                                        className="pr-8 text-xs h-8"
                                        autoFocus
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setEditShowPassword(!editShowPassword)}
                                        className="hover:bg-accent hover:text-accent-foreground text-muted-foreground absolute top-2.5 right-2 rounded p-0.5 transition-colors cursor-pointer"
                                        aria-label={editShowPassword ? "Hide password" : "Show password"}
                                      >
                                        {editShowPassword ? (
                                          <EyeOff className="size-3.5" />
                                        ) : (
                                          <Eye className="size-3.5" />
                                        )}
                                      </button>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={editAddPassword}
                                      onChange={(e) => setEditAddPassword(e.target.checked)}
                                      className="rounded border-border text-primary focus:ring-ring size-3.5"
                                    />
                                    <span className="text-foreground text-xs font-medium">
                                      {t("share.addPassword")}
                                    </span>
                                  </label>
                                  {editAddPassword ? (
                                    <div className="relative pt-1">
                                      <Input
                                        type={editShowPassword ? "text" : "password"}
                                        value={editPasswordValue}
                                        onChange={(e) => setEditPasswordValue(e.target.value)}
                                        placeholder={t("share.passwordPlaceholder")}
                                        className="pr-8 text-xs h-8"
                                        autoFocus
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setEditShowPassword(!editShowPassword)}
                                        className="hover:bg-accent hover:text-accent-foreground text-muted-foreground absolute top-2.5 right-2 rounded p-0.5 transition-colors cursor-pointer"
                                        aria-label={editShowPassword ? "Hide password" : "Show password"}
                                      >
                                        {editShowPassword ? (
                                          <EyeOff className="size-3.5" />
                                        ) : (
                                          <Eye className="size-3.5" />
                                        )}
                                      </button>
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={updating}
                              onClick={cancelEdit}
                              className="h-8 px-3 text-xs cursor-pointer hover:bg-surface-hover"
                            >
                              {t("share.cancel")}
                            </Button>
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              disabled={updating}
                              onClick={() => void handleUpdateShare(item)}
                              className="h-8 px-3 text-xs font-medium gap-1.5 cursor-pointer hover:bg-primary-hover active:bg-primary-active transition-colors"
                            >
                              {updating ? <Loader2 className="size-3.5 animate-spin" /> : null}
                              <span>{updating ? t("share.saving") : t("share.saveChanges")}</span>
                            </Button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={item.id}
                        className="rounded-lg border border-border bg-surface p-3 space-y-2.5 text-xs transition-all hover:border-border-strong hover:shadow-xs"
                      >
                        {/* URL bar & primary actions */}
                        <div className="flex items-center gap-2">
                          <div className="flex flex-1 min-w-0 items-center gap-2 rounded-md border border-border/80 bg-surface-sunken/60 px-2.5 py-1 text-xs focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
                            <Globe className="size-3.5 text-muted-foreground shrink-0" />
                            <span
                              className="font-mono text-[11px] text-foreground truncate select-all flex-1"
                              title={shareUrl}
                            >
                              {shareUrl}
                            </span>
                          </div>

                          <Button
                            type="button"
                            variant={isCopied ? "secondary" : "primary"}
                            size="sm"
                            onClick={() => copyLink(item.token)}
                            className="h-7 px-2.5 text-xs font-medium shrink-0 gap-1.5 cursor-pointer transition-all"
                            title={t("share.copyShareLink")}
                          >
                            {isCopied ? (
                              <Check className="size-3.5 text-success" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                            <span>{isCopied ? t("share.copied") : t("share.copyLink")}</span>
                          </Button>

                          <div className="flex items-center border-l border-border pl-1 gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => startEdit(item)}
                              className="size-7 p-0 text-muted-foreground hover:text-foreground hover:bg-surface-hover rounded transition-colors cursor-pointer"
                              title={t("share.editLink")}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setTargetRevoke(item)}
                              className="size-7 p-0 text-muted-foreground hover:text-danger hover:bg-danger/10 rounded transition-colors cursor-pointer"
                              title={t("share.revoke")}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        {/* Metadata row */}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <Badge variant="neutral" className="text-[10px] py-0 px-1.5 font-normal">
                            {t("share.readOnlyBadge")}
                          </Badge>

                          {item.has_password ? (
                            <Badge variant="info" className="text-[10px] py-0 px-1.5 font-normal gap-1">
                              <Lock className="size-2.5" />
                              <span>{t("share.hasPassword")}</span>
                            </Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Unlock className="size-2.5" />
                              <span>{t("share.noPassword")}</span>
                            </span>
                          )}

                          <span className="text-border">•</span>

                          <span className="inline-flex items-center gap-1">
                            <Calendar className="size-3 text-muted-foreground" />
                            <span>
                              {item.expires_at
                                ? t("share.expiresAt", {
                                    date: formatDate(item.expires_at, locale),
                                  })
                                : t("share.expiresNever")}
                            </span>
                          </span>

                          {item.view_count > 0 ? (
                            <>
                              <span className="text-border">•</span>
                              <span className="inline-flex items-center gap-1">
                                <Eye className="size-3 text-muted-foreground" />
                                <span>{t("share.viewCount", { count: item.view_count })}</span>
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>

      {/* Confirmation Dialog for Revoking a Public Link */}
      <ConfirmDialog
        open={targetRevoke !== null}
        onOpenChange={(openState) => {
          if (!openState) setTargetRevoke(null);
        }}
        title={t("share.revokeTitle")}
        description={t("share.revokePrompt")}
        confirmLabel={t("share.revokeAction")}
        cancelLabel={t("share.cancel")}
        destructive
        pending={revoking}
        onConfirm={() => targetRevoke && void confirmRevokeShare(targetRevoke.id)}
      />
    </Dialog>
  );
}

