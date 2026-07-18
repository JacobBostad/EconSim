/**
 * scenarios.ts — data-driven starting scenarios (town variants).
 *
 * A scenario decides which AI chains exist, where they sit, and how they are
 * stocked/staffed. Every scenario leaves at least one consumer market
 * underserved or contested — that gap is the player's opening. The default
 * 'meadowbrook' reproduces the classic three-chain town.
 */

import type { Vec2 } from '../entities/Location';
import { dollars } from './constants';
import type { PersonalityId } from './personalities';

export interface AiChainSpec {
  firmName: string;
  /** Consumer product the chain ends in. */
  product: 'bread' | 'tools' | 'clothes';
  producerDef: 'farm' | 'mine';
  producerRecipe: string;
  factoryRecipe: string;
  inputProduct: string;
  producerName: string;
  factoryName: string;
  retailName: string;
  loc: { producer: Vec2; factory: Vec2; retail: Vec2 };
  cash: number;
  adBudget: number;
  brand: number;
  /** Starting stocks. */
  stocks: { producerOut: number; factoryIn: number; factoryOut: number; shopIn: number };
  /** Staffing per stage. */
  staff: { producer: number; factory: number; retail: number };
  /** Contract params: producer→factory and factory→shop. */
  pf: { target: number; reorder: number; max: number };
  fs: { target: number; reorder: number; max: number };
  /** CEO archetype; defaults to a deterministic rotation when omitted. */
  personality?: PersonalityId;
}

export interface ScenarioDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  aiChains: AiChainSpec[];
}

const breadChain = (over: Partial<AiChainSpec> = {}): AiChainSpec => ({
  firmName: 'Sunrise Foods',
  product: 'bread',
  producerDef: 'farm',
  producerRecipe: 'grow_grain',
  factoryRecipe: 'bake_bread',
  inputProduct: 'grain',
  producerName: 'Sunrise Farm',
  factoryName: 'Sunrise Bakery',
  retailName: 'Sunrise Bread Shop',
  loc: { producer: { x: 26, y: 16 }, factory: { x: 48, y: 32 }, retail: { x: 46, y: 48 } },
  cash: dollars(40000),
  adBudget: dollars(20),
  brand: 22,
  stocks: { producerOut: 60, factoryIn: 30, factoryOut: 24, shopIn: 40 },
  staff: { producer: 2, factory: 2, retail: 2 },
  pf: { target: 40, reorder: 15, max: 80 },
  fs: { target: 60, reorder: 24, max: 110 },
  personality: 'brand_builder',
  ...over,
});

const toolsChain = (over: Partial<AiChainSpec> = {}): AiChainSpec => ({
  firmName: 'Granite Industries',
  product: 'tools',
  producerDef: 'mine',
  producerRecipe: 'mine_minerals',
  factoryRecipe: 'make_tools',
  inputProduct: 'minerals',
  producerName: 'Granite Mine',
  factoryName: 'Granite Tool Works',
  retailName: 'Granite Hardware',
  loc: { producer: { x: 104, y: 16 }, factory: { x: 86, y: 32 }, retail: { x: 78, y: 48 } },
  cash: dollars(45000),
  adBudget: dollars(14),
  brand: 22,
  stocks: { producerOut: 50, factoryIn: 24, factoryOut: 12, shopIn: 20 },
  staff: { producer: 2, factory: 2, retail: 1 },
  pf: { target: 30, reorder: 12, max: 60 },
  fs: { target: 40, reorder: 14, max: 80 },
  personality: 'price_fighter',
  ...over,
});

const clothesChain = (over: Partial<AiChainSpec> = {}): AiChainSpec => ({
  firmName: 'Loom & Thread',
  product: 'clothes',
  producerDef: 'farm',
  producerRecipe: 'grow_cotton',
  factoryRecipe: 'sew_clothes',
  inputProduct: 'cotton',
  producerName: 'Loom Cotton Farm',
  factoryName: 'Loom Tailor Works',
  retailName: 'Loom Boutique',
  loc: { producer: { x: 64, y: 14 }, factory: { x: 66, y: 32 }, retail: { x: 62, y: 48 } },
  cash: dollars(38000),
  adBudget: dollars(12),
  brand: 20,
  stocks: { producerOut: 40, factoryIn: 20, factoryOut: 12, shopIn: 18 },
  staff: { producer: 2, factory: 2, retail: 1 },
  pf: { target: 30, reorder: 12, max: 60 },
  fs: { target: 36, reorder: 14, max: 80 },
  personality: 'expansionist',
  ...over,
});

