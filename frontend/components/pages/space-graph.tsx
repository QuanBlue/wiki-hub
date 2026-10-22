"use client";

import {
  ExternalLink,
  Loader2,
  Maximize2,
  Network,
  RefreshCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { layoutGraph, type Point } from "@/lib/graph-layout";
import { useTranslation } from "@/lib/i18n/context";
import { fold, pageHref } from "@/lib/page-mentions";
import { cn } from "@/lib/utils";
import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  Space,
  SpaceGraph,
} from "@/types/api";

/** The map is drawn in a square of this many SVG units. */
const SIZE = 1000;
const KINDS: GraphEdgeKind[] = ["link", "mention", "similar", "tree"];
/** Only three hues stay apart for every reader when any two groups can sit side by
 * side; groups past these share the "other" colour and are named in the legend. */
const SERIES = ["var(--graph-1)", "var(--graph-2)", "var(--graph-3)"];
const OTHER = "var(--graph-other)";
/** Each kind of tie has its own line style, so none is told apart by colour alone. */
const DASH: Record<GraphEdgeKind, string | undefined> = {
  link: undefined,
  mention: "6 4",
  similar: "2 4",
  tree: "10 4 2 4",
};
/** The same styles, scaled to the 16px sample beside each kind's name. */
const SAMPLE_DASH: Record<GraphEdgeKind, string | undefined> = {
  link: undefined,
  mention: "5 3",
  similar: "1.5 2.5",
  tree: "6 2 1.5 2",
};
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;

type ColourBy = "group" | "branch" | "space";
/** One space, or every space the reader may open. */
export type MapScope = "space" | "all";
type View = { x: number; y: number; k: number };
const HOME: View = { x: 0, y: 0, k: 1 };

/** Groups of pages (by tie group or by branch), largest first, with their colour. */
type Legend = { id: string; name: string; count: number; colour: string }[];

function legendFor(
  nodes: GraphNode[],
  colourBy: ColourBy,
  titleOf: (id: string) => string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): { legend: Legend; groupOf: (node: GraphNode) => string } {
  const groupOf = (node: GraphNode) =>
    colourBy === "group"
      ? `g${node.community}`
      : colourBy === "space"
        ? `s:${node.space_key}`
        : node.branch_id;
  const spaceNames = new Map(
    nodes.map((node) => [node.space_key, node.space_name]),
  );
  const counts = new Map<string, number>();
  for (const node of nodes)
    counts.set(groupOf(node), (counts.get(groupOf(node)) ?? 0) + 1);
  const ordered = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const legend = ordered.map(([id, count], index) => ({
    id,
    count,
    // A group of one is not a group: it is drawn as "other".
    colour: index < SERIES.length && count > 1 ? SERIES[index] : OTHER,
    name:
      colourBy === "group"
        ? t("graph.groupN", { n: Number(id.slice(1)) + 1 })
        : colourBy === "space"
          ? (spaceNames.get(id.slice(2)) ?? id.slice(2))
          : t("graph.branchOf", { title: titleOf(id) }),
  }));
  return { legend, groupOf };
}

/**
 * Which side of a page its label is tried on first: the side it fits whole, else the one
 * with more room (where it will be shortened to fit).
 */
export function sidesToTry(
  width: number,
  room: { start: number; end: number },
): ("start" | "end")[] {
  if (width <= room.start) return ["start", "end"];
  if (width <= room.end) return ["end", "start"];
  return room.start >= room.end ? ["start", "end"] : ["end", "start"];
}

