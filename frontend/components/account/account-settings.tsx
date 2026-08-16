"use client";

import { KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { ChangePasswordForm } from "@/components/account/change-password-form";
import { ProfileForm } from "@/components/account/profile-form";
import { ProfileSummary } from "@/components/account/profile-summary";
import { SessionsPanel } from "@/components/account/sessions-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Me } from "@/types/api";

type AccountTab = "profile" | "security" | "sessions";

const tabs: { id: AccountTab; label: string; icon: typeof UserRound }[] = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "security", label: "Password & authentication", icon: ShieldCheck },
  { id: "sessions", label: "Sessions", icon: KeyRound },
];

export function AccountSettings({ user }: { user: Me }) {
  const [activeTab, setActiveTab] = useState<AccountTab>("profile");
  const [profileEditing, setProfileEditing] = useState(false);
  const [passwordEditing, setPasswordEditing] = useState(false);
  const tabRefs = useRef<Record<AccountTab, HTMLButtonElement | null>>({
    profile: null,
    security: null,
    sessions: null,
  });

  function selectTab(tab: AccountTab) {
    setActiveTab(tab);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentTab: AccountTab) {
    const currentIndex = tabs.findIndex((tab) => tab.id === currentTab);
    const nextIndex = event.key === "ArrowRight" ? (currentIndex + 1) % tabs.length
      : event.key === "ArrowLeft" ? (currentIndex - 1 + tabs.length) % tabs.length
        : -1;

    if (nextIndex === -1) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex]!.id;
    selectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="Account settings" className="border-border flex gap-1 border-b">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[tab.id] = node; }}
              type="button"
              role="tab"
              id={tab.id + "-tab"}
              aria-controls={tab.id + "-panel"}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
              className={cn(
                "relative inline-flex h-10 items-center gap-2 px-3 text-sm font-medium",
                "transition-colors duration-150 hover:text-foreground focus-visible:z-10 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isActive
                  ? "text-primary after:bg-primary after:absolute after:right-3 after:bottom-0 after:left-3 after:h-0.5"
                  : "text-muted-foreground hover:bg-surface-hover",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "profile" ? (
        <section id="profile-panel" role="tabpanel" aria-labelledby="profile-tab" className="pt-8">
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
        <section id="security-panel" role="tabpanel" aria-labelledby="security-tab" className="pt-8">
          {passwordEditing ? (
            <div>
              <div className="mb-6">
                <h2 className="font-semibold">Change account password</h2>
                <p className="text-muted-foreground mt-1 text-sm">Update the password you use to sign in to WikiHub.</p>
              </div>
              <ChangePasswordForm
                onCancel={() => setPasswordEditing(false)}
                onSuccess={() => setPasswordEditing(false)}
              />
            </div>
          ) : (
            <div className="max-w-4xl">
              <h2 className="text-xl font-semibold tracking-tight">Sign-in methods</h2>
              <div className="border-border mt-5 overflow-hidden rounded-lg border">
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                  <span className="bg-surface-sunken text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
                    <Mail className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">Email and password</h3>
                    <p className="text-muted-foreground mt-1 text-sm">Sign in with {user.email} and your account password.</p>
                  </div>
                  <Button variant="secondary" onClick={() => setPasswordEditing(true)}>
                    Change password
                  </Button>
                </div>

                <div className="border-border flex flex-col gap-4 border-t p-5 sm:flex-row sm:items-center">
                  <span className="bg-surface-sunken text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
                    <ShieldCheck className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">Single sign-on (SSO)</h3>
                    <p className="text-muted-foreground mt-1 text-sm">Sign in with your organization’s identity provider.</p>
                  </div>
                  <span className="border-primary/30 bg-primary-subtle text-primary rounded-md border px-2 py-1 text-xs font-medium">
                    Incoming feature
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section id="sessions-panel" role="tabpanel" aria-labelledby="sessions-tab" className="pt-8">
          <SessionsPanel />
        </section>
      )}
    </div>
  );
}
