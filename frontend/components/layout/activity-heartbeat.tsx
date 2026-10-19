"use client";

import { useEffect } from "react";

import { api } from "@/lib/api-client";

/** Matches the server's heartbeat credit: one beat accounts for at most this long. */
export const HEARTBEAT_MS = 60_000;

const INPUT_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "scroll",
  "touchstart",
] as const;

function beat() {
  void api.post("/api/v1/users/me/activity").catch(() => undefined);
}

/**
 * Tells the server, once a minute, that this person is using WikiHub, which
 * feeds the active-people and active-time statistics. A beat is sent only for
 * a minute in which the tab was visible and the person touched it (read by
 * scrolling, typed, clicked), so a tab left open in the background counts no
 * time. Renders nothing.
 */
export function ActivityHeartbeat() {
  useEffect(() => {
    let touched = false;
    const touch = () => {
      touched = true;
    };
    for (const name of INPUT_EVENTS) {
      window.addEventListener(name, touch, { capture: true, passive: true });
    }
    // Opening a page is itself activity.
    beat();
    const timer = window.setInterval(() => {
      if (touched && document.visibilityState === "visible") beat();
      touched = false;
    }, HEARTBEAT_MS);
    return () => {
      window.clearInterval(timer);
      for (const name of INPUT_EVENTS) {
        window.removeEventListener(name, touch, { capture: true });
      }
    };
  }, []);
  return null;
}
