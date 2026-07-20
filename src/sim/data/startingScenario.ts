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
import { TRADE_CITY_IDS, cityBias } from './tradeCities';
import { FIRST_NAMES, LAST_NAMES } from './names';
import { dollars } from './constants';
import { defaultPersonalityFor, defaultCeoFor } from './personalities';
import { getScenario, DEFAULT_SCENARIO_ID } from './scenarios';
import { defaultDistrictPartition } from './districts';
import { SAVE_VERSION } from '../core/GameState';

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
  b.state.firms[ownerFirmId]!.facilities.push(id);
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
  b.state.facilities[homeId]!.residentIds.push(id);
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
  const cit = b.state.citizens[citizenId]!;
  cit.employerFirmId = firmId;
  cit.workplaceFacilityId = facilityId;
  cit.role = role;
  cit.wage = wage;
  cit.employmentStatus = 'employed';
  b.state.facilities[facilityId]!.employees.push(citizenId);
  b.state.firms[firmId]!.employees.push(citizenId);
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
  const state: GameState = {
    saveVersion: SAVE_VERSION,
    seed,
    scenarioId: scenario.id,
    rngState: seedToState(seed),
    tick: 0,
    speed: 1,
    paused: false, // the world starts alive; the player can pause anytime
    config: { ...config },
    citizens: {},
    firms: {},
    facilities: {},
    vehicles: {},
    contracts: {},
    marketStats: {},
    worldCash: dollars(1_000_000),
    playerFirmId: '',
    worldFirmId: '',
    events: [],
    transactions: [],
    worldEvents: [],
    achievements: [],
    missions: [],
    tradeCities: {},
    rushOrder: null,
    tradeAnnouncement: null,
    rushOrdersCompleted: 0,
    rushOrdersMissed: 0,
    facilityOffer: null,
    fireSalesBought: 0,
    deskTrades: 0,
    emigrationPressure: 0,
    emigrationDepartures: 0,
    marketGapDays: {},
    marketUndersupplyDays: {},
    lastUndersupplyEntryDay: 0,
    sharePriceShift: {},
    // Districts are built AFTER the size-preset block below (which may raise
    // the map dimensions), so the partition tiles the preset's real map.
    districts: {},
    cohorts: {},
    lastLapsedFireSale: null,
    townHistory: [],
    idCounters: counters,
    selectedEntityId: null,
    perf: { lastTickMs: 0, avgTickMs: 0, ticksSimulated: 0 },
  };
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
  const homeFacilityIds = Object.keys(state.facilities).filter(
    (id) => state.facilities[id]!.type === 'home',
  );
  for (let h = 0; h < homeFacilityIds.length; h++) {
    const homeId = homeFacilityIds[h]!;
    for (let c = 0; c < CITIZENS_PER_HOME; c++) {
      newCitizen(b, homeId, state.facilities[homeId]!.location);
    }
  }
  const allCitizenIds = Object.keys(state.citizens);
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

  return state;
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
  const residential = Object.values(state.districts)
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