export function SpaceGraphDialog({
  space = null,
  initialScope,
  open,
  onOpenChange,
}: {
  /** The space it was opened from; without one, the map shows every space. */
  space?: Space | null;
  initialScope?: MapScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const startScope: MapScope = space ? (initialScope ?? "space") : "all";
  const [scope, setScope] = useState<MapScope>(startScope);
  const [attempt, setAttempt] = useState(0);
  // The last map read, with the request it answered: a redraw keeps showing it
  // until the new one arrives.
  const [loaded, setLoaded] = useState<{
    request: string;
    graph: SpaceGraph | null;
  } | null>(null);
  const request = `${scope}:${space?.key ?? ""}:${attempt}`;
  // Across spaces, which space a page is in is the first thing to see.
  const [colourBy, setColourBy] = useState<ColourBy>(
    startScope === "all" ? "space" : "group",
  );
  const [kinds, setKinds] = useState<Set<GraphEdgeKind>>(() => new Set(KINDS));
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(HOME);
  const svgRef = useRef<SVGSVGElement>(null);
  const asideRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  // SVG units per screen pixel: the map is drawn in a fixed square, shown at any size.
  const [unitsPerPixel, setUnitsPerPixel] = useState(SIZE / 600);
  // The part of the drawing square's x axis on screen: wider than the square when
  // the map is wider than it is tall.
  const [visibleX, setVisibleX] = useState<[number, number]>([0, SIZE]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const url =
      scope === "space" && space
        ? `/api/v1/spaces/${encodeURIComponent(space.key)}/graph`
        : "/api/v1/graph";
    api
      .get<SpaceGraph>(url)
      .then((data) => {
        if (active) setLoaded({ request, graph: data });
      })
      .catch(() => {
        if (active) setLoaded({ request, graph: null });
      });
    return () => {
      active = false;
    };
  }, [open, scope, space, request]);
  const graph = loaded?.graph ?? null;
  const loading = loaded?.request !== request;
  const failed = !loading && graph === null;

  const nodes = useMemo(() => graph?.nodes ?? [], [graph]);
  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const titleOf = useCallback(
    (id: string) => byId.get(id)?.title ?? "",
    [byId],
  );
  // Laid out from every tie, so turning a kind off does not move the pages. Across
  // spaces, each page is also pulled lightly towards the first page of its space (a
  // tie that is never drawn), so every space settles into its own cluster.
  const positions = useMemo<Record<string, Point>>(() => {
    const ties = (graph?.edges ?? []).map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight:
        edge.kind === "tree" ? 0.5 : edge.kind === "similar" ? edge.weight : 1,
    }));
    if (new Set(nodes.map((node) => node.space_key)).size > 1) {
      const anchors = new Map<string, string>();
      for (const node of nodes) {
        const anchor = anchors.get(node.space_key);
        if (anchor === undefined) anchors.set(node.space_key, node.id);
        else ties.push({ source: anchor, target: node.id, weight: 0.15 });
      }
    }
    return layoutGraph(
      nodes.map((node) => node.id),
      ties,
      { size: SIZE },
    );
  }, [nodes, graph]);
  const edges = useMemo(
    () => (graph?.edges ?? []).filter((edge) => kinds.has(edge.kind)),
    [graph, kinds],
  );
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source)!.add(edge.target);
      map.get(edge.target)!.add(edge.source);
    }
    return map;
  }, [edges]);
  const { legend, groupOf } = useMemo(
    () => legendFor(nodes, colourBy, titleOf, t),
    [nodes, colourBy, titleOf, t],
  );
  const colourOf = useMemo(() => {
    const colours = new Map(legend.map((entry) => [entry.id, entry.colour]));
    return (node: GraphNode) => colours.get(groupOf(node)) ?? OTHER;
  }, [legend, groupOf]);
  const matches = useMemo(() => {
    const folded = fold(query.trim());
    if (!folded) return [];
    return nodes.filter(
      (node) =>
        fold(node.title).includes(folded) ||
        (scope === "all" && fold(node.space_name).includes(folded)),
    );
  }, [nodes, query, scope]);

  // What stands out: the hovered or selected page and its neighbours, a legend
  // group, or the pages matching the search. Everything else is dimmed.
  const focus = hovered ?? selected;
  const lit = useMemo(() => {
    if (focus) return new Set([focus, ...(neighbours.get(focus) ?? [])]);
    if (focusGroup)
      return new Set(
        nodes.filter((n) => groupOf(n) === focusGroup).map((n) => n.id),
      );
    if (query.trim()) return new Set(matches.map((node) => node.id));
    return null;
  }, [focus, focusGroup, neighbours, nodes, groupOf, query, matches]);

  const centreOn = useCallback(
    (id: string) => {
      const point = positions[id];
      if (!point) return;
      const k = Math.max(view.k, 1.5);
      setView({ k, x: SIZE / 2 - point.x * k, y: SIZE / 2 - point.y * k });
    },
    [positions, view.k],
  );
  const select = useCallback(
    (id: string) => {
      setSelected(id);
      setFocusGroup(null);
      centreOn(id);
    },
    [centreOn],
  );

  const zoom = useCallback(
    (factor: number, at: Point = { x: SIZE / 2, y: SIZE / 2 }) => {
      setView((current) => {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
        const ratio = k / current.k;
        return {
          k,
          x: at.x - (at.x - current.x) * ratio,
          y: at.y - (at.y - current.y) * ratio,
        };
      });
    },
    [],
  );

  /** A pointer position in SVG units. */
  const toSvg = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const box = svg.getBoundingClientRect();
    const scale = SIZE / Math.min(box.width, box.height);
    const offsetX = (box.width - Math.min(box.width, box.height)) / 2;
    const offsetY = (box.height - Math.min(box.width, box.height)) / 2;
    return {
      x: (clientX - box.left - offsetX) * scale,
      y: (clientY - box.top - offsetY) * scale,
    };
  }, []);

  // The wheel zooms the map, not the dialog: that needs a listener that may
  // prevent the default, which React's own wheel handler cannot.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(
        event.deltaY < 0 ? 1.15 : 1 / 1.15,
        toSvg(event.clientX, event.clientY),
      );
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoom, toSvg, graph]);

  const reset = () => {
    setView(HOME);
    setSelected(null);
    setFocusGroup(null);
  };

  // A newly picked page is shown from the top of the side panel, not wherever the
  // list it was picked from had been scrolled to.
  useEffect(() => {
    asideRef.current?.scrollTo?.({ top: 0 });
  }, [selected]);

  // Keep the units-per-pixel ratio current as the dialog resizes.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const box = svg.getBoundingClientRect();
      const side = Math.min(box.width, box.height);
      if (side > 0) {
        const perPixel = SIZE / side;
        const wide = box.width * perPixel;
        setUnitsPerPixel(perPixel);
        setVisibleX([(SIZE - wide) / 2, (SIZE + wide) / 2]);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [graph]);

  /** One screen pixel, in SVG units at the current zoom. */
  const unit = unitsPerPixel / view.k;
  // Which pages get a label, and on which side: the picked page first, then its
  // neighbours, then the best-connected. A label that would cover another label or
  // a page is tried on the other side, then left out - its page still names itself
  // on hover and in the list.
  const labels = useMemo(() => {
    const out = new Map<
      string,
      { x: number; anchor: "start" | "end"; text: string }
    >();
    const taken: [number, number, number, number][] = [];
    const radiusOf = (node: GraphNode) =>
      (5 + Math.sqrt(node.degree) * 2.2) * unit;
    for (const node of nodes) {
      const point = positions[node.id];
      if (!point) continue;
      const r = radiusOf(node);
      taken.push([point.x - r, point.x + r, point.y - r, point.y + r]);
    }
    const rank = (node: GraphNode) =>
      node.id === focus ? 0 : lit?.has(node.id) ? 1 : 2;
    const ordered = [...nodes].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.degree - a.degree ||
        a.title.localeCompare(b.title),
    );
    const overlaps = (box: [number, number, number, number], own: number) =>
      taken.some(
        (other, index) =>
          index !== own &&
          box[0] < other[1] &&
          box[1] > other[0] &&
          box[2] < other[3] &&
          box[3] > other[2],
      );
    for (const node of ordered) {
      const point = positions[node.id];
      if (!point || (lit !== null && !lit.has(node.id))) continue;
      const own = nodes.indexOf(node);
      const full =
        node.title.length > 32 ? `${node.title.slice(0, 30)}…` : node.title;
      const charWidth = 6.6 * unit;
      const half = 8 * unit;
      const gap = radiusOf(node) + 4 * unit;
      // Room on each side, up to the edge of what is on screen (in map units).
      const onScreen = point.x * view.k + view.x;
      const room = {
        start: (visibleX[1] - onScreen) / view.k - gap - 4 * unit,
        end: (onScreen - visibleX[0]) / view.k - gap - 4 * unit,
      };
      const sides = sidesToTry(full.length * charWidth, room);
      for (const anchor of sides) {
        // Where neither side has room for the whole title, it is shortened to fit.
        const chars = Math.floor(room[anchor] / charWidth);
        if (chars < 6) continue;
        const text =
          full.length <= chars ? full : `${full.slice(0, chars - 1)}…`;
        const width = text.length * charWidth;
        const x = anchor === "start" ? point.x + gap : point.x - gap;
        const box: [number, number, number, number] =
          anchor === "start"
            ? [x, x + width, point.y - half, point.y + half]
            : [x - width, x, point.y - half, point.y + half];
        if (node.id === focus || !overlaps(box, own)) {
          taken.push(box);
          out.set(node.id, { x, anchor, text });
          break;
        }
      }
    }
    return out;
  }, [nodes, positions, focus, lit, unit, view.k, view.x, visibleX]);
  const selectedNode = selected ? (byId.get(selected) ?? null) : null;
  const capped = graph && graph.total_pages > nodes.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          reset();
          setScope(startScope);
          setColourBy(startScope === "all" ? "space" : "group");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex h-[min(90vh,960px)] max-w-6xl flex-col overflow-hidden max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:p-3"
        title={
          <span className="flex items-center gap-2">
            <Network className="text-muted-foreground size-4" aria-hidden />
            {t(scope === "all" ? "graph.mapAllTitle" : "graph.mapTitle")}
          </span>
        }
        description={
          scope === "all" || !space
            ? t("graph.mapAllDescription")
            : t("graph.mapDescription", { space: space.name })
        }
      >
        {/* Toolbar: one row of filters above the map. */}
        {/* On a phone the toolbar is one row that scrolls sideways, so the map keeps
            the height. */}
        <div className="flex flex-wrap items-center gap-2 pb-3 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:pb-2">
          <div className="relative min-w-48 flex-1 sm:max-w-64">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches[0]) select(matches[0].id);
              }}
              placeholder={t("graph.findPage")}
              aria-label={t("graph.findPage")}
              className="h-8 pl-8"
            />
          </div>
          {space ? (
            <div
              role="group"
              aria-label={t("graph.scope")}
              className="bg-surface-sunken border-border inline-flex shrink-0 gap-0.5 rounded-md border p-0.5"
            >
              {(["space", "all"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={scope === option}
                  onClick={() => {
                    if (option === scope) return;
                    setScope(option);
                    setColourBy(option === "all" ? "space" : "group");
                    setSelected(null);
                    setFocusGroup(null);
                    setView(HOME);
                  }}
                  className={cn(
                    "focus-visible:ring-ring cursor-pointer rounded-sm px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    scope === option
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected",
                  )}
                >
                  {t(option === "space" ? "graph.scopeThis" : "graph.scopeAll")}
                </button>
              ))}
            </div>
          ) : null}
          <div
            role="group"
            aria-label={t("graph.colorBy")}
            className="flex shrink-0 items-center gap-1"
          >
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {t("graph.colorBy")}
            </span>
            {(scope === "all"
              ? (["space", "group", "branch"] as const)
              : (["group", "branch"] as const)
            ).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={colourBy === option ? "subtle" : "ghost"}
                aria-pressed={colourBy === option}
                className={cn(
                  colourBy === option && "bg-surface-selected text-foreground",
                )}
                onClick={() => {
                  setColourBy(option);
                  setFocusGroup(null);
                }}
              >
                {t(
                  option === "group"
                    ? "graph.colorGroup"
                    : option === "space"
                      ? "graph.colorSpace"
                      : "graph.colorBranch",
                )}
              </Button>
            ))}
          </div>
          <div
            role="group"
            aria-label={t("graph.ties")}
            className="flex shrink-0 flex-wrap items-center gap-1 max-sm:flex-nowrap"
          >
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {t("graph.ties")}
            </span>
            {KINDS.map((kind) => {
              const on = kinds.has(kind);
              return (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={on ? "subtle" : "ghost"}
                  aria-pressed={on}
                  className={cn(
                    "gap-1.5",
                    on && "bg-surface-selected text-foreground",
                  )}
                  onClick={() =>
                    setKinds((current) => {
                      const next = new Set(current);
                      if (next.has(kind)) next.delete(kind);
                      else next.add(kind);
                      return next;
                    })
                  }
                >
                  {/* Buttons size every svg to a 16px square, so the sample line is
                      drawn in one, centred, rather than in a thin box of its own. */}
                  <svg viewBox="0 0 16 16" aria-hidden className="shrink-0">
                    <line
                      x1="0"
                      y1="8"
                      x2="16"
                      y2="8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray={SAMPLE_DASH[kind]}
                    />
                  </svg>
                  {t(`graph.kind_${kind}`)}
                </Button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("graph.zoomIn")}
              title={t("graph.zoomIn")}
              onClick={() => zoom(1.3)}
            >
              <ZoomIn />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("graph.zoomOut")}
              title={t("graph.zoomOut")}
              onClick={() => zoom(1 / 1.3)}
            >
              <ZoomOut />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("graph.fit")}
              title={t("graph.fit")}
              onClick={() => setView(HOME)}
            >
              <Maximize2 />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("graph.redraw")}
              title={t("graph.redraw")}
              onClick={() => {
                reset();
                setAttempt((n) => n + 1);
              }}
            >
              <RefreshCw />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
          <div className="border-border bg-surface-sunken relative min-h-56 flex-1 overflow-hidden rounded-lg border">
            {loading && !graph ? (
              <div className="text-muted-foreground absolute inset-0 grid place-items-center text-sm">
                <span className="flex items-center gap-2">
                  <Loader2
                    className="size-4 motion-safe:animate-spin"
                    aria-hidden
                  />
                  {t("graph.loading")}
                </span>
              </div>
            ) : failed ? (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div>
                  <p className="text-sm">{t("graph.loadError")}</p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3"
                    onClick={() => setAttempt((n) => n + 1)}
                  >
                    {t("graph.retry")}
                  </Button>
                </div>
              </div>
            ) : nodes.length === 0 || (graph?.edges.length ?? 0) === 0 ? (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div className="max-w-sm">
                  <p className="font-medium">{t("graph.emptyTitle")}</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {t("graph.emptyHint")}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${SIZE} ${SIZE}`}
                  role="img"
                  aria-label={t("graph.mapAria", { count: nodes.length })}
                  className="size-full cursor-grab touch-none select-none active:cursor-grabbing"
                  onPointerDown={(event) => {
                    if ((event.target as Element).closest("[data-node]"))
                      return;
                    drag.current = {
                      ...toSvg(event.clientX, event.clientY),
                      view,
                    };
                    (event.currentTarget as Element).setPointerCapture(
                      event.pointerId,
                    );
                  }}
                  onPointerMove={(event) => {
                    const start = drag.current;
                    if (!start) return;
                    const point = toSvg(event.clientX, event.clientY);
                    setView({
                      ...start.view,
                      x: start.view.x + point.x - start.x,
                      y: start.view.y + point.y - start.y,
                    });
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onClick={(event) => {
                    if (!(event.target as Element).closest("[data-node]"))
                      setSelected(null);
                  }}
                >
                  <g
                    transform={`translate(${view.x} ${view.y}) scale(${view.k})`}
                  >
                    {edges.map((edge: GraphEdge) => {
                      const a = positions[edge.source];
                      const b = positions[edge.target];
                      if (!a || !b) return null;
                      const on = lit
                        ? lit.has(edge.source) &&
                          lit.has(edge.target) &&
                          (!focus ||
                            edge.source === focus ||
                            edge.target === focus)
                        : false;
                      return (
                        <line
                          key={`${edge.source}-${edge.target}-${edge.kind}`}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke={
                            on ? "var(--primary)" : "var(--muted-foreground)"
                          }
                          strokeWidth={
                            (on
                              ? 2
                              : 1 +
                                (edge.kind === "similar" ? edge.weight : 0.5)) *
                            unit
                          }
                          strokeDasharray={DASH[edge.kind]
                            ?.split(" ")
                            .map((part) => Number(part) * unit)
                            .join(" ")}
                          strokeOpacity={
                            lit && !on
                              ? 0.08
                              : edge.kind === "tree"
                                ? 0.35
                                : 0.55
                          }
                        />
                      );
                    })}
                    {nodes.map((node) => {
                      const point = positions[node.id];
                      if (!point) return null;
                      const dim = lit !== null && !lit.has(node.id);
                      // Sizes are in screen pixels, whatever the map's size or zoom.
                      const radius = (5 + Math.sqrt(node.degree) * 2.2) * unit;
                      const isFocus = node.id === focus;
                      const label = labels.get(node.id);
                      return (
                        <g
                          key={node.id}
                          data-node
                          className="cursor-pointer"
                          opacity={dim ? 0.18 : 1}
                          onPointerEnter={() => setHovered(node.id)}
                          onPointerLeave={() => setHovered(null)}
                          onClick={() => select(node.id)}
                          onDoubleClick={() => {
                            window.location.href = pageHref(
                              node.space_key,
                              node.slug,
                            );
                          }}
                        >
                          <title>{node.title}</title>
                          {/* A target big enough for a finger, around a small mark. */}
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={Math.max(radius, 16 * unit)}
                            fill="transparent"
                          />
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={radius}
                            fill={colourOf(node)}
                            stroke={
                              isFocus ? "var(--foreground)" : "var(--surface)"
                            }
                            strokeWidth={(isFocus ? 2.5 : 2) * unit}
                          />
                          {label ? (
                            <text
                              x={label.x}
                              textAnchor={label.anchor}
                              y={point.y}
                              dominantBaseline="middle"
                              fontSize={12 * unit}
                              fontWeight={isFocus ? 600 : 400}
                              fill="var(--foreground)"
                              stroke="var(--surface-sunken)"
                              strokeWidth={3 * unit}
                              paintOrder="stroke"
                            >
                              {label.text}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}
                  </g>
                </svg>

                {capped ? (
                  <p className="border-border bg-surface/95 text-muted-foreground absolute top-2 left-2 rounded-md border px-2 py-1 text-xs">
                    {t("graph.capped", {
                      shown: nodes.length,
                      total: graph.total_pages,
                    })}
                  </p>
                ) : null}
              </>
            )}
          </div>

          {/* Beside the map on a wide screen; below it, as a sheet of limited
              height, on a phone. */}
          {/* The panel itself never scrolls: the legend, the insights (or the picked
              page) and the list of pages each scroll on their own. */}
          <aside className="border-border flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-lg border max-md:max-h-[42%] md:w-72">
            {nodes.length && legend.length ? (
              <>
                {/* Legend: every group is named and can be singled out, so identity
                never rests on colour alone. */}
                <div className="border-border max-h-48 shrink-0 overflow-y-auto border-b p-2 text-xs">
                  <p className="text-muted-foreground mb-1 font-medium">
                    {t("graph.legend")}
                  </p>
                  <ul className="space-y-0.5">
                    {legend.map((entry) => {
                      const on = focusGroup === entry.id;
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            aria-pressed={on}
                            title={t("graph.highlight", { name: entry.name })}
                            onClick={() => {
                              setFocusGroup(on ? null : entry.id);
                              setSelected(null);
                            }}
                            className={cn(
                              "hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                              on && "bg-surface-selected",
                            )}
                          >
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ background: entry.colour }}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {entry.name}
                            </span>
                            <span className="text-muted-foreground tabular-nums">
                              {entry.count}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {focusGroup ? (
                    <button
                      type="button"
                      onClick={() => setFocusGroup(null)}
                      className="text-primary focus-visible:ring-ring mt-1 cursor-pointer rounded-sm px-1.5 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {t("graph.clearHighlight")}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
            <div ref={asideRef} className="min-h-0 flex-1 overflow-y-auto">
              {query.trim() && !selectedNode ? (
                <SearchMatches matches={matches} onSelect={select} />
              ) : selectedNode ? (
                <NodePreview
                  node={selectedNode}
                  showSpace={scope === "all"}
                  neighbours={[...(neighbours.get(selectedNode.id) ?? [])]
                    .map((id) => byId.get(id))
                    .filter((node): node is GraphNode => Boolean(node))
                    .sort((a, b) => a.title.localeCompare(b.title))}
                  onSelect={select}
                  onClose={() => setSelected(null)}
                />
              ) : graph ? (
                <Insights
                  graph={graph}
                  titleOf={titleOf}
                  onSelect={select}
                  onFocusGroup={(community) => {
                    setColourBy("group");
                    setSelected(null);
                    setFocusGroup(`g${community}`);
                  }}
                />
              ) : null}
            </div>
            {nodes.length ? (
              <details className="border-border shrink-0 border-t p-3 text-sm">
                <summary className="hover:text-foreground focus-visible:ring-ring text-muted-foreground cursor-pointer rounded-sm text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none">
                  {t("graph.pageList")} ({nodes.length})
                </summary>
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                  {nodes.map((node) => (
                    <li key={node.id}>
                      <PageButton node={node} onSelect={select} />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PageButton({
  node,
  onSelect,
}: {
  node: GraphNode;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className="hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring w-full cursor-pointer truncate rounded-sm px-1.5 py-1 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
    >
      {node.title}
    </button>
  );
}

function SearchMatches({
  matches,
  onSelect,
}: {
  matches: GraphNode[];
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="p-3">
      {matches.length ? (
        <ul className="space-y-0.5">
          {matches.slice(0, 30).map((node) => (
            <li key={node.id}>
              <PageButton node={node} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("graph.noMatch")}</p>
      )}
    </div>
  );
}

function NodePreview({
  node,
  showSpace,
  neighbours,
  onSelect,
  onClose,
}: {
  node: GraphNode;
  /** Name the page's space too: the map shows several. */
  showSpace: boolean;
  neighbours: GraphNode[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="p-3">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold break-words">
          {node.title}
        </h3>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={t("graph.closePreview")}
          title={t("graph.closePreview")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {showSpace ? `${node.space_name} · ` : ""}
        {neighbours.length === 1
          ? t("graph.tieCountOne")
          : t("graph.tieCount", { count: neighbours.length })}
      </p>
      {node.excerpt ? (
        <p className="text-foreground mt-2 line-clamp-6 text-xs leading-relaxed">
          {node.excerpt}
        </p>
      ) : null}
      <Button asChild size="sm" variant="primary" className="mt-3 gap-1.5">
        <Link href={pageHref(node.space_key, node.slug)}>
          <ExternalLink />
          {t("graph.openPage")}
        </Link>
      </Button>
      {neighbours.length ? (
        <>
          <p className="text-muted-foreground mt-4 mb-1 text-xs font-medium">
            {t("graph.tiedTo")}
          </p>
          <ul className="space-y-0.5">
            {neighbours.map((other) => (
              <li key={other.id}>
                <PageButton node={other} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Insights({
  graph,
  titleOf,
  onSelect,
  onFocusGroup,
}: {
  graph: SpaceGraph;
  titleOf: (id: string) => string;
  onSelect: (id: string) => void;
  onFocusGroup: (community: number) => void;
}) {
  const { t } = useTranslation();
  const pagesOf = (ids: string[]) =>
    ids.map((id) => ({
      key: id,
      label: titleOf(id),
      onClick: () => onSelect(id),
    }));
  const sections = [
    {
      key: "bridges",
      title: t("graph.bridges"),
      hint: t("graph.bridgesHint"),
      items: pagesOf(graph.insights.bridges),
    },
    {
      key: "sparse",
      title: t("graph.sparseGroups"),
      hint: t("graph.sparseGroupsHint"),
      items: graph.insights.sparse_groups.map((group) => ({
        key: `g${group.community}`,
        label: t("graph.groupSize", {
          name: t("graph.groupN", { n: group.community + 1 }),
          count: group.size,
        }),
        onClick: () => onFocusGroup(group.community),
      })),
    },
    {
      key: "orphans",
      title: t("graph.orphans"),
      hint: t("graph.orphansHint"),
      items: pagesOf(graph.insights.orphans),
    },
  ].filter((section) => section.items.length);
  return (
    <div className="p-3">
      <p className="text-muted-foreground text-xs">{t("graph.selectHint")}</p>
      <h3 className="mt-4 text-sm font-semibold">{t("graph.insights")}</h3>
      {sections.length ? (
        sections.map((section) => (
          <section key={section.key} className="mt-3">
            <h4 className="text-xs font-medium">{section.title}</h4>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {section.hint}
            </p>
            <ul className="mt-1 space-y-0.5">
              {section.items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={item.onClick}
                    className="hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring w-full cursor-pointer truncate rounded-sm px-1.5 py-1 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="text-muted-foreground mt-1 text-xs">
          {t("graph.noInsights")}
        </p>
      )}
    </div>
  );
}
