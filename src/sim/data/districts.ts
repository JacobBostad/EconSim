/**
 * districts.ts — default district partitions (world-scale roadmap, HD6).
 *
 * A2 partitions the CLASSIC map as metadata over the existing layout: the
 * producer/factory rows are the industrial quarter, the shop row is the
 * commercial strip, and everything south is residential. Scenarios can ship
 * authored layouts later (A4); until then every town gets this default, and
 * old saves are backfilled with it on load.
 */

import type { District } from '../entities/District';
import type { SimulationConfig } from '../core/SimulationConfig';

export function defaultDistrictPartition(
  config: Pick<SimulationConfig, 'mapWidth' | 'mapHeight' | 'maxCitizens'>,
): Record<string, District> {
  const w = config.mapWidth;
  const h = config.mapHeight;
  const districts: Record<string, District> = {
    ironrow: {
      id: 'ironrow',
      name: 'Iron Row',
      kind: 'industrial',
      bounds: { x: 0, y: 0, w, h: 40 },
      landValueBase: 0.9,
      desirability: 0.5,
      housingCapacity: 0,
      adjacent: ['midmarket'],
    },
    midmarket: {
      id: 'midmarket',
      name: 'Midmarket',
      kind: 'commercial',
      bounds: { x: 0, y: 40, w, h: 16 },
      landValueBase: 1.2,
      desirability: 0.5,
      housingCapacity: 0,
      adjacent: ['ironrow', 'the_rows'],
    },
    the_rows: {
      id: 'the_rows',
      name: 'The Rows',
      kind: 'residential',
      bounds: { x: 0, y: 56, w, h: Math.max(8, h - 56) },
      landValueBase: 1.0,
      desirability: 0.5,
      // Crowd housing beyond the cast's on-map homes (used from A3).
      housingCapacity: config.maxCitizens * 25,
      adjacent: ['midmarket'],
    },
  };
  return districts;
}
