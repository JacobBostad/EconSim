/**
 * tradeCities.ts — the distant markets goods can be exported to.
 *
 * Each city's prices walk around base price scaled by a per-product bias:
 * Port Rosa is the balanced food-and-goods port the game launched with;
 * Ironvale is an industrial inland hub that pays up for tools, minerals and
 * finery but grows its own food. Freight differs too, so the best port for a
 * shipment is a real decision — and the two walks are anti-correlated, so
 * arbitrage windows open and close.
 */

import type { ProductId } from '../core/Id';

export type TradeCityId = 'port_rosa' | 'ironvale';

export interface TradeCityDef {
  id: TradeCityId;
  name: string;
  emoji: string;
  /** Multiplier on the export freight fee (distance/terrain). */
  freightMult: number;
  /** Per-product multiplier on the price-walk center (default 1). */
  biasByProduct: Partial<Record<ProductId, number>>;
  /** Which direction this city's daily price jitter leans (+1 / −1). */
  walkSign: 1 | -1;
  /**
   * Off-map population the demand pool consumes for (Arc E, opt-in only). A
   * TINY figure by design — the pool is a price read, not a second town — sized
   * so a player-scale export (hundreds of units) is a few days of the city's
   * cover and moves the quote for days rather than one tick. Port Rosa is the
   * larger provisioning port; Ironvale the smaller inland hub.
   */
  population: number;
}

export const TRADE_CITIES: Record<TradeCityId, TradeCityDef> = {
  port_rosa: {
    id: 'port_rosa',
    name: 'Port Rosa',
    emoji: '🚢',
    freightMult: 1,
    biasByProduct: {},
    walkSign: 1,
    population: 180,
  },
  ironvale: {
    id: 'ironvale',
    name: 'Ironvale',
    emoji: '🚂',
    freightMult: 1.15,
    biasByProduct: {
      minerals: 1.2,
      tools: 1.3,
      cotton: 1.1,
      clothes: 1.2,
      jewelry: 1.25,
      grain: 0.85,
      bread: 0.85,
      coffee: 0.9,
      pastries: 0.9,
    },
    walkSign: -1,
    population: 140,
  },
};

export const TRADE_CITY_IDS = Object.keys(TRADE_CITIES) as TradeCityId[];

export function getTradeCity(id: string): TradeCityDef {
  return TRADE_CITIES[id as TradeCityId] ?? TRADE_CITIES.port_rosa;
}

export function cityBias(cityId: string, productId: ProductId): number {
  return getTradeCity(cityId).biasByProduct[productId] ?? 1;
}
