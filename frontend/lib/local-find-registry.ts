/**
 * Lets a component that owns its own "find within this content" shortcut
 * (Ctrl+F inside a text-attachment preview, say) announce that it is
 * currently active, so the global quick-search shortcut - bound to the same
 * keys - can step aside instead of popping open over it.
 *
 * A plain module-level counter rather than React context: the two sides
 * (the app-shell search bar and whatever local preview wants Ctrl+F) live in
 * unrelated parts of the component tree with no shared ancestor worth wiring
 * a provider through just for this.
 */
let activeCount = 0;

/** Call on mount; call the returned function on unmount/cleanup. */
export function markLocalFindActive(): () => void {
  activeCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeCount = Math.max(0, activeCount - 1);
  };
}

export function isLocalFindActive(): boolean {
  return activeCount > 0;
}
