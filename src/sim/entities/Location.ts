/**
 * Location.ts — 2D positions and distance helpers for the town map.
 *
 * The map is a continuous 2D plane. Facilities occupy fixed points; citizens
 * and vehicles move between them. Distances are Euclidean and used both for
 * movement timing and for the retail "distance score".
 */

export interface Vec2 {
  x: number;
  y: number;
}

export function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Move `from` toward `to` by at most `maxStep` units. Returns the new position
 * and whether the destination was reached this step.
 */
export function moveToward(
  from: Vec2,
  to: Vec2,
  maxStep: number,
): { pos: Vec2; arrived: boolean } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= maxStep || dist === 0) {
    return { pos: { x: to.x, y: to.y }, arrived: true };
  }
  const ratio = maxStep / dist;
  return {
    pos: { x: from.x + dx * ratio, y: from.y + dy * ratio },
    arrived: false,
  };
}
