/**
 * chains.ts — Blueprint for each full consumer supply chain, used by the
 * BUILD_CHAIN command ("chain wizard") to stand up producer → factory →
 * store in one click. Data-driven: adding a chain here makes it wizardable.
 */

import type { ProductId } from '../core/Id';
import { getFacilityDef } from './facilityDefinitions';

export interface ChainBlueprint {
  /** Consumer product the chain ends in. */
  productId: ProductId;
  /** Raw input produced upstream. */
  inputProductId: ProductId;
  producerDefId: 'farm' | 'mine';
  producerRecipeId: string;
  factoryRecipeId: string;
}

export const CHAIN_BLUEPRINTS: Record<string, ChainBlueprint> = {
  bread: {
    productId: 'bread',
    inputProductId: 'grain',
    producerDefId: 'farm',
    producerRecipeId: 'grow_grain',
    factoryRecipeId: 'bake_bread',
  },
  coffee: {
    productId: 'coffee',
    inputProductId: 'grain',
    producerDefId: 'farm',
    producerRecipeId: 'grow_grain',
    factoryRecipeId: 'roast_coffee',
  },
  tools: {
    productId: 'tools',
    inputProductId: 'minerals',
    producerDefId: 'mine',
    producerRecipeId: 'mine_minerals',
    factoryRecipeId: 'make_tools',
  },
  clothes: {
    productId: 'clothes',
    inputProductId: 'cotton',
    producerDefId: 'farm',
    producerRecipeId: 'grow_cotton',
    factoryRecipeId: 'sew_clothes',
  },
  // Arc C1 breadth chains (city/metropolis products) — same producer→factory→
  // store shape as the shipped chains, so the wizard and AI founder stand them
  // up through the exact same machinery.
  meals: {
    productId: 'meals',
    inputProductId: 'produce',
    producerDefId: 'farm',
    producerRecipeId: 'grow_produce',
    factoryRecipeId: 'cook_meals',
  },
  shoes: {
    productId: 'shoes',
    inputProductId: 'leather',
    producerDefId: 'farm',
    producerRecipeId: 'tan_leather',
    factoryRecipeId: 'make_shoes',
  },
  furniture: {
    productId: 'furniture',
    inputProductId: 'lumber',
    producerDefId: 'farm',
    producerRecipeId: 'cut_lumber',
    factoryRecipeId: 'build_furniture',
  },
  appliances: {
    productId: 'appliances',
    inputProductId: 'minerals',
    producerDefId: 'mine',
    producerRecipeId: 'mine_minerals',
    factoryRecipeId: 'assemble_appliances',
  },
  wine: {
    productId: 'wine',
    inputProductId: 'grapes',
    producerDefId: 'farm',
    producerRecipeId: 'grow_grapes',
    factoryRecipeId: 'ferment_wine',
  },
};

/** Total build cost of a chain (producer + factory + retail). */
export function chainCost(blueprint: ChainBlueprint): number {
  return (
    getFacilityDef(blueprint.producerDefId).buildCost +
    getFacilityDef('factory').buildCost +
    getFacilityDef('retail').buildCost
  );
}
