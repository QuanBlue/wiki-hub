/**
 * Where a click would actually take the reader, or null when it takes them
 * nowhere (not a plain left-click on a same-tab link, or a link to the page
 * they are already on). Shared by the unsaved-changes guards so they all
 * agree on what counts as "leaving".
 *
 * `ignoreHref` lets a caller exempt links it handles itself, such as
 * attachment links that open a preview instead of navigating.
 */
export function linkNavigationTarget(
  event: MouseEvent,
  ignoreHref?: (href: string) => boolean,
): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

  const target = event.target;
  const link = target instanceof Element ? target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement)) return null;
  if (link.target && link.target !== "_self") return null;
  if (link.hasAttribute("download")) return null;
  if (ignoreHref?.(link.getAttribute("href") ?? "")) return null;

  const destination = new URL(link.href, window.location.href);
  if (destination.href === window.location.href) return null;
  return destination;
}
