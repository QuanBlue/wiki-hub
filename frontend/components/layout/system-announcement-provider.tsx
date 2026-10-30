"use client";

import { createContext, useContext, useMemo } from "react";
import type { SystemAnnouncement } from "@/types/api";

interface SystemAnnouncementContextValue {
  announcement: SystemAnnouncement | null;
  isAdmin: boolean;
}

const DEFAULT_VALUE: SystemAnnouncementContextValue = {
  announcement: null,
  isAdmin: false,
};

const SystemAnnouncementContext =
  createContext<SystemAnnouncementContextValue>(DEFAULT_VALUE);

export function SystemAnnouncementProvider({
  announcement,
  isAdmin,
  children,
}: {
  announcement: SystemAnnouncement | null | undefined;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      announcement: announcement ?? null,
      isAdmin,
    }),
    [announcement, isAdmin],
  );

  return (
    <SystemAnnouncementContext.Provider value={value}>
      {children}
    </SystemAnnouncementContext.Provider>
  );
}

export function useSystemAnnouncement() {
  return useContext(SystemAnnouncementContext);
}

