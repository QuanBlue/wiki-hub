"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Re-fetches the current server-rendered view in place (filters, sort and
 * page stay as they are) - for data like online presence that goes stale
 * while the page is open. */
export function RefreshButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw className={cn("size-4", pending && "animate-spin")} />
    </Button>
  );
}
