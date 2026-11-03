"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { apiBaseUrl } from "@/lib/env";
import type { PageSavedEvent, PresenceHeartbeatResponse, PresenceUser } from "@/types/api";

interface UsePagePresenceOptions {
  spaceKey: string | null | undefined;
  pageSlug: string | null | undefined;
  editing: boolean;
  currentUserId?: string | null;
  onPageSaved?: (event: PageSavedEvent) => void;
}

export function usePagePresence({
  spaceKey,
  pageSlug,
  editing,
  currentUserId,
  onPageSaved,
}: UsePagePresenceOptions) {
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const onPageSavedRef = useRef(onPageSaved);
  onPageSavedRef.current = onPageSaved;

  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  const editingRef = useRef(editing);
  editingRef.current = editing;

  const lastKnownUpdatedAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!spaceKey || !pageSlug) {
      setActiveUsers([]);
      setIsConnected(false);
      return;
    }

    let active = true;
    let ws: WebSocket | null = null;
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let fallbackPollInterval: NodeJS.Timeout | null = null;
    let usePolling = false;

    function startHttpPolling() {
      if (!active || fallbackPollInterval) return;
      usePolling = true;

      const poll = async () => {
        if (!active) return;
        try {
          const res = await api.post<PresenceHeartbeatResponse>(
            `/api/v1/spaces/${encodeURIComponent(spaceKey!)}/pages/${encodeURIComponent(pageSlug!)}/presence/heartbeat`,
            { editing: editingRef.current },
          );
          if (!active) return;

          // Check if page updated while user is on it
          if (
            lastKnownUpdatedAtRef.current &&
            res.page_updated_at &&
            res.page_updated_at !== lastKnownUpdatedAtRef.current
          ) {
            onPageSavedRef.current?.({
              actor_id: "",
              actor_name: "",
              saved_at: res.page_updated_at,
              title: "",
            });
          }
          lastKnownUpdatedAtRef.current = res.page_updated_at;

          // Filter out current user from "other active users"
          const others = res.users.filter(
            (u) => !currentUserIdRef.current || u.user_id !== currentUserIdRef.current,
          );
          setActiveUsers(others);
          setIsConnected(true);
        } catch {
          if (active) setIsConnected(false);
        }
      };

      void poll();
      fallbackPollInterval = setInterval(poll, 12000);
    }

    // Try WebSocket connection first
    try {
      const base =
        (typeof apiBaseUrl === "function" ? apiBaseUrl() : apiBaseUrl) ||
        (typeof window !== "undefined" ? window.location.origin : "");
      const wsProtocol = base.startsWith("https") ? "wss:" : "ws:";
      const host = base.replace(/^https?:\/\//, "");
      const wsUrl = `${wsProtocol}//${host}/api/v1/spaces/${encodeURIComponent(
        spaceKey,
      )}/pages/${encodeURIComponent(pageSlug)}/presence/ws?editing=${editing ? "1" : "0"}`;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (!active) {
          ws?.close();
          return;
        }
        setIsConnected(true);

        heartbeatInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: "heartbeat", editing: editingRef.current }));
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        if (!active) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "sync" && Array.isArray(msg.users)) {
            if (msg.page_updated_at) {
              lastKnownUpdatedAtRef.current = msg.page_updated_at;
            }
            const others = (msg.users as PresenceUser[]).filter(
              (u) => !currentUserIdRef.current || u.user_id !== currentUserIdRef.current,
            );
            setActiveUsers(others);
          } else if (msg.type === "presence_update" && msg.user) {
            const user = msg.user as PresenceUser;
            if (currentUserIdRef.current && user.user_id === currentUserIdRef.current) return;
            setActiveUsers((prev) => {
              const filtered = prev.filter((u) => u.user_id !== user.user_id);
              return [...filtered, user].sort((a, b) => a.username.localeCompare(b.username));
            });
          } else if (msg.type === "presence_leave" && msg.user_id) {
            setActiveUsers((prev) => prev.filter((u) => u.user_id !== msg.user_id));
          } else if (msg.type === "page_saved") {
            const savedEvent = msg as PageSavedEvent;
            if (currentUserIdRef.current && savedEvent.actor_id === currentUserIdRef.current) return;
            lastKnownUpdatedAtRef.current = savedEvent.saved_at;
            onPageSavedRef.current?.(savedEvent);
          }
        } catch {
          // ignore invalid websocket frame
        }
      };

      ws.onerror = () => {
        if (!usePolling) {
          startHttpPolling();
        }
      };

      ws.onclose = () => {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (active && !usePolling) {
          startHttpPolling();
        }
      };
    } catch {
      startHttpPolling();
    }

    return () => {
      active = false;
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (fallbackPollInterval) clearInterval(fallbackPollInterval);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [spaceKey, pageSlug]);

  // When editing status changes while WS is connected, send update immediately
  useEffect(() => {
    // Polling will pick up editing state on next heartbeat
  }, [editing]);

  return { activeUsers, isConnected };
}
