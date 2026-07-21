/**
 * SimulationConfig.ts — Tunable simulation constants.
 *
 * Config is part of GameState so it survives save/load and keeps the engine
 * data-driven. Defaults are chosen so the starting scenario is immediately
 * playable and the economy moves quickly.
 */

export type Difficulty = 'relaxed' | 'standard' | 'brutal';

/** World-scale size preset. Ranked village < city < metropolis; a product's
 * `availableIn` floor (Product.availableIn) is compared against this rank so
 * the broader Arc C1 catalog reaches Metropolis without ever touching the
 * Village or City game (see data/products.ts productIdsForPreset). */
export type SizePreset = 'village' | 'city' | 'metropolis';

export interface SimulationConfig {
  /** Chosen difficulty preset (informational; the knobs below carry the effect). */
  difficulty: Difficulty;
  /** Challenge run: the game ends with a final score at day 200. */
  challengeMode: boolean;
  /** Player starting cash (cents). */
  playerStartCash: number;
  /** Chance per day that a new world event starts (see WorldEventSystem). */
  worldEventDailyChance: number;
  /** Chance per eligible day that an AI firm opens a new outlet. */
  aiExpandChance: number;

  /** Ticks per in-game hour. Day length = ticksPerHour * 24. */
  ticksPerHour: number;
  /** Citizen movement speed in map units per tick. */
  citizenSpeed: number;
  /** Vehicle movement speed in map units per tick. */
  vehicleSpeed: number;

  /** Work day start/end hours (24h). */
  workStartHour: number;
  workEndHour: number;
  /** Shopping window (24h). Urgent needs can still shop outside it. */
  shopStartHour: number;
  shopEndHour: number;
  /** Hours during which retail stores are open and can serve customers. */
  storeOpenHour: number;
  storeCloseHour: number;

  /** Payroll interval in days (1 = daily, 7 = weekly). */
  payrollIntervalDays: number;
  /**
   * Subsistence income (cents/day) paid to unemployed citizens from the world
   * account. Models savings/informal work/welfare so the consumer economy keeps
   * functioning at high unemployment. Set to 0 for a harsher simulation.
   */
  subsistenceIncomePerDay: number;

  /** Need urgency threshold above which a citizen wants to shop. */
  needUrgencyThreshold: number;
  /** Urgency at/above which a need is "urgent" and may shop off-hours. */
  needUrgentThreshold: number;
  /** Max distance (map units) a citizen will travel to shop. */
  maxShoppingDistance: number;
  /** Seeded random weight applied to store scores (exploration). */
  storeScoreJitter: number;
  /** Minimum ticks between a citizen's shopping trips (prevents thrashing). */
  shoppingCooldownTicks: number;

  /** Days a firm may stay cash-negative before becoming distressed. */
  distressGraceDays: number;
  /** Days insolvent before facilities begin closing. */
  insolvencyCloseDays: number;

  /** AI price step bounds. */
  aiPriceStepMin: number; // e.g. 0.02
  aiPriceStepMax: number; // e.g. 0.05
  /** AI keeps price within [min, max] * basePrice. */
  aiPriceFloorMult: number;
  aiPriceCeilMult: number;

  /** Bounded log sizes. */
  maxEvents: number;
  maxTransactions: number;
  maxDailyHistory: number;

