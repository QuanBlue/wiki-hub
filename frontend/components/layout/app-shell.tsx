import { AppMain } from "@/components/layout/app-main";
import { ImpersonationBanner } from "@/components/layout/impersonation-banner";
import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { TopBar } from "@/components/layout/top-bar";
import { getSidebarPermissions } from "@/lib/navigation";
import { getSidebarPreferences } from "@/lib/sidebar-preferences";
import { listTopVisitedSpaces } from "@/lib/spaces";
import type { Me } from "@/types/api";

/** How many of the user's most-visited spaces show inline in the sidebar. */
const TOP_SPACES_LIMIT = 5;

/**
 * The documentation layout: fixed top bar, collapsible navigation rail on the
 * left and a fluid content column. The page tree and per-page table of contents
 * slot into the sidebar and content area in Phase 4.
 *
 * Only rendered for a signed-in user — the middleware redirects everyone else
 * to /login before a page using this shell is reached.
 */
export async function AppShell({
  siteName,
  user,
  children,
  contentClassName,
  hideSidebar = false,
  fullWidth = false,
}: {
  siteName: string;
  user: Me;
  children: React.ReactNode;
  contentClassName?: string;
  hideSidebar?: boolean;
  fullWidth?: boolean;
}) {
  const [sidebarPermissions, sidebarPreferences, topSpaces] = await Promise.all([
    getSidebarPermissions(),
    getSidebarPreferences(),
    // Only the rail needs this, but fetching it here (rather than in
    // <Sidebar>, a client component) keeps it server-rendered like the rest
    // of the navigation.
    hideSidebar ? Promise.resolve([]) : listTopVisitedSpaces(TOP_SPACES_LIMIT),
  ]);

  return (
    <SidebarProvider
      initialCollapsed={sidebarPreferences.collapsed}
      initialSidebarWidth={sidebarPreferences.appWidth}
    >
      <div className="bg-background min-h-screen">
        <TopBar siteName={siteName} user={user} />
        {hideSidebar ? null : (
          <Sidebar
            user={user}
            permissions={sidebarPermissions}
            topSpaces={topSpaces}
          />
        )}
        <AppMain
          hasBanner={user.impersonator !== null}
          contentClassName={contentClassName}
          disableSidebarOffset={hideSidebar}
          fullWidth={fullWidth}
        >
          {children}
        </AppMain>
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
