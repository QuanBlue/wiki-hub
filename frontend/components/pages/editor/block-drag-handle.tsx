"use client";

import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { dropPoint } from "@tiptap/pm/transform";
import { type EditorView } from "@tiptap/pm/view";
import { type Editor } from "@tiptap/react";
import { GripVertical } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/context";

import { DRAGGABLE_BLOCK_NODE_TYPES } from "./content-normalize";

export type BlockDropTarget = {
  pos: number;
  lineTop: number;
  lineLeft: number;
  lineWidth: number;
};

type HoveredBlock = {
  pos: number;
  top: number;
  left: number;
  blockLeft: number;
  blockBottom: number;
};

function canInsertNodeAt(
  doc: PMNode,
  pos: number,
  node: PMNode,
): boolean {
  if (pos < 0 || pos > doc.content.size) return false;
  try {
    const $pos = doc.resolve(pos);
    return $pos.parent.canReplaceWith($pos.index(), $pos.index(), node.type);
  } catch {
    return false;
  }
}

/**
 * Resolve the exact insertion position and indicator geometry when dragging a
 * block node (table, code block, quote, callout, etc.) over the editor.
 *
 * Walks from the deepest hovered block up toward the document root so dropping
 * into a bullet/numbered/task list item, blockquote, callout, toggle, or table
 * cell lands inside that container when schema-valid, and cleanly falls back to
 * an outer boundary when it is not (e.g. above a list item's required leading
 * paragraph).
 */
export function resolveBlockDropTarget(
  view: EditorView,
  clientX: number,
  clientY: number,
  draggedNode: PMNode,
  fromPos: number,
): BlockDropTarget | null {
  const { doc } = view.state;
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (!coords) return null;

  // Dropping onto or inside the dragged block itself is a no-op.
  if (coords.pos >= fromPos && coords.pos <= fromPos + draggedNode.nodeSize) {
    return null;
  }

  const $pos = doc.resolve(coords.pos);

  // Check if the pointer is directly over a leaf/atom block node (e.g. hr, diagram).
  const directNode = doc.nodeAt(coords.pos);
  if (directNode && directNode.isBlock && directNode.isAtom) {
    const dom = view.nodeDOM(coords.pos);
    if (dom instanceof Element) {
      const rect = dom.getBoundingClientRect();
      const placeAfter = clientY >= rect.top + rect.height / 2;
      const candidatePos = placeAfter
        ? coords.pos + directNode.nodeSize
        : coords.pos;
      if (canInsertNodeAt(doc, candidatePos, draggedNode)) {
        return {
          pos: candidatePos,
          lineTop: placeAfter ? rect.bottom : rect.top,
          lineLeft: rect.left,
          lineWidth: rect.width,
        };
      }
    }
  }

  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (!node.isBlock) continue;

    const beforePos = $pos.before(depth);
    const afterPos = $pos.after(depth);
    const dom = view.nodeDOM(beforePos);
    const rect =
      dom instanceof Element ? dom.getBoundingClientRect() : null;

    const placeAfter = rect
      ? clientY >= rect.top + rect.height / 2
      : true;
    const candidatePos = placeAfter ? afterPos : beforePos;

    if (canInsertNodeAt(doc, candidatePos, draggedNode)) {
      const fallbackRect = view.dom.getBoundingClientRect();
      return {
        pos: candidatePos,
        lineTop: rect
          ? placeAfter
            ? rect.bottom
            : rect.top
          : clientY,
        lineLeft: rect ? rect.left : fallbackRect.left + 20,
        lineWidth: rect ? rect.width : Math.max(120, fallbackRect.width - 40),
      };
    }

    // List items (bullet/ordered/task) require a leading paragraph (`paragraph block*`),
    // so inserting *before* that first paragraph is schema-invalid. Unless the pointer
    // is near the very top edge of the list's first item (where the user wants to drop
    // above the list), fall through to *after* the paragraph so the block nests cleanly
    // inside the hovered list item.
    const parent = $pos.node(depth - 1);
    if (
      !placeAfter &&
      (parent.type.name === "listItem" || parent.type.name === "taskItem") &&
      canInsertNodeAt(doc, afterPos, draggedNode)
    ) {
      const isFirstListItem = depth >= 2 && $pos.index(depth - 2) === 0;
      const nearTopEdgeOfFirstItem =
        isFirstListItem && rect !== null && clientY < rect.top + rect.height * 0.25;
      if (!nearTopEdgeOfFirstItem) {
        const fallbackRect = view.dom.getBoundingClientRect();
        return {
          pos: afterPos,
          lineTop: rect ? rect.bottom : clientY,
          lineLeft: rect ? rect.left : fallbackRect.left + 20,
          lineWidth: rect ? rect.width : Math.max(120, fallbackRect.width - 40),
        };
      }
    }
  }

  const slice = new Slice(Fragment.from(draggedNode), 0, 0);
  const fallbackPos = dropPoint(doc, coords.pos, slice);
  if (fallbackPos == null) return null;
  if (fallbackPos >= fromPos && fallbackPos <= fromPos + draggedNode.nodeSize) {
    return null;
  }

  const editorRect = view.dom.getBoundingClientRect();
  return {
    pos: fallbackPos,
    lineTop: clientY,
    lineLeft: editorRect.left + 20,
    lineWidth: Math.max(120, editorRect.width - 40),
  };
}

