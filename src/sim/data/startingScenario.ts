/**
 * startingScenario.ts — Builds the initial, immediately-playable GameState.
 *
 * The town has 40 citizens in 20 homes, three AI competitors running full supply
 * chains (bread, tools, and clothes), an external importer, and a player
 * firm with starting cash but no facilities (buildable empty land). Initial
 * inventories and employment are seeded so the economy starts moving on tick 0.
 *
 * Everything is generated deterministically from the seed via the Rng.
 */

import type { GameState } from '../core/GameState';
import type { SimulationConfig } from '../core/SimulationConfig';
import { DEFAULT_CONFIG, SIZE_PRESETS } from '../core/SimulationConfig';
import { cohortId, emptyCohort } from '../entities/Cohort';
import { Rng, seedToState } from '../core/Random';
import { nextId, type IdCounters } from '../core/Id';
import type { Citizen } from '../entities/Citizen';
import type { Firm, FirmOwnerType } from '../entities/Firm';
import { emptyStrategy } from '../entities/Firm';
import type { Facility } from '../entities/Facility';
import { emptyFacilityDailyStats } from '../entities/Facility';
import type { Contract } from '../entities/Contract';
import type { Vec2 } from '../entities/Location';
import { emptyAccounting } from '../entities/Accounting';
import { emptyMarketStat } from '../entities/Market';
import { addStock, type Inventory } from '../entities/Inventory';
import { makeCitizenNeeds } from '../entities/factories';
import { getFacilityDef, facilityRecipesForPreset } from './facilityDefinitions';
import { getProduct, PRODUCT_IDS_BY_PRESET, CONSUMER_PRODUCT_IDS_BY_PRESET } from './products';
import { TRADE_CITY_IDS, cityBias, getTradeCity } from './tradeCities';
import { poolTargetInventory } from './tradePool';
import { FIRST_NAMES, LAST_NAMES } from './names';
import { dollars } from './constants';
import { defaultPersonalityFor, defaultCeoFor } from './personalities';
import { getScenario, DEFAULT_SCENARIO_ID } from './scenarios';
import { defaultDistrictPartition } from './districts';
import { SAVE_VERSION } from '../core/GameState';
import { townOf, HOME_TOWN_ID, installTownAliases, type TownRecords } from '../core/Town';
import { seedTown, PARTNER_TOWN_ID, PORT_ROSA_SPEC, willBeLivePartner } from './seedTown';

const NUM_HOMES = 20;
const CITIZENS_PER_HOME = 2;
const CITIZEN_START_CASH = dollars(400);
const DEFAULT_AI_WAGE = dollars(16);
const PLAYER_DEFAULT_WAGE = dollars(16);

interface Builder {
  state: GameState;
  rng: Rng;
  counters: IdCounters;
}

