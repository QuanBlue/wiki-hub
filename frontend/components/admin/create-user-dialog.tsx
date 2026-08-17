"use client";

import { KeyRound, Loader2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import type { Page, User } from "@/types/api";

const MIN_PASSWORD_LENGTH = 8;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UsernameCheck = "idle" | "checking" | "available" | "taken" | "error";

export function CreateUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheck>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const usernameInvalid =
    username.length > 0 && !USERNAME_PATTERN.test(username);
  const emailInvalid = email.length > 0 && !EMAIL_PATTERN.test(email.trim());
  const passwordHasLower = /[a-z]/.test(password);
  const passwordHasUpper = /[A-Z]/.test(password);
  const passwordHasNumberOrSymbol = /[0-9]|[^A-Za-z0-9]/.test(password);

  useEffect(() => {
    const normalized = username.trim();
    if (!normalized || !USERNAME_PATTERN.test(normalized)) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void api
        .get<Page<User>>(
          `/api/v1/users?q=${encodeURIComponent(normalized)}&limit=10&offset=0`,
        )
        .then((result) => {
          if (!active) return;
          const taken = result.items.some(
            (user) => user.username.toLowerCase() === normalized.toLowerCase(),
          );
          setUsernameCheck(taken ? "taken" : "available");
        })
        .catch(() => {
          if (active) setUsernameCheck("error");
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [username]);

  function reset() {
    setFirstName("");
    setLastName("");
    setUsername("");
    setEmail("");
    setPassword("");
    setRole("member");
    setUsernameCheck("idle");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (usernameCheck !== "available") return;
    setPending(true);
    setError(null);
    try {
      const created = await api.post<User>("/api/v1/users", {
        username: username.trim(),
        email: email.trim(),
        full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
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
      if (err instanceof ApiError && err.code === "username_taken")
        setUsernameCheck("taken");
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
          className="max-w-xl"
          title="Create a user"
          description="Add a workspace account with the right access level. The account becomes active immediately."
        >
          <div className="bg-primary-subtle text-primary mb-5 flex items-start gap-3 rounded-md px-3 py-2.5">
            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-xs leading-5">
              Share the temporary password securely. WikiHub does not send
              invitation e-mails.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-first-name">First name</Label>
                <Input
                  id="new-first-name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  placeholder="Jane"
                  autoComplete="given-name"
                  required
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-last-name">Last name</Label>
                <Input
                  id="new-last-name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  placeholder="Doe"
                  autoComplete="family-name"
                  required
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-username">Username</Label>
                <Input
                  id="new-username"
                  value={username}
                  onChange={(event) => {
                    const value = event.target.value;
                    setUsername(value);
                    setUsernameCheck(
                      USERNAME_PATTERN.test(value.trim()) ? "checking" : "idle",
                    );
                  }}
                  placeholder="jdoe"
                  autoComplete="username"
                  aria-invalid={
                    usernameInvalid || usernameCheck === "taken" || undefined
                  }
                  disabled={pending}
                  required
                />
                {usernameInvalid ? (
                  <p className="text-danger text-xs">
                    Use 3–64 letters, digits, dot, dash or underscore.
                  </p>
                ) : null}
                {usernameCheck === "checking" ? (
                  <p className="text-muted-foreground text-xs">
                    Checking availability…
                  </p>
                ) : null}
                {usernameCheck === "available" ? (
                  <p className="text-success text-xs">Username is available.</p>
                ) : null}
                {usernameCheck === "taken" ? (
                  <p className="text-danger text-xs">
                    This username is already in use.
                  </p>
                ) : null}
                {usernameCheck === "error" ? (
                  <p className="text-warning text-xs">
                    Could not check availability. Try again.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-email">E-mail</Label>
                <Input
                  id="new-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="jdoe@example.com"
                  autoComplete="email"
                  aria-invalid={emailInvalid || undefined}
                  disabled={pending}
                  required
                />
                {emailInvalid ? (
                  <p className="text-danger text-xs">
                    Enter a valid e-mail address.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-password">Password</Label>
                <PasswordInput
                  id="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  disabled={pending}
                  required
                />
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span
                    className={
                      password.length >= MIN_PASSWORD_LENGTH
                        ? "text-success"
                        : "text-danger"
                    }
                  >
                    ● 8+ characters
                  </span>
                  <span
                    className={
                      passwordHasUpper && passwordHasLower
                        ? "text-success"
                        : "text-danger"
                    }
                  >
                    ● upper and lower case
                  </span>
                  <span
                    className={
                      passwordHasNumberOrSymbol ? "text-success" : "text-danger"
                    }
                  >
                    ● number or symbol
                  </span>
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-role">Role</Label>
                <Select value={role} onValueChange={setRole} disabled={pending}>
                  <SelectTrigger id="new-role" aria-label="Role">
                    <SelectValue>
                      {role === "admin" ? "Administrator" : "Member"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Administrator</SelectItem>
                  </SelectContent>
                </Select>
                {role === "admin" ? (
                  <p className="text-muted-foreground text-xs">
                    Administrators can manage every user, space and setting.
                  </p>
                ) : null}
              </div>
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
                  !firstName.trim() ||
                  !lastName.trim() ||
                  !USERNAME_PATTERN.test(username.trim()) ||
                  usernameCheck !== "available" ||
                  !email.trim() ||
                  emailInvalid ||
                  password.length < MIN_PASSWORD_LENGTH ||
                  !passwordHasUpper ||
                  !passwordHasLower ||
                  !passwordHasNumberOrSymbol
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : null}Create
                user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
