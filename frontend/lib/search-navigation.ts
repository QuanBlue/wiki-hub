import {
  Activity,
  BarChart3,
  Bell,
  Bookmark,
  Bug,
  Clock,
  Database,
  FolderCog,
  HardDrive,
  Home,
  Keyboard,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  MessageCircle,
  Mail,
  MessageSquareWarning,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  User,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

import { foldText } from "@/lib/search-highlight";
import type { Me } from "@/types/api";

/** Who may see an entry. The backend still enforces the real boundary. */
type Access = "everyone" | "admin" | "manage_users" | "manage_groups" | "manage_issues";

export interface NavigationEntry {
  /** Dictionary key suffix: `searchNav.<id>` is the label, `searchNav.<id>Hint` the line under it. */
  id: string;
  href: string;
  icon: LucideIcon;
  access: Access;
  /** Other words people type for it, in English and Vietnamese (matched without accents). */
  keywords: string;
  /** What follows ":" in the search box to jump here ("help" for ":help"). */
  command?: string;
}

/** Typed shortcuts: ":help" opens the guide, ":users" user management, and so on. */
const COMMANDS: Record<string, string> = {
  home: "home",
  spaces: "spaces",
  recent: "recent",
  favorites: "favorites",
  saved: "saved",
  issues: "issues",
  help: "help",
  contactAdmin: "contact",
  profile: "account",
  changePassword: "password",
  security: "security",
  sessions: "sessions",
  shortcuts: "shortcuts",
  adminUsers: "users",
  adminGroups: "groups",
  adminSpaces: "manage-spaces",
  adminIssues: "manage-issues",
  statistics: "stats",
  monitor: "server",
  settings: "settings",
  backup: "backup",
  storage: "storage",
  mail: "mail",
  ai: "ai",
};

/** Commands that act instead of navigating; the search box carries them out. */
export const ACTION_ENTRIES: NavigationEntry[] = [
  { id: "chat", href: "", icon: MessageCircle, access: "everyone", keywords: "", command: "chat" },
  { id: "ask", href: "", icon: Sparkles, access: "everyone", keywords: "", command: "ask" },
];

export const NAVIGATION_ENTRIES: NavigationEntry[] = [
  { id: "home", href: "/", icon: Home, access: "everyone", keywords: "home dashboard trang chu" },
  { id: "spaces", href: "/spaces", icon: LayoutGrid, access: "everyone", keywords: "spaces directory browse khong gian danh sach" },
  { id: "recent", href: "/recent", icon: Clock, access: "everyone", keywords: "recent history visited worked on gan day lich su da xem" },
  { id: "favorites", href: "/favorites", icon: Star, access: "everyone", keywords: "favorites favourites starred yeu thich" },
  { id: "saved", href: "/saved", icon: Bookmark, access: "everyone", keywords: "saved bookmarks read later da luu" },
  { id: "issues", href: "/issues", icon: Bug, access: "everyone", keywords: "issues report bug feedback loi bao loi phan hoi" },
  { id: "help", href: "/help", icon: LifeBuoy, access: "everyone", keywords: "help guide docs how to support tro giup huong dan" },
  { id: "contactAdmin", href: "/contact-admin", icon: MessageSquareWarning, access: "everyone", keywords: "contact administrator request access lien he quan tri yeu cau quyen" },
  { id: "profile", href: "/account", icon: UserRound, access: "everyone", keywords: "account profile name avatar email tai khoan ho so ca nhan trang ca nhan" },
  { id: "changePassword", href: "/account?tab=security&action=password", icon: KeyRound, access: "everyone", keywords: "change password reset security doi mat khau bao mat" },
  { id: "security", href: "/account?tab=security", icon: ShieldCheck, access: "everyone", keywords: "security sign in authentication password bao mat xac thuc dang nhap" },
  { id: "sessions", href: "/account?tab=sessions", icon: Bell, access: "everyone", keywords: "sessions devices logout sign out phien dang nhap thiet bi dang xuat" },
  { id: "shortcuts", href: "/account?tab=shortcuts", icon: Keyboard, access: "everyone", keywords: "keyboard shortcuts hotkeys keybindings phim tat" },
  { id: "adminUsers", href: "/admin/users", icon: User, access: "manage_users", keywords: "users manage users accounts people administrators quan ly user nguoi dung tai khoan" },
  { id: "adminGroups", href: "/admin/groups", icon: Users, access: "manage_groups", keywords: "groups teams members nhom thanh vien" },
  { id: "adminSpaces", href: "/admin/spaces", icon: FolderCog, access: "admin", keywords: "manage spaces archive delete space quan ly khong gian" },
  { id: "adminIssues", href: "/admin/issues", icon: Bug, access: "manage_issues", keywords: "manage issues triage quan ly loi" },
  { id: "statistics", href: "/admin/statistics", icon: BarChart3, access: "admin", keywords: "statistics analytics usage thong ke" },
  { id: "monitor", href: "/admin/monitor", icon: Activity, access: "admin", keywords: "server monitor health status logs may chu giam sat" },
  { id: "settings", href: "/admin/settings", icon: SlidersHorizontal, access: "admin", keywords: "settings administration theme branding site name cai dat quan tri giao dien" },
  { id: "backup", href: "/admin/backup", icon: Database, access: "admin", keywords: "backup restore import confluence export sao luu khoi phuc nhap" },
  { id: "storage", href: "/admin/storage", icon: HardDrive, access: "admin", keywords: "storage files attachments disk minio luu tru tep dinh kem" },
  { id: "mail", href: "/admin/mail", icon: Mail, access: "admin", keywords: "mail email smtp mailboxes notifications thu hop thu" },
  { id: "ai", href: "/admin/ai", icon: Sparkles, access: "admin", keywords: "ai assistant model chat openai tro ly tri tue nhan tao" },
];

function isAdmin(user: Me): boolean {
  return user.is_superuser || user.global_permissions.includes("system_admin");
}

export function canSeeEntry(entry: NavigationEntry, user: Me): boolean {
  switch (entry.access) {
    case "everyone":
      return true;
    case "admin":
      return isAdmin(user);
    default:
      return isAdmin(user) || user.global_permissions.includes(entry.access);
  }
}

export interface NavigationMatch {
  entry: NavigationEntry;
  label: string;
  hint: string;
  /** Shown but not usable: the feature it needs is switched off (the AI assistant). */
  disabled?: boolean;
}

/**
 * The places in the app that answer `query`, limited to what `user` may open.
 * Every word typed must appear (accents and case ignored) in the entry's label,
 * its description or its keywords, so "đổi mật khẩu" and "change password" both land.
 */
export function matchNavigation(
  query: string,
  user: Me | null | undefined,
  t: (key: string) => string,
  limit = 5,
): NavigationMatch[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!user || words.length === 0) return [];

  const scored: { match: NavigationMatch; score: number }[] = [];
  for (const entry of NAVIGATION_ENTRIES) {
    if (!canSeeEntry(entry, user)) continue;
    const label = t(`searchNav.${entry.id}`);
    const hint = t(`searchNav.${entry.id}Hint`);
    const foldedLabel = foldText(label);
    const haystack = `${foldedLabel} ${foldText(hint)} ${foldText(entry.keywords)}`;
    if (!words.every((word) => haystack.includes(word))) continue;
    const inLabel = words.every((word) => foldedLabel.includes(word));
    const score = foldedLabel.startsWith(words[0]!) ? 0 : inLabel ? 1 : 2;
    scored.push({ match: { entry, label, hint }, score });
  }
  // Array.sort is stable, so equally good matches keep the order above.
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((item) => item.match);
}

/** `:name rest` typed in the search box, or null for an ordinary search. */
export function parseCommand(query: string): { name: string; rest: string } | null {
  const match = /^\s*:(\S*)\s*([\s\S]*)$/.exec(query);
  return match ? { name: match[1]!.toLowerCase(), rest: match[2]!.trim() } : null;
}

/**
 * The commands whose name starts with what follows ":", for what `user` may open.
 * ":chat" and ":ask" stay listed while the AI assistant is off, but disabled.
 */
export function matchCommands(
  name: string,
  user: Me | null | undefined,
  t: (key: string) => string,
  aiOn: boolean,
): NavigationMatch[] {
  if (!user) return [];
  const all = [
    ...NAVIGATION_ENTRIES.map((entry) => ({ ...entry, command: COMMANDS[entry.id] })),
    ...ACTION_ENTRIES,
  ];
  return all
    .filter((entry) => entry.command?.startsWith(name) && canSeeEntry(entry, user))
    .map((entry) => {
      const off = !aiOn && ACTION_ENTRIES.includes(entry);
      return {
        entry,
        label: t(`searchNav.${entry.id}`),
        hint: off ? t("searchNav.aiOff") : t(`searchNav.${entry.id}Hint`),
        disabled: off,
      };
    });
}
