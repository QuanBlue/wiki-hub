"use client";

import { Loader2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import type { User } from "@/types/api";

const MIN_PASSWORD_LENGTH = 8;
/** Mirrors UserCreate.username in the backend schema. */
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;

export function CreateUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const usernameInvalid =
    username.length > 0 && !USERNAME_PATTERN.test(username);

  function reset() {
    setUsername("");
    setEmail("");
    setFullName("");
    setPassword("");
    setRole("member");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const created = await api.post<User>("/api/v1/users", {
        username: username.trim(),
        email: email.trim(),
        full_name: fullName.trim(),
        password,
        is_superuser: role === "admin",
      });
      toast.success(`User ${created.username} created.`);
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not create the user.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <UserPlus />
        Create user
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent
          title="Create user"
          description="The account is active immediately. Give the person their password out of band — WikiHub does not send e-mail."
        >
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="new-username">Username</Label>
              <Input
                id="new-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="jdoe"
                autoComplete="off"
                aria-invalid={usernameInvalid || undefined}
                disabled={pending}
                required
                autoFocus
              />
              <p className="text-muted-foreground text-xs">
                3–64 characters: letters, digits, dot, dash or underscore.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-email">E-mail</Label>
              <Input
                id="new-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jdoe@example.com"
                autoComplete="off"
                disabled={pending}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-fullname">Full name</Label>
              <Input
                id="new-fullname"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
                disabled={pending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">Password</Label>
              <PasswordInput
                id="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                disabled={pending}
                required
              />
              <p className="text-muted-foreground text-xs">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-role">Role</Label>
              <Select
                id="new-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={pending}
              >
                <option value="member">Member</option>
                <option value="admin">Administrator</option>
              </Select>
              {role === "admin" ? (
                <p className="text-muted-foreground text-xs">
                  Administrators can manage every user, space and setting.
                </p>
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

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  pending ||
                  !USERNAME_PATTERN.test(username) ||
                  !email ||
                  password.length < MIN_PASSWORD_LENGTH
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : null}
                Create user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
