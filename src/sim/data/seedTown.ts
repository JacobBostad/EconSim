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
import type { District } from '../entities/District';
import { emptyAccounting } from '../entities/Accounting';
import { emptyMarketStat } from '../entities/Market';
import { emptyCohort, cohortId } from '../entities/Cohort';
import { addStock, type Inventory } from '../entities/Inventory';
import { Rng, seedToState, type RngHost } from '../core/Random';
import { nextId } from '../core/Id';
import type { ProductId, RecipeId } from '../core/Id';
import type { SizePreset } from '../core/SimulationConfig';
import { SIZE_PRESETS } from '../core/SimulationConfig';
import { defaultDistrictPartition } from './districts';
import { getProduct, PRODUCT_IDS_BY_PRESET } from './products';
import { getFacilityDef, facilityRecipesForPreset } from './facilityDefinitions';
import { RECIPES, getRecipe } from './recipes';
import { getTradeCity, type TradeCityId } from './tradeCities';
import { perCapitaDailyConsumption } from './tradePool';
import { dollars } from './constants';

/** The partner town's id for slice 1 (region.md's chosen partner). */
export const PARTNER_TOWN_ID: TownId = 'port_rosa';

/**
 * Whether a trade city WILL be seeded as a live partner town under this config —
 * the construction-time predicate that must agree with `isLivePartnerCity(state,
 * cityId)` once `seedTown` has run. Used in `startingScenario` to RETIRE the stub
 * pool for the live partner BEFORE `state.towns[port_rosa]` exists (the pool loop
 * runs before the town is minted). A flag-off game — or any city that is not the
 * chosen partner — is false, so its pool row is seeded exactly as before.
 */
export function willBeLivePartner(
  config: { regionEnabled: boolean; sizePreset: SizePreset },
  cityId: string,
): boolean {
  return config.regionEnabled && config.sizePreset !== 'village' && cityId === PARTNER_TOWN_ID;
}

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
const PRODUCER_FIRM_CASH = dollars(60000);
/**
 * A partner firm makes AND sells its specialty (region.md step 4, slice 3). The
 * partner runs the light subset with NO logistics (intra-/inter-town freight is
 * slice 4's FreightSystem), so its factory INPUTS are seeded deep — the factory
 * runs the whole soak to keep the crowd employed (its dead output is the crowd's
 * job, not the export larder). The retail SHELF, by contrast, is the export
 * larder the quote now reads (slice 5), so it is seeded at COVER-BUFFER scale
 * (below), not warehouse-scale — otherwise `stock / demand` cover pegs the quote
 * at the discount floor (slice 4's measured degeneracy: 400k units ÷ ~360/day =
 * ~1100 days of cover). PartnerMarketSystem then refills it toward that buffer.
 */
const PARTNER_INPUT_STOCK = 400_000; // raw-input buffer per producing factory (crowd employment)
const PARTNER_STORAGE_CAP = 2_000_000; // per-facility cap: never the binding one
/**
 * Slice-5 shelf seed, in DAYS of cover (region.md step 4, slice 5). The export
 * larder opens with a generous buffer above the `TRADE_POOL_TARGET_COVER_DAYS`
 * (6) target so it survives the demand RAMP — the real-demand read needs a few
 * days of sales history before `PartnerMarketSystem` activates — after which the
 * `(target − shelf)` feedback pulls it DOWN to the 6-day buffer and holds it
 * there. Derived: a seed of `SHELF_SEED_COVER_DAYS × modelDemand` where
 * modelDemand = crowd population × the product's needSpec spec-midpoint per-capita
 * consumption (the same number the pool's target used), so bread (crowd 300 ×
 * 1.30/day = 390/day) opens at ~12 days = ~4,680 units and converges to ~2,340.
 */
const SHELF_SEED_COVER_DAYS = 12;
/** Quality stamped on a firm's specialty — clears the luxury recipes' mastery
 * gate (pastries/jewelry need minQuality 75) so a food-rich port's pastry line
 * actually produces. */
