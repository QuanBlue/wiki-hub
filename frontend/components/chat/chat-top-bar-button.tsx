"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { toggleChat } from "@/lib/ai-chat";
import { aiStatus } from "@/lib/ai-summary";
import { useTranslation } from "@/lib/i18n/context";

/**
 * The button in the top bar that opens and closes the chat panel. It lives in the bar, not
 * floating over the page, so it can never cover a button or the end of a page. Like the panel,
 * it does not exist while the AI assistant is off.
 */
export function ChatTopBarButton() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    void aiStatus().then((status) => {
      if (alive) setEnabled(status.enabled === true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!enabled) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleChat}
      aria-label={t("chat.open")}
      title={t("chat.open")}
      // The panel puts itself away on a click outside it; this click is the one that toggles it.
      data-chat-toggle
    >
      <Sparkles className="size-4" aria-hidden />
    </Button>
  );
}
