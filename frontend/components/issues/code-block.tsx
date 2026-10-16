"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/context";

/** A fenced block of code as a card: the language on the left, a button to copy it on the right. */
export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return; // not allowed here (plain http, no permission): nothing to confirm
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="border-border bg-surface-sunken my-3 overflow-hidden rounded-2xl border">
      <div className="text-muted-foreground flex items-center justify-between px-4 pt-2.5 text-xs">
        <span className="font-medium">{language || t("chat.code")}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? t("chat.copied") : t("chat.copy")}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 pt-2 pb-3.5 font-mono text-xs leading-5">
        <code>{code}</code>
      </pre>
    </div>
  );
}