export const SCENARIOS: Record<string, ScenarioDef> = {
  meadowbrook: {
    id: 'meadowbrook',
    name: 'Meadowbrook',
    icon: '🏘️',
    description:
      'The classic town: three AI firms cover bread, tools, and clothes. Compete anywhere.',
    aiChains: [breadChain(), toolsChain(), clothesChain()],
  },
  gold_rush: {
    id: 'gold_rush',
    name: 'Gold Rush Gulch',
    icon: '⛏️',
    description:
      'A mining boomtown: TWO tool companies wage a price war, one bakery feeds everyone — and nobody sells clothes. That gap is yours.',
    aiChains: [
      breadChain({ cash: dollars(32000) }),
      toolsChain(),
      toolsChain({
        firmName: 'Deepvein Mining Co',
        producerName: 'Deepvein Shaft',
        factoryName: 'Deepvein Forge',
        retailName: 'Deepvein Outfitters',
        loc: { producer: { x: 118, y: 22 }, factory: { x: 108, y: 36 }, retail: { x: 96, y: 50 } },
        cash: dollars(40000),
        brand: 16,
        personality: 'exporter',
      }),
    ],
  },
  port_haven: {
    id: 'port_haven',
    name: 'Port Haven',
    icon: '⚓',
    description:
      'A harbor town obsessed with the export trade: the bakery and the forge both ship their best to Port Rosa, leaving home shelves thin — and nobody sells clothes. Feed the town they forgot, or out-sail them.',
    aiChains: [
      breadChain({
        firmName: 'Harbor Loaf Co',
        producerName: 'Harbor Grain Fields',
        factoryName: 'Harbor Bakehouse',
        retailName: 'Harbor Loaf Shop',
        // Compact, homes-adjacent layout: a scenario whose buildings sit in a
        // far corner starves — commutes eat the whole workday (measured).
        loc: { producer: { x: 28, y: 16 }, factory: { x: 46, y: 32 }, retail: { x: 50, y: 48 } },
        cash: dollars(36000),
        adBudget: dollars(10),
        brand: 14, // the home market is an afterthought
        stocks: { producerOut: 60, factoryIn: 30, factoryOut: 24, shopIn: 30 },
        staff: { producer: 3, factory: 3, retail: 2 },
        personality: 'exporter',
      }),
      toolsChain({
        firmName: 'Quayside Ironworks',
        producerName: 'Quayside Mine',
        factoryName: 'Quayside Forge',
        retailName: 'Quayside Supply',
        loc: { producer: { x: 86, y: 18 }, factory: { x: 76, y: 34 }, retail: { x: 64, y: 48 } },
        adBudget: dollars(10),
        brand: 14,
        stocks: { producerOut: 50, factoryIn: 24, factoryOut: 12, shopIn: 18 },
        staff: { producer: 3, factory: 3, retail: 2 },
        personality: 'exporter',
      }),
    ],
  },
  harvest_valley: {
    id: 'harvest_valley',
    name: 'Harvest Valley',
    icon: '🌾',
    description:
      'Breadbasket country: two bakery empires fight for every crumb, a boutique clothes the town — but no one makes tools. Bring the hardware.',
    aiChains: [
      breadChain(),
      breadChain({
        firmName: 'Golden Grain Co',
        producerName: 'Golden Grain Fields',
        factoryName: 'Golden Grain Bakehouse',
        retailName: 'Golden Grain Bakery',
        loc: { producer: { x: 100, y: 14 }, factory: { x: 92, y: 32 }, retail: { x: 84, y: 48 } },
        cash: dollars(36000),
        brand: 18,
        personality: 'price_fighter',
      }),
      clothesChain(),
    ],
  },
};

export const DEFAULT_SCENARIO_ID = 'meadowbrook';

export function getScenario(id: string): ScenarioDef {
  return SCENARIOS[id] ?? SCENARIOS[DEFAULT_SCENARIO_ID]!;
}
