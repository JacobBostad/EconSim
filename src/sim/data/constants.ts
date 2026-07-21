/**
 * constants.ts — Shared economic constants and units.
 *
 * Money is always integer cents internally. Helpers here convert between
 * dollars and cents for data definitions and UI.
 */

/** Cents per dollar. */
export const CENTS = 100;

/** Convert dollars to integer cents. */
export function dollars(value: number): number {
  return Math.round(value * CENTS);
}

/** Quality scale bounds. */
export const MIN_QUALITY = 0;
export const MAX_QUALITY = 100;

/** Reference quality used when comparing/scoring stores. */
export const REFERENCE_QUALITY = 50;

/** Importer sells raw inputs at this multiple of base price (premium sourcing). */
export const IMPORT_MARKUP = 1.5;

/**
 * Wholesale (cross-firm supply contracts) trade at this multiple of the
 * market's average retail price — cheaper than shelves, pricier than making
 * it yourself, so buying local beats importing (1.5×) but not integration.
 * Measured: at 0.85 a wholesale-fed store's 15% gross margin couldn't cover
 * retail wages (lifetime revenue < COGS over 150 days); 0.70 leaves retail
 * economics that work at ordinary volume.
 */
export const WHOLESALE_DISCOUNT = 0.7;

/** Per-unit transport cost (cents) component for shipments, times distance. */
export const TRANSPORT_COST_PER_UNIT_DISTANCE = 0.6;
/** Flat transport cost (cents) per shipment. */
export const TRANSPORT_FLAT_COST = dollars(2);

// --- Marketing / brand ---------------------------------------------------
/** Brand points gained per day per $ of ad spend (with diminishing returns). */
export const AD_BRAND_GAIN_PER_DOLLAR = 0.05;
/** Daily multiplicative brand decay (brand fades without spend). */
export const BRAND_DECAY_PER_DAY = 0.03;
/** Max brand a store score can contribute via brand weight. */
export const MAX_BRAND = 100;

// --- R&D / quality -------------------------------------------------------
/** Quality points gained per $1,000 invested, scaled by remaining headroom. */
export const RND_QUALITY_GAIN_PER_1000 = 9;

// --- Finance / loans -----------------------------------------------------
/** A firm may borrow up to this multiple of its net worth (cash + inventory). */
export const LOAN_CREDIT_LIMIT_MULTIPLE = 1.5;
/** Minimum credit line (cents) regardless of net worth. */
export const LOAN_MIN_CREDIT = dollars(5000);

/** Objective: grow company valuation to this to "win" (sandbox continues). */
export const OBJECTIVE_VALUATION = dollars(50000);

/**
 * Escalating objectives after the first win — the sandbox always has a goal.
 *
 * Rungs re-priced from measurement (600-day runs, 3 seeds): the strongest
 * scripted player plateaus near $28k, the richest AI incumbent near $64k,
 * and the whole Cozy economy sums to roughly $210k — so the old Magnate
 * ($150k) demanded most of the town and Empire ($400k) was provably
 * unreachable even owning everything. Now Tycoon stays a stretch above
 * strong play, Magnate means out-valuing every incumbent, and Empire means
 * approaching whole-town scale — epic, but no longer imaginary.
 */
export const OBJECTIVE_LADDER: { valuation: number; title: string }[] = [
  { valuation: OBJECTIVE_VALUATION, title: 'Tycoon' },
  { valuation: dollars(100000), title: 'Magnate' },
  { valuation: dollars(200000), title: 'Business Empire' },
];

// --- Stock market ----------------------------------------------------------
/** Fraction of a firm's positive daily net profit distributed as dividends. */
export const DIVIDEND_PAYOUT_RATIO = 0.3;
/** Max partial stake one firm may hold in another (full takeover is separate). */
export const MAX_STAKE_PCT = 49;
/** Control ladder (see docs/design/stock-market.md, Phase 3). A holder at or
 * above this stake gains board visibility: the target's cash, 7-day net
 * profit, and facility count (a selector, surfaced in the portfolio card). */
export const BOARD_VISIBILITY_PCT = 25;
/** A single outside firm at or above this stake blocks a hostile full
 * acquisition of the target by anyone else — the blocker must consent, and AI
 * never does, so 40% is takeover protection. Below MAX_STAKE_PCT so a stake
 * short of the partial cap already buys a veto. */
export const CONTROL_BLOCK_PCT = 40;
/** Full takeover price multiple on valuation for a healthy target. */
export const ACQUISITION_PREMIUM_HEALTHY = 1.3;
/** Distressed/insolvent targets sell at a discount to valuation. */
export const ACQUISITION_PREMIUM_DISTRESSED = 0.9;