  /** Map dimensions in units. */
  mapWidth: number;
  mapHeight: number;
  /** Hard caps on town growth (town-size presets scale these). */
  maxHomes: number;
  maxCitizens: number;
  /**
   * World-scale size preset (see docs/design/cohorts-and-districts.md).
   * 'village' = the classic game: every citizen is a simulated agent and
   * cohorts stay empty. 'city'/'metropolis' (Arc A3+) add crowd population
   * as district × tier cohorts beyond the simulated cast.
   */
  sizePreset: SizePreset;
  /**
   * B2B services channel (datacenter compute, HD3). Off by default — including
   * for the plain city/metropolis presets the founder/soak baselines are tuned
   * against — so those pinned trajectories are untouched. The UI turns it on for
   * a City world; probes and tests opt in explicitly. Village never runs it
   * regardless (double-gated on sizePreset).
   */
  servicesEnabled: boolean;
  /**
   * Real-estate firms channel (Arc D2, HD4 — landlord archetype). Off by
   * default, including for the plain city/metropolis presets whose founder/soak
   * baselines (tierAcceptance bands, metropolis 24-30 founder pins / 0 insolvent)
   * are pinned to exact rng trajectories. A landlord firm founding into the town
   * changes firm balances, which reshuffle the cash-threshold short-circuits
   * ahead of the operators' `rng.chance` draws — so the flag keeps the landlord
   * archetype INERT in every pinned run (Village always; plain city/metropolis
   * with the flag off) and is opted into by a City game, the real-estate probe,
   * and its tests. This is the servicesEnabled house rule applied one level up.
   * Village never runs it regardless (double-gated on sizePreset in the founder
   * row). See docs/design/real-estate.md.
   */
  realEstateEnabled: boolean;
  /**
   * Investor holdco archetype (Arc D3). Off by default — including for the plain
   * city/metropolis presets the founder/soak/tier baselines are tuned against —
   * so those pinned trajectories are untouched (an active holdco drains the firm
   * sector by buying stakes against the public float, which measurably shifts the
   * A3 crowd-tier bands; with the flag off, zero investors found and the city
   * economy is bit-identical to pre-D3). The UI turns it on for a City world;
   * probes and tests opt in explicitly. Double-gated on sizePreset === 'city' in
   * the founder row, so Village and Metropolis never found a holdco regardless. */
  investorsEnabled: boolean;
  /**
   * Trade-city demand pools (Arc E slice; see docs/design/region.md). Off by
   * default at EVERY preset. When on, each trade city grows a tiny cohort-style
   * consumption pool (population, per-product inventory that exports refill and
   * daily consumption drains) and its export quote picks up a cover-driven
   * premium/discount ON TOP of the seeded random walk. The pool draws no shared
   * rng and holds no money, but it DOES write per-city inventory into the
   * serialized state and bends the quote — so it is flag-gated rather than
   * layered live, because the bit-identity contract hashes the whole state
   * (village seeds 1/11/777, city seed 11) and the tierAcceptance bands read
   * export prices. With the flag off no pool materializes and the trade book is
   * byte-identical to pre-Arc-E; a City/Metropolis game opts in, the trade-pool
   * probe and tests opt in explicitly. */
  tradeDemandPoolsEnabled: boolean;
}

/**
 * Per-preset scale knobs (consumed progressively through Arc A). `mapWidth`/
 * `mapHeight` are the A4 physical-district map presets: Village keeps today's
 * 130×92 exactly (bit-identity), City and Metropolis get the bigger authored
 * maps createInitialState wires into config (the castTarget pattern). The
 * authored district layouts per preset live in data/districts.ts and are sized
 * to tile these dimensions exactly.
 */
