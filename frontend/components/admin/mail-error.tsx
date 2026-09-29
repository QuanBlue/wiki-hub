"use client";

import { mailErrorKey, tidyMailError } from "@/lib/admin-mail-ui";
import { useTranslation } from "@/lib/i18n/context";

/**
 * A mail-server failure in words an administrator can act on, with what the
 * server actually said folded away underneath for anyone who needs it (or
 * wants to search for it).
 */
export function MailError({ raw }: { raw: string | null | undefined }) {
  const { t } = useTranslation();
  const detail = raw ? tidyMailError(raw) : "";

  return (
    <>
      <span className="block">{t(mailErrorKey(raw))}</span>
      {detail ? (
        <details className="group mt-1">
          <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring w-fit cursor-pointer rounded text-xs underline-offset-2 transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none">
            {t("adminMail.technicalDetails")}
          </summary>
          <pre className="bg-surface-sunken text-muted-foreground mt-1 max-h-32 overflow-auto rounded-md px-2 py-1.5 text-[11px] leading-4 break-words whitespace-pre-wrap">
            {detail}
          </pre>
        </details>
      ) : null}
    </>
  );
}