// --- Inter-city trade (Port Rosa) -------------------------------------------
/** Fraction of export revenue lost to freight/handling. */
export const EXPORT_FREIGHT_FEE = 0.08;
/** Port Rosa price random-walk bounds and daily step (× base price). */
export const TRADE_PRICE_MIN_MULT = 0.6;
export const TRADE_PRICE_MAX_MULT = 1.8;
export const TRADE_WALK_STEP = 0.12;
/** News thresholds: export boom above, glut below (× base price). */
export const TRADE_BOOM_MULT = 1.45;
export const TRADE_GLUT_MULT = 0.7;

/** Max products one retail store can carry. */
export const MAX_RETAIL_PRODUCTS = 3;

// --- Civic actions ----------------------------------------------------------
/** Sponsoring the 3-day town festival costs this much (paid to the town). */
/**
 * Daily ad budget the chain wizard sets on its product. Measured over 200
 * unattended days: without ads + auto-pricing a fresh chain never escapes
 * ~10% share (the incumbent's brand + loyalty outweigh any price cut) and
 * bleeds money forever; with them it reaches 30–45% share and break-even.
 */
export const WIZARD_AD_BUDGET = dollars(15);

/** Daily rent per resident of a player/AI-built apartment. */
export const APARTMENT_RENT_PER_DAY = dollars(2.5);
/** Satisfaction equilibrium bonus for living in premium housing. */
export const APARTMENT_SATISFACTION_BONUS = 5;

/**
 * Total tenants an apartment BLOCK houses (Arc A3 / HD4 crowd housing). The
 * named cast still pair up two-to-an-apartment as premium housing (the `< 2`
 * home-pick checks elsewhere are untouched); the spare capacity above the cast
 * residents houses anonymous crowd renters, so a landlord's income scales with
 * the district's population rather than its two on-map tenants. See
 * CrowdRentSystem.
 */
export const APARTMENT_CAPACITY = 50;

/**
 * Daily per-capita housing cost every cohort member pays (Arc A3 / HD4). The
 * consumption sink that bounds the cohort pool drift the City soak measured at
 * $3.7-4.4/capita/day upward (pools reaching $900-1,360/cap by day 300 and
 * distorting the tier savings gates). Pinned just under that drift so the pool
 * plateaus at a healthy $150-350/cap — enough to keep demand and the savings
 * gates meaningful, not a runaway and not a collapse. Crowd renters in
 * landlord-owned apartments pay it to the owning firm (booked exactly like cast
 * rent); everyone else pays the world account (informal housing — the town's
 * implicit landlord until real housing stock exists, symmetric with the
 * subsistence stipend the world already pays idle crowd).
 */
export const CROWD_RENT_PER_DAY = dollars(3);

/**
 * Measured (6 seeds, paired 100-day runs): the festival's direct revenue
 * lift for a typical single-chain player is tiny (~$50-200) — its value is
 * the town-wide moment, not the till. At $1,500 it was a trap dressed as a
 * business play; $800 prices it as the civic splurge it actually is, and a
 * large multi-store empire can still break even on volume.
 */
export const FESTIVAL_COST = dollars(800);
/** Funding a new home (2 residents move in) costs this much. */
export const FUND_HOME_COST = dollars(3000);

// --- Immigration / town growth ---------------------------------------------
/** New citizens move in only while average satisfaction is at least this. */
export const IMMIGRATION_MIN_SATISFACTION = 55;
/**
 * ...and the labor market is tight: unemployed ≤ max(floor, rate × population).
 * People move toward opportunity — creating jobs is what grows the town.
 */
export const IMMIGRATION_MAX_UNEMPLOYED_FLOOR = 8;
export const IMMIGRATION_MAX_UNEMPLOYED_RATE = 0.22;
/** Hard caps so the town grows but stays lean. */
export const MAX_HOMES = 40;
export const MAX_CITIZENS = 80;
/** Cash a new arrival brings (paid from the world account; conserved). */
export const IMMIGRANT_START_CASH = dollars(400);

// --- Emigration (the mutter made real) --------------------------------------
/**
 * A town only loses families under SUSTAINED misery: worker share above the
 * share bar AND average satisfaction below this, every day for the grace
 * period. Healthy-but-modest worker towns (Mill Country idles near 50) must
 * never qualify — this bar is deliberately far below the immigration gate.
 */
export const EMIGRATION_MAX_SATISFACTION = 42;
export const EMIGRATION_MIN_WORKER_SHARE = 0.8;
/** Consecutive miserable days before anyone actually packs. One good day resets it. */
export const EMIGRATION_GRACE_DAYS = 10;
/** Once past the grace period, the daily hash-gated odds a household departs. */
export const EMIGRATION_DAILY_CHANCE = 0.25;
/** The town never empties out — departures stop at this population. */
export const EMIGRATION_MIN_POPULATION = 12;

