/**
 * DistrictSlots.ts — deterministic build-slot enumeration inside districts
 * (world-scale roadmap, A4).
 *
 * The single placement primitive that replaces the three hardcoded schemes on
 * the big maps: homeSlotFor's southward column march (ImmigrationSystem), the
 * fixed build rows in ChainBuilder, and the AI founders' magic coordinates.
 * Homes go in residential districts; producers/factories in industrial;
 * stores in commercial — each into the FIRST free slot on a district-local
 * grid, so buildings fill the map by district capacity instead of marching off
 * the edge.
 *
 * Determinism is the contract: districts of the requested kind are visited in
 * sorted-id order, each scanned row-major (y outer, x inner), and the first
 * grid cell clear of every existing facility (nothing within `clearRadius`) is
 * returned. No rng is drawn — placement is a pure function of current state, so
 * a City/Metropolis town lays out identically at a given seed and Village (which
 * never calls this — it keeps its legacy paths for bit-identity) is untouched.
 */

import type { GameState } from './GameState';
import { townOf } from './Town';
import type { DistrictKind } from '../entities/District';
import type { Vec2 } from '../entities/Location';

export interface SlotSpec {
  /** Grid spacing along x / y within a district (world units). */
  stepX: number;
  stepY: number;
  /** Inset from the district bounds so buildings don't straddle a border. */
  margin: number;
  /** A slot is free only if no facility sits within this radius of it. */
  clearRadius: number;
}

/**
 * First free slot inside any district of `kind`, in deterministic order
 * (district id, then row-major grid), or null when every such district is
 * saturated. `reserved` points block additional slots — used to place several
 * buildings of one chain into the same district before any of them exists in
 * `state.facilities` yet.
 */
export function firstFreeDistrictSlot(
  state: GameState,
  kind: DistrictKind,
  spec: SlotSpec,
  reserved: Vec2[] = [],
  onlyDistrictId?: string,
): Vec2 | null {
  const r2 = spec.clearRadius * spec.clearRadius;
  const blocked = (x: number, y: number): boolean => {
    for (const fid in state.facilities) {
      const loc = state.facilities[fid]!.location;
      const dx = loc.x - x;
      const dy = loc.y - y;
      if (dx * dx + dy * dy < r2) return true;
    }
    for (const p of reserved) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  };

  const districts = townOf(state).districts;
  for (const id of Object.keys(districts).sort()) {
    const d = districts[id]!;
    if (d.kind !== kind) continue;
    // Callers placing INTO a specific district (the cast curator promoting a
    // crowd member home) scope the scan; unscoped callers take the first free
    // slot across every district of the kind.
    if (onlyDistrictId !== undefined && id !== onlyDistrictId) continue;
    const b = d.bounds;
    const xMax = b.x + b.w - spec.margin;
    const yMax = b.y + b.h - spec.margin;
    for (let y = b.y + spec.margin; y <= yMax; y += spec.stepY) {
      for (let x = b.x + spec.margin; x <= xMax; x += spec.stepX) {
        if (!blocked(x, y)) return { x, y };
      }
    }
  }
  return null;
}
