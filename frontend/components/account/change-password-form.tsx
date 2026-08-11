"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { api, ApiError } from "@/lib/api-client";
import type { User } from "@/types/api";

const MIN_PASSWORD_LENGTH = 8;

export function ChangePasswordForm({
  protectedAccount,
}: {
  protectedAccount: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (protectedAccount) {
    // The backend answers 403 for this account, so do not offer a form that
    // can only fail.
    return (
      <p className="text-muted-foreground text-sm">
        This is the built-in administrator account. Its password is fixed when
        the instance is first seeded and cannot be changed here — that is what
        guarantees there is always a way back in. To rotate it, change{" "}
        <code className="bg-surface-sunken rounded px-1 py-0.5 font-mono text-xs">
          WIKIHUB_ADMIN_PASSWORD
        </code>{" "}
        and re-seed a fresh instance.
      </p>
    );
  }

  const mismatch = confirm.length > 0 && next !== confirm;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (next !== confirm) {
      setError("The two new passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.post<User>("/api/v1/users/me/password", {
        current_password: current,
        new_password: next,
      });
      toast.success("Password changed.");
      setCurrent("");
      setNext("");
      setConfirm("");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not change the password.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-sm space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="current-password">Current password</Label>
        <PasswordInput
          id="current-password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          disabled={pending}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="next-password">New password</Label>
        <PasswordInput
          id="next-password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={pending}
          required
        />
        <p className="text-muted-foreground text-xs">
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <PasswordInput
          id="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={pending}
          aria-invalid={mismatch || undefined}
          required
        />
        {mismatch ? (
          <p className="text-danger text-xs">The passwords do not match.</p>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        disabled={
          pending ||
          !current ||
          next.length < MIN_PASSWORD_LENGTH ||
          next !== confirm
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : null}
        Change password
      </Button>
    </form>
  );
}
