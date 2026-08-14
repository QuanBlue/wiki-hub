(() => {
  const isExtensionMarker = (name) =>
    name.startsWith("bis_") || /^__processed_[a-f0-9-]+__$/.test(name);

  const clean = (element) => {
    if (!(element instanceof Element)) return;
    if (
      element instanceof HTMLScriptElement &&
      element.src.startsWith("chrome-extension://")
    ) {
      element.remove();
      return;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (isExtensionMarker(attribute.name)) element.removeAttribute(attribute.name);
    }
  };

  const cleanTree = (root) => {
    clean(root);
    if (!(root instanceof Element)) return;
    root.querySelectorAll("*").forEach(clean);
  };

  const start = () => {
    cleanTree(document.documentElement);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") clean(mutation.target);
        for (const node of mutation.addedNodes) cleanTree(node);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener("load", () => observer.disconnect(), { once: true });
  };

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