/**
 * Per-preset founder pacing (A5 — read via the AIFounderSystem helpers):
 *
 *  - `founderUndersupplyCooldown`: town-wide minimum days between under-supply
 *    entries. Village/City keep the baseline 20 (FOUNDER_UNDERSUPPLY_COOLDOWN;
 *    the founders rate-limit test pins City at it). Metropolis slashes it to 7:
 *    the founder-scale probe measured a 30-cap town stuck at 5-6 firms with the
 *    under-supply streak running to 291 days and fill-rate pinned at 0.2-0.5 —
 *    genuine sustained starvation, not the transient shock the cooldown guards
 *    against, so one entry per 20 days (~12 over the 55→300 window) can never
 *    fill a map that hungry. At 7 days the same window admits enough entries to
 *    reach ~24-30 firms by day 300, and the demand so vastly exceeds supply that
 *    the field stays solvent there (probe: 0 insolvent at day 300; a shorter 6
 *    over-founds and slides into a post-300 insolvency cascade).
 *
 *  - `founderUndersupplyFillRate`: the smoothed town fill-rate below which a
 *    staple is "under-supplied". Village/City keep the baseline 0.65
 *    (FOUNDER_UNDERSUPPLY_FILL_RATE — City's crowd tier economy is calibrated for
 *    the ~8-9 firm equilibrium this yields; the A3 pool-drift and worker/cohort
 *    guards trip if it is pushed higher). Metropolis lifts it to 0.80 so the
 *    signal keeps firing until the huge crowd is genuinely served, rather than
 *    switching off at the City value while a third of demand still goes unmet.
 *
 *  - `founderCash`: founding capital (from the world account, conserved).
 *    Village/City keep the FOUNDER_CASH baseline ($22k). Metropolis raises it to
 *    $28k: the founder-scale probe measured ramp casualties (up to 9 firms
 *    insolvent at day 300 when the cooldown packed entrants in fast) — the
 *    demand supports 30 firms (fill-rate stays below the 0.80 trigger even at
 *    the cap), but on the bigger, pricier map a fresh chain spends more to build
 *    and needs a longer runway to capture its share while many rivals ramp at
 *    once. The extra $6k is that runway; it converts the last handful of firms
 *    from ramp-casualties into solvent competitors.
 */
export const SIZE_PRESETS = {
  village: { castTarget: 80, cohortCap: 0, crowdStart: 0, founderMaxAiFirms: 6, founderUndersupplyCooldown: 20, founderUndersupplyFillRate: 0.65, founderCash: 22000_00, mapWidth: 130, mapHeight: 92 },
  city: { castTarget: 150, cohortCap: 2000, crowdStart: 300, founderMaxAiFirms: 18, founderUndersupplyCooldown: 20, founderUndersupplyFillRate: 0.65, founderCash: 22000_00, mapWidth: 260, mapHeight: 184 },
  metropolis: { castTarget: 150, cohortCap: 10000, crowdStart: 1500, founderMaxAiFirms: 30, founderUndersupplyCooldown: 7, founderUndersupplyFillRate: 0.80, founderCash: 28000_00, mapWidth: 390, mapHeight: 276 },
} as const;

export const DEFAULT_CONFIG: SimulationConfig = {
  difficulty: 'standard',
  challengeMode: false,
  playerStartCash: 15000 * 100,
  worldEventDailyChance: 0.2,
  aiExpandChance: 0.5,

  ticksPerHour: 2, // 48 ticks/day
  citizenSpeed: 6,
  vehicleSpeed: 4,

  workStartHour: 8,
  workEndHour: 16,
  shopStartHour: 16,
  shopEndHour: 21,
  storeOpenHour: 8,
  storeCloseHour: 22,

  payrollIntervalDays: 1,
  subsistenceIncomePerDay: 1400, // $14.00/day — keeps consumption flowing

  needUrgencyThreshold: 0.5,
  needUrgentThreshold: 1.1,
  maxShoppingDistance: 95,
  storeScoreJitter: 0.06,
  shoppingCooldownTicks: 6, // ~3 in-game hours at default tick rate

  distressGraceDays: 3,
  insolvencyCloseDays: 10,

  aiPriceStepMin: 0.02,
  aiPriceStepMax: 0.05,
  aiPriceFloorMult: 0.6,
  aiPriceCeilMult: 1.5,

  maxEvents: 400,
  maxTransactions: 4000,
  maxDailyHistory: 120,

  mapWidth: 130,
  mapHeight: 92,
  maxHomes: 40,
  maxCitizens: 80,
  sizePreset: 'village',
  servicesEnabled: false,
  realEstateEnabled: false,
  investorsEnabled: false,
  tradeDemandPoolsEnabled: false,
};

