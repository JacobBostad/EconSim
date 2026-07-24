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
  /**
   * The region (Arc E step 4; see docs/design/region.md § "What step 4 will
   * take"). Off by default at EVERY preset, and NO preset turns it on yet (slice
   * 1). When on at state construction, `createInitialState` seeds ONE partner
   * town (`port_rosa`) into `state.towns` alongside home via `seedTown`, minting
   * only that town's six record families off the region's SHARED `idCounters`
   * (town-namespaced id prefixes, so home's runtime id stream is untouched) and a
   * LOCAL rng (so the shared rng stream is untouched). In slice 1 the partner is
   * INERT: no system ticks it and no home tick reads it, so a flag-on City game's
   * home is byte-identical to flag-off (rngState, serialized home records, money)
   * — proven in regionSeed.test.ts and the isolation probe. Village never seeds a
   * partner regardless (double-gated on sizePreset — a Village is definitionally
   * one town). Dispatch, the region-wide money primitive, and the freight edge
   * are later slices. */
  regionEnabled: boolean;
  /**
   * Risk-tiered loan pricing (see docs/design/interest-rates.md). Off by
   * default — including for the plain village/city/metropolis presets the pins
   * are tuned against — so probes, tests, and old saves keep the flat all-in
   * rate byte-identical. When on, FinanceSystem charges a leverage-priced
   * effective rate (a cheap first dollar rising toward the old flat rate at the
   * credit limit) instead of the stored flat `interestRatePerDay`. New games at
   * EVERY preset opt in (worldScaleConfig): the probe proved no AI or passive
   * player ever borrows on the pinned paths, so the interest transaction (gated
   * on debt > 0) is never reached — every rngState/money pin is bit-identical
   * flag-on vs flag-off (verified in interestRates.test.ts). Phase 3's migration
   * that reprices existing saved firms' base stays unshipped, so loaded games
   * keep their behavior (normalize default false). */
  riskTieredInterestEnabled: boolean;
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
/**
 * City-decoupling knobs (docs/design/cohorts-and-districts.md, "The City
 * cast-parity mechanism"). Every field below carries its shipped/baseline value
 * for ALL THREE presets, so the whole stack is INERT by construction — a plain
 * `{...DEFAULT_CONFIG, sizePreset:'city'}` town is bit-identical to before these
 * fields existed, and Village/Metropolis are byte-untouched. They are the sweep
 * axes the `city-decoupling` probe overrides in-process; a value only leaves its
 * baseline if a measured grid landing ships it (none has, as of this writing —
 * see the verdict). The fields:
 *
 *  - `founderCrowdWage` (cents): the wage an operator founder pays its crowd.
 *    $16 everywhere (= the historical `dollars(16)` literal). The decoupling
 *    would raise City to $18 so crowd workers clear the comfortable WAGE bar
 *    (sub × 18/14) and comfortable-band formation rides wages, not the runaway
 *    pool — but only pays off at the raised-trigger firm count where crowd
 *    empShare ≈ 0.5 (below that the wage leg is weaker than the savings cap it
 *    replaces; see the verdict).
 *  - `catchupBaskets`: extra baskets a crowd-town cast WORKER buys per urgent
 *    stop (the A3 `WORKER_CATCHUP_BASKETS`, now preset-keyed so the gap mechanism
 *    can raise it). 2 everywhere = the shipped value.
 *  - `catchupSyntheticSignal`: when true, the catch-up tranche is booked as
 *    SYNTHETIC PARITY demand — it buys real stock and pays real revenue, but is
 *    excluded from the founder-visible market shortage gauge (marketStats
 *    units/unmet), so raising `catchupBaskets` closes the cast-vs-cohort worker
 *    gap WITHOUT lifting fill-rate above the founder trigger (raising the flat
 *    WCB collapsed firm count exactly that way — city-headroom finding). false =
 *    the shipped accounting (catch-up counts as market demand).
 *  - `prosperityDrainFloor` (cents) / `prosperityDrainRate`: the prosperity-
 *    scaled pool sink (CrowdRentSystem). Above the per-capita floor a cohort
 *    sheds `rate` of its excess to the world each day, so the pool plateaus at
 *    any firm count (the flat rent sink was calibrated for the ~9-firm
 *    equilibrium and runs away at the raised trigger's ~0.5 employment). rate 0
 *    everywhere = disabled = the shipped flat-rent-only regime.
 *  - `immigrationEmpFloor`: an employment-aware immigration gate. Cohort inflow
 *    reads town SATISFACTION only (≥ 55), never job supply — so once the cast/
 *    crowd is well-served the worker cohort floods faster than founders add jobs
 *    and crowd empShare craters (the A4 flood, and the wall the cast-parity pass
 *    hit: closing the cast gap RAISES town satisfaction, re-triggering the flood).
 *    When > 0, inflow is scaled by `clamp((empShare − floor)/(1 − floor), 0, 1)`,
 *    so immigration halts at/below the floor and recovers as jobs fill — capital
 *    attracts labor only where there is work. 0 everywhere = disabled = the
 *    shipped satisfaction-only gate.
 *  - `restockRevisit`: the cast "restocked-shelf revisit" (cast-parity attempt
 *    #3; see docs/design/cohorts-and-districts.md). When true, a cast WORKER
 *    whose urgent need stocked out at an OPEN store earlier the same day gets
 *    ONE extra purchase attempt at that store once it restocks (models "swung by
 *    on the way home"), reusing the RetailDemandSystem purchase path so every
 *    stat stays coherent. The forward path the cast-parity verdict named — give
 *    the trip-limited worker the cohort's throughput as a genuine extra VISIT,
 *    not deeper single-visit baskets. false everywhere = disabled = shipped
 *    behaviour; the mechanism draws no rng and, double-gated on crowd presence,
 *    stays dark in a Village even if forced true (no cohort ever stocks out).
 */
