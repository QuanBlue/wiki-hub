"use client";

import { FilePlus2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { inputClassName } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { WikiPage } from "@/types/api";

export function CreatePageDialog({
  spaceKey,
  parentPage,
  triggerLabel = "Create page",
  triggerVariant = "primary",
  triggerSize = "md",
}: {
  spaceKey: string;
  parentPage?: Pick<WikiPage, "id" | "title"> | null;
  triggerLabel?: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setPending(true);
    try {
      const page = await api.post<WikiPage>(
        `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages`,
        {
          title: trimmedTitle,
          content,
          parent_id: parentPage?.id ?? null,
        },
      );
      toast.success(`Page "${page.title}" created.`);
      setOpen(false);
      setTitle("");
      setContent("");
      router.push(
        `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(page.slug)}`,
      );
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not create page.",
      );
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          <FilePlus2 />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={parentPage ? "Create child page" : "Create page"}
        description={
          parentPage
            ? `Add a page under "${parentPage.title}".`
            : "Add a top-level page to this space."
        }
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="page-title">Title</Label>
            <input
              id="page-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={inputClassName}
              placeholder="Meeting notes, runbook, project brief..."
              autoFocus
              required
              maxLength={255}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="page-content">Content</Label>
            <textarea
              id="page-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className={cn(inputClassName, "min-h-40 resize-y py-2 leading-6")}
              placeholder="Start writing..."
              maxLength={200000}
            />
          </div>

          <DialogFooter>
            <Button
              type="submit"
              variant="primary"
              disabled={pending || !title.trim()}
            >
              {pending ? <Loader2 className="animate-spin" /> : <FilePlus2 />}
              {pending ? "Creating..." : "Create page"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