const PARTNER_SPECIALTY_QUALITY = 80;

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
 * Namespace a district partition to a town: every district id (and every
 * `adjacent` reference) is prefixed `${townId}:`, so the partner's districts —
 * and the cohorts keyed `districtId:tier` off them — are REGION-UNIQUE. Without
 * this the partner's `the_rows:worker` cohort id would collide with home's, and
 * the region-wide account primitive (which resolves a holder by id across every
 * town) would credit the partner's crowd wages to HOME's crowd — the exact
 * id-collision hazard the second-town probe caught, here for cohorts/districts
 * (slice 1 already namespaced firm/facility ids the same way).
 */
function namespaceDistricts(
  partition: Record<string, District>,
  townId: string,
): Record<string, District> {
  const out: Record<string, District> = {};
  for (const oldId of Object.keys(partition)) {
    const d = partition[oldId]!;
    const nid = `${townId}:${oldId}`;
    out[nid] = { ...d, id: nid, adjacent: d.adjacent.map((a) => `${townId}:${a}`) };
  }
  return out;
}

/** The first district of a kind, in sorted-id order (deterministic). */
function firstDistrictOfKind(
  districts: Record<string, District>,
  kind: District['kind'],
): District | undefined {
  return Object.keys(districts)
    .sort()
    .map((id) => districts[id]!)
    .find((d) => d.kind === kind);
}

/** A deterministic point inside a district's bounds (local rng, no shared draw),
 * inset from the edges so a facility sits clearly within its quarter. */
function pointInDistrict(d: District, rng: Rng): { x: number; y: number } {
  const b = d.bounds;
  return {
    x: Math.round(b.x + rng.range(0.2, 0.8) * b.w),
    y: Math.round(b.y + rng.range(0.2, 0.8) * b.h),
  };
}

/** The factory recipe that OUTPUTS `productId` (deterministic: first by recipe
 * id in sorted order). Returns null for a product no factory recipe makes. */
