/**
 * personalities.ts — AI rival personalities.
 *
 * Every AI firm gets a named CEO with an archetype that biases the knobs the
 * strategy system already turns: ad spend, price-cut depth, expansion
 * appetite, R&D cadence, and export eagerness. The mechanics stay shared —
 * personalities only tilt them — so rivals feel distinct ("Granite always
 * starts price wars") without forking the AI. Neutral defaults keep any firm
 * without a personality behaving exactly as before.
 */

export type PersonalityId =
  | 'price_fighter'
  | 'brand_builder'
  | 'expansionist'
  | 'exporter';

/** Gazette moments a CEO might comment on. */
export type QuoteKind = 'ads' | 'expand' | 'price' | 'export' | 'luxury' | 'shares';

export interface Personality {
  id: PersonalityId;
  name: string;
  icon: string;
  /** One line for tooltips/dashboards: what to expect from this rival. */
  blurb: string;
  /** CEO quips attached to gazette headlines, by moment. */
  quotes: Partial<Record<QuoteKind, string[]>>;
  /** Multiplier on the ad-budget cap (and ramp step). */
  adMult: number;
  /** Multiplier on price-cut depth (priced-out / surplus branches). */
  priceCutMult: number;
  /** Penetration-pricing target as a fraction of base price. */
  penetrationTarget: number;
  /** Multiplier on the daily expansion roll. */
  expandChanceMult: number;
  /** Daily chance of an unprompted R&D investment. */
  rndChance: number;
  /**
   * Appetite for parking cash in rival equity (Arc B2, city-scale only). Scales
   * the yield-buy cadence, the target stake cap, and how little cash the firm
   * keeps back — aggressive acquirers (expansionist, price_fighter, both of
   * whom already have 'shares' quips) buy more; brand/export builders hoard for
   * their own operations. Neutral 1.0 leaves the Village path (which never
   * reads it) untouched. */
  stakeAppetite: number;
  /**
   * Dividend payout stance (Arc B2, city-scale only): a multiplier on the base
   * DIVIDEND_PAYOUT_RATIO. Growth personas retain (<1) to fund expansion;
   * income / thin-margin personas distribute (>1). Neutral 1.0 keeps Village
   * dividends bit-identical (DividendSystem only applies it at city scale). */
  dividendMult: number;
  /** Multiplier on the stock an exporter keeps at home (lower = ships more). */
  exportKeepMult: number;
  /** Lowest wholesale asking price (fraction of market) this CEO will cut to
   * when hunting customers. */
  wholesaleFloor: number;
  ceoNames: string[];
}

