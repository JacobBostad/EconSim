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

export interface Personality {
  id: PersonalityId;
  name: string;
  icon: string;
  /** One line for tooltips/dashboards: what to expect from this rival. */
  blurb: string;
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
  /** Multiplier on the stock an exporter keeps at home (lower = ships more). */
  exportKeepMult: number;
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
  exportKeepMult: 1,
  ceoNames: [],
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
    exportKeepMult: 1,
    ceoNames: ['Vera Stone', 'Otto Krieg', 'Sal Marchetti'],
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
    exportKeepMult: 1,
    ceoNames: ['Mara Voss', 'Julian Bright', 'Coco Delacroix'],
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
    exportKeepMult: 1,
    ceoNames: ['Ada Sterling', 'Ray Calloway', 'Petra Lindqvist'],
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
    exportKeepMult: 0.5,
    ceoNames: ['Ines Marlowe', 'Dmitri Volkov', 'June Okafor'],
  },
};

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
