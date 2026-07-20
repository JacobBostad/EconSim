/**
 * District.ts — a named zone of the city (world-scale roadmap, HD6).
 *
 * In A2 districts are pure METADATA over the existing map: a partition that
 * cohorts key off from birth, so nothing needs re-keying when A4 makes
 * districts physical (map presets, placement, district-local shopping).
 * Desirability is recomputed daily by DistrictSystem and cached here.
 */

export type DistrictId = string;

export type DistrictKind = 'residential' | 'commercial' | 'industrial' | 'civic' | 'mixed';

export interface District {
  id: DistrictId;
  name: string;
  kind: DistrictKind;
  /** Axis-aligned bounds in world units. Partition: every map point belongs
   * to exactly one district. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Authored base attractiveness (scenario data; 1 = neutral). */
  landValueBase: number;
  /** Live attractiveness cache (0..1), recomputed daily by DistrictSystem
   * from homes, jobs, and shops present — never read for money math in A2. */
  desirability: number;
  /** Cohort housing stock this district can hold (people, not homes). The
   * on-map homes remain the CAST's housing; the crowd lives here. */
  housingCapacity: number;
  adjacent: DistrictId[];
}

/** The district containing a world point (bounds partition the map). */
export function districtAt(
  districts: Record<DistrictId, District>,
  x: number,
  y: number,
): District | null {
  for (const id of Object.keys(districts).sort()) {
    const d = districts[id]!;
    const b = d.bounds;
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return d;
  }
  // Points outside every bound (map edge growth) belong to the last
  // residential district — the partition must never strand an entity.
  for (const id of Object.keys(districts).sort()) {
    if (districts[id]!.kind === 'residential') return districts[id]!;
  }
  const first = Object.keys(districts).sort()[0];
  return first ? districts[first]! : null;
}