/** Difficulty presets: starting capital, news volatility, AI aggressiveness. */
export function configForDifficulty(difficulty: Difficulty): SimulationConfig {
  switch (difficulty) {
    case 'relaxed':
      return {
        ...DEFAULT_CONFIG,
        difficulty,
        playerStartCash: 25000 * 100,
        worldEventDailyChance: 0.12,
        aiExpandChance: 0.35,
      };
    case 'brutal':
      return {
        ...DEFAULT_CONFIG,
        difficulty,
        playerStartCash: 9000 * 100,
        worldEventDailyChance: 0.3,
        aiExpandChance: 0.7,
      };
    default:
      return { ...DEFAULT_CONFIG, difficulty: 'standard' };
  }
}

/**
 * Player-only metropolis starting-cash uplift (cents), added on top of the
 * difficulty cash for a Metropolis New Game. The metropolis map is ~4.5× the
 * village's area and its metropolis-only deep C3 chains cost up to $11,200 to
 * stand up (vs the village catalog's $7,400 cheapest) — a standard $15k player
 * could afford exactly one chain with no runway while every one of the 25-30 AI
 * rivals founds with the $28k metropolis founderCash. The uplift opens the
 * player at that same $28k parity at standard difficulty; relaxed/brutal keep
 * their gradient above/below it (relaxed $38k, brutal $22k).
 *
 * PLAYER-ONLY, verified inert to the pinned AI trajectory: the
 * metropolis-playability probe holds the day-300 rngState, the 24-30 founder
 * count, and 0-insolvent bit-identical across a $15k→$999k player-cash sweep,
 * because no founder/strategy/finance path reads the player firm's cash — those
 * scans key off profit base, marketCap, and employee/facility counts, all zero
 * for the do-nothing player firm. The bonus is therefore applied only on the
 * store's New Game path (worldScaleConfig); probes/tests that build config
 * directly stay byte-identical. (docs/design/probes/metropolis-playability.ts)
 */
export const METROPOLIS_PLAYER_START_CASH_BONUS = 13000 * 100;

/**
 * Compose the full SimulationConfig for a New Game from the modal's choices:
 * difficulty knobs + challenge flag + town-size caps (bustling) + world-scale
 * overrides. Pure, so the store and its tests share one source of truth for the
 * wiring. City and Metropolis both switch on the crowd economy and the
 * archetype/trade channels their founder baselines are gated for; Metropolis
 * additionally lands the player-only cash uplift.
 */
export function worldScaleConfig(
  difficulty: Difficulty,
  challenge: boolean,
  size: 'cozy' | 'bustling',
  world: 'village' | 'city' | 'metropolis',
): SimulationConfig {
  const sizeOverrides =
    size === 'bustling' ? { maxHomes: 80, maxCitizens: 160, mapHeight: 124 } : {};
  let worldOverride: Partial<SimulationConfig> = {};
  if (world === 'city') {
    // City turns the whole stack on together (crowd + services + landlords +
    // holdcos + trade pools) — the founder baselines are pinned with all four on.
    worldOverride = {
      sizePreset: 'city',
      servicesEnabled: true,
      realEstateEnabled: true,
      investorsEnabled: true,
      tradeDemandPoolsEnabled: true,
    };
  } else if (world === 'metropolis') {
    // Metropolis wires every channel City does EXCEPT investorsEnabled: the
    // holdco founder row is double-gated on sizePreset === 'city' (a live holdco
    // reshuffles the D3-measured crowd-tier bands), so the flag is a no-op here —
    // omitted rather than set to something inert. services + realEstate + trade
    // pools all activate at metropolis (their gates are sizePreset !== 'village').
    worldOverride = {
      sizePreset: 'metropolis',
      servicesEnabled: true,
      realEstateEnabled: true,
      tradeDemandPoolsEnabled: true,
    };
  }
  const config: SimulationConfig = {
    ...configForDifficulty(difficulty),
    challengeMode: challenge,
    ...sizeOverrides,
    ...worldOverride,
  };
  // Player-only foothold uplift, added last so difficulty still orders the start.
  if (world === 'metropolis') config.playerStartCash += METROPOLIS_PLAYER_START_CASH_BONUS;
  return config;
}
