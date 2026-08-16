"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { api, ApiError } from "@/lib/api-client";
import type { User } from "@/types/api";

const LOWERCASE = "abcdefghjkmnpqrstuvwxyz";
const UPPERCASE = "ABCDEFGHJKMNPQRSTUVWXYZ";
const NUMBERS = "23456789";
const SYMBOLS = "!@#$%*+-_";
const ALL_PASSWORD_CHARS = LOWERCASE + UPPERCASE + NUMBERS + SYMBOLS;
const PASSWORD_LENGTH = 20;

function randomCharacter(characters: string) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return characters[values[0]! % characters.length]!;
}

function generatePassword() {
  const password = [
    randomCharacter(LOWERCASE),
    randomCharacter(UPPERCASE),
    randomCharacter(NUMBERS),
    randomCharacter(SYMBOLS),
    ...Array.from({ length: PASSWORD_LENGTH - 4 }, () => randomCharacter(ALL_PASSWORD_CHARS)),
  ];

  return password.sort(() => {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0]! % 2 === 0 ? -1 : 1;
  }).join("");
}

function passwordRequirements(password: string) {
  return {
    hasLength: password.length >= 8,
    hasLetterCase: /[a-z]/.test(password) && /[A-Z]/.test(password),
    hasNumberOrSymbol: /\d/.test(password) || /[^A-Za-z0-9]/.test(password),
  };
}

export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const requirements = passwordRequirements(password);
  const passwordIsValid = Object.values(requirements).every(Boolean);

  async function regeneratePassword() {
    const generated = generatePassword();
    setPassword(generated);
    setConfirm(generated);
    setError(null);
    try {
      await navigator.clipboard.writeText(generated);
      toast.success("A strong password was generated and copied to clipboard.");
    } catch {
      toast.success("A strong password was generated.");
      toast.error("Could not copy it to the clipboard. Select it from the field instead.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordIsValid || password !== confirm) {
      setError("The new password does not meet all requirements.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.post<User>(`/api/v1/users/${user.id}/password-reset`, {
        new_password: password,
      });
      toast.success(`Password reset for ${user.username}.`);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not reset the password.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Reset password for ${user.username}`}
        description="The current password is not required. Share the new password securely with the user."
      >
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => void regeneratePassword()} disabled={pending}>
              <Sparkles />
              Generate password
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
              value={password}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              aria-invalid={passwordFocused && !passwordIsValid}
              required
            />
            {passwordFocused && !passwordIsValid ? (
              <p className="text-danger text-xs">Use 8+ characters with uppercase, lowercase, and a number or special character.</p>
            ) : (
              <p className="text-muted-foreground text-xs">Generate a strong password or enter one manually.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm">Confirm password</Label>
            <PasswordInput
              id="reset-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              disabled={pending}
              aria-invalid={mismatch || undefined}
              required
            />
            {mismatch ? <p className="text-danger text-xs">The passwords do not match.</p> : null}
          </div>

          {error ? <p role="alert" className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !passwordIsValid || password !== confirm}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
