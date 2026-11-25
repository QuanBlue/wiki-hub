"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  loadAttached,
  loadDraft,
  NEW_BOX,
  saveAttached,
  saveDraft,
  type ChatFile,
} from "@/lib/ai-chat";

/** A file in the question box: being read, ready to go with a question, or refused. */
export type FileChip = {
  key: string;
  filename: string;
  status: "reading" | "ready" | "failed";
  id?: string;
  error?: string;
};

/** What waits in one thread's question box: the words, the files and the file asked about. */
type Box = { draft: string; chips: FileChip[]; scope: ChatFile | null };

const EMPTY_BOX: Box = { draft: "", chips: [], scope: null };

function readBox(userId: string, id: string): Box {
  return {
    draft: loadDraft(userId, id),
    chips: loadAttached(userId, id).map((kept) => ({
      key: kept.id,
      filename: kept.filename,
      status: "ready" as const,
      id: kept.id,
    })),
    scope: null,
  };
}

/**
 * The question box of each thread (``NEW_BOX`` for a chat not asked anything yet), so words
 * and files waiting in one are not carried into another. The words and the files that were
 * read are kept in the browser. ``ready`` turns true once the browser's threads are read.
 */
export function useChatBox(userId: string, boxId: string, ready: boolean) {
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  // What the browser kept of a box not touched here yet.
  const stored = useMemo(
    () => readBox(userId, boxId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again once ``ready``
    [userId, boxId, ready],
  );
  const box = boxes[boxId] ?? stored;

  const saved = useRef(new Map<string, Box>());
  useEffect(() => {
    for (const [id, next] of Object.entries(boxes)) {
      if (saved.current.get(id) === next) continue;
      saved.current.set(id, next);
      saveDraft(userId, next.draft, id);
      saveAttached(
        userId,
        next.chips.flatMap((chip) =>
          chip.status === "ready" && chip.id
            ? [{ id: chip.id, filename: chip.filename }]
            : [],
        ),
        id,
      );
    }
  }, [userId, boxes]);

  const update = useCallback(
    (id: string, change: (current: Box) => Box) =>
      setBoxes((all) => ({
        ...all,
        [id]: change(all[id] ?? readBox(userId, id)),
      })),
    [userId],
  );

  const setDraft = useCallback(
    (draft: string) => update(boxId, (current) => ({ ...current, draft })),
    [boxId, update],
  );

  /** ``into`` names the box when it may not be the one shown (a file that was being read). */
  const setChips = useCallback(
    (change: (chips: FileChip[]) => FileChip[], into: string = boxId) =>
      update(into, (current) => ({ ...current, chips: change(current.chips) })),
    [boxId, update],
  );

  const setScope = useCallback(
    (scope: ChatFile | null) =>
      update(boxId, (current) => ({ ...current, scope })),
    [boxId, update],
  );

  /** A new chat got its first question and became ``threadId``: its box goes with it. */
  const started = useCallback(
    (threadId: string, kept: { chips: FileChip[]; scope: ChatFile | null }) => {
      update(threadId, () => ({ draft: "", ...kept }));
      update(NEW_BOX, () => EMPTY_BOX);
    },
    [update],
  );

  /** Forget the box of a removed thread. */
  const drop = useCallback((id: string) => {
    saved.current.delete(id);
    setBoxes((all) => {
      const { [id]: _gone, ...rest } = all;
      return rest;
    });
  }, []);

  return { ...box, setDraft, setChips, setScope, started, drop };
}
