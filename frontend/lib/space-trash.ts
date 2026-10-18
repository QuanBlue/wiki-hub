/** Opening a space's Trash from outside the space screen, the way the search box does for ":trash". */
export const TRASH_OPEN_EVENT = "wikihub:trash-open";

export function openSpaceTrash(spaceKey: string): void {
  window.dispatchEvent(new CustomEvent(TRASH_OPEN_EVENT, { detail: { spaceKey } }));
}
