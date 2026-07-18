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

/** Escalating objectives after the first win — the sandbox always has a goal. */
export const OBJECTIVE_LADDER: { valuation: number; title: string }[] = [
  { valuation: OBJECTIVE_VALUATION, title: 'Tycoon' },
  { valuation: dollars(150000), title: 'Magnate' },
  { valuation: dollars(400000), title: 'Business Empire' },
];

// --- Stock market ----------------------------------------------------------
/** Fraction of a firm's positive daily net profit distributed as dividends. */
export const DIVIDEND_PAYOUT_RATIO = 0.3;
/** Max partial stake one firm may hold in another (full takeover is separate). */
export const MAX_STAKE_PCT = 49;
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

export const FESTIVAL_COST = dollars(1500);
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
