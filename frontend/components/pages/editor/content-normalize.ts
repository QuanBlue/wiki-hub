import { type ViewMutationRecord } from "@tiptap/pm/view";

/**
 * The frame React draws around a block node's editable content (a callout's icon, a code
 * block's line numbers, a toggle's chevron) appears a moment after ProseMirror inserts the
 * node, and Tiptap then moves the node's editable content into that frame. On Android,
 * ProseMirror reads any block element that shows up behind its back as the keyboard's Enter
 * and runs the Enter command - which lifted a freshly inserted callout straight back out of
 * existence. Only changes inside the node's own editable content are ProseMirror's to see;
 * everything else in the node view is ours.
 */
export function ignoreNodeViewChrome({ mutation }: { mutation: ViewMutationRecord }): boolean {
  if (mutation.type === "selection") return false;
  if (mutation.type === "childList") {
    // Tiptap putting the editable content element into React's frame (or taking it out).
    const moved = [...mutation.addedNodes, ...mutation.removedNodes];
    if (
      moved.length > 0 &&
      moved.every((node) => node instanceof Element && node.hasAttribute("data-node-view-content-react"))
    ) {
      return true;
    }
  }
  const target =
    mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  if (!target) return true;
  // This node's view, and the editable content Tiptap keeps inside it. A callout inside a
  // toggle sits within the toggle's content, not its own, so it must be the nearest ones.
  const view = target.closest(".react-renderer");
  const content = target.closest("[data-node-view-content-react]");
  // Inside this node's own content: ProseMirror's. Anywhere else in its view: ours.
  return !(view && content && view.contains(content));
}
/**
 * Node types whose node view starts a drag through the custom move machinery.
 * Both hide `dragstart` from ProseMirror behind a node view, so both need the
 * drop to be owned rather than left to ProseMirror's external-drop path.
 */
