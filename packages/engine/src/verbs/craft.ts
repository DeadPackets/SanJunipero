import { STEW_KIND } from '../food.js'
import { inputName, type RecipeDef, type SimConfig, type StructureRecipeDef } from '@sj/shared'

// What can be built at all: a row with materials on it. An empty `inputs` marks a kind the
// world places and nobody raises — a grave is not a building project.
export function buildableRecipe(config: SimConfig, kind: string): StructureRecipeDef | null {
  const row = config.structures.recipes[kind]
  return row !== undefined && Object.keys(row.inputs).length > 0 ? row : null
}

// The house keeps its own dial as the duration source; every other kind reads its row. The two
// are asserted equal in config.test.ts, so this is one number under two names, not two numbers.
export function buildTicks(config: SimConfig, kind: string): number {
  return kind === 'house'
    ? config.construction.houseTicks
    : (config.structures.recipes[kind]?.durationTicks ?? 0)
}

// Code and not a dial, because SimConfigSchema is closed — and it wants two things a config row
// cannot say: a fire somebody is feeding, and a vessel with water in it.
export type SeedRecipe = RecipeDef & { atFire?: true; water?: number }

export const SEED_RECIPES: Readonly<Record<string, SeedRecipe>> = {
  [STEW_KIND]: {
    inputs: { any_meat: 1, any_vegetable: 1 },
    output: { kind: STEW_KIND, qty: 1 },
    skill: 'cooking',
    atFire: true,
    water: 1,
  },
  // crafting.recipes holds the weaver's road (fiber → cloth → garment) and is closed, so the road
  // that skips the loom lives here. The name has to differ from that row; the thing it makes does not.
  hide_garment: {
    inputs: { hide: 2 },
    output: { kind: 'garment', qty: 1 },
    skill: 'tailoring',
  },
  // A stick and a wrap of dry reed. Until this row the only flame in the world was the one
  // the founders were given, and `kindle` had nothing to strike.
  torch: {
    inputs: { wood: 1, fiber: 1 },
    output: { kind: 'torch', qty: 1 },
    skill: 'carpentry',
  },
}

export function recipeFor(config: SimConfig, name: string): SeedRecipe | undefined {
  return config.crafting.recipes[name] ?? SEED_RECIPES[name]
}

// A mind asks for the THING, not the road to it: "craft garment" with two hides in hand must not
// be told there is no cloth. The row that owns the name is tried first; order is by key.
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

// Off the same two tables build and craft already validate against. No new physics: the vocabulary
// those verbs have always accepted, gathered in one place so somebody can be told it.
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
  // One word per product, because `craftRoutes` already lets one word reach every road to it:
  // "garment" finds the loom and the hide, where `hide_garment` would have found only the hide.
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

// Where a material comes from, for the refusal that says a pair of hands is short of one: the
// live gate answered "not enough meat" to a town that had never seen an animal.
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
