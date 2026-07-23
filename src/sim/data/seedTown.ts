/**
 * seedTown.ts — the region's town factory (Arc E step 4, slice 1).
 *
 * `seedTown(region, townId, spec)` mints ONLY the six town-scoped record
 * families (a `TownRecords`) for a partner town and writes them into
 * `region.towns[townId]`. It is the `Town`-struct extraction region.md step 3
 * named ("everything town-scoped becomes a Town; everything world-scoped stays
 * on GameState"), finally cashed in for a SECOND town — carved from
 * `startingScenario`'s home-town construction, and subsuming the isolation
 * probe's hand-rolled `buildPartnerRecords`.
 *
 * Two determinism disciplines make the factory safe to run behind a flag with
 * the pinned world provably undisturbed (region.md § "The finding up front"):
 *
 *  1. It mints off the region's SHARED `idCounters` (never a fresh counter set —
 *     that was the measured `firm_3` collision the probe caught). Ids are
 *     TOWN-NAMESPACED (`port_rosa:firm_1`, ...), so they are region-unique
 *     (never collide with home's `firm_N`) AND do not advance home's own
 *     `firm`/`fac` counters — home's runtime id stream is byte-untouched, which
 *     is what lets a flag-on home be identical to flag-off.
 *  2. It draws NOTHING from the shared region rng. Any randomness comes from a
 *     LOCAL `Rng` seeded deterministically from `region.seed` + a hash of the
 *     town id, so a flag-off game's rng stream is untouched and two flag-on runs
 *     of a seed agree bit-for-bit.
 *
 * The factory writes no world-scoped field (rng, clock, `worldCash`, the ledger,
 * the trade graph). The partner's holder cash (cohort pools + firm cash) is
 * direct-assigned as initial supply — exactly the `seedCrowd` idiom — and is
 * NOT drawn from `worldCash`, so home's conserved money is untouched. In slice 1
 * the partner is INERT (no system ticks it); the region-wide money primitive,
 * dispatch, and the freight edge are later slices (see region.md § "SLICING").
 */

import type { GameState } from '../core/GameState';
import type { TownId, TownRecords } from '../core/Town';
import type { Firm } from '../entities/Firm';
import { emptyStrategy } from '../entities/Firm';
import type { Facility } from '../entities/Facility';
import { emptyFacilityDailyStats } from '../entities/Facility';
import { emptyAccounting } from '../entities/Accounting';
import { emptyMarketStat } from '../entities/Market';
import { emptyCohort, cohortId } from '../entities/Cohort';
import { addStock, type Inventory } from '../entities/Inventory';
import { Rng, seedToState, type RngHost } from '../core/Random';
import { nextId } from '../core/Id';
import type { ProductId } from '../core/Id';
import type { SizePreset } from '../core/SimulationConfig';
import { SIZE_PRESETS } from '../core/SimulationConfig';
import { defaultDistrictPartition } from './districts';
import { getProduct, PRODUCT_IDS_BY_PRESET } from './products';
import { getFacilityDef, facilityRecipesForPreset } from './facilityDefinitions';
import { getTradeCity, type TradeCityId } from './tradeCities';
import { dollars } from './constants';

/** The partner town's id for slice 1 (region.md's chosen partner). */
export const PARTNER_TOWN_ID: TownId = 'port_rosa';

/**
 * The minimal shape a partner town is built from — a LIGHT partner (region.md
 * § "A MINIMAL viable partner town"): crowd-only (no simulated cast), a handful
 * of producing firms, its own map/districts/market book. Deliberately small so
 * the second town costs a fraction of home per tick.
 */
