/**
 * districts.ts — default district partitions (world-scale roadmap, HD6 / A4).
 *
 * A2 partitioned the CLASSIC (Village) map as metadata over the existing layout:
 * the producer/factory rows are the industrial quarter, the shop row is the
 * commercial strip, and everything south is residential. A4 makes districts
 * PHYSICAL: the City and Metropolis presets get bigger authored maps (see
 * SIZE_PRESETS) and richer partitions with more districts, and placement/
 * shopping key off them. The Village partition is UNCHANGED — bit-identity — so
 * a Village town, old saves, and golden fixtures v1-v7 replay exactly as before.
 *
 * Every partition must TILE its map exactly: the union of bounds covers
 * [0, mapWidth) × [0, mapHeight) with no gap and no overlap (the partition
 * invariant districts.test.ts asserts for every preset). All boundaries are
 * derived from mapWidth/mapHeight so a partition tiles whatever dimensions the
 * config carries (custom maps included), not just the preset defaults.
 */

import type { District } from '../entities/District';
import type { SimulationConfig } from '../core/SimulationConfig';

type PartitionConfig = Pick<SimulationConfig, 'mapWidth' | 'mapHeight' | 'maxCitizens' | 'sizePreset'>;

export function defaultDistrictPartition(config: PartitionConfig): Record<string, District> {
  switch (config.sizePreset) {
    case 'city':
      return cityPartition(config);
    case 'metropolis':
      return metropolisPartition(config);
    default:
      return villagePartition(config);
  }
}

/**
 * The classic Village partition — three stacked bands over the 130×92 map, kept
 * EXACTLY as A2 shipped it (any change here breaks the 300-day bit-identity
 * baseline). Industrial top, a thin commercial strip, residential south.
 */
