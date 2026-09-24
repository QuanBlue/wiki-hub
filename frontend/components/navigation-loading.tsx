"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useTranslation } from "@/lib/i18n/context";

let navigationPending = false;
const navigationListeners = new Set<() => void>();

function setNavigationPending(value: boolean) {
  if (navigationPending === value) return;
  navigationPending = value;
  navigationListeners.forEach((listener) => listener());
}

/** True from a same-origin link click until the route's pathname changes, so
 * other components (e.g. the page content area) can show their own loading
 * state without the surrounding shell/sidebar being touched. */
export function useNavigationPending(): boolean {
  return useSyncExternalStore(
    (listener) => {
      navigationListeners.add(listener);
      return () => navigationListeners.delete(listener);
    },
    () => navigationPending,
    () => false,
  );
}

export function NavigationLoading() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    setNavigationPending(loading);
  }, [loading]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- route completion clears the navigation indicator
    setLoading(false);
  }, [pathname]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      // NOT a defaultPrevented check: next/link always calls preventDefault()
      // itself to do a client-side transition instead of a browser
      // navigation, and its own onClick (delegated near the document root)
      // runs before this listener sees the event during the bubble phase -
      // so defaultPrevented is normally *true* for exactly the clicks this
      // is supposed to catch. Bailing out on it here used to mean this
      // never fired for a single real next/link click, only for a bare
      // anchor doing a full browser navigation (which needs no JS-rendered
      // bar - the browser already shows its own).
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;

      const target = event.target;
      const link =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!link || (link.target && link.target !== "_self")) return;
      if (link.hasAttribute("download")) return;

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search &&
        destination.hash === window.location.hash
      ) {
        return;
      }
      setLoading(true);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    // Safety net: the click heuristic above can occasionally fire for a
    // click that never actually completes a navigation (an unrelated
    // preventDefault-ing handler on an anchor, a cancelled/failed
    // transition). Without this, the bar would then never clear, since its
    // only other clear path is `pathname` changing.
    if (!loading) return;
    const timer = window.setTimeout(() => setLoading(false), 8000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  if (!loading) return null;

  return (
    <div
      className="fixed top-14 right-0 left-0 z-50 h-1 overflow-hidden"
      role="progressbar"
      aria-label={t("navigation.loadingPage")}
    >
      {/* A sweeping fill reads as "still moving" far more reliably than an
          opacity pulse would at this thickness - see the same
          track+progress-indeterminate pairing in the backup panel's job
          progress bars. */}
      <div className="bg-primary progress-indeterminate absolute inset-y-0 w-2/5 rounded-full" />
    </div>
  );
}
