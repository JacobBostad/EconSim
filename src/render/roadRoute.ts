/**
 * roadRoute.ts — pure geometry for road-following truck routes.
 *
 * The engine moves vehicles in a straight line between facilities; the
 * renderer maps that progress fraction onto a Manhattan polyline over the
 * street grid so trucks appear to drive the roads. Pure functions so the
 * mapping is unit-testable without a canvas.
 */

export interface Vec { x: number; y: number }

export interface RoadGrid {
  x0: number; x1: number; y0: number; y1: number;
  hYs: number[];
  vXs: number[];
}

export interface Route { pts: Vec[]; cum: number[]; total: number }

function nearest(arr: number[], v: number): number {
  return arr.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

/** Origin → nearest avenue → (vertical road when changing avenues) → dest. */
export function buildRoute(o: Vec, d: Vec, g: RoadGrid): Route {
  const ao = nearest(g.hYs, o.y);
  const ad = nearest(g.hYs, d.y);
  const raw: Vec[] = [o];
  if (ao === ad) {
    raw.push({ x: o.x, y: ao }, { x: d.x, y: ao });
  } else {
    const vx = nearest(g.vXs, (o.x + d.x) / 2);
    raw.push({ x: o.x, y: ao }, { x: vx, y: ao }, { x: vx, y: ad }, { x: d.x, y: ad });
  }
  raw.push(d);
  const pts: Vec[] = [raw[0]!];
  for (const p of raw) {
    const l = pts[pts.length - 1]!;
    if (Math.hypot(p.x - l.x, p.y - l.y) > 0.05) pts.push(p);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  }
  return { pts, cum, total: cum[cum.length - 1]! };
}

/** Position + unit heading along the route at progress fraction t ∈ [0,1]. */
export function routePose(route: Route, t: number): { p: Vec; dir: Vec } {
  const len = Math.max(0, Math.min(1, t)) * route.total;
  const { pts, cum } = route;
  for (let i = 1; i < pts.length; i++) {
    if (len <= cum[i]! || i === pts.length - 1) {
      const seg = Math.max(1e-6, cum[i]! - cum[i - 1]!);
      const f = Math.max(0, Math.min(1, (len - cum[i - 1]!) / seg));
      const a = pts[i - 1]!, b = pts[i]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dl = Math.max(1e-6, Math.hypot(dx, dy));
      return { p: { x: a.x + dx * f, y: a.y + dy * f }, dir: { x: dx / dl, y: dy / dl } };
    }
  }
  const last = pts[pts.length - 1]!;
  return { p: { ...last }, dir: { x: 1, y: 0 } };
}
