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
      }),
      clothesChain(),
    ],
  },
};

export const DEFAULT_SCENARIO_ID = 'meadowbrook';

export function getScenario(id: string): ScenarioDef {
  return SCENARIOS[id] ?? SCENARIOS[DEFAULT_SCENARIO_ID]!;
}