// --- AI founders (capital follows people) -----------------------------------
/** No AI founds anything before this day — the map's gaps belong to the
 * player first. */
export const FOUNDER_EARLIEST_DAY = 55;
/** A staple must go unsold (no staffed seller) this many CONSECUTIVE days
 * before capital notices; any seller appearing resets the count. */
export const FOUNDER_GAP_DAYS = 20;
/** Hash-gated daily odds of an entry once every gate is open. */
export const FOUNDER_DAILY_CHANCE = 0.12;
/** Total AI firms the town supports before founders stop coming. This is the
 * VILLAGE baseline; the live cap is `SIZE_PRESETS[preset].founderMaxAiFirms`
 * (village resolves to exactly this 6), read via `founderMaxAiFirms()`. */
export const FOUNDER_MAX_AI_FIRMS = 6;

// --- AI founders: crowd under-supply response (city-scale only) -------------
// A second, coexisting founder signal beyond total vacancy: a staple that is
// SOLD but chronically UNDER-supplied (a queue at the counter, not an empty
// shelf) draws a competitor into the occupied market. Structurally inert at
// Village size — the founder loop never scans it there (see AIFounderSystem).
/** A staple whose smoothed town fill-rate (fulfilled / (fulfilled + unmet))
 * stays below this is chronically under-supplied. Starting value — measure
 * against the City soak. */
export const FOUNDER_UNDERSUPPLY_FILL_RATE = 0.65;
/** Days to smooth the fill-rate over, read from marketStats daily history. */
export const FOUNDER_UNDERSUPPLY_WINDOW = 7;
/** Consecutive under-supplied days before a founder enters an OCCUPIED market.
 * Starting value to measure. */
export const FOUNDER_UNDERSUPPLY_DAYS = 15;
/** Town-wide minimum days between under-supply entries, so a transient shock
 * (a bad-logistics week, a world-event demand spike) doesn't spawn a glut of
 * bakeries at once. Starting value to measure. */
export const FOUNDER_UNDERSUPPLY_COOLDOWN = 20;
/** Founders only chase towns worth living in (see also the satisfaction
 * gate — the immigration bar). */
export const FOUNDER_MIN_POPULATION = 30;
/** Founding capital, paid in from the world account (conserved): a starter
 * chain (~$8-10k at land prices) plus working-capital runway. */
export const FOUNDER_CASH = dollars(22000);

// --- AI founders: investor holdco (Arc D3, city-scale only) ------------------
// A third founder signal: when equity is cheap and dividends are fat, a holding
// company moves to town to work the book (no chain, no shelves — just stakes).
// The signal is the MEDIAN trailing dividend yield across listed firms; a broad
// spread of well-paying, reasonably-priced equity is what a holdco enters for.
// Structurally inert outside the City preset (Village bit-identity + the pinned
// Metropolis founder soak both found zero investors — see AIFounderSystem).
/** Median daily dividend yield (smoothed profit base ÷ marketCap, the base the
 * DividendSystem actually pays from) across listed firms above which the equity
 * market is "fat" enough to draw a holdco. Pinned by the d3-investor probe: a
 * live City median sits at ~0.0025-0.0045 for most of a 300-day run (seeds
 * 11/4/7), so this bar (0.002 ≈ a ~22%/yr gross yield at the 0.3 payout ratio)
 * is a real spread, not noise, and clears with room in a healthy city. */
export const INVESTOR_YIELD_BAR = 0.002;
/** Consecutive days the median yield must hold above the bar before a holdco
 * enters — a sustained spread, not a one-week blip. */
export const INVESTOR_SIGNAL_DAYS = 30;
/** Town-wide minimum days between investor entries, so a durable fat-yield
 * regime seeds a holdco or two, not a swarm. */
export const INVESTOR_ENTRY_COOLDOWN = 30;
/** Founding capital for a holdco (from the world account, conserved). Larger
 * than the operator's $22k: a holdco has no chain to build, so all of it is
 * deployable into the book — this is its starting war chest. */
export const INVESTOR_FOUNDER_CASH = dollars(30000);

// --- Stock market friction (see docs/design/stock-market.md, Phase 2) -------
/** Brokerage fee on every share trade, both directions, paid to the world —
 * with the price impact below this makes round-trip timing plays lose. */
export const SHARE_TRADE_FEE = 0.03;
/** Resting-price displacement per percent traded: buys push the quote up,
 * sells push it down (the fill itself walks the half-impact curve, exactly
 * like the commodity desk). */
export const SHARE_PRICE_IMPACT_PER_PCT = 0.004;
/** Fraction of the displacement retained each day — it mean-reverts to the
 * fair value (marketCap) as the market digests the trade. */
export const SHARE_SHIFT_DECAY = 0.8;
/** Displacement never exceeds ±25% of fair value. */
export const SHARE_SHIFT_MAX = 0.25;
