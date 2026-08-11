import { AppMain } from "@/components/layout/app-main";
import { ImpersonationBanner } from "@/components/layout/impersonation-banner";
import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { TopBar } from "@/components/layout/top-bar";
import type { Me } from "@/types/api";

/**
 * The documentation layout: fixed top bar, collapsible navigation rail on the
 * left and a fluid content column. The page tree and per-page table of contents
 * slot into the sidebar and content area in Phase 4.
 *
 * Only rendered for a signed-in user — the middleware redirects everyone else
 * to /login before a page using this shell is reached.
 */
export function AppShell({
  siteName,
  user,
  children,
}: {
  siteName: string;
  user: Me;
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <div className="bg-background min-h-screen">
        <TopBar siteName={siteName} user={user} />
        <Sidebar />
        <AppMain hasBanner={user.impersonator !== null}>{children}</AppMain>
        {user.impersonator ? (
          <ImpersonationBanner
            viewingAs={user}
            impersonator={user.impersonator}
          />
        ) : null}
      </div>
    </SidebarProvider>
  );
}