export interface PartnerTownSpec {
  /**
   * The off-map trade city this partner IS — its production profile (which
   * goods it over-/under-produces) and its flavor come from the matching
   * `TradeCityDef` (Port Rosa food-rich, Ironvale industrial).
   */
  tradeCityId: TradeCityId;
  /**
   * World-scale preset sizing the partner's map, its district partition, and the
   * catalog its market book covers. A light partner uses 'city' — genuinely
   * smaller than home along the crowd/firm axes, not the map.
   */
  sizePreset: SizePreset;
  /**
   * Whole people seeded into the partner's primary residential cohort (the crowd
   * that consumes). Hundreds, not a full city — the partner is a place with an
   * economy, not a second City.
   */
  crowdPopulation: number;
  /**
   * How many producer firms to stand up (a handful). Each makes ONE product the
   * port over-produces (its specialty, top of the production profile), holding
   * real output stock and real cash — so the port has goods to ship and a
   * money balance the region-wide primitive will later have to see.
   */
  producerFirms: number;
}

/** The slice-1 partner: Port Rosa, a light food-rich crowd-only town. */
export const PORT_ROSA_SPEC: PartnerTownSpec = {
  tradeCityId: 'port_rosa',
  sizePreset: 'city',
  crowdPopulation: 300,
  producerFirms: 6,
};

const CROWD_START_CASH_PER_CAPITA = dollars(50); // matches seedCrowd
const PRODUCER_FIRM_CASH = dollars(30000);
const PRODUCER_OUTPUT_STOCK = 400;