/**
 * Move a block node from `fromPos` to `targetPos`, preserving containers such
 * as callouts, blockquotes, toggles, or table cells if the moved block was
 * their only child.
 */
export function moveBlockNode(
  view: EditorView,
  fromPos: number,
  targetPos: number,
): boolean {
  const { state } = view;
  const node = state.doc.nodeAt(fromPos);
  if (!node) return false;
  if (targetPos >= fromPos && targetPos <= fromPos + node.nodeSize) {
    return false;
  }

  const tr = state.tr;
  const $from = state.doc.resolve(fromPos);
  const sourceParent = $from.parent;
  const isSoleChildOfContainer =
    $from.depth > 0 &&
    sourceParent.childCount === 1 &&
    sourceParent.type.name !== "doc";

  if (isSoleChildOfContainer && state.schema.nodes.paragraph) {
    tr.replaceWith(
      fromPos,
      fromPos + node.nodeSize,
      state.schema.nodes.paragraph.create(),
    );
  } else {
    tr.delete(fromPos, fromPos + node.nodeSize);
  }

  const mappedTarget = tr.mapping.map(targetPos);
  const slice = new Slice(Fragment.from(node), 0, 0);
  const insertPos = canInsertNodeAt(tr.doc, mappedTarget, node)
    ? mappedTarget
    : (dropPoint(tr.doc, mappedTarget, slice) ?? mappedTarget);

  if (!canInsertNodeAt(tr.doc, insertPos, node)) return false;

  tr.insert(insertPos, node);
  const inserted = tr.doc.nodeAt(insertPos);
  if (inserted && NodeSelection.isSelectable(inserted)) {
    tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  } else {
    tr.setSelection(
      TextSelection.near(
        tr.doc.resolve(Math.min(insertPos + 1, tr.doc.content.size)),
        1,
      ),
    );
  }
  view.dispatch(tr);
  return true;
}

function findHoveredDraggableBlock(
  view: EditorView,
  target: Element,
): { pos: number; dom: Element } | null {
  if (!view.dom.contains(target)) return null;

  let pos: number;
  try {
    pos = view.posAtDOM(target, 0);
  } catch {
    return null;
  }

  const { doc } = view.state;
  const direct = doc.nodeAt(pos);
  if (direct && DRAGGABLE_BLOCK_NODE_TYPES.has(direct.type.name)) {
    const dom = view.nodeDOM(pos);
    if (dom instanceof Element) return { pos, dom };
  }

  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (DRAGGABLE_BLOCK_NODE_TYPES.has(node.type.name)) {
      const nodePos = $pos.before(depth);
      const dom = view.nodeDOM(nodePos);
      if (dom instanceof Element) return { pos: nodePos, dom };
    }
  }

  return null;
}

/**
 * Floating drag handle shown on the left edge of hovered draggable blocks
 * (tables, code blocks, quotes, callouts, toggles, diagrams, etc.) in edit
 * mode, together with a live horizontal drop indicator during block drags.
 */