export const DRAGGABLE_NODE_TYPES = new Set(["image", "attachment"]);
export const headingLevels = [1, 2, 3, 4] as const;
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Convert Confluence's XML-style code & callout macros into semantic HTML for Tiptap. */
export function normalizeConfluenceCodeMacros(content: string): string {
  let res = content.replace(
    /<ac:structured-macro\b[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
    (macro, inner: string) => {
      const nameMatch = macro.match(/ac:name=(?:"([^"]+)"|'([^']+)');?/i);
      const name = (nameMatch?.[1] || nameMatch?.[2] || "").toLowerCase();

      if (name === "code") {
        const bodyMatch = inner.match(
          /<ac:plain-text-body\b[^>]*>([\s\S]*?)<\/ac:plain-text-body>/i,
        );
        if (!bodyMatch) return macro;
        let code = bodyMatch[1];

        if (/^\s*<!\[CDATA\[/i.test(code)) {
          code = code.replace(/^\s*<!\[CDATA\[/i, "");
          code = code.replace(/\]\]\s*(?:>?|&gt;)\s*$/i, "");
        }

        code = code
          .replace(/^(?:[ \t]*[\r\n]|&#10;|&#13;|&NewLine;)+/, "")
          .replace(/(?:[\r\n][ \t]*|&#10;|&#13;|&NewLine;)+$/, "");

        const langMatch = inner.match(
          /<ac:parameter\b[^>]*\bac:name=(?:"language"|'language')[^>]*>([\s\S]*?)<\/ac:parameter>/i,
        );
        const language =
          langMatch?.[1]?.trim()?.replace(/[^a-z0-9_-]/gi, "") || "";
        return `<pre><code${language ? ` class="language-${language}"` : ""}>${escapeHtml(code)}</code></pre>`;
      }

      if (
        ["info", "warning", "note", "tip", "panel", "expand"].includes(name)
      ) {
        const bodyMatch = inner.match(
          /<ac:rich-text-body\b[^>]*>([\s\S]*?)<\/ac:rich-text-body>/i,
        );
        const body = bodyMatch ? bodyMatch[1] : "";

        const titleMatch = inner.match(
          /<ac:parameter\b[^>]*\bac:name=(?:"title"|'title')[^>]*>([\s\S]*?)<\/ac:parameter>/i,
        );
        const title = titleMatch ? titleMatch[1].trim() : "";
        const titleHtml = title
          ? `<p><strong>${escapeHtml(title)}</strong></p>`
          : "";

        const type = name === "expand" ? "panel" : name;
        return `<div data-type="callout" data-callout-type="${type}" class="callout callout-${type}">${titleHtml}${body}</div>`;
      }

      if (name === "mermaid") {
        const bodyMatch = inner.match(
          /<ac:plain-text-body\b[^>]*>([\s\S]*?)<\/ac:plain-text-body>/i,
        );
        let code = bodyMatch ? bodyMatch[1] : inner;
        if (/^\s*<!\[CDATA\[/i.test(code)) {
          code = code.replace(/^\s*<!\[CDATA\[/i, "");
          code = code.replace(/\]\]\s*(?:>?|&gt;)\s*$/i, "");
        }
        return `<div data-type="diagram" data-engine="mermaid" data-look="classic" data-code="${escapeHtml(code.trim())}"></div>`;
      }

      if (["view-file", "viewfile", "view-doc", "viewdoc"].includes(name)) {
        const fileMatch =
          inner.match(/ri:filename="([^"]+)"/i) ||
          inner.match(/filename="([^"]+)"/i) ||
          inner.match(/<ac:parameter[^>]*>([^<]+)<\/ac:parameter>/i);
        const filename = fileMatch ? fileMatch[1].trim() : "";
        if (!filename) return "";
        return `<a href="#attachment-${escapeHtml(filename)}" data-attachment="${escapeHtml(filename)}" data-display-mode="card" title="${escapeHtml(filename)}">${escapeHtml(filename)}</a>`;
      }

      return macro;
    },
  );

  // Normalize ac:link macros pointing at attachments into standard link-mode attachments
  res = res.replace(
    /<ac:link\b[^>]*>([\s\S]*?)<\/ac:link>/gi,
    (fullLink, inner: string) => {
      const fileMatch = inner.match(/ri:filename="([^"]+)"/i);
      if (fileMatch) {
        const filename = fileMatch[1].trim();
        const textMatch =
          inner.match(
            /<ac:plain-text-link-body[^>]*>([\s\S]*?)<\/ac:plain-text-link-body>/i,
          ) || inner.match(/<ac:link-body[^>]*>([\s\S]*?)<\/ac:link-body>/i);
        const text = textMatch
          ? textMatch[1].replace(/<[^>]+>/g, "").trim()
          : filename;
        return `<a href="#attachment-${escapeHtml(filename)}" data-attachment="${escapeHtml(filename)}" data-display-mode="link" class="attachment-link" title="${escapeHtml(text || filename)}">${escapeHtml(text || filename)}</a>`;
      }
      return fullLink;
    },
  );

  // Normalize any legacy view-file card container divs into clean card-mode attachment anchors
  res = res.replace(
    /<div\b[^>]*class="[^"]*confluence-macro-view-file[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi,
    (fullDiv) => {
      const hrefMatch = fullDiv.match(/href="([^"]+)"/i);
      if (!hrefMatch) return fullDiv;
      const href = hrefMatch[1];

      // Try title or download attribute with an extension first
      const attrMatch =
        fullDiv.match(/download="([^"]+\.[A-Za-z0-9]{1,8})"/i) ||
        fullDiv.match(/title="([^"]+\.[A-Za-z0-9]{1,8})"/i) ||
        fullDiv.match(/data-attachment="([^"]+)"/i) ||
        fullDiv.match(/data-filename="([^"]+)"/i);

      let filename = attrMatch ? attrMatch[1].trim() : "";

      // If not found, try finding any span or p text that has a filename with extension
      if (!filename || filename.toLowerCase() === "download") {
        const textMatch = fullDiv.match(/>([^<>]+\.[A-Za-z0-9]{1,8})</i);
        if (textMatch && textMatch[1].trim().toLowerCase() !== "download") {
          filename = textMatch[1].trim();
        }
      }

      // If still not found, try extracting title without ext + ext badge
      if (!filename || filename.toLowerCase() === "download") {
        const titleMatch = fullDiv.match(/<p\b[^>]*>([^<]+)<\/p>/i);
        const extMatch =
          fullDiv.match(/opacity-15[^>]*>([A-Za-z0-9]{1,8})<\/div>/i) ||
          fullDiv.match(/uppercase[^>]*>([A-Za-z0-9]{1,8})<\/div>/i);
        if (titleMatch && extMatch) {
          filename = `${titleMatch[1].trim()}.${extMatch[1].trim().toLowerCase()}`;
        }
      }

      if (filename && filename.toLowerCase() !== "download" && href) {
        return `<a href="${href}" data-attachment="${escapeHtml(filename)}" data-display-mode="card" title="${escapeHtml(filename)}">${escapeHtml(filename)}</a>`;
      }
      return fullDiv;
    },
  );

  // Normalize <pre><code class="language-mermaid"> into <div data-type="diagram" ...>
  res = res.replace(
    /<pre\b[^>]*>\s*<code\b[^>]*class=["'][^"']*language-mermaid[^"']*["'][^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_match, code) => {
      const decoded = code
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return `<div data-type="diagram" data-engine="mermaid" data-look="classic" data-code="${escapeHtml(decoded.trim())}"></div>`;
    },
  );

  // Strip leading and trailing newlines from any existing <pre><code>...</code></pre> blocks
  res = res.replace(
    /(<pre\b[^>]*><code\b[^>]*>)([\s\S]*?)(<\/code><\/pre>)/gi,
    (_match, open, code, close) => {
      const trimmedCode = code
        .replace(/^(?:[ \t]*[\r\n]|&#10;|&#13;|&NewLine;)+/, "")
        .replace(/(?:[\r\n][ \t]*|&#10;|&#13;|&NewLine;)+$/, "");
      return `${open}${trimmedCode}${close}`;
    },
  );

  return res;
}

export function linkifyPlainTextUrls(content: string): string {
  if (typeof document === "undefined" || !content) return content;
  const parsed = document.implementation.createHTMLDocument("");
  parsed.body.innerHTML = content;
  const urlPattern = /\bhttps?:\/\/[^\s<]+[^\s<.,:;!?)]/g;
  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement?.tagName;
    if (parent !== "A" && parent !== "CODE" && parent !== "PRE") {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }
  for (const textNode of textNodes) {
    if (!urlPattern.test(textNode.data)) {
      urlPattern.lastIndex = 0;
      continue;
    }
    urlPattern.lastIndex = 0;
    const fragment = parsed.createDocumentFragment();
    let lastIndex = 0;
    textNode.data.replace(urlPattern, (url: string, offset: number) => {
      fragment.append(textNode.data.slice(lastIndex, offset));
      const anchor = parsed.createElement("a");
      anchor.href = url;
      anchor.textContent = url;
      fragment.append(anchor);
      lastIndex = offset + url.length;
      return url;
    });
    fragment.append(textNode.data.slice(lastIndex));
    textNode.replaceWith(fragment);
  }
  return parsed.body.innerHTML;
}

export const editorClassName =
  "wikihub-editor min-h-[calc(100vh-19rem)] px-5 py-4 text-sm leading-[1.45] outline-none " +
  "[&_p]:my-2 [&_p:first-child]:mt-0 " +
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight " +
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-tight " +
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-tight " +
  "[&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:leading-tight " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 " +
  // Task list: no bullet marker, checkbox instead, styled to match the raw
  // checkbox convention already used across the admin screens. TaskItem
  // ships its own vanilla node view for the live editing DOM, which never
  // carries the "data-type" it puts on serialized HTML - but it always sets
  // data-checked (both live and serialized), so that's the selector that
  // actually matches in both places.
  // The content <div> next to the checkbox has no intrinsic width of its
  // own (an empty paragraph is near-0px wide), so as a flex sibling it
  // shrank to nothing and hid the caret with it - flex-1 + min-w-0 makes it
  // claim the rest of the row like every other flex-text-column in this app.
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_li[data-checked]]:flex [&_li[data-checked]]:items-start [&_li[data-checked]]:gap-2 [&_li[data-checked]>label]:mt-1 [&_li[data-checked]>label]:flex-shrink-0 [&_li[data-checked]>div]:min-w-0 [&_li[data-checked]>div]:flex-1 " +
  "[&_li[data-checked]>label>input[type=checkbox]]:accent-primary [&_li[data-checked]>label>input[type=checkbox]]:size-4 [&_li[data-checked]>label>input[type=checkbox]]:cursor-pointer [&_li[data-checked]>label>input[type=checkbox]]:rounded " +
  "[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_code]:rounded [&_code]:bg-inline-code-bg [&_code]:text-inline-code [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_pre_code]:bg-transparent [&_pre_code]:text-[inherit] [&_pre_code]:p-0 [&_pre_code]:whitespace-pre " +
  "[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-md " +
  // Table rhythm (margin, cell minimum width, padding, and line-height) is
  // kept identical to readerClassName below so rows have the same height in
  // the editor and in the live preview.
  "[&_.tableWrapper]:my-3 [&_.tableWrapper]:overflow-x-auto [&_.tableWrapper]:overflow-y-hidden [&_table]:w-full [&_table]:border-collapse [&_th]:min-w-24 [&_th]:border [&_th]:border-border [&_th]:bg-surface-sunken [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:leading-[1.45] [&_td]:min-w-24 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:leading-[1.45]";

// Imported pages are read like documentation, not like an editor canvas.
// Keep this separate from editorClassName so editing remains comfortable while
// imported Confluence pages retain their compact, scan-friendly rhythm.
export const readerClassName =
  "wikihub-reader text-sm leading-[1.45] " +
  // The last-paragraph trim belongs to the document root only. Applying it
  // to every descendant also removes the bottom margin from each table cell,
  // making preview rows shorter than their editable counterparts.
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&>p:last-child]:mb-0 " +
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight " +
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-tight " +
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-tight " +
  "[&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:leading-tight " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary/50 [&_a]:transition-colors [&_a]:duration-150 [&_a:hover]:bg-primary-subtle [&_a:hover]:decoration-primary " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 " +
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_li[data-checked]]:flex [&_li[data-checked]]:items-start [&_li[data-checked]]:gap-2 [&_li[data-checked]>label]:mt-1 [&_li[data-checked]>label]:flex-shrink-0 [&_li[data-checked]>div]:min-w-0 [&_li[data-checked]>div]:flex-1 " +
  "[&_li[data-checked]>label>input[type=checkbox]]:accent-primary [&_li[data-checked]>label>input[type=checkbox]]:size-4 [&_li[data-checked]>label>input[type=checkbox]]:rounded [&_li[data-checked]>label>input[type=checkbox]]:pointer-events-none " +
  "[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_code]:rounded [&_code]:bg-inline-code-bg [&_code]:text-inline-code [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_pre_code]:bg-transparent [&_pre_code]:text-[inherit] [&_pre_code]:p-0 [&_pre_code]:whitespace-pre " +
  "[&_img]:my-3 [&_img]:block [&_img]:h-auto [&_img]:max-w-[42rem] [&_img]:rounded-md " +
  // Tables are persisted with their column widths in `colwidth` attributes.
  // Fixed layout makes the reader honour those widths instead of allowing an
  // unbroken word to redistribute every column after the page is saved.
  "[&_.tableWrapper]:my-3 [&_.tableWrapper]:overflow-x-auto [&_.tableWrapper]:overflow-y-hidden [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_th]:min-w-24 [&_th]:break-words [&_th]:whitespace-normal [&_th]:border [&_th]:border-border [&_th]:bg-surface-sunken [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:leading-[1.45] [&_td]:min-w-24 [&_td]:break-words [&_td]:whitespace-normal [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:leading-[1.45]";

// A toggled-on toolbar control. Hover has to stay blue: the ghost button's own
// hover swaps in the grey surface and the dark text colour, which made a
// selected control look deselected the moment the pointer touched it.
export const TOGGLE_ON_CLASS =
  "bg-surface-selected text-primary hover:bg-surface-selected-hover hover:text-primary " +
  "[&:not(:disabled)]:hover:bg-surface-selected-hover [&:not(:disabled)]:hover:text-primary " +
  "active:bg-surface-selected-hover";
