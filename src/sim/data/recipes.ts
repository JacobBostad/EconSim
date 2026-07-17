/**
 * recipes.ts — Production recipes (data-driven).
 *
 * Extraction recipes (farms, mines, importer) have no inputs. Manufacturing
 * recipes (factory/bakery) consume inputs to make outputs. To add a recipe,
 * append it here and list its id in the relevant facility definition's
 * allowedRecipes.
 */

import type { Recipe } from '../entities/Recipe';
import type { RecipeId } from '../core/Id';
import { dollars } from './constants';

export const RECIPES: Record<RecipeId, Recipe> = {
  // --- Bread chain -------------------------------------------------------
  grow_grain: {
    id: 'grow_grain',
    name: 'Grow Grain',
    facilityType: 'farm',
    inputs: [],
    outputs: [{ productId: 'grain', quantity: 10 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(2.0), // seed, water, fuel
  },
  bake_bread: {
    id: 'bake_bread',
    name: 'Bake Bread',
    facilityType: 'factory',
    inputs: [{ productId: 'grain', quantity: 3 }],
    outputs: [{ productId: 'bread', quantity: 13 }],
    laborRequired: 2,
    ticksRequired: 2,
    baseEfficiency: 1,
    variableCost: dollars(1.5),
  },

  // --- Tools chain -------------------------------------------------------
  mine_minerals: {
    id: 'mine_minerals',
    name: 'Mine Minerals',
    facilityType: 'mine',
    inputs: [],
    outputs: [{ productId: 'minerals', quantity: 8 }],
    laborRequired: 2,
    ticksRequired: 4,
    baseEfficiency: 1,
    variableCost: dollars(2.5),
  },
  make_tools: {
    id: 'make_tools',
    name: 'Make Tools',
    facilityType: 'factory',
    inputs: [{ productId: 'minerals', quantity: 4 }],
    outputs: [{ productId: 'tools', quantity: 10 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(2.5),
  },

  // --- Apparel chain -----------------------------------------------------
  grow_cotton: {
    id: 'grow_cotton',
    name: 'Grow Cotton',
    facilityType: 'farm',
    inputs: [],
    outputs: [{ productId: 'cotton', quantity: 8 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(2.2),
  },
  sew_clothes: {
    id: 'sew_clothes',
    name: 'Sew Clothes',
    facilityType: 'factory',
    inputs: [{ productId: 'cotton', quantity: 3 }],
    outputs: [{ productId: 'clothes', quantity: 8 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(2.2),
  },

  // --- Importer (extraction from the outside world) ----------------------
  import_grain: {
    id: 'import_grain',
    name: 'Import Grain',
    facilityType: 'importer',
    inputs: [],
    outputs: [{ productId: 'grain', quantity: 8 }],
    laborRequired: 0,
    ticksRequired: 2,
    baseEfficiency: 1,
    variableCost: dollars(2.6),
  },
  import_minerals: {
    id: 'import_minerals',
    name: 'Import Minerals',
    facilityType: 'importer',
    inputs: [],
    outputs: [{ productId: 'minerals', quantity: 8 }],
    laborRequired: 0,
    ticksRequired: 2,
    baseEfficiency: 1,
    variableCost: dollars(3.4),
  },
  import_cotton: {
    id: 'import_cotton',
    name: 'Import Cotton',
    facilityType: 'importer',
    inputs: [],
    outputs: [{ productId: 'cotton', quantity: 8 }],
    laborRequired: 0,
    ticksRequired: 2,
    baseEfficiency: 1,
    variableCost: dollars(3.6),
  },
};

export function getRecipe(id: RecipeId): Recipe {
  const r = RECIPES[id];
  if (!r) throw new Error(`Unknown recipe: ${id}`);
  return r;
}
