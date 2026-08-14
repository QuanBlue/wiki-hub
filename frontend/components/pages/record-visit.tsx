"use client";

import { useEffect } from "react";

import { recordVisit } from "@/lib/recently-visited";

/**
 * Renders nothing - it only records that this page was opened, for the
 * "Recently visited" sidebar entry. Lives in the page route rather than
 * `SpaceWorkspace` itself so the (much larger) workspace component doesn't
 * need to know this bookkeeping exists.
 */
export function RecordVisit({
  spaceKey,
  spaceName,
  slug,
  title,
}: {
  spaceKey: string;
  spaceName: string;
  slug: string;
  title: string;
}) {
  useEffect(() => {
    recordVisit({
      spaceKey,
      spaceName,
      slug,
      title,
      visitedAt: new Date().toISOString(),
    });
  }, [spaceKey, spaceName, slug, title]);

  return null;
}
