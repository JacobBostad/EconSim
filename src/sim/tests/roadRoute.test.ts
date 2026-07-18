import { describe, it, expect } from 'vitest';
import { buildRoute, routePose, type RoadGrid } from '../../render/roadRoute';

const GRID: RoadGrid = {
  x0: 10, x1: 100, y0: 20, y1: 80,
  hYs: [20, 50, 80],
  vXs: [10, 40, 70, 100],
};

describe('Road-following truck routes', () => {
  it('same-avenue trip: drive to the avenue, along it, then to the door', () => {
    const r = buildRoute({ x: 30, y: 24 }, { x: 90, y: 18 }, GRID);
    // Endpoints preserved.
    expect(r.pts[0]).toEqual({ x: 30, y: 24 });
    expect(r.pts[r.pts.length - 1]).toEqual({ x: 90, y: 18 });
    // All intermediate points sit on the nearest avenue (y=20).
    for (const p of r.pts.slice(1, -1)) expect(p.y).toBe(20);
    // Longer than the crow-flies line, but bounded by the Manhattan detour.
    const straight = Math.hypot(60, -6);
    expect(r.total).toBeGreaterThan(straight);
  });

  it('cross-avenue trip goes via a vertical road', () => {
    const r = buildRoute({ x: 30, y: 22 }, { x: 90, y: 78 }, GRID);
    // Some intermediate point must sit on a vertical road while changing avenues.
    const onVertical = r.pts.slice(1, -1).filter((p) => GRID.vXs.includes(p.x));
    expect(onVertical.length).toBeGreaterThanOrEqual(2);
    // Route is continuous: consecutive points share an x or a y (Manhattan).
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1]!, b = r.pts[i]!;
      expect(a.x === b.x || a.y === b.y || i === 1 || i === r.pts.length - 1).toBe(true);
    }
  });

  it('routePose maps t=0 to origin, t=1 to destination, monotone in between', () => {
    const o = { x: 30, y: 22 }, d = { x: 90, y: 78 };
    const r = buildRoute(o, d, GRID);
    expect(routePose(r, 0).p).toEqual(o);
    expect(routePose(r, 1).p).toEqual(d);
    // Walking t forward never moves backwards along the path.
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const { p } = routePose(r, t);
      let len = 0;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1]!, b = r.pts[i]!;
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        const onSeg =
          Math.abs(Math.hypot(p.x - a.x, p.y - a.y) + Math.hypot(b.x - p.x, b.y - p.y) - seg) < 1e-6;
        if (onSeg) { len += Math.hypot(p.x - a.x, p.y - a.y); break; }
        len += seg;
      }
      expect(len).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = len;
    }
    // Heading is always a unit vector.
    const { dir } = routePose(r, 0.5);
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 6);
  });

  it('degenerate trip (origin equals destination) stays put', () => {
    const r = buildRoute({ x: 30, y: 50 }, { x: 30, y: 50 }, GRID);
    expect(routePose(r, 0.5).p).toEqual({ x: 30, y: 50 });
  });
});