/** Neutral profile: exactly the pre-personality behavior. */
export const NEUTRAL: Personality = {
  id: 'price_fighter', // unused for neutral lookups; fields below are what matter
  name: 'Steady Hand',
  icon: '🎩',
  blurb: 'Runs the numbers by the book.',
  adMult: 1,
  priceCutMult: 1,
  penetrationTarget: 0.78,
  expandChanceMult: 1,
  rndChance: 0.15,
  stakeAppetite: 1,
  dividendMult: 1,
  exportKeepMult: 1,
  wholesaleFloor: 0.7,
  ceoNames: [],
  quotes: {},
};

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  price_fighter: {
    id: 'price_fighter',
    name: 'Price Fighter',
    icon: '🥊',
    blurb: 'Cuts deeper and dives lower to buy customers — expect price wars.',
    adMult: 0.6,
    priceCutMult: 1.5,
    penetrationTarget: 0.7,
    expandChanceMult: 1,
    rndChance: 0.08,
    // Aggressive: "if you can't beat them, own them." Buys stakes eagerly and,
    // a small margin-thin income tilt.
    stakeAppetite: 1.3,
    dividendMult: 1.1,
    exportKeepMult: 1,
    wholesaleFloor: 0.55,
    ceoNames: ['Vera Stone', 'Otto Krieg', 'Sal Marchetti'],
    quotes: {
      price: ['Nobody undersells us. Nobody.', 'Margins are for cowards.'],
      ads: ['Ads are noise. Our price tag is the billboard.'],
      expand: ['Another block, another beachhead.'],
      shares: ['If you can’t beat them, own them.'],
    },
  },
  brand_builder: {
    id: 'brand_builder',
    name: 'Brand Builder',
    icon: '📣',
    blurb: 'Outspends on ads and quality instead of cutting prices.',
    adMult: 1.5,
    priceCutMult: 0.9,
    penetrationTarget: 0.85,
    expandChanceMult: 1,
    rndChance: 0.2,
    // Conservative acquirer, growth-retaining: hoards cash for ads/quality and
    // keeps a little more inside to build the brand.
    stakeAppetite: 0.6,
    dividendMult: 0.9,
    exportKeepMult: 1,
    wholesaleFloor: 0.68,
    ceoNames: ['Mara Voss', 'Julian Bright', 'Coco Delacroix'],
    quotes: {
      ads: ['Quality speaks. We just turn up the volume.', 'A brand is a promise — we advertise ours.'],
      price: ['We don’t chase discounts. Discounts chase us.'],
      luxury: ['The finer things were always the plan.'],
      expand: ['Every storefront is a stage.'],
    },
  },
  expansionist: {
    id: 'expansionist',
    name: 'Expansionist',
    icon: '🏗️',
    blurb: 'Opens new outlets at the first whiff of unmet demand.',
    adMult: 1,
    priceCutMult: 1,
    penetrationTarget: 0.78,
    expandChanceMult: 2.5,
    rndChance: 0.12,
    // Most aggressive acquirer: "today a stake, tomorrow the street." Retains
    // to fund the next store.
    stakeAppetite: 1.6,
    dividendMult: 0.85,
    exportKeepMult: 1,
    wholesaleFloor: 0.62,
    ceoNames: ['Ada Sterling', 'Ray Calloway', 'Petra Lindqvist'],
    quotes: {
      expand: ['Growth is the only moat.', 'See a queue? Build a door.'],
      ads: ['New neighborhoods need new signs.'],
      shares: ['Today a stake, tomorrow the street.'],
      luxury: ['Upmarket is just another market.'],
    },
  },
  exporter: {
    id: 'exporter',
    name: 'Exporter',
    icon: '🚢',
    blurb: 'Ships surplus to Port Rosa early and often.',
    adMult: 0.9,
    priceCutMult: 1,
    penetrationTarget: 0.78,
    expandChanceMult: 1,
    rndChance: 0.12,
    // Conservative acquirer but cash-generative — ships goods, not capital, and
    // distributes a little more of the trade income it throws off.
    stakeAppetite: 0.7,
    dividendMult: 1.15,
    exportKeepMult: 0.5,
    wholesaleFloor: 0.72,
    ceoNames: ['Ines Marlowe', 'Dmitri Volkov', 'June Okafor'],
    quotes: {
      export: ['Port Rosa pays better than nostalgia.', 'The tide waits for no warehouse.'],
      price: ['Local prices are a courtesy, not a strategy.'],
      expand: ['Every outlet is a harbor.'],
    },
  },
};

/**
 * A CEO quip for a gazette headline, or '' when the firm has no CEO (the
 * player) or the personality has nothing to say about this moment. Uses the
 * sim rng so replays stay deterministic.
 */
export function ceoQuote(
  rng: { pick<T>(arr: T[]): T | undefined },
  firm: { ceoName: string | null; personalityId: string | null },
  kind: QuoteKind,
): string {
  if (!firm.ceoName) return '';
  const pool = getPersonality(firm.personalityId).quotes[kind];
  if (!pool || pool.length === 0) return '';
  const q = rng.pick(pool);
  return q ? ` “${q}” — ${firm.ceoName}` : '';
}

const ROTATION: PersonalityId[] = ['brand_builder', 'price_fighter', 'expansionist', 'exporter'];

/** Deterministic personality for the i-th AI firm (used when a scenario doesn't pin one). */
export function defaultPersonalityFor(index: number): PersonalityId {
  return ROTATION[index % ROTATION.length]!;
}

/** Deterministic CEO name for the i-th AI firm with a given personality. */
export function defaultCeoFor(id: PersonalityId, index: number): string {
  const names = PERSONALITIES[id].ceoNames;
  return names[index % names.length]!;
}

export function getPersonality(id: string | null | undefined): Personality {
  return (id && PERSONALITIES[id as PersonalityId]) || NEUTRAL;
}
