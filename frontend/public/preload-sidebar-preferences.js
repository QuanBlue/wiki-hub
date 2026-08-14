(() => {
  try {
    const root = document.documentElement;
    const storedCollapsed = window.localStorage.getItem("wikihub:sidebar-collapsed");
    const collapsed =
      storedCollapsed === null
        ? root.dataset.whSidebarCollapsed === "true"
        : storedCollapsed === "true";
    const storedAppWidth = window.localStorage.getItem("wikihub:sidebar-width");
    const storedSpaceWidth = window.localStorage.getItem("wikihub:space-sidebar-width");
    const appWidth =
      storedAppWidth === null
        ? Number.parseFloat(root.style.getPropertyValue("--wh-preloaded-sidebar-width"))
        : Number(storedAppWidth);
    const spaceWidth =
      storedSpaceWidth === null
        ? Number.parseFloat(root.style.getPropertyValue("--wh-preloaded-space-sidebar-width"))
        : Number(storedSpaceWidth);
    const isSpaceWorkspace = /^\/spaces\/[^/]+/.test(window.location.pathname);
    root.dataset.whSidebarCollapsed = String(collapsed);
    root.dataset.whSpaceWorkspace = String(isSpaceWorkspace);
    root.dataset.whSidebarHydrated = "false";
    root.style.setProperty(
      "--wh-preloaded-sidebar-width",
      `${Number.isFinite(appWidth) ? Math.min(520, Math.max(0, appWidth)) : 256}px`,
    );
    root.style.setProperty(
      "--wh-preloaded-space-sidebar-width",
      `${Number.isFinite(spaceWidth) ? Math.min(520, Math.max(200, spaceWidth)) : 320}px`,
    );
  } catch {
    // Storage can be blocked; the React sidebar store has the same fallback.
  }
})();
