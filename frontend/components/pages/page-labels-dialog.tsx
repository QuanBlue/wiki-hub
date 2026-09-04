"use client";

import { Loader2, Plus, Tag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import type { PageLabel } from "@/types/api";

export function PageLabelsDialog({ spaceKey, slug, open, onOpenChange, onChange }: { spaceKey: string; slug: string; open: boolean; onOpenChange: (open: boolean) => void; onChange: (labels: PageLabel[]) => void }) {
  const [labels, setLabels] = useState<PageLabel[]>([]);
  const [name, setName] = useState("");
  const path = `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}/labels`;
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const loading = open && loadedPath !== path;

  useEffect(() => {
    if (!open) return;
    void api.get<PageLabel[]>(path).then((next) => { setLabels(next); onChange(next); }).catch(() => toast.error("Could not load page labels.")).finally(() => setLoadedPath(path));
  }, [open, path, onChange]);

  async function addLabel() {
    const value = name.trim();
    if (!value) return;
    try {
      const next = await api.post<PageLabel>(path, { name: value });
      const all = [...labels, next];
      setLabels(all); onChange(all); setName("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not add label."); }
  }

  async function removeLabel(label: PageLabel) {
    try {
      await api.delete(`${path}/${encodeURIComponent(label.id)}`);
      const next = labels.filter((item) => item.id !== label.id);
      setLabels(next); onChange(next);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not remove label."); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent title="Page labels" description="These labels are private to your account.">
    <div className="flex gap-2"><Input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addLabel(); }} placeholder="Add a label" maxLength={64} /><Button type="button" onClick={() => void addLabel()} disabled={!name.trim()}><Plus /> Add</Button></div>
    {loading ? <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm"><Loader2 className="animate-spin" /> Loading labels...</div> : <div className="mt-4 flex flex-wrap gap-2">{labels.map((label) => <span key={label.id} className="bg-primary-subtle text-primary inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"><Tag className="size-3" />{label.name}<button type="button" onClick={() => void removeLabel(label)} aria-label={`Remove ${label.name}`} className="hover:bg-primary/10 focus-visible:ring-ring rounded-full p-0.5 focus-visible:ring-2 focus-visible:outline-none"><Trash2 className="size-3" /></button></span>)}{labels.length === 0 && !loading ? <p className="text-muted-foreground text-sm">No labels yet.</p> : null}</div>}
  </DialogContent></Dialog>;
}