/** FNV-1a hash of the town id, so the local rng seed varies per town. */
function hashTownId(townId: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < townId.length; i++) {
    h ^= townId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function stock(inv: Inventory, productId: string, qty: number): void {
  addStock(inv, productId, qty, getProduct(productId).defaultQuality);
}

/**
 * Mint the partner town's records and attach them at `region.towns[townId]`.
 * Returns the created `TownRecords`. Pure over (region.idCounters + a local rng);
 * touches no world-scoped field on `region` other than the shared counters.
 */
export function seedTown(
  region: GameState,
  townId: TownId,
  spec: PartnerTownSpec,
): TownRecords {
  const preset = SIZE_PRESETS[spec.sizePreset];
  // The partner OWNS its map (region.md step 4): its own preset-authored dims,
  // independent of home's config.
  const mapWidth = preset.mapWidth;
  const mapHeight = preset.mapHeight;

  const records: TownRecords = {
    districts: {},
    cohorts: {},
    citizens: {}, // crowd-only: the light partner has no simulated cast
    marketStats: {},
    firms: {},
    facilities: {},
    mapWidth,
    mapHeight,
  };
  // Attach before we populate so a future reader resolves it by id, and so the
  // town is present even if the spec produces an empty family.
  region.towns[townId] = records;

  // A LOCAL rng — NOT the shared region stream (region.rngState is untouched).
  const rngHost: RngHost = { rngState: seedToState((region.seed ^ hashTownId(townId)) >>> 0) };
  const rng = new Rng(rngHost);

  // Town-namespaced id minting off the region's SHARED counters: region-unique
  // (never collides with home's `firm_N`) and leaves home's `firm`/`fac`
  // counters untouched (a distinct key), so home's runtime ids never shift.
  const mintId = (kind: string): string => nextId(region.idCounters, `${townId}:${kind}`);

  // --- Districts: the partner's own partition, tiling its own map ----------
  records.districts = defaultDistrictPartition({
    mapWidth,
    mapHeight,
    maxCitizens: preset.castTarget,
    sizePreset: spec.sizePreset,
  });

  // --- Market book: one entry per traded product (the partner's own book) --
  for (const pid of PRODUCT_IDS_BY_PRESET[spec.sizePreset]) {
    records.marketStats[pid] = emptyMarketStat(pid);
  }

  // --- Crowd: one worker-tier cohort in the primary residential district,
  // holding real cash (direct-assigned initial supply, the seedCrowd idiom). --
  const residential = Object.values(records.districts)
    .filter((d) => d.kind === 'residential')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (residential.length > 0 && spec.crowdPopulation > 0) {
    const primary = residential[0]!;
    const cohort = emptyCohort(primary.id, 'worker', spec.sizePreset);
    cohort.population = spec.crowdPopulation;
    cohort.cashPool = spec.crowdPopulation * CROWD_START_CASH_PER_CAPITA;
    records.cohorts[cohortId(primary.id, 'worker')] = cohort;
  }

  // --- Producer firms: a handful, each making the port's over-produced
  // specialties (top of its production profile). Each holds real cash and a
  // factory stocked with output — goods to ship, a balance to later conserve. --
  const profile = getTradeCity(spec.tradeCityId).productionByProduct;
  const specialties = (Object.keys(profile) as ProductId[])
    .filter((pid) => records.marketStats[pid] !== undefined)
    .sort((a, b) => (profile[b] ?? 0) - (profile[a] ?? 0) || (a < b ? -1 : 1))
    .slice(0, spec.producerFirms);

  const factoryDef = getFacilityDef('factory');
  for (let i = 0; i < specialties.length; i++) {
    const productId = specialties[i]!;
    const firmId = mintId('firm');
    const firm: Firm = {
      id: firmId,
      name: `${getTradeCity(spec.tradeCityId).name} ${getProduct(productId).name} Works`,
      ownerType: 'ai',
      cash: PRODUCER_FIRM_CASH,
      facilities: [],
      employees: [],
      pricesByProduct: {},
      wagePolicy: { baseWage: dollars(16) },
      accounting: emptyAccounting(),
      strategy: emptyStrategy(productId),
      bankruptcyStatus: 'healthy',
      daysInsolvent: 0,
      marketShareByProduct: {},
      createdAtTick: 0,
      personalityId: null,
      ceoName: null,
      brandByProduct: {},
      adBudgetByProduct: {},
      qualityByProduct: {},
      debt: 0,
      interestRatePerDay: 0.0009,
      sharesHeld: {},
      shareCostBasis: {},
      acquiredNames: [],
      autoPriceByProduct: {},
      exportRevenue: 0,
      exportRevenueByCity: {},
      wholesaleSpend: 0,
      wholesaleEarned: 0,
      managers: [],
      forwards: [],
      forwardWins: 0,
    };
    records.firms[firmId] = firm;

    const facId = mintId('fac');
    // Spread the factories across the industrial-ish top band using the LOCAL
    // rng (no shared draw) so the layout is deterministic but not all-stacked.
    const loc = {
      x: Math.round(rng.range(0.15, 0.85) * mapWidth),
      y: Math.round(rng.range(0.1, 0.35) * mapHeight),
    };
    const fac: Facility = {
      id: facId,
      defId: 'factory',
      name: `${getProduct(productId).name} Factory`,
      type: factoryDef.type,
      ownerFirmId: firmId,
      location: loc,
      employees: [],
      inputInventory: {},
      outputInventory: {},
      storageCapacity: factoryDef.storageCapacity,
      recipes: facilityRecipesForPreset(factoryDef, spec.sizePreset),
      activeRecipeId: null, // inert in slice 1 — no production ticks yet
      retailProductIds: [],
      positioning: 'standard',
      operatingCostPerDay: factoryDef.maintenanceCostPerDay,
      buildCost: factoryDef.buildCost,
      productionProgress: 0,
      status: 'idle',
      bottleneckReason: null,
      dailyStats: emptyFacilityDailyStats(),
      yesterdayStats: emptyFacilityDailyStats(),
      pnlEma: { revenue: 0, cost: 0, net: 0 },
      presentWorkers: 0,
      presentSkill: 0,
      builtAtTick: 0,
      crowdByCohort: {},
      crowdTenants: 0,
      level: 1,
      workerCapacity: factoryDef.workerCapacity,
      exportOrders: {},
      residentIds: [],
      wholesaleEnabled: true,
    };
    stock(fac.outputInventory, productId, PRODUCER_OUTPUT_STOCK);
    records.facilities[facId] = fac;
    firm.facilities.push(facId);
  }

  return records;
}
