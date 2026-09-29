import {
  Bell,
  Inbox,
  KeyRound,
  LayoutGrid,
  ShieldCheck,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { AppNotification } from "@/types/api";

/** How a notification reads at a glance; drives its colour and toast style. */
export type NotificationTone = "success" | "info" | "warning";

interface KindMeta {
  icon: LucideIcon;
  tone: NotificationTone;
}

/**
 * What each kind of event looks like. The wording itself lives in the
 * dictionary under `notifications.kind.<kind>`, so it follows the reader's
 * language; a kind this build does not know still shows, with a generic line.
 */
const KINDS: Record<string, KindMeta> = {
  space_member_added: { icon: LayoutGrid, tone: "success" },
  space_role_changed: { icon: LayoutGrid, tone: "info" },
  space_member_removed: { icon: LayoutGrid, tone: "warning" },
  space_permission_granted: { icon: LayoutGrid, tone: "success" },
  space_permission_revoked: { icon: LayoutGrid, tone: "warning" },
  space_owner_added: { icon: LayoutGrid, tone: "success" },
  space_owner_removed: { icon: LayoutGrid, tone: "warning" },
  group_member_added: { icon: Users, tone: "success" },
  group_member_removed: { icon: Users, tone: "warning" },
  password_reset_by_admin: { icon: KeyRound, tone: "warning" },
  role_changed: { icon: ShieldCheck, tone: "info" },
  global_permissions_changed: { icon: ShieldCheck, tone: "info" },
  account_enabled: { icon: UserCheck, tone: "success" },
  admin_request: { icon: Inbox, tone: "info" },
};

const FALLBACK: KindMeta = { icon: Bell, tone: "info" };

export function notificationMeta(kind: string): KindMeta {
  return KINDS[kind] ?? FALLBACK;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A translated word for a param value, or the value itself when there is none. */
function word(t: Translate, group: string, value: string | undefined): string {
  if (!value) return "";
  const key = `notifications.${group}.${value}`;
  const translated = t(key);
  return translated === key ? value : translated;
}

/** The sentence for one notification, in the reader's language. */
export function describeNotification(t: Translate, item: AppNotification): string {
  const key = `notifications.kind.${item.kind}`;
  const known = t(key) !== key;
  if (!known) return t("notifications.kind.unknown");
  const p = item.params;
  return t(key, {
    actor: item.actor_name ?? t("notifications.someone"),
    space: p.space ?? "",
    group: p.group ?? "",
    name: p.name ?? "",
    role: word(t, "role", p.role),
    permission: word(t, "permission", p.permission),
    type: word(t, "requestType", p.type),
  });
}
