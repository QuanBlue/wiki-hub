"use client";

import { Keyboard, KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { ChangePasswordForm } from "@/components/account/change-password-form";
import { ProfileForm } from "@/components/account/profile-form";
import { ProfileSummary } from "@/components/account/profile-summary";
import { SessionsPanel } from "@/components/account/sessions-panel";
import { ShortcutSettings } from "@/components/account/shortcut-settings";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Me } from "@/types/api";

type AccountTab = "profile" | "security" | "sessions" | "shortcuts";

const tabs: { id: AccountTab; labelKey: string; icon: typeof UserRound }[] = [
  { id: "profile", labelKey: "account.tabProfile", icon: UserRound },
  { id: "security", labelKey: "account.tabSecurity", icon: ShieldCheck },
  { id: "sessions", labelKey: "account.tabSessions", icon: KeyRound },
  { id: "shortcuts", labelKey: "account.tabShortcuts", icon: Keyboard },
];

export function AccountSettings({ user }: { user: Me }) {
  const [activeTab, setActiveTab] = useState<AccountTab>("profile");
  const [profileEditing, setProfileEditing] = useState(false);
  const [passwordEditing, setPasswordEditing] = useState(false);
  const { t } = useTranslation();
  const tabRefs = useRef<Record<AccountTab, HTMLButtonElement | null>>({
    profile: null,
    security: null,
    sessions: null,
    shortcuts: null,
  });

  function selectTab(tab: AccountTab) {
    setActiveTab(tab);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentTab: AccountTab) {
    const currentIndex = tabs.findIndex((tab) => tab.id === currentTab);
    const nextIndex = event.key === "ArrowDown" ? (currentIndex + 1) % tabs.length
      : event.key === "ArrowUp" ? (currentIndex - 1 + tabs.length) % tabs.length
        : -1;

    if (nextIndex === -1) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex]!.id;
    selectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside
        role="tablist"
        aria-label={t("account.settingsAria")}
        className="border-border border-r pr-5 lg:sticky lg:top-24"
      >
        <p className="text-muted-foreground px-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
          {t("account.personalSettings")}
        </p>
        <div className="mt-3 space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[tab.id] = node;
                }}
                type="button"
                role="tab"
                id={tab.id + "-tab"}
                aria-controls={tab.id + "-panel"}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  isActive
                    ? "bg-surface-selected text-primary font-semibold hover:bg-surface-hover focus-visible:ring-ring"
                    : "text-muted-foreground font-normal hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
        <p className="border-border text-muted-foreground mt-5 border-t px-2 pt-4 text-xs leading-relaxed">
          {t("account.settingsHint")}
        </p>
      </aside>

      <div className="min-w-0">
      {activeTab === "profile" ? (
        <section id="profile-panel" role="tabpanel" aria-labelledby="profile-tab">
          {profileEditing ? (
            <ProfileForm
              user={user}
              onCancel={() => setProfileEditing(false)}
              onSaved={() => setProfileEditing(false)}
            />
          ) : (
            <ProfileSummary user={user} onEdit={() => setProfileEditing(true)} />
          )}
        </section>
      ) : activeTab === "security" ? (
        <section id="security-panel" role="tabpanel" aria-labelledby="security-tab">
          {passwordEditing ? (
            <div>
              <div className="mb-6">
                <h2 className="font-semibold">{t("account.changePasswordTitle")}</h2>
                <p className="text-muted-foreground mt-1 text-sm">{t("account.changePasswordHint")}</p>
              </div>
              <ChangePasswordForm
                onCancel={() => setPasswordEditing(false)}
                onSuccess={() => setPasswordEditing(false)}
              />
            </div>
          ) : (
            <div className="max-w-4xl">
              <h2 className="text-xl font-semibold tracking-tight">{t("account.signInMethods")}</h2>
              <div className="border-border mt-5 overflow-hidden rounded-lg border">
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                  <span className="bg-surface-sunken text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
                    <Mail className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{t("account.emailPassword")}</h3>
                    <p className="text-muted-foreground mt-1 text-sm">{t("account.emailPasswordHint", { email: user.email })}</p>
                  </div>
                  <Button variant="secondary" onClick={() => setPasswordEditing(true)}>
                    {t("account.changePassword")}
                  </Button>
                </div>

                <div className="border-border flex flex-col gap-4 border-t p-5 sm:flex-row sm:items-center">
                  <span className="bg-surface-sunken text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
                    <ShieldCheck className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{t("account.sso")}</h3>
                    <p className="text-muted-foreground mt-1 text-sm">{t("account.ssoHint")}</p>
                  </div>
                  <span className="border-primary/30 bg-primary-subtle text-primary rounded-md border px-2 py-1 text-xs font-medium">
                    {t("account.incomingFeature")}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : activeTab === "sessions" ? (
        <section id="sessions-panel" role="tabpanel" aria-labelledby="sessions-tab">
          <SessionsPanel />
        </section>
      ) : (
        <section id="shortcuts-panel" role="tabpanel" aria-labelledby="shortcuts-tab">
          <div className="max-w-4xl">
            <ShortcutSettings />
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
