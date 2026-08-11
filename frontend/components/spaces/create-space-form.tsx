"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api-client";
import type { Space } from "@/types/api";

/** Mirrors the backend's key rule so the user is told before a round trip. */
function deriveKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export function CreateSpaceForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const key = deriveKey(name);

  function reset() {
    setName("");
    setDescription("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const space = await api.post<Space>("/api/v1/spaces", {
        key,
        name: name.trim(),
        description: description.trim(),
        icon: "",
      });
      toast.success(`Space "${space.name}" created.`);
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not create the space.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus />
        Create space
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border bg-surface w-full rounded-lg border p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">New space</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          aria-label="Cancel"
        >
          <X />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="space-name" className="text-sm font-medium">
            Name
          </label>
          <Input
            id="space-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Engineering"
            required
            autoFocus
            disabled={pending}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="space-description" className="text-sm font-medium">
            Description
          </label>
          <Input
            id="space-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What lives in this space?"
            disabled={pending}
          />
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="border-danger/30 bg-danger/10 text-danger mt-3 rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={pending || !name || !key}
        >
          {pending ? (
            <>
              <Loader2 className="animate-spin" />
              Creating…
            </>
          ) : (
            "Create space"
          )}
        </Button>
      </div>
    </form>
  );
}
