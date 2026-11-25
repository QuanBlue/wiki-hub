"use client";

import { Globe, Layers, LayoutTemplate, Loader2 } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { inputClassName } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { savePageAsTemplate } from "@/lib/templates";
import { cn } from "@/lib/utils";
import type { PageTemplate, WikiPage } from "@/types/api";

export function SaveAsTemplateDialog({
  spaceKey,
  page,
  open,
  onOpenChange,
  canCreateGlobal = false,
  onSaved,
}: {
  spaceKey: string;
  page: Pick<WikiPage, "id" | "title">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreateGlobal?: boolean;
  onSaved?: (template: PageTemplate) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(page.title);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState<"space" | "global">("space");
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setName(page.title);
      setDescription("");
      setCategory("");
      setScope("space");
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || pending) return;

    setPending(true);
    try {
      const created = await savePageAsTemplate(spaceKey, page.id, {
        name: trimmedName,
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        scope: canCreateGlobal ? scope : "space",
      });
      toast.success(t("templates.savePageSuccess", { name: created.name }));
      onSaved?.(created);
      onOpenChange(false);
    } catch (error) {
      toast.error(describeApiError(error, t("templates.savePageError")));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg"
        title={t("templates.savePageTitle")}
        description={t("templates.savePageDescription", { title: page.title })}
      >
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="save-template-name">{t("templates.nameLabel")}</Label>
            <input
              id="save-template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClassName}
              placeholder={t("templates.namePlaceholder")}
              maxLength={120}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="save-template-description">
              {t("templates.descriptionLabel")}
            </Label>
            <textarea
              id="save-template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={cn(inputClassName, "min-h-20 resize-y py-2 leading-5")}
              placeholder={t("templates.descriptionPlaceholder")}
              maxLength={500}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="save-template-category">
              {t("templates.categoryLabel")}
            </Label>
            <input
              id="save-template-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={inputClassName}
              placeholder={t("templates.categoryPlaceholder")}
              maxLength={60}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-foreground text-sm font-medium">
              {t("templates.scopeLabel")}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                role="radio"
                aria-checked={scope === "space"}
                onClick={() => setScope("space")}
                className={cn(
                  "focus-visible:ring-ring flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  scope === "space"
                    ? "border-primary bg-primary-subtle/50 text-foreground"
                    : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                )}
              >
                <Layers className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="text-foreground block text-sm font-medium">
                    {t("templates.scopeSpaceOption")}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">
                    {t("templates.scopeSpaceOptionHint")}
                  </span>
                </span>
              </button>

              {canCreateGlobal ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === "global"}
                  onClick={() => setScope("global")}
                  className={cn(
                    "focus-visible:ring-ring flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    scope === "global"
                      ? "border-primary bg-primary-subtle/50 text-foreground"
                      : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                  )}
                >
                  <Globe className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="text-foreground block text-sm font-medium">
                      {t("templates.scopeGlobalOption")}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {t("templates.scopeGlobalOptionHint")}
                    </span>
                  </span>
                </button>
              ) : null}
            </div>
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={pending || !name.trim()}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <LayoutTemplate aria-hidden />
              )}
              {pending ? t("templates.saving") : t("templates.savePageAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
