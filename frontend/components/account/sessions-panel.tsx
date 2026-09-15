"use client";

import { Laptop, Loader2, LogOut, MonitorSmartphone, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import type { AccountSession } from "@/types/api";

function describeDevice(userAgent: string | null, t: (key: string) => string) {
  if (!userAgent) return t("sessions.deviceUnknown");
  if (/mobile|android|iphone|ipad/i.test(userAgent)) return t("sessions.deviceMobile");
  return t("sessions.deviceDesktop");
}

function lastSeen(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function SessionsPanel() {
  const { t, locale, apiErrorText } = useTranslation();
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

  async function loadSessions() {
    setLoading(true);
    setError(null);
    try {
      setSessions(await api.get<AccountSession[]>("/api/v1/auth/sessions"));
    } catch (err) {
      setError(apiErrorText(err, "sessions.couldNotLoad"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const requestId = window.setTimeout(() => { void loadSessions(); }, 0);
    return () => window.clearTimeout(requestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only; apiErrorText is stable per locale
  }, []);

  async function revokeOthers() {
    setRevoking(true);
    try {
      await api.post<void>("/api/v1/auth/sessions/revoke-others");
      setConfirmOpen(false);
      toast.success(t("sessions.signedOutOthers"));
      await loadSessions();
    } catch (err) {
      toast.error(apiErrorText(err, "sessions.couldNotSignOutOthers"));
    } finally {
      setRevoking(false);
    }
  }

  const otherSessionCount = sessions.filter((session) => !session.is_current).length;

  return (
    <section className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t("sessions.title")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("sessions.hint")}</p>
        </div>
        <Button variant="secondary" onClick={() => setConfirmOpen(true)} disabled={loading || otherSessionCount === 0}>
          <LogOut />
          {t("sessions.signOutOthers")}
        </Button>
      </div>

      {loading ? <div className="text-muted-foreground mt-6 flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />{t("sessions.loading")}</div> : null}
      {error ? <p role="alert" className="border-danger/30 bg-danger/10 text-danger mt-6 rounded-md border px-3 py-2 text-sm">{error}</p> : null}
      {!loading && !error ? (
        <div className="border-border mt-6 overflow-hidden rounded-lg border">
          {sessions.map((session) => {
            const current = session.is_current;
            const DeviceIcon = current ? MonitorSmartphone : Laptop;
            return (
              <div key={session.id} className="border-border flex gap-4 border-b p-5 last:border-b-0 sm:items-center">
                <span className="bg-surface-sunken text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
                  <DeviceIcon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{describeDevice(session.user_agent, t)}</p>
                  <p className="text-muted-foreground mt-1 text-sm">{session.is_admin_session ? t("sessions.adminUsingSession") : current ? t("sessions.currentSession") : t("sessions.lastActive", { time: lastSeen(session.last_seen_at, locale) })}</p>
                  <p className="text-muted-foreground mt-1 text-xs">{session.ip_address ? t("sessions.ipAddress", { ip: session.ip_address }) : t("sessions.ipAddressUnavailable")}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {session.is_admin_session ? <span className="border-warning/30 bg-warning-bg text-warning rounded-md border px-2 py-1 text-xs font-medium">{t("sessions.adminSession")}</span> : null}
                  {current ? <span className="text-primary bg-primary-subtle rounded-md px-2 py-1 text-xs font-medium">{t("sessions.current")}</span> : null}
                </div>
              </div>
            );
          })}
          {sessions.length === 0 ? <p className="text-muted-foreground p-5 text-sm">{t("sessions.noSessions")}</p> : null}
        </div>
      ) : null}

      <div className="border-border bg-surface-sunken/60 mt-6 flex gap-3 rounded-lg border p-4">
        <ShieldAlert className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="text-muted-foreground text-sm">{t("sessions.securityHint")}</p>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("sessions.confirmTitle")}
        description={t("sessions.confirmDescription")}
        confirmLabel={t("sessions.confirmLabel")}
        destructive
        pending={revoking}
        onConfirm={() => void revokeOthers()}
      />
    </section>
  );
}
