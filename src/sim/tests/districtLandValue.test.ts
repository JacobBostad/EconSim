/**
 * districtLandValue.test.ts — the A4 land-value cache value-identity contract.
 *
 * The A4 cache (HomeIndex + landValueFromIndex, and the per-district
 * `district.landValue` digest DistrictSystem writes off it) is a pure caching
 * layer: it must reproduce the direct home-scan land value BYTE-FOR-BYTE, or it
 * is a silent rebalance of build costs and the Districts panel. Village
 * bit-identity is covered by the orchestrator's 300-day rngState baseline; this
 * test covers the CITY preset with district metadata live — the case the baseline
 * does not exercise — by running the crowd economy and, at each checkpoint,
 * comparing every cached path against a fresh direct recomputation on the same
 * live state.
 *
 * `directLandValue` below is the pre-A4 kernel verbatim (walk every facility,
 * sum the home-proximity pull). It is the ground truth the cache must equal.
 *
 * Not asserted: that the STORED `district.landValue` equals a post-run direct
 * recomputation. By system order DistrictSystem writes the caches at the top of
 * the daily roll-up, then immigration / cast curation / AI builders run later the
 * same tick and shift residents and homes — so the stored value intentionally
 * reflects the START-of-roll-up snapshot (the identical timing `desirability` has
 * always had; see LandValue.ts and DistrictSystem.ts). What must hold — and is
 * asserted — is that the cache MECHANISM reproduces the direct computation on any
 * given state.
 */
import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import type { GameState } from '../core/GameState';
import type { Vec2 } from '../entities/Location';
import { landValueAt, landValueFromIndex, buildHomeIndex } from '../core/LandValue';
import { districtLandValue, districtCentre } from '../systems/DistrictSystem';

// The pre-A4 land-value kernel, verbatim — the direct O(homes) recomputation.
const HOME_REACH = 45;
const SATURATION = 26;
function directLandValue(state: GameState, loc: Vec2): number {
  let pull = 0;
  for (const fid in state.facilities) {
    const fac = state.facilities[fid]!;
    if (fac.type !== 'home') continue;
    const dx = fac.location.x - loc.x;
    const dy = fac.location.y - loc.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= HOME_REACH) continue;
    const residents = Math.max(1, fac.residentIds.length);
    pull += residents * (1 - dist / HOME_REACH);
  }
  return Math.min(1, pull / SATURATION);
}

describe('A4 district land-value cache — value-identical to the direct scan', () => {
  const SEEDS = [11, 4, 7];
  const DAYS = 120;
  const CHECK_EVERY = 15;

  for (const seed of SEEDS) {
    it(`city seed ${seed}: cached land value == direct recomputation, every day sampled`, () => {
      const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' });
      const sim = new Simulation(state);
      sim.dispatch({ type: 'RESUME' });
      const tpd = ticksPerDay(state.config);
      // A coarse grid spanning the whole map plus a few off-map points (the map
      // edge the town grows into): every cell must round-trip byte-identically.
      const step = 12;
      const samples: Vec2[] = [];
      for (let y = 0; y <= state.config.mapHeight + 20; y += step) {
        for (let x = 0; x <= state.config.mapWidth + 20; x += step) samples.push({ x, y });
      }

      let checks = 0;
      for (let day = 1; day <= DAYS; day++) {
        sim.run(tpd);
        if (day % CHECK_EVERY !== 0) continue;

        const index = buildHomeIndex(state);
        // (1) The selector: indexed path and the public landValueAt must both
        // equal the direct scan, bit-for-bit, at every sampled point.
        for (const p of samples) {
          const direct = directLandValue(state, p);
          expect(landValueFromIndex(index, p)).toBe(direct);
          expect(landValueAt(state, p)).toBe(direct);
          checks += 1;
        }

        // (2) The per-district aggregate: districtLandValue (the exact call
        // DistrictSystem caches) must equal the direct scan at each centre, and
        // the stored cache must be a populated, in-range number.
        const ids = Object.keys(state.districts).sort();
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) {
          const d = state.districts[id]!;
          const centre = districtCentre(d);
          expect(districtLandValue(state, d, index)).toBe(directLandValue(state, centre));
          expect(districtLandValue(state, d)).toBe(directLandValue(state, centre)); // no shared index
          expect(typeof d.landValue).toBe('number');
          expect(d.landValue!).toBeGreaterThanOrEqual(0);
          expect(d.landValue!).toBeLessThanOrEqual(1);
        }
      }
      expect(checks).toBeGreaterThan(0);
    });
  }
});
