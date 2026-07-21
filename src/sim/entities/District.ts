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
  /** Live land-value cache (0..1): the home-proximity land value sampled at the
   * district's centre, recomputed daily by DistrictSystem from the same home
   * snapshot the money path's landValueAt uses (A4). A per-district DAILY digest
   * of the point kernel — a location-premium readout for the Districts panel, not
   * a money-path input (the money path stays live; see LandValue.ts). Absent on
   * saves written before A4 until the first daily pass repopulates it. */
  landValue?: number;
  /** Cohort housing stock this district can hold (people, not homes). The
   * on-map homes remain the CAST's housing; the crowd lives here. */
  housingCapacity: number;
  adjacent: DistrictId[];
}

/**
 * The districts a shopper rooted in `originId` may reach: its own plus every
 * `adjacent` id (A4 district-local shopping — a home district and the quarters
 * beside it, no farther, because a shop-window trip at walking speed cannot
 * cross a City/Metropolis map). Unknown ids yield just themselves. Village never
 * calls this (it keeps the town-wide scan — its map fits in reach).
 */
export function shoppingDistrictIds(
  districts: Record<DistrictId, District>,
  originId: DistrictId,
): Set<DistrictId> {
  const allowed = new Set<DistrictId>([originId]);
  const origin = districts[originId];
  if (origin) for (const adj of origin.adjacent) allowed.add(adj);
  return allowed;
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
