/**
 * chains.ts — Blueprint for each full consumer supply chain, used by the
 * BUILD_CHAIN command ("chain wizard") to stand up a whole chain (producer →
 * [intermediate factories…] → factory → store) in one click. Data-driven:
 * adding a chain here makes it wizardable.
 *
 * Arc C3 generalized the blueprint from a fixed producer→factory→retail triple
 * to N production `stages` (each a facility + recipe), with the store appended
 * after the last stage. A 2-stage chain (raw → consumer) is just `stages` of
 * length 2; a deep chain (raw → intermediate → consumer) is length 3. The
 * builder walks the stages in order, so a 2-stage blueprint builds BYTE-
 * IDENTICALLY to the pre-C3 triple (same facilities, same order, same
 * coordinates, same contracts) — the Village wizard/founder paths are pinned by
 * bit-identity and must not move. See ChainBuilder / chains.test.ts.
 */

import type { ProductId, FacilityDefId } from '../core/Id';
import { getFacilityDef } from './facilityDefinitions';
import { getRecipe } from './recipes';

/** One production stage of a chain: a facility running a recipe. The recipe's
 * single output is shipped to the next stage (or, for the last stage, retailed
 * as the chain's consumer product). */
export interface ChainStage {
  facilityDefId: FacilityDefId;
  recipeId: string;
}

export interface ChainBlueprint {
  /** Consumer product the chain ends in (retailed by the store). */
  productId: ProductId;
  /** Production stages in order: stage[0] extracts the raw, the last stage
   * makes `productId`. Length 2 = a classic raw→consumer chain; length 3+ =
   * a deep chain through one or more `intermediate` producer goods. */
  stages: ChainStage[];
}

/** The product shipped OUT of a stage — its recipe's first (sole) output. Used
 * for the wiring contract between stage i and i+1, and for stage-list display. */
export function stageOutput(stage: ChainStage): ProductId {
  return getRecipe(stage.recipeId).outputs[0]!.productId;
}

export const CHAIN_BLUEPRINTS: Record<string, ChainBlueprint> = {
  bread: {
    productId: 'bread',
    stages: [
      { facilityDefId: 'farm', recipeId: 'grow_grain' },
      { facilityDefId: 'factory', recipeId: 'bake_bread' },
    ],
  },
  coffee: {
    productId: 'coffee',
    stages: [
      { facilityDefId: 'farm', recipeId: 'grow_grain' },
      { facilityDefId: 'factory', recipeId: 'roast_coffee' },
    ],
  },
  tools: {
    productId: 'tools',
    stages: [
      { facilityDefId: 'mine', recipeId: 'mine_minerals' },
      { facilityDefId: 'factory', recipeId: 'make_tools' },
    ],
  },
  clothes: {
    productId: 'clothes',
    stages: [
      { facilityDefId: 'farm', recipeId: 'grow_cotton' },
      { facilityDefId: 'factory', recipeId: 'sew_clothes' },
    ],
  },
  // Arc C1 breadth chains (metropolis products) — 2-stage producer→factory→
  // store, same shape as the shipped chains.
  meals: {
    productId: 'meals',
    stages: [
      { facilityDefId: 'farm', recipeId: 'grow_produce' },
      { facilityDefId: 'factory', recipeId: 'cook_meals' },
    ],
  },
  shoes: {
    productId: 'shoes',
    stages: [
      { facilityDefId: 'farm', recipeId: 'tan_leather' },
      { facilityDefId: 'factory', recipeId: 'make_shoes' },
    ],
  },
  wine: {
    productId: 'wine',
    stages: [
      { facilityDefId: 'farm', recipeId: 'grow_grapes' },
      { facilityDefId: 'factory', recipeId: 'ferment_wine' },
    ],
  },
  // Arc C3 deep chains (metropolis only) — a raw is smelted/milled into an
  // `intermediate` producer good, then a second factory turns that into the
  // consumer good: three production stages + a store. The old 2-stage recipe
  // (assemble_appliances / build_furniture) stays a legacy alias for save-compat.
  appliances: {
    productId: 'appliances',
    stages: [
      { facilityDefId: 'mine', recipeId: 'mine_minerals' },
      { facilityDefId: 'factory', recipeId: 'smelt_steel' },
      { facilityDefId: 'factory', recipeId: 'forge_appliances' },
    ],
  },
  furniture: {
    productId: 'furniture',
    stages: [
      { facilityDefId: 'farm', recipeId: 'cut_lumber' },
      { facilityDefId: 'factory', recipeId: 'mill_planks' },
      { facilityDefId: 'factory', recipeId: 'assemble_furniture' },
    ],
  },
};

/** Total build cost of a chain: every production stage's facility + the store. */
export function chainCost(blueprint: ChainBlueprint): number {
  let total = getFacilityDef('retail').buildCost;
  for (const stage of blueprint.stages) {
    total += getFacilityDef(stage.facilityDefId).buildCost;
  }
  return total;
}