export function BlockDragHandle({
  editor,
  containerRef,
}: {
  editor: Editor | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);
  const [dropIndicator, setDropIndicator] = useState<BlockDropTarget | null>(
    null,
  );
  const handleRef = useRef<HTMLButtonElement>(null);
  const hoveredRef = useRef<HoveredBlock | null>(null);
  const draggingPosRef = useRef<number | null>(null);

  const setHoveredBlock = useCallback((next: HoveredBlock | null) => {
    hoveredRef.current = next;
    setHovered(next);
  }, []);

  const clearDragVisuals = useCallback(() => {
    draggingPosRef.current = null;
    setDropIndicator(null);
  }, []);

  useEffect(() => {
    if (!editor || !editor.isEditable) return;
    const container = containerRef.current;
    if (!container) return;

    const updateHovered = (event: MouseEvent) => {
      if (draggingPosRef.current !== null) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (handleRef.current?.contains(target)) return;

      const found = findHoveredDraggableBlock(editor.view, target);
      if (!found) {
        // Keep the handle visible while the pointer crosses the narrow gutter
        // between a hovered block and its drag handle.
        const current = hoveredRef.current;
        if (
          current &&
          event.clientX >= current.left - 8 &&
          event.clientX <= current.blockLeft + 8 &&
          event.clientY >= current.top - 8 &&
          event.clientY <= current.blockBottom + 8
        ) {
          return;
        }
        setHoveredBlock(null);
        return;
      }

      const blockRect = found.dom.getBoundingClientRect();
      const editorRect = editor.view.dom.getBoundingClientRect();
      setHoveredBlock({
        pos: found.pos,
        top: Math.max(8, blockRect.top + 4),
        left: Math.max(editorRect.left + 2, blockRect.left - 22),
        blockLeft: blockRect.left,
        blockBottom: blockRect.bottom,
      });
    };

    const handleMouseLeave = (event: MouseEvent) => {
      const related = event.relatedTarget;
      if (related instanceof Node && handleRef.current?.contains(related)) {
        return;
      }
      setHoveredBlock(null);
    };

    const handleDragOver = (event: DragEvent) => {
      const fromPos = draggingPosRef.current;
      if (fromPos === null) return;
      const draggedNode = editor.state.doc.nodeAt(fromPos);
      if (!draggedNode) {
        setDropIndicator(null);
        return;
      }
      const resolved = resolveBlockDropTarget(
        editor.view,
        event.clientX,
        event.clientY,
        draggedNode,
        fromPos,
      );
      setDropIndicator(resolved);
    };

    const handleScrollOrResize = () => {
      setHoveredBlock(null);
      setDropIndicator(null);
    };

    const editorDom = editor.view.dom;
    editorDom.addEventListener("mousemove", updateHovered);
    editorDom.addEventListener("mouseleave", handleMouseLeave);
    container.addEventListener("dragover", handleDragOver, true);
    container.addEventListener("drop", clearDragVisuals);
    container.addEventListener("wikihub:internal-node-drag-end", clearDragVisuals);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      editorDom.removeEventListener("mousemove", updateHovered);
      editorDom.removeEventListener("mouseleave", handleMouseLeave);
      container.removeEventListener("dragover", handleDragOver, true);
      container.removeEventListener("drop", clearDragVisuals);
      container.removeEventListener(
        "wikihub:internal-node-drag-end",
        clearDragVisuals,
      );
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [editor, containerRef, clearDragVisuals, setHoveredBlock]);

  if (!editor || !editor.isEditable) return null;

  const handleDragStart = (event: React.DragEvent<HTMLButtonElement>) => {
    if (!hovered) return;
    const { pos } = hovered;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || !DRAGGABLE_BLOCK_NODE_TYPES.has(node.type.name)) {
      event.preventDefault();
      return;
    }

    draggingPosRef.current = pos;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.dropEffect = "move";
    event.dataTransfer.setData("application/x-wikihub-block", String(pos));
    event.dataTransfer.setData("text/plain", "");

    const blockDom = editor.view.nodeDOM(pos);
    if (blockDom instanceof HTMLElement && event.dataTransfer.setDragImage) {
      event.dataTransfer.setDragImage(blockDom, 16, 16);
    }

    containerRef.current?.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-start", {
        bubbles: true,
        detail: { pos, isBlock: true },
      }),
    );
  };

  const handleDragEnd = () => {
    clearDragVisuals();
    setHoveredBlock(null);
    containerRef.current?.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-end", { bubbles: true }),
    );
  };

  return (
    <>
      {hovered ? (
        <button
          ref={handleRef}
          type="button"
          draggable
          aria-label={t("editor.dragToMoveBlock")}
          title={t("editor.dragToMoveBlock")}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onMouseDown={(event) => {
            // Keep ProseMirror's selection intact without focusing the button.
            event.stopPropagation();
          }}
          style={{ top: hovered.top, left: hovered.left }}
          className="border-border bg-surface-raised/95 text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected focus-visible:ring-ring fixed z-40 flex h-6 w-5 cursor-grab items-center justify-center rounded border shadow-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      ) : null}

      {dropIndicator ? (
        <div
          aria-hidden
          data-testid="block-drop-indicator"
          style={{
            top: dropIndicator.lineTop - 1,
            left: dropIndicator.lineLeft,
            width: dropIndicator.lineWidth,
          }}
          className="bg-primary pointer-events-none fixed z-50 h-0.5 rounded-full before:bg-primary before:absolute before:-top-[3px] before:-left-1 before:size-2 before:rounded-full before:content-['']"
        />
      ) : null}
    </>
  );
}
