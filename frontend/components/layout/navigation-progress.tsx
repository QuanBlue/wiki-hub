"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

type NavigationProgressValue = {
  /** Navigate and show the page-transition bar until the route has rendered. */
  navigate: (href: string) => void;
};

const NavigationProgressContext = createContext<NavigationProgressValue | null>(null);

/**
 * Wraps programmatic navigations in a transition so the shell can show a
 * top progress bar while the destination page loads. Links clicked directly
 * don't need this; it exists for router.push callers such as quick search.
 */
export function NavigationProgressProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [transitioning, startTransition] = useTransition();
  // The transition can settle before the URL actually changes, so keep the bar
  // up until the destination path is current (with a failsafe timeout).
  const [target, setTarget] = useState<string | null>(null);
  const pending = transitioning || (target !== null && target !== pathname);

  useEffect(() => {
    if (target === null) return;
    if (target === pathname) {
      setTarget(null);
      return;
    }
    const timer = setTimeout(() => setTarget(null), 15000);
    return () => clearTimeout(timer);
  }, [target, pathname]);

  const navigate = useCallback(
    (href: string) => {
      setTarget(href.split(/[?#]/)[0]);
      startTransition(() => {
        router.push(href);
      });
    },
    [router],
  );

  const value = useMemo(() => ({ navigate }), [navigate]);

  return (
    <NavigationProgressContext.Provider value={value}>
      <div
        role="progressbar"
        aria-label="Loading page"
        aria-hidden={!pending}
        className={
          "pointer-events-none fixed inset-x-0 top-[calc(var(--wh-topbar-height)-4px)] z-[70] h-1 overflow-hidden bg-[color-mix(in_oklab,var(--wh-neutral-0)_25%,transparent)] transition-opacity duration-200 " +
          (pending ? "opacity-100" : "opacity-0")
        }
      >
        <div className="nav-progress-bar absolute inset-y-0 w-1/2 rounded-full bg-[var(--wh-neutral-0)] shadow-[0_0_12px_2px_var(--wh-neutral-0)]" />
      </div>
      {/* Soften the outgoing page so the switch reads as a page transition. */}
      <div
        aria-hidden
        className={
          "bg-background/50 pointer-events-none fixed inset-x-0 top-(--wh-topbar-height) bottom-0 z-[25] transition-opacity duration-300 " +
          (pending ? "opacity-100" : "opacity-0")
        }
      />
      {children}
    </NavigationProgressContext.Provider>
  );
}

export function useNavigate(): (href: string) => void {
  const ctx = useContext(NavigationProgressContext);
  const router = useRouter();
  return useCallback(
    (href: string) => {
      if (ctx) ctx.navigate(href);
      else router.push(href);
    },
    [ctx, router],
  );
}
