/**
 * Placing a space's pages on its map.
 *
 * Pages that tie together (a connected component) are laid out with a force-directed
 * layout (Fruchterman-Reingold): tied pages pull together, every pair pushes apart.
 * Components are then packed in rows, largest first, so a page tied to nothing sits
 * beside the others instead of being pushed to a far corner. Pure and deterministic -
 * the same pages and ties always give the same picture, so the map does not reshuffle
 * between visits. No dependency: a few hundred pages settle in well under a second.
 */

export type Point = { x: number; y: number };

export type LayoutEdge = { source: string; target: string; weight?: number };

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * How far apart pages ``i`` and ``j`` are, as ``[dx, dy, distance]``. Two pages on one
 * spot are nudged apart, the same way every time, so the push between them is finite.
 */
export function apart(
  i: number,
  j: number,
  dx: number,
  dy: number,
): [number, number, number] {
  const dist = Math.hypot(dx, dy);
  if (dist >= 0.01) return [dx, dy, dist];
  const nx = 0.01 * ((i % 7) - 3 || 1);
  const ny = 0.01 * ((j % 5) - 2 || 1);
  return [nx, ny, Math.hypot(nx, ny)];
}

/** One component laid out in the unit square. */
function forceLayout(
  count: number,
  links: [number, number, number][],
): Point[] {
  if (count === 1) return [{ x: 0.5, y: 0.5 }];
  const size = 1000;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  // Start on a sunflower spiral: spread out, and the same every time.
  for (let i = 0; i < count; i++) {
    const r = (size / 2) * Math.sqrt((i + 0.5) / count);
    xs[i] = size / 2 + r * Math.cos(i * GOLDEN_ANGLE);
    ys[i] = size / 2 + r * Math.sin(i * GOLDEN_ANGLE);
  }
  const k = Math.sqrt((size * size) / count) * 0.6;
  const rounds = count > 300 ? 120 : count > 100 ? 200 : 300;
  let temperature = size / 10;
  const cool = temperature / (rounds + 1);
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);
  for (let round = 0; round < rounds; round++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const [ddx, ddy, dist] = apart(i, j, xs[i] - xs[j], ys[i] - ys[j]);
        const push = (k * k) / dist;
        dx[i] += (ddx / dist) * push;
        dy[i] += (ddy / dist) * push;
        dx[j] -= (ddx / dist) * push;
        dy[j] -= (ddy / dist) * push;
      }
    }
    for (const [a, b, weight] of links) {
      const ddx = xs[a] - xs[b];
      const ddy = ys[a] - ys[b];
      const dist = Math.max(Math.hypot(ddx, ddy), 0.01);
      const pull = ((dist * dist) / k) * weight;
      dx[a] -= (ddx / dist) * pull;
      dy[a] -= (ddy / dist) * pull;
      dx[b] += (ddx / dist) * pull;
      dy[b] += (ddy / dist) * pull;
    }
    for (let i = 0; i < count; i++) {
      const move = Math.hypot(dx[i], dy[i]);
      if (move > 0) {
        const step = Math.min(move, temperature);
        xs[i] += (dx[i] / move) * step;
        ys[i] += (dy[i] / move) * step;
      }
    }
    temperature = Math.max(temperature - cool, 0.5);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    minX = Math.min(minX, xs[i]);
    minY = Math.min(minY, ys[i]);
    maxX = Math.max(maxX, xs[i]);
    maxY = Math.max(maxY, ys[i]);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const padX = (span - (maxX - minX)) / 2;
  const padY = (span - (maxY - minY)) / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: (xs[i] - minX + padX) / span,
    y: (ys[i] - minY + padY) / span,
  }));
}

export function layoutGraph(
  ids: string[],
  edges: LayoutEdge[],
  { size = 1000 }: { size?: number } = {},
): Record<string, Point> {
  const n = ids.length;
  const out: Record<string, Point> = {};
  if (n === 0) return out;
  const index = new Map(ids.map((id, i) => [id, i]));
  const links: [number, number, number][] = [];
  const parent = ids.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const edge of edges) {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    links.push([a, b, edge.weight ?? 1]);
    parent[root(a)] = root(b);
  }
  // Components, largest first; ties keep the order pages were given in.
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = root(i);
    if (!members.has(r)) members.set(r, []);
    members.get(r)!.push(i);
  }
  const components = [...members.values()].sort(
    (a, b) => b.length - a.length || a[0] - b[0],
  );

  // Each component gets a square cell whose side grows with the root of its size,
  // packed in rows of roughly equal width.
  const sides = components.map((c) => Math.sqrt(c.length));
  const total = sides.reduce((sum, side) => sum + side * side, 0);
  const rowWidth = Math.max(Math.sqrt(total) * 1.15, sides[0]);
  const cells: { x: number; y: number; side: number }[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const side of sides) {
    if (x > 0 && x + side > rowWidth) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    cells.push({ x, y, side });
    x += side;
    rowHeight = Math.max(rowHeight, side);
  }
  const width = Math.max(...cells.map((cell) => cell.x + cell.side));
  const height = y + rowHeight;
  const scale = size / Math.max(width, height);
  const offsetX = (size - width * scale) / 2;
  const offsetY = (size - height * scale) / 2;

  components.forEach((component, c) => {
    const local = new Map(component.map((i, j) => [i, j]));
    const componentLinks = links
      .filter(([a]) => local.has(a))
      .map(
        ([a, b, w]) =>
          [local.get(a)!, local.get(b)!, w] as [number, number, number],
      );
    const points = forceLayout(component.length, componentLinks);
    const cell = cells[c];
    // A margin inside each cell keeps components, and their labels, apart.
    const inner = cell.side * (component.length === 1 ? 0 : 0.8);
    const margin = (cell.side - inner) / 2;
    component.forEach((i, j) => {
      out[ids[i]] = {
        x: offsetX + (cell.x + margin + points[j].x * inner) * scale,
        y: offsetY + (cell.y + margin + points[j].y * inner) * scale,
      };
    });
  });
  return out;
}