function villagePartition(config: PartitionConfig): Record<string, District> {
  const w = config.mapWidth;
  const h = config.mapHeight;
  return {
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
}

/**
 * City partition — five districts over the 260×184 map, laid so the residential
 * band sits DIRECTLY ABOVE the central commercial core: every home is within a
 * short vertical hop of a store, which is what makes district-local shopping
 * (home district + adjacent, maxShoppingDistance 95) actually reach a staple on
 * a map far too wide to cross in a shop-window trip. The inner-city ids
 * (ironrow / midmarket / the_rows) persist from the Village partition — a
 * Village grown into a City keeps its old quarters, and cohort keys stay stable.
 *
 * Bands (top→bottom): industrial belt, two residential halves, commercial core,
 * civic. The two residential halves split the width; `the_rows` is the inner
 * (west) half that carries the starting homes and shops and sorts first — it is
 * the crowd's bootstrap district (seedCrowd) — while `the_yards` is the eastern
 * expansion half the town grows into (named to sort AFTER the_rows so the sorted
 * residential order puts the store-rich inner district first). Boundaries derived
 * from h/w so the tiling is exact for any dimensions.
 */
function cityPartition(config: PartitionConfig): Record<string, District> {
  const w = config.mapWidth;
  const h = config.mapHeight;
  const xMid = Math.round(w / 2);
  const yIndustrial = Math.round(h * 0.22); // industrial belt height
  const yResidential = Math.round(h * 0.50); // residential band ends here
  const yCommercial = Math.round(h * 0.70); // commercial core ends here
  const capPerResidential = config.maxCitizens * 25;
  return {
    ironrow: {
      id: 'ironrow',
      name: 'Iron Row',
      kind: 'industrial',
      bounds: { x: 0, y: 0, w, h: yIndustrial },
      landValueBase: 0.9,
      desirability: 0.5,
      housingCapacity: 0,
      adjacent: ['the_rows', 'the_yards'],
    },
    the_rows: {
      id: 'the_rows',
      name: 'The Rows',
      kind: 'residential',
      bounds: { x: 0, y: yIndustrial, w: xMid, h: yResidential - yIndustrial },
      landValueBase: 1.0,
      desirability: 0.5,
      housingCapacity: capPerResidential,
      adjacent: ['ironrow', 'the_yards', 'midmarket'],
    },
    the_yards: {
      id: 'the_yards',
      name: 'The Yards',
      kind: 'residential',
      bounds: { x: xMid, y: yIndustrial, w: w - xMid, h: yResidential - yIndustrial },
      landValueBase: 1.0,
      desirability: 0.5,
      housingCapacity: capPerResidential,
      adjacent: ['ironrow', 'the_rows', 'midmarket'],
    },
    midmarket: {
      id: 'midmarket',
      name: 'Midmarket',
      kind: 'commercial',
      bounds: { x: 0, y: yResidential, w, h: yCommercial - yResidential },
      landValueBase: 1.2,
      desirability: 0.5,
      housingCapacity: 0,
      adjacent: ['the_rows', 'the_yards', 'civic'],
    },
    civic: {
      id: 'civic',
      name: 'Civic Square',
      kind: 'civic',
      bounds: { x: 0, y: yCommercial, w, h: h - yCommercial },
      landValueBase: 1.1,
      desirability: 0.5,
      housingCapacity: 0,
      adjacent: ['midmarket'],
    },
  };
}

/**
 * Metropolis partition — six districts over the 390×276 map: the same
 * industrial-belt / residential / commercial / civic skeleton as the City, but
 * with THREE residential columns (the_rows / the_yards / westgate) so the larger
 * crowd's expansion spreads across three district × tier cohort homes, all
 * sitting directly above the central commercial core within shopping reach.
 * `the_rows` is the inner (west) column and sorts first — the bootstrap district.
 */
function metropolisPartition(config: PartitionConfig): Record<string, District> {
  const w = config.mapWidth;
  const h = config.mapHeight;
  const x1 = Math.round(w / 3);
  const x2 = Math.round((2 * w) / 3);
  const yIndustrial = Math.round(h * 0.20);
  const yResidential = Math.round(h * 0.52);
  const yCommercial = Math.round(h * 0.72);
  const capPerResidential = config.maxCitizens * 25;
  return {
    ironrow: {
      id: 'ironrow',
      name: 'Iron Row',
      kind: 'industrial',
      bounds: { x: 0, y: 0, w, h: yIndustrial },
      landValueBase: 0.9,
      desirability: 0.5,
      housingCapacity: 0,
      adjacent: ['the_rows', 'the_yards', 'westgate'],
    },
    the_rows: {
      id: 'the_rows',
      name: 'The Rows',
      kind: 'residential',
      bounds: { x: 0, y: yIndustrial, w: x1, h: yResidential - yIndustrial },
      landValueBase: 1.0,
      desirability: 0.5,
      housingCapacity: capPerResidential,
      adjacent: ['ironrow', 'the_yards', 'midmarket'],
    },
    the_yards: {
      id: 'the_yards',
      name: 'The Yards',
      kind: 'residential',
      bounds: { x: x1, y: yIndustrial, w: x2 - x1, h: yResidential - yIndustrial },
      landValueBase: 1.0,
      desirability: 0.5,
      housingCapacity: capPerResidential,
      adjacent: ['ironrow', 'the_rows', 'westgate', 'midmarket'],
    },
    westgate: {
      id: 'westgate',
      name: 'Westgate',
      kind: 'residential',
      bounds: { x: x2, y: yIndustrial, w: w - x2, h: yResidential - yIndustrial },
      landValueBase: 1.0,
      desirability: 0.5,
      housingCapacity: capPerResidential,
      adjacent: ['ironrow', 'the_yards', 'midmarket'],
    },
    midmarket: {
      id: 'midmarket',
      name: 'Midmarket',
      kind: 'commercial',
      bounds: { x: 0, y: yResidential, w, h: yCommercial - yResidential },
      landValueBase: 1.2,
      desirability: 0.5,
      housingCapacity: 0,
      adjacent: ['the_rows', 'the_yards', 'westgate', 'civic'],
    },
    civic: {
      id: 'civic',
      name: 'Civic Square',
      kind: 'civic',
      bounds: { x: 0, y: yCommercial, w, h: h - yCommercial },
      landValueBase: 1.1,
      desirability: 0.5,
      housingCapacity: 0,
      adjacent: ['midmarket'],
    },
  };
}