function newFacility(
  b: Builder,
  defId: string,
  ownerFirmId: string,
  location: Vec2,
  opts: { name?: string; activeRecipeId?: string | null; retailProductIds?: string[] } = {},
): Facility {
  const def = getFacilityDef(defId);
  const id = nextId(b.counters, 'fac');
  const fac: Facility = {
    id,
    defId,
    name: opts.name ?? def.name,
    type: def.type,
    ownerFirmId,
    location,
    employees: [],
    inputInventory: {},
    outputInventory: {},
    storageCapacity: def.storageCapacity,
    recipes: facilityRecipesForPreset(def, b.state.config.sizePreset),
    activeRecipeId: opts.activeRecipeId ?? null,
    retailProductIds: opts.retailProductIds ?? [],
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
  b.state.facilities[id] = fac;
  townOf(b.state).firms[ownerFirmId]!.facilities.push(id);
  return fac;
}

function newFirm(
  b: Builder,
  name: string,
  ownerType: FirmOwnerType,
  cash: number,
  strategy: Firm['strategy'],
  wage: number,
): Firm {
  const id = nextId(b.counters, 'firm');
  const firm: Firm = {
    id,
    name,
    ownerType,
    cash,
    facilities: [],
    employees: [],
    pricesByProduct: {},
    wagePolicy: { baseWage: wage },
    accounting: emptyAccounting(),
    strategy,
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
  b.state.firms[id] = firm;
  return firm;
}

// Needs generation is shared with runtime immigration — see entities/factories.

function newCitizen(b: Builder, homeId: string, homeLoc: Vec2): Citizen {
  const id = nextId(b.counters, 'cit');
  const first = b.rng.pick(FIRST_NAMES) ?? 'Sam';
  const last = b.rng.pick(LAST_NAMES) ?? 'Doe';
  const prefs: Record<string, number> = {};
  for (const pid of CONSUMER_PRODUCT_IDS_BY_PRESET[b.state.config.sizePreset]) prefs[pid] = b.rng.range(0.85, 1.15);
  const cit: Citizen = {
    id,
    name: `${first} ${last}`,
    homeFacilityId: homeId,
    employerFirmId: null,
    workplaceFacilityId: null,
    role: 'unemployed',
    wage: 0,
    cash: CITIZEN_START_CASH,
    needs: makeCitizenNeeds(b.rng, b.state.config.sizePreset),
    preferences: prefs,
    currentLocation: { ...homeLoc },
    targetLocation: { ...homeLoc },
    targetFacilityId: null,
    movementState: 'idle',
    activity: 'home',
    satisfaction: 70,
    employmentStatus: 'unemployed',
    tier: 'worker',
    tierStreak: 0,
    lastPurchasedFromByProduct: {},
    storeReliability: {},
    dailyStats: { day: 0, wagesEarned: 0, spent: 0, purchases: 0, unmetNeeds: 0 },
    lastShopTick: -1000,
    missedPaydays: 0,
    skill: b.rng.range(0.85, 1.05),
  };
  b.state.citizens[id] = cit;
  townOf(b.state).facilities[homeId]!.residentIds.push(id);
  return cit;
}

/** Employ a citizen at a facility/firm. */
function employ(
  b: Builder,
  citizenId: string,
  firmId: string,
  facilityId: string,
  role: string,
  wage: number,
): void {
  const cit = townOf(b.state).citizens[citizenId]!;
  cit.employerFirmId = firmId;
  cit.workplaceFacilityId = facilityId;
  cit.role = role;
  cit.wage = wage;
  cit.employmentStatus = 'employed';
  townOf(b.state).facilities[facilityId]!.employees.push(citizenId);
  townOf(b.state).firms[firmId]!.employees.push(citizenId);
}

function stock(inv: Inventory, productId: string, qty: number): void {
  addStock(inv, productId, qty, getProduct(productId).defaultQuality);
}

export function createInitialState(
  seed: number,
  config: SimulationConfig = DEFAULT_CONFIG,
  scenarioId: string = DEFAULT_SCENARIO_ID,
): GameState {
  const scenario = getScenario(scenarioId);
  const counters: IdCounters = {};
  // The six town-scoped families live under `towns[HOME_TOWN_ID]` (region.md step
  // 3 endgame). Build them once here; the flat `citizens`/`firms`/... fields below
  // reference the SAME objects so the literal type-checks, then
  // `installTownAliases` demotes those flat keys to non-enumerable accessors onto
  // the home town — every writer in this builder (and every reader) keeps working,
  // and only `towns` serializes.
  const homeRecords: TownRecords = {
    districts: {},
    cohorts: {},
    citizens: {},
    marketStats: {},
    firms: {},
    facilities: {},
    // Per-town map dims (region.md step 4, slice 1). Seeded from the passed
    // config here and RE-SET to the final config below, after the size-preset
    // block may raise them — so home.mapWidth === config.mapWidth exactly (the
    // getter swap in townOf is a value-identity for every existing game).
    mapWidth: config.mapWidth,
    mapHeight: config.mapHeight,
  };
  const state: GameState = {
    saveVersion: SAVE_VERSION,
    seed,
    scenarioId: scenario.id,
    rngState: seedToState(seed),
    tick: 0,
    speed: 1,
    paused: false, // the world starts alive; the player can pause anytime
    config: { ...config },
    towns: { [HOME_TOWN_ID]: homeRecords },
    citizens: homeRecords.citizens,
    firms: homeRecords.firms,
    facilities: homeRecords.facilities,
    vehicles: {},
    contracts: {},
    serviceContracts: {},
    marketStats: homeRecords.marketStats,
    worldCash: dollars(1_000_000),
    playerFirmId: '',
    worldFirmId: '',
    events: [],
    transactions: [],
    worldEvents: [],
    achievements: [],
    missions: [],
    tradeCities: {},
    freight: [],
    rushOrder: null,
    tradeAnnouncement: null,
    rushOrdersCompleted: 0,
    rushOrdersMissed: 0,
    facilityOffer: null,
    fireSalesBought: 0,
    deskTrades: 0,
    forwardsClosed: 0,
    poolFeedsWhileThin: 0,
    poolCoversRestored: 0,
    landlordRepossessions: 0,
    freightBestSpikePct: 0,
    emigrationPressure: 0,
    emigrationDepartures: 0,
    marketGapDays: {},
    marketUndersupplyDays: {},
    lastUndersupplyEntryDay: 0,
    housingTightDays: 0,
    lastLandlordEntryDay: 0,
    investorSignalDays: 0,
    lastInvestorEntryDay: 0,
    serviceUncoveredDays: {},
    lastServiceEntryDay: 0,
    sharePriceShift: {},
    // Districts are built AFTER the size-preset block below (which may raise
    // the map dimensions), so the partition tiles the preset's real map.
    districts: homeRecords.districts,
    cohorts: homeRecords.cohorts,
    lastLapsedFireSale: null,
    townHistory: [],
    idCounters: counters,
    selectedEntityId: null,
    perf: { lastTickMs: 0, avgTickMs: 0, ticksSimulated: 0 },
  };
  // Demote the six flat family keys to non-enumerable aliases onto towns.home
  // (they reference the same objects, so this is invisible to construction that
  // follows — every writer below routes through them) and keep only `towns` in a
  // save. Must run before any townOf(...) read or family writer in this builder.
  installTownAliases(state);
  const b: Builder = { state, rng: new Rng(state), counters };

  // World-scale cast ceiling: a non-Village preset lifts the immigration caps
  // to the preset's castTarget (homes hold 2 residents, so ceil(target/2) homes
  // plus a few spares for odd/partial fills) AND the physical map to the preset's
  // authored dimensions (A4). Home/facility PLACEMENT is now district-aware
  // (see DistrictSlots + the placement rewrite), so the bigger map is filled by
  // slot enumeration inside districts, not the old column march. Village keeps
  // its 80/40 caps and 130×92 map untouched (bit-identity).
  if (state.config.sizePreset !== 'village') {
    const preset = SIZE_PRESETS[state.config.sizePreset];
    state.config.maxCitizens = Math.max(state.config.maxCitizens, preset.castTarget);
    state.config.maxHomes = Math.max(state.config.maxHomes, Math.ceil(preset.castTarget / 2) + 4);
    state.config.mapWidth = Math.max(state.config.mapWidth, preset.mapWidth);
    state.config.mapHeight = Math.max(state.config.mapHeight, preset.mapHeight);
  }
  // Map dims are final: record the home town's OWN copy (= config, exactly), so
  // townOf(...).mapWidth reads the town field and stays value-identical.
  homeRecords.mapWidth = state.config.mapWidth;
  homeRecords.mapHeight = state.config.mapHeight;
  // Now that map dimensions are final, tile the authored district partition.
  state.districts = defaultDistrictPartition(state.config);

  for (const cid of TRADE_CITY_IDS) state.tradeCities[cid] = { pricesByProduct: {} };
  // Preset-gated (C1): Village seeds only the classic catalog, so its serialized
  // marketStats/trade-city books are byte-identical to pre-C1. City/Metropolis
  // additionally seed the breadth products they actually trade.
  for (const pid of PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
    state.marketStats[pid] = emptyMarketStat(pid);
    for (const cid of TRADE_CITY_IDS) {
      state.tradeCities[cid]!.pricesByProduct[pid] = Math.round(
        getProduct(pid).basePrice * cityBias(cid, pid),
      );
    }
  }
  // Arc E (opt-in): each trade city grows a demand pool seeded AT its target
  // buffer, so a fresh game opens in equilibrium (cover mult 1.0). Flag off ⇒
  // no pool key is written and the book stays byte-identical to pre-Arc-E.
  //
  // Slice 5 RETIRES the pool for the LIVE partner: when `port_rosa` graduates to
  // a real simulated town (region flag on, non-Village — the `seedTown` gate
  // below), its export quote reads its REAL shelf/demand, so it carries NO pool
  // row. A flag-off `port_rosa` is still a stub — its pool row STAYS (this is the
  // byte-identity gate: flag-off is unchanged). `ironvale` always keeps its pool.
  if (state.config.tradeDemandPoolsEnabled) {
    for (const cid of TRADE_CITY_IDS) {
      if (willBeLivePartner(state.config, cid)) continue; // retired: real book, no pool
      const book = state.tradeCities[cid]!;
      book.pool = { population: getTradeCity(cid).population, inventory: {} };
      for (const pid of PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
        const target = poolTargetInventory(cid, pid);
        if (target > 0) book.pool.inventory[pid] = target;
      }
    }
  }

  // --- World firm (owns homes; sink for external costs) ------------------
  const world = newFirm(b, 'Municipality', 'world', 0, emptyStrategy('none'), 0);
  state.worldFirmId = world.id;

  // --- Homes (residential neighbourhood, lower band) ---------------------
  const homeLocations: Vec2[] = [];
  const cols = 5;
  const numHomes = scenario.homes ?? NUM_HOMES;
  for (let i = 0; i < numHomes; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const loc: Vec2 = { x: 16 + col * 11, y: 60 + row * 8 };
    homeLocations.push(loc);
    newFacility(b, 'home', world.id, loc, { name: `Home ${i + 1}` });
  }

  // --- Citizens ----------------------------------------------------------
  const facilities = townOf(state).facilities;
  const homeFacilityIds = Object.keys(facilities).filter(
    (id) => facilities[id]!.type === 'home',
  );
  for (let h = 0; h < homeFacilityIds.length; h++) {
    const homeId = homeFacilityIds[h]!;
    for (let c = 0; c < CITIZENS_PER_HOME; c++) {
      newCitizen(b, homeId, facilities[homeId]!.location);
    }
  }
  const allCitizenIds = Object.keys(townOf(state).citizens);
  let nextWorker = 0;
  const takeWorker = (): string | null =>
    nextWorker < allCitizenIds.length ? allCitizenIds[nextWorker++]! : null;

  // --- Player firm (no facilities; buildable land) -----------------------
  const player = newFirm(
    b,
    'Player Holdings',
    'player',
    state.config.playerStartCash,
    emptyStrategy('none'),
    PLAYER_DEFAULT_WAGE,
  );
  state.playerFirmId = player.id;

  // --- External importer -------------------------------------------------
  const importer = newFirm(
    b,
    'Global Importers',
    'external',
    dollars(2_000_000),
    emptyStrategy('none'),
    0,
  );
  const importerFac = newFacility(b, 'importer', importer.id, { x: 120, y: 10 }, {
    name: 'Import Terminal',
  });
  // Importer holds a large buffer so contract-based sourcing always succeeds.
  stock(importerFac.outputInventory, 'grain', 100000);
  stock(importerFac.outputInventory, 'minerals', 100000);
  stock(importerFac.outputInventory, 'cotton', 100000);

  // --- AI chains (data-driven; see data/scenarios.ts) --------------------
  const addContract = (
    ownerFirmId: string,
    source: string,
    dest: string,
    productId: string,
    targetQuantity: number,
    reorderPoint: number,
    maxInventory: number,
  ): Contract => {
    const id = nextId(b.counters, 'ctr');
    const ctr: Contract = {
      id,
      ownerFirmId,
      sourceFacilityId: source,
      destinationFacilityId: dest,
      productId,
      targetQuantity,
      reorderPoint,
      maxInventory,
      transportCost: 0,
      active: true,
    };
    state.contracts[id] = ctr;
    return ctr;
  };

  let aiIndex = 0;
  for (const spec of scenario.aiChains) {
    const firm = newFirm(b, spec.firmName, 'ai', spec.cash, emptyStrategy(spec.product), DEFAULT_AI_WAGE);
    const personality = spec.personality ?? defaultPersonalityFor(aiIndex);
    firm.personalityId = personality;
    firm.ceoName = defaultCeoFor(personality, aiIndex);
    aiIndex += 1;
    firm.pricesByProduct[spec.product] = getProduct(spec.product).basePrice;
    firm.brandByProduct[spec.product] = spec.brand;
    firm.qualityByProduct[spec.product] = getProduct(spec.product).defaultQuality;
    firm.adBudgetByProduct[spec.product] = spec.adBudget;

    // Importer-fed chains build no producer: their factory buys inputs from
    // the Import Terminal, making them day-one wholesale customers for any
    // local supplier who undercuts it.
    const producer = spec.importerFed
      ? null
      : newFacility(b, spec.producerDef, firm.id, spec.loc.producer, {
          name: spec.producerName,
          activeRecipeId: spec.producerRecipe,
        });
    if (producer) stock(producer.outputInventory, spec.inputProduct, spec.stocks.producerOut);

    const factory = newFacility(b, 'factory', firm.id, spec.loc.factory, {
      name: spec.factoryName,
      activeRecipeId: spec.factoryRecipe,
    });
    stock(factory.inputInventory, spec.inputProduct, spec.stocks.factoryIn);
    stock(factory.outputInventory, spec.product, spec.stocks.factoryOut);

    const shop = newFacility(b, 'retail', firm.id, spec.loc.retail, {
      name: spec.retailName,
      retailProductIds: [spec.product],
    });
    stock(shop.inputInventory, spec.product, spec.stocks.shopIn);

    const staffUp = (facId: string, count: number, role: string): void => {
      for (let i = 0; i < count; i++) {
        const w = takeWorker();
        if (w) employ(b, w, firm.id, facId, role, DEFAULT_AI_WAGE);
      }
    };
    if (producer) staffUp(producer.id, spec.staff.producer, `${spec.producerDef} worker`);
    staffUp(factory.id, spec.staff.factory, 'factory worker');
    staffUp(shop.id, spec.staff.retail, 'clerk');

    addContract(
      firm.id, producer ? producer.id : importerFac.id, factory.id,
      spec.inputProduct, spec.pf.target, spec.pf.reorder, spec.pf.max,
    );
    addContract(firm.id, factory.id, shop.id, spec.product, spec.fs.target, spec.fs.reorder, spec.fs.max);
  }

  seedCrowd(state);
  seedComputeProvider(b);

  // Region (Arc E step 4, slice 1): with the flag on at a non-Village preset,
  // seed ONE inert partner town (`port_rosa`) into state.towns alongside home.
  // Built LAST, off the region's SHARED idCounters (town-namespaced prefixes)
  // and a LOCAL rng, so it shifts NONE of home's ids and draws NOTHING from the
  // shared rng — a flag-off game (default) is byte-identical, and a flag-on
  // game's home is byte-identical to flag-off (the partner is unticked in this
  // slice). Village never seeds a partner (definitionally one town).
  if (state.config.regionEnabled && state.config.sizePreset !== 'village') {
    seedTown(state, PARTNER_TOWN_ID, PORT_ROSA_SPEC);
  }

  return state;
}

/**
 * B2B services bootstrap (HD3): when the services channel is enabled on a
 * city-scale world, stand up one compute provider so the market exists on day
 * one and subscribers have something to buy. It is a dedicated AI firm ("Cirrus
 * Compute") owning a single datacenter — kept separate from the chain firms so
 * it never trips the founder invariant that every *chain* firm carries a full
 * producer→factory→store (this firm is a pure service play). Built last so it
 * shifts none of the earlier deterministic ids or rng draws.
 *
 * Gated on servicesEnabled AND non-Village, so every existing baseline (Village
 * bit-identity, and the plain city/metropolis founder/soak runs that leave the
 * flag off) sees nothing here.
 */
const COMPUTE_PROVIDER_CASH = dollars(40000);

function seedComputeProvider(b: Builder): void {
  const { state } = b;
  if (!state.config.servicesEnabled || state.config.sizePreset === 'village') return;
  // Seeded as a 'service' archetype firm (Arc D4): the dispatcher routes it to
  // ai/ServiceBehavior, so it grows its own capacity under load (level up / add a
  // site) instead of running the shopkeeper loop it has no shop for.
  const firm = newFirm(b, 'Cirrus Compute', 'ai', COMPUTE_PROVIDER_CASH, emptyStrategy('none', 'service'), DEFAULT_AI_WAGE);
  const personality = defaultPersonalityFor(1); // steady operator; no chain to run
  firm.personalityId = personality;
  firm.ceoName = defaultCeoFor(personality, 1);
  // Place it in the commercial-ish middle of the map, clear of the homes band.
  // Placement is town-scoped, so it reads the town's dims through the view.
  const town = townOf(state);
  const loc: Vec2 = {
    x: Math.round(town.mapWidth * 0.5),
    y: Math.round(town.mapHeight * 0.35),
  };
  newFacility(b, 'datacenter', firm.id, loc, { name: 'Cirrus Datacenter' });
}

/**
 * Arc A3 bootstrap: non-Village presets start with a crowd — worker-tier
 * cohorts in the residential districts holding real cash (direct assignment,
 * like citizen starting cash: it is part of the initial money supply, and
 * every later flow goes through recordTransaction). Village presets have
 * crowdStart 0 and are untouched.
 */
const CROWD_START_CASH_PER_CAPITA = dollars(50);

function seedCrowd(state: GameState): void {
  const preset = SIZE_PRESETS[state.config.sizePreset];
  if (preset.crowdStart <= 0) return;
  const residential = Object.values(townOf(state).districts)
    .filter((d) => d.kind === 'residential')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (residential.length === 0) return;
  // The whole crowd bootstraps as ONE worker-tier cohort in the primary
  // (first-sorted, store-rich inner) residential district — the As-built A3
  // bootstrap (`the_rows:worker` holds all crowdStart). The other residential
  // districts are the expansion room migration and home growth spread into;
  // seeding them here instead would strand crowd in districts the starting
  // shops (concentrated in the inner district) can't yet reach.
  const primary = residential[0]!;
  const id = cohortId(primary.id, 'worker');
  const cohort = emptyCohort(primary.id, 'worker', state.config.sizePreset);
  cohort.population = preset.crowdStart;
  cohort.cashPool = preset.crowdStart * CROWD_START_CASH_PER_CAPITA;
  state.cohorts[id] = cohort;
}
