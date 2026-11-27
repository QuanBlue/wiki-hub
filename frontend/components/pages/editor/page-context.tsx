"use client";

import { createContext, useContext } from "react";
import type { WikiPage } from "@/types/api";

export interface EditorSpacePageContextValue {
  spaceKey: string;
  currentPageId: string | null;
  currentPageSlug: string | null;
  pages: WikiPage[];
}

const EditorSpacePageContext = createContext<EditorSpacePageContextValue | null>(
  null,
);

export const EditorSpacePageProvider = EditorSpacePageContext.Provider;

export function useEditorSpacePageContext(): EditorSpacePageContextValue | null {
  return useContext(EditorSpacePageContext);
}
