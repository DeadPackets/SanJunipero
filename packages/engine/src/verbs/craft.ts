import { STEW_KIND } from '../food.js'
import { inputName, type RecipeDef, type SimConfig, type StructureRecipeDef } from '@sj/shared'

// An empty `inputs` marks a kind the world places and nobody raises.
export function buildableRecipe(config: SimConfig, kind: string): StructureRecipeDef | null {
  const row = config.structures.recipes[kind]
  return row !== undefined && Object.keys(row.inputs).length > 0 ? row : null
}

// The house has its own dial; config.test.ts asserts it equals its recipe row, so this is one
// number under two names.
export function buildTicks(config: SimConfig, kind: string): number {
  return kind === 'house'
    ? config.construction.houseTicks
    : (config.structures.recipes[kind]?.durationTicks ?? 0)
}

// Code and not a dial: SimConfigSchema is closed, and a row cannot say "at a fire" or "with water".
export type SeedRecipe = RecipeDef & { atFire?: true; water?: number }

export const SEED_RECIPES: Readonly<Record<string, SeedRecipe>> = {
  [STEW_KIND]: {
    inputs: { any_meat: 1, any_vegetable: 1 },
    output: { kind: STEW_KIND, qty: 1 },
    skill: 'cooking',
    atFire: true,
    water: 1,
  },
  // The key must differ from the closed `crafting.recipes` row; the product it makes need not.
  hide_garment: {
    inputs: { hide: 2 },
    output: { kind: 'garment', qty: 1 },
    skill: 'tailoring',
  },
  torch: {
    inputs: { wood: 1, fiber: 1 },
    output: { kind: 'torch', qty: 1 },
    skill: 'carpentry',
  },
}

export function recipeFor(config: SimConfig, name: string): SeedRecipe | undefined {
  return config.crafting.recipes[name] ?? SEED_RECIPES[name]
}

// A mind asks for the THING, not the road: "craft garment" with two hides in hand must not be
// told there is no cloth.
export function craftRoutes(config: SimConfig, name: string): SeedRecipe[] {
  const named = recipeFor(config, name)
  const product = named?.output.kind ?? name
  const routes = named === undefined ? [] : [named]
  for (const key of Object.keys(SEED_RECIPES).sort()) {
    const seed = SEED_RECIPES[key]!
    if (seed !== named && seed.output.kind === product) routes.push(seed)
  }
  return routes
}

// Off the same two tables build and craft validate against — no vocabulary of its own.
export type MakeableRoad = { inputs: Record<string, number>; atFire?: true; water?: number }
export type Makeables = {
  builds: { kind: string; inputs: Record<string, number> }[]
  crafts: { name: string; roads: MakeableRoad[] }[]
}

export function makeables(config: SimConfig): Makeables {
  const builds = Object.keys(config.structures.recipes)
    .sort()
    .flatMap((kind) => {
      const row = buildableRecipe(config, kind)
      return row === null ? [] : [{ kind, inputs: row.inputs }]
    })
  // One word per product: `craftRoutes` reaches every road to it from the product's own name.
  const products = new Set<string>()
  for (const name of [...Object.keys(config.crafting.recipes), ...Object.keys(SEED_RECIPES)]) {
    products.add(recipeFor(config, name)?.output.kind ?? name)
  }
  const crafts = [...products].sort().map((name) => ({
    name,
    roads: craftRoutes(config, name).map((r) => ({
      inputs: r.inputs,
      ...(r.atFire === true ? { atFire: true as const } : {}),
      ...(r.water === undefined ? {} : { water: r.water }),
    })),
  }))
  return { builds, crafts }
}

// "not enough meat" means nothing to a town that has never seen an animal.
const MATERIAL_SOURCE: Readonly<Record<string, string>> = {
  meat: 'meat comes off an animal you have hunted, or a fish out of the water',
  vegetables:
    'a vegetable comes from a berry patch, a mushroom ground or a field you have harvested',
  fiber: 'fiber comes from cutting the reeds where the bank is wet',
  cloth: 'cloth is woven from fiber',
  hide: 'a hide comes off an animal you have killed',
  wood: 'wood comes from felling a tree',
  plank: 'planks are cut from wood',
  stone: 'stone comes from the loose rock at the foot of an outcrop',
  clay: 'clay comes from a bank where the ground has slumped',
}

export function shortOf(kind: string): string {
  const name = inputName(kind)
  const source = MATERIAL_SOURCE[name]
  return source === undefined ? `not enough ${name}` : `not enough ${name} — ${source}`
}