function factoryRecipeFor(productId: ProductId): RecipeId | null {
  for (const rid of Object.keys(RECIPES).sort()) {
    const r = RECIPES[rid]!;
    if (r.facilityType !== 'factory') continue;
    if (r.outputs.some((o) => o.productId === productId)) return rid;
  }
  return null;
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

  // --- Districts: the partner's own partition, tiling its own map, with ids
  // NAMESPACED to the town so its cohorts are region-unique (see the helper). --
  records.districts = namespaceDistricts(
    defaultDistrictPartition({
      mapWidth,
      mapHeight,
      maxCitizens: preset.castTarget,
      sizePreset: spec.sizePreset,
    }),
    townId,
  );

  // --- Market book: one entry per traded product (the partner's own book) --
  for (const pid of PRODUCT_IDS_BY_PRESET[spec.sizePreset]) {
    records.marketStats[pid] = emptyMarketStat(pid);
  }

  // The districts the crowd lives, shops, and works in (region.md step 4, slice
  // 3). The cohort lives in the primary RESIDENTIAL quarter; its retail stores
  // stand THERE too so the crowd can reach them (CohortDemandSystem shops
  // district-locally — a store outside the home+adjacent quarters is
  // unreachable); the factories sit in the INDUSTRIAL belt (adjacent, so still
  // reachable, though production needs no reachability).
  const residentialD = firstDistrictOfKind(records.districts, 'residential');
  const industrialD = firstDistrictOfKind(records.districts, 'industrial') ?? residentialD;

  // --- Crowd: one worker-tier cohort in the primary residential district,
  // holding real cash (direct-assigned initial supply, the seedCrowd idiom). --
  if (residentialD && spec.crowdPopulation > 0) {
    const cohort = emptyCohort(residentialD.id, 'worker', spec.sizePreset);
    cohort.population = spec.crowdPopulation;
    cohort.cashPool = spec.crowdPopulation * CROWD_START_CASH_PER_CAPITA;
    records.cohorts[cohortId(residentialD.id, 'worker')] = cohort;
  }

  // --- Producer firms: a handful, each a vertically-integrated maker-seller of
  // one of the port's over-produced specialties (top of its production profile).
  // Each firm owns a FACTORY (turns seeded inputs + crowd labor into its
  // specialty) and a RETAIL STORE (sells the specialty to the crowd). Both are
  // staffed by the crowd via CohortLaborSystem, hold real cash and stock, and
  // move money only through recordTransaction — conserved region-wide. --
  const profile = getTradeCity(spec.tradeCityId).productionByProduct;
  const specialties = (Object.keys(profile) as ProductId[])
    .filter(
      (pid) => records.marketStats[pid] !== undefined && factoryRecipeFor(pid) !== null,
    )
    .sort((a, b) => (profile[b] ?? 0) - (profile[a] ?? 0) || (a < b ? -1 : 1))
    .slice(0, spec.producerFirms);

  const factoryDef = getFacilityDef('factory');
  const retailDef = getFacilityDef('retail');
  const tradeCityName = getTradeCity(spec.tradeCityId).name;

  const newFirm = (firmId: string, productId: ProductId): Firm => ({
    id: firmId,
    name: `${tradeCityName} ${getProduct(productId).name} Works`,
    ownerType: 'ai',
    cash: PRODUCER_FIRM_CASH,
    facilities: [],
    employees: [],
    // Price the specialty at base so the crowd's walkaway logistic centres
    // sanely; the store reads this through the town-scoped storePrice.
    pricesByProduct: { [productId]: getProduct(productId).basePrice },
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
    // Stamp the specialty's quality so the luxury recipes' mastery gate clears.
    qualityByProduct: { [productId]: PARTNER_SPECIALTY_QUALITY },
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
  });

  const baseFacility = (
    facId: string,
    firmId: string,
    defId: 'factory' | 'retail',
    name: string,
    loc: { x: number; y: number },
  ): Facility => {
    const def = defId === 'factory' ? factoryDef : retailDef;
    return {
      id: facId,
      defId,
      name,
      type: def.type,
      ownerFirmId: firmId,
      location: loc,
      employees: [],
      inputInventory: {},
      outputInventory: {},
      storageCapacity: PARTNER_STORAGE_CAP,
      recipes: facilityRecipesForPreset(def, spec.sizePreset),
      activeRecipeId: null,
      retailProductIds: [],
      positioning: 'standard',
      operatingCostPerDay: def.maintenanceCostPerDay,
      buildCost: def.buildCost,
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
      workerCapacity: def.workerCapacity,
      exportOrders: {},
      residentIds: [],
      wholesaleEnabled: true,
    };
  };

  for (let i = 0; i < specialties.length; i++) {
    const productId = specialties[i]!;
    const recipeId = factoryRecipeFor(productId)!;
    const recipe = getRecipe(recipeId);
    const firmId = mintId('firm');
    const firm = newFirm(firmId, productId);
    records.firms[firmId] = firm;

    // Factory in the industrial belt: the specialty recipe assigned and its raw
    // inputs seeded deep, so it produces across the whole window (no logistics to
    // restock it — freight is slice 4).
    const facId = mintId('fac');
    const factory = baseFacility(
      facId,
      firmId,
      'factory',
      `${getProduct(productId).name} Factory`,
      industrialD ? pointInDistrict(industrialD, rng) : { x: 0, y: 0 },
    );
    factory.activeRecipeId = recipeId;
    for (const io of recipe.inputs) stock(factory.inputInventory, io.productId, PARTNER_INPUT_STOCK);
    records.facilities[facId] = factory;
    firm.facilities.push(facId);

    // Retail store in the residential quarter (reachable by the crowd): the
    // specialty on the shelf — the EXPORT LARDER the slice-5 quote reads. Seeded
    // at cover-buffer scale (a few days above the target), NOT warehouse-scale, so
    // `stock / demand` cover lands in the mult band. PartnerMarketSystem refills it.
    const storeId = mintId('fac');
    const store = baseFacility(
      storeId,
      firmId,
      'retail',
      `${getProduct(productId).name} Market`,
      residentialD ? pointInDistrict(residentialD, rng) : { x: 0, y: 0 },
    );
    store.retailProductIds = [productId];
    const shelfSeed = Math.round(
      SHELF_SEED_COVER_DAYS * spec.crowdPopulation * perCapitaDailyConsumption(productId),
    );
    stock(store.inputInventory, productId, Math.max(shelfSeed, 1));
    records.facilities[storeId] = store;
    firm.facilities.push(storeId);
  }

  return records;
}
