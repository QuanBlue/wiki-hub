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
import { useTranslation } from "@/lib/i18n/context";
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
  const { t } = useTranslation();
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
      toast.success(t("pageCreate.createdToast", { title: page.title }));
      setOpen(false);
      setTitle("");
      setContent("");
      router.push(
        `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(page.slug)}`,
      );
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("pageCreate.createError"),
      );
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          aria-label={triggerLabel || t("pageCreate.newPageAria")}
          title={triggerLabel || t("pageCreate.newPageAria")}
        >
          <FilePlus2 />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={parentPage ? t("pageCreate.createChildTitle") : t("pageCreate.createTitle")}
        description={
          parentPage
            ? t("pageCreate.createChildDescription", { title: parentPage.title })
            : t("pageCreate.createTopLevelDescription")
        }
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="page-title">{t("pageCreate.titleLabel")}</Label>
            <input
              id="page-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={inputClassName}
              placeholder={t("pageCreate.titlePlaceholder")}
              autoFocus
              required
              maxLength={255}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="page-content">{t("pageCreate.contentLabel")}</Label>
            <textarea
              id="page-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className={cn(inputClassName, "min-h-40 resize-y py-2 leading-6")}
              placeholder={t("pageCreate.contentPlaceholder")}
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
              {pending ? t("pageCreate.creating") : t("pageCreate.createTitle")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
