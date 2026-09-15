"use client";

import { Undo2, UserRoundCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import type { User } from "@/types/api";

/**
 * Standing notice that the session is borrowed.
 *
 * Deliberately not dismissible and deliberately loud. The dangerous failure
 * mode of impersonation is forgetting you are in it and then acting — writing a
 * comment, deleting a space — believing you are yourself. A banner that can be
 * closed is a banner that will be closed.
 *
 * Pinned to the bottom rather than above the header: the top bar and sidebar
 * are `fixed`, so a bar above them would have to shift three separate offsets
 * that are otherwise constants. The bottom edge is just as unmissable and
 * costs the rest of the layout nothing.
 */
export function ImpersonationBanner({
  viewingAs,
  impersonator,
}: {
  viewingAs: User;
  impersonator: User;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { t, apiErrorText } = useTranslation();

  async function stop() {
    setPending(true);
    try {
      await api.delete<unknown>("/api/v1/auth/impersonate");
      router.replace("/");
      router.refresh();
    } catch (error) {
      toast.error(apiErrorText(error, "userMenu.returnToSelfError"));
      setPending(false);
    }
  }

  return (
    <div
      role="status"
      className="bg-warning-bg text-warning border-warning/30 fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t px-4 py-2 text-sm shadow-lg"
    >
      <UserRoundCog aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 truncate">
        {t("impersonation.viewingAsPrefix")}{" "}
        <strong className="font-semibold">
          {viewingAs.full_name || viewingAs.username}
        </strong>
        . {t("impersonation.recordedAs", { username: impersonator.username })}
      </p>
      <button
        type="button"
        onClick={() => void stop()}
        disabled={pending}
        className="border-warning/40 hover:bg-warning/10 active:bg-warning/20 focus-visible:ring-warning flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Undo2 aria-hidden className="size-3.5" />
        {pending ? t("impersonation.returning") : t("impersonation.returnToMyAccount")}
      </button>
    </div>
  );
}
