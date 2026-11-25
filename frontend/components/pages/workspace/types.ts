import type { CommentsUser } from "@/components/comments/page-comments";
import type { Group, Space, SpaceMember, WikiPage } from "@/types/api";

export const SPACE_SIDEBAR_WIDTH_KEY = "wikihub:space-sidebar-width";
export const SPACE_SIDEBAR_WIDTH_COOKIE = "wikihub_space_sidebar_width";
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_SIDEBAR_WIDTH = 320;

export const MIN_PREVIEW_SPLIT = 30;
export const MAX_PREVIEW_SPLIT = 70;
export const SPACE_SIDEBAR_SCROLL_PREFIX = "wikihub:space-sidebar-scroll:";
export const TREE_EXPAND_PREFIX = "wikihub:page-tree-expanded:";

/**
 * Whether a page is closed to the world at large, and why. Two independent
 * things can close it - a view restriction on the page (or an ancestor) and a
 * restricted space - so the reason is spelled out rather than left to a guess.
 */
export type PageAccess = { restricted: boolean; labelKey: string };

export type PageLikeStatus = { liked_by_me: boolean; like_count: number };

export type EditMode = "normal" | "markdown" | "html";

export type AudienceSummary = {
  users: number;
  groups: number;
  everyone: boolean;
};

export type SpaceWorkspaceProps = {
  space: Space;
  pages: WikiPage[];
  members: SpaceMember[];
  groups: Group[];
  currentPage?: WikiPage | null;
  initialSidebarWidth?: number;
  canEdit: boolean;
  canExport: boolean;
  canManageRestrictions: boolean;
  /** Whether the current user has system_admin / superuser privileges. */
  isSystemAdmin?: boolean;
  /** Who is reading; enables the comments section under a page. */
  currentUser?: CommentsUser;
};
