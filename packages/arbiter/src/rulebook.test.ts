import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { migrateArbiterTables, openArbiterDb } from './schema.js'
import { RulebookStore, normalizeIntent, slugify } from './rulebook.js'
import type { Recipe } from './verdict.js'

const boilSaltRecipe: Recipe = {
  id: 'recipe:boil_salt',
  name: 'Boil River Water for Salt',
  durationTicks: 6,
  costs: [{ kind: 'firewood', qty: 1 }],
  requires: [{ type: 'held_item', kind: 'clay_pot', qty: 1 }],
  outcomeTable: [
    {
      weight: 1,
      success: true,
      label: 'The water boils away, leaving a crust of salt.',
      effects: [{ op: 'spawn_item', kind: 'salt', qty: 1 }],
    },
    {
      weight: 1,
      success: false,
      label: 'The pot cracks and the water is lost.',
      effects: [{ op: 'none' }],
    },
  ],
  rngStream: 'craft',
  canon: ['fire'],
}

function makeStore(): { db: Database.Database; store: RulebookStore } {
  const db = openArbiterDb(':memory:')
  return { db, store: new RulebookStore(db) }
}

describe('normalizeIntent', () => {
  it("strips the leading 'I want to'", () => {
    expect(normalizeIntent('I want to eat')).toBe('eat')
  })

  it('collapses whitespace and lowercases', () => {
    expect(normalizeIntent('   Boil  River   Water ')).toBe('boil river water')
  })

  it('strips trailing punctuation', () => {
    expect(normalizeIntent('Attack Omar!!')).toBe('attack omar')
  })
})

describe('slugify', () => {
  it('slugs a phrase to snake_case', () => {
    expect(slugify('Boil River Water for Salt')).toBe('boil_river_water_for_salt')
  })
})

describe('RulebookStore', () => {
  it('insert then byId returns the row with verb and round-trippable recipeJson', () => {
    const { store } = makeStore()
    store.insert(boilSaltRecipe, 100)
    const row = store.byId('recipe:boil_salt')
    expect(row).not.toBeNull()
    expect(row!.verb).toBe('recipe:boil_salt')
    expect(row!.normalizedName).toBe('boil river water for salt')
    expect(JSON.parse(row!.recipeJson)).toEqual(boilSaltRecipe)
  })

  it('lookup matches an exact normalized intent and ignores rephrasing', () => {
    const { store } = makeStore()
    store.insert(boilSaltRecipe, 100)
    expect(store.lookup('  I TRY TO   Boil River Water for Salt!!  ')).not.toBeNull()
    expect(store.lookup('extract salt from the river')).toBeNull()
    expect(store.lookup('smelt copper')).toBeNull()
  })

  it('revert tombstones the row: lookup null, allActive excludes, byId still returns it', () => {
    const { store } = makeStore()
    store.insert(boilSaltRecipe, 100)
    store.revert('recipe:boil_salt', 'physics wrong', 500)
    expect(store.lookup('Boil River Water for Salt')).toBeNull()
    expect(store.allActive()).toEqual([])
    const row = store.byId('recipe:boil_salt')
    expect(row).not.toBeNull()
    expect(row!.revertedAtTick).toBe(500)
    expect(row!.revertedReason).toBe('physics wrong')
  })

  it('counts the minting as a use, and touch() moves the last use forward', () => {
    const { store } = makeStore()
    store.insert(boilSaltRecipe, 100)
    expect(store.byId('recipe:boil_salt')!.lastUsedTick).toBe(100)
    expect(store.unusedSince(101).map((r) => r.recipeId)).toEqual(['recipe:boil_salt'])
    store.touch('recipe:boil_salt', 500)
    expect(store.byId('recipe:boil_salt')!.lastUsedTick).toBe(500)
    expect(store.unusedSince(101)).toEqual([])
    expect(store.unusedSince(501)).toHaveLength(1)
    store.revert('recipe:boil_salt', 'gone', 600)
    expect(store.unusedSince(9999)).toEqual([])
  })

  it('reads a row minted before last use was kept as used at its minting', () => {
    const { db, store } = makeStore()
    db.exec('ALTER TABLE rulebook DROP COLUMN last_used_tick')
    db.prepare(
      `INSERT INTO rulebook (recipe_id, name, normalized_name, recipe_json, verb, tick)
       VALUES ('recipe:old', 'Old', 'old', '{}', 'recipe:old', 7)`,
    ).run()
    migrateArbiterTables(db)
    expect(store.byId('recipe:old')!.lastUsedTick).toBe(7)
  })

  it('throws on duplicate insert of the same recipeId (UNIQUE)', () => {
    const { store } = makeStore()
    store.insert(boilSaltRecipe, 100)
    expect(() => store.insert(boilSaltRecipe, 101)).toThrow(/UNIQUE/)
  })
})
