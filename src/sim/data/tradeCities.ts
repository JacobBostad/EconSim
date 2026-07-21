/**
 * tradeCities.ts — the distant markets goods can be exported to.
 *
 * Each city's prices walk around base price scaled by a per-product bias:
 * Port Rosa is the food-and-goods provisioning port the game launched with;
 * Ironvale is an industrial inland rail hub that pays up for tools, minerals
 * and finery. Freight differs too, so the best port for a shipment is a real
 * decision — and the two walks are anti-correlated, so arbitrage windows open
 * and close.
 *
 * Arc E step 2 (opt-in demand pools) makes each port TWO-SIDED: it not only
 * consumes but PRODUCES some of what it consumes, as a per-product fraction of
 * its own daily consumption (`productionByProduct`). The two ports mirror each
 * other — Port Rosa (🚢) is food-leaning and grows most of its own bread,
 * coffee and staples but makes little of its tools or finery; Ironvale (🚂) is
 * the industrial mirror, forging most of its own tools, apparel and jewelry but
 * importing its food. The consequence is real specialization: a port's export
 * market DEEPENS in what it under-produces (thin cover, a standing premium) and
 * SHRINKS in what it self-supplies (its own output keeps the shelf full, so a
 * dump there overhangs harder and longer). See region.md step 2 and tradePool.ts
 * — production is deterministic, holds no money, and only runs with the flag on.
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
  /**
   * Arc E step 2 (opt-in): the fraction of each product's own daily consumption
   * the city PRODUCES locally, per consumer product. 1.0 = fully self-sufficient
   * (imports nothing); 0 / omitted = fully imported (the deepest export market).
   * The town's own economy adds this to the pool each day regardless of tenders;
   * imports (the throttleable restock) then cover only the remaining gap. Held
   * below 1.0 by design — a port is at most self-sufficient, never a net
   * exporter, so a dump can always work off through consumption (just slowly
   * where production keeps refilling). Only consumer (needSpec) products appear;
   * raws/intermediates carry no pool. Empty ⇒ everything imported (pre-step-2).
   */
  productionByProduct: Partial<Record<ProductId, number>>;
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
    // Food-leaning provisioning port: grows/lands most of its own staples
    // (bread, coffee, meals) but makes little of its tools, apparel or finery —
    // so tools stay lucrative here (deep import market) while a bread dump
    // overhangs hard (its own bakers keep the shelf full).
    productionByProduct: {
      bread: 0.85,
      coffee: 0.75,
      meals: 0.75,
      pastries: 0.55,
      wine: 0.55,
      clothes: 0.2,
      shoes: 0.2,
      tools: 0.15,
      furniture: 0.2,
      appliances: 0.15,
      jewelry: 0.2,
    },
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
    // The industrial mirror: forges most of its own tools, apparel and jewelry
    // but imports its food — so food stays lucrative here (a rail hub where food
    // is cheap standing but under-produced, spiking when the import channel is
    // throttled) while a tool dump overhangs hard (its own forges keep filling).
    productionByProduct: {
      bread: 0.2,
      coffee: 0.25,
      meals: 0.25,
      pastries: 0.3,
      wine: 0.25,
      clothes: 0.75,
      shoes: 0.75,
      tools: 0.85,
      furniture: 0.8,
      appliances: 0.8,
      jewelry: 0.75,
    },
  },
};

export const TRADE_CITY_IDS = Object.keys(TRADE_CITIES) as TradeCityId[];

export function getTradeCity(id: string): TradeCityDef {
  return TRADE_CITIES[id as TradeCityId] ?? TRADE_CITIES.port_rosa;
}

export function cityBias(cityId: string, productId: ProductId): number {
  return getTradeCity(cityId).biasByProduct[productId] ?? 1;
}
