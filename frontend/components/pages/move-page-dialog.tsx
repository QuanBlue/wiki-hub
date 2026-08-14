"use client";

import { ChevronDown, FolderInput, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { inputClassName } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import type { Space, WikiPage } from "@/types/api";

function pageHref(spaceKey: string, slug: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`;
}

function descendantIds(pages: WikiPage[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const page of pages) {
    if (!page.parent_id) continue;
    const children = childrenByParent.get(page.parent_id) ?? [];
    children.push(page.id);
    childrenByParent.set(page.parent_id, children);
  }

  const descendants = new Set<string>([rootId]);
  const pending = [rootId];
  while (pending.length > 0) {
    const pageId = pending.pop();
    if (!pageId) continue;
    for (const childId of childrenByParent.get(pageId) ?? []) {
      if (descendants.has(childId)) continue;
      descendants.add(childId);
      pending.push(childId);
    }
  }
  return descendants;
}

export function MovePageDialog({
  space,
  page,
  pages,
  open: controlledOpen,
  onOpenChange,
}: {
  space: Space;
  page: WikiPage;
  pages: WikiPage[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [destinationKey, setDestinationKey] = useState(space.key);
  const [destinationPages, setDestinationPages] = useState<WikiPage[]>(pages);
  const [parentId, setParentId] = useState(page.parent_id ?? "");
  const [parentSearch, setParentSearch] = useState("");
  const [parentOpen, setParentOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const excludedIds = useMemo(
    () => descendantIds(pages, page.id),
    [page.id, pages],
  );
  const parentPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialize the form from the page when the dialog opens
    setDestinationKey(space.key);
    setDestinationPages(pages);
    setParentId(page.parent_id ?? "");
    setParentSearch("");
    setParentOpen(false);
    setLoading(true);
    void api
      .get<Space[]>("/api/v1/spaces")
      .then(setSpaces)
      .catch(() => toast.error("Could not load spaces."))
      .finally(() => setLoading(false));
  }, [open, page.parent_id, pages, space.key]);

  async function selectDestination(nextKey: string) {
    setDestinationKey(nextKey);
    setParentId("");
    setParentSearch("");
    setParentOpen(false);
    if (nextKey === space.key) {
      setDestinationPages(pages);
      return;
    }

    setLoading(true);
    try {
      setDestinationPages(
        await api.get<WikiPage[]>(
          `/api/v1/spaces/${encodeURIComponent(nextKey)}/pages`,
        ),
      );
    } catch {
      setDestinationPages([]);
      toast.error("Could not load pages in that space.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!parentOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!parentPickerRef.current?.contains(event.target as Node)) {
        setParentOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [parentOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const moved = await api.post<WikiPage>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(page.slug)}/move`,
        {
          destination_space_key: destinationKey,
          parent_id: parentId || null,
        },
      );
      const destination = spaces.find((item) => item.key === destinationKey);
      toast.success(
        `Moved "${moved.title}"${destination ? ` to ${destination.name}` : ""}.`,
      );
      setOpen(false);
      router.push(pageHref(destinationKey, moved.slug));
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not move this page.",
      );
    } finally {
      setPending(false);
    }
  }

  const eligibleParents = destinationPages.filter((candidate) => {
    const isEligible =
      destinationKey !== space.key || !excludedIds.has(candidate.id);
    const matchesSearch = candidate.title
      .toLocaleLowerCase()
      .includes(parentSearch.toLocaleLowerCase());
    return isEligible && matchesSearch;
  });
  const selectedParent = destinationPages.find(
    (candidate) => candidate.id === parentId,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined ? (
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <FolderInput />
            Move
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        title="Move page"
        description="The page and any child pages move together."
        className="overflow-visible"
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="move-page-space">Destination space</Label>
            <Select
              value={destinationKey}
              onValueChange={(value) => void selectDestination(value)}
              disabled={loading || pending}
            >
              <SelectTrigger id="move-page-space" aria-label="Destination space">
                <SelectValue>
                  {spaces.find((candidate) => candidate.key === destinationKey)?.name ?? space.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
              {spaces.length === 0 ? (
                <SelectItem value={space.key}>{space.name}</SelectItem>
              ) : null}
              {spaces.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.key}>
                  {candidate.name} ({candidate.key})
                </SelectItem>
              ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="move-page-parent">Parent page</Label>
            <div ref={parentPickerRef} className="relative">
              <Search
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2"
              />
              <input
                id="move-page-parent"
                type="search"
                role="combobox"
                aria-expanded={parentOpen}
                aria-controls="move-page-parent-options"
                value={
                  parentOpen ? parentSearch : (selectedParent?.title ?? "")
                }
                onFocus={() => {
                  setParentSearch("");
                  setParentOpen(true);
                }}
                onChange={(event) => {
                  setParentSearch(event.target.value);
                  setParentOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setParentOpen(false);
                }}
                placeholder="Top-level page"
                className={`${inputClassName} pr-9 pl-9`}
                disabled={loading || pending}
              />
              <ChevronDown
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
              />
              {parentOpen ? (
                <div
                  id="move-page-parent-options"
                  role="listbox"
                  className="border-border bg-surface-raised absolute z-20 mt-1 max-h-[min(13rem,calc(100vh-18rem))] w-full overflow-y-auto rounded-md border p-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={!parentId}
                    onClick={() => {
                      setParentId("");
                      setParentSearch("");
                      setParentOpen(false);
                    }}
                    className="text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex min-h-8 w-full cursor-pointer items-center rounded px-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    Top-level page
                  </button>
                  {eligibleParents.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      role="option"
                      aria-selected={parentId === candidate.id}
                      onClick={() => {
                        setParentId(candidate.id);
                        setParentSearch("");
                        setParentOpen(false);
                      }}
                      className="text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex min-h-8 w-full cursor-pointer items-center rounded px-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {candidate.title}
                    </button>
                  ))}
                  {eligibleParents.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-1.5 text-sm">
                      No matching pages.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="submit"
              variant="primary"
              disabled={loading || pending}
            >
              {pending ? <Loader2 className="animate-spin" /> : <FolderInput />}
              {pending ? "Moving..." : "Move page"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