export const SIZE_PRESETS = {
  village: { castTarget: 80, cohortCap: 0, crowdStart: 0, founderMaxAiFirms: 6, founderUndersupplyCooldown: 20, founderUndersupplyFillRate: 0.65, founderCash: 22000_00, mapWidth: 130, mapHeight: 92, founderCrowdWage: 16_00, catchupBaskets: 2, catchupSyntheticSignal: false, prosperityDrainFloor: 0, prosperityDrainRate: 0, immigrationEmpFloor: 0, restockRevisit: false },
  city: { castTarget: 150, cohortCap: 2000, crowdStart: 300, founderMaxAiFirms: 18, founderUndersupplyCooldown: 20, founderUndersupplyFillRate: 0.65, founderCash: 22000_00, mapWidth: 260, mapHeight: 184, founderCrowdWage: 16_00, catchupBaskets: 2, catchupSyntheticSignal: false, prosperityDrainFloor: 0, prosperityDrainRate: 0, immigrationEmpFloor: 0, restockRevisit: false },
  metropolis: { castTarget: 150, cohortCap: 10000, crowdStart: 1500, founderMaxAiFirms: 30, founderUndersupplyCooldown: 7, founderUndersupplyFillRate: 0.80, founderCash: 28000_00, mapWidth: 390, mapHeight: 276, founderCrowdWage: 16_00, catchupBaskets: 2, catchupSyntheticSignal: false, prosperityDrainFloor: 0, prosperityDrainRate: 0, immigrationEmpFloor: 0, restockRevisit: false },
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
  regionEnabled: false,
  riskTieredInterestEnabled: false,
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
    // Phase 2 opt-in (docs/design/interest-rates.md): every new game gets the
    // better, realistic loan pricing. Proven zero-AI-impact — no founder or
    // passive player borrows on the pinned paths, so the pins are bit-identical
    // flag-on (interestRates.test.ts). Old saves keep the flat rate via the
    // normalize default false; Phase 3's repricing migration stays unshipped.
    riskTieredInterestEnabled: true,
    ...sizeOverrides,
    ...worldOverride,
  };
  // Player-only foothold uplift, added last so difficulty still orders the start.
  if (world === 'metropolis') config.playerStartCash += METROPOLIS_PLAYER_START_CASH_BONUS;
  return config;
}
