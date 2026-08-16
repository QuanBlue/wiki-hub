"use client";

import { Laptop, Loader2, LogOut, MonitorSmartphone, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";
import type { AccountSession } from "@/types/api";

function describeDevice(userAgent: string | null) {
  if (!userAgent) return "Web browser";
  if (/mobile|android|iphone|ipad/i.test(userAgent)) return "Mobile browser";
  return "Desktop browser";
}

function lastSeen(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function SessionsPanel() {
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
      setError(err instanceof ApiError ? err.message : "Could not load active sessions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const requestId = window.setTimeout(() => { void loadSessions(); }, 0);
    return () => window.clearTimeout(requestId);
  }, []);

  async function revokeOthers() {
    setRevoking(true);
    try {
      await api.post<void>("/api/v1/auth/sessions/revoke-others");
      setConfirmOpen(false);
      toast.success("Other sessions have been signed out.");
      await loadSessions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not sign out other sessions.");
    } finally {
      setRevoking(false);
    }
  }

  const otherSessionCount = sessions.filter((session) => !session.is_current).length;

  return (
    <section className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Web sessions</h2>
          <p className="text-muted-foreground mt-1 text-sm">Review devices signed in to your account and sign out ones you do not recognize.</p>
        </div>
        <Button variant="secondary" onClick={() => setConfirmOpen(true)} disabled={loading || otherSessionCount === 0}>
          <LogOut />
          Sign out other sessions
        </Button>
      </div>

      {loading ? <div className="text-muted-foreground mt-6 flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Loading sessions&hellip;</div> : null}
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
                  <p className="font-semibold">{describeDevice(session.user_agent)}</p>
                  <p className="text-muted-foreground mt-1 text-sm">{session.is_admin_session ? "An administrator is using this session." : current ? "Current session" : `Last active ${lastSeen(session.last_seen_at)}`}</p>
                  <p className="text-muted-foreground mt-1 text-xs">{session.ip_address ? `IP address: ${session.ip_address}` : "IP address unavailable"}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {session.is_admin_session ? <span className="border-warning/30 bg-warning-bg text-warning rounded-md border px-2 py-1 text-xs font-medium">Admin session</span> : null}
                  {current ? <span className="text-primary bg-primary-subtle rounded-md px-2 py-1 text-xs font-medium">Current</span> : null}
                </div>
              </div>
            );
          })}
          {sessions.length === 0 ? <p className="text-muted-foreground p-5 text-sm">No active web sessions.</p> : null}
        </div>
      ) : null}

      <div className="border-border bg-surface-sunken/60 mt-6 flex gap-3 rounded-lg border p-4">
        <ShieldAlert className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="text-muted-foreground text-sm">If you do not recognize a session, sign out all other sessions and change your password.</p>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sign out other sessions?"
        description="All other browsers will need to sign in again. Your current session will stay active."
        confirmLabel="Sign out sessions"
        destructive
        pending={revoking}
        onConfirm={() => void revokeOthers()}
      />
    </section>
  );
}
