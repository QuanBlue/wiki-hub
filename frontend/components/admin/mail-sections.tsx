"use client";

import { History, Mail, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { MailboxPanel } from "@/components/admin/mailbox-panel";
import { MailDeliveryLogs } from "@/components/admin/mail-delivery-logs";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { AdminAccount, AdminMailbox } from "@/types/api";

type SectionId = "mailboxes" | "logs";

export function MailSections({
  initialMailboxes,
  administrators,
  initialUpdateId,
  currentUserId,
  currentUserIsProtected,
}: {
  initialMailboxes: AdminMailbox[];
  administrators: AdminAccount[];
  initialUpdateId?: string;
  currentUserId: string;
  currentUserIsProtected: boolean;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<SectionId>("mailboxes");
  const [logsMounted, setLogsMounted] = useState(false);

  const sections: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
    { id: "mailboxes", label: t("adminMail.sectionMailboxes"), icon: Mail },
    { id: "logs", label: t("adminMail.sectionLogs"), icon: History },
  ];

  function selectSection(id: SectionId) {
    setActive(id);
    if (id === "logs") setLogsMounted(true);
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside
        aria-label={t("adminMail.sectionsLabel")}
        className="border-border border-r pr-5 lg:sticky lg:top-24"
      >
        <p className="text-muted-foreground px-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
          {t("adminMail.sectionsLabel")}
        </p>
        <div
          role="tablist"
          aria-orientation="vertical"
          className="mt-3 space-y-1"
        >
          {sections.map(({ id, label, icon: Icon }) => {
            const selected = active === id;
            return (
              <button
                key={id}
                id={`mail-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`mail-panel-${id}`}
                onClick={() => selectSection(id)}
                className={cn(
                  "focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  selected
                    ? "bg-surface-selected text-primary hover:bg-surface-hover font-semibold"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground font-normal",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </aside>

      <div className="min-w-0">
        <div
          id="mail-panel-mailboxes"
          role="tabpanel"
          aria-labelledby="mail-tab-mailboxes"
          hidden={active !== "mailboxes"}
        >
          <MailboxPanel
            initialMailboxes={initialMailboxes}
            administrators={administrators}
            initialUpdateId={initialUpdateId}
            currentUserId={currentUserId}
            currentUserIsProtected={currentUserIsProtected}
          />
        </div>
        <div
          id="mail-panel-logs"
          role="tabpanel"
          aria-labelledby="mail-tab-logs"
          hidden={active !== "logs"}
        >
          {logsMounted ? <MailDeliveryLogs mailboxes={initialMailboxes} /> : null}
        </div>
      </div>
    </div>
  );
}
