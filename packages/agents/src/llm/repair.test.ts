import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { repairCandidates, repairToSchema } from './repair.js'

// The chronicle schema the narrator asks for, verbatim — this is the decode that failed on
// a live night and cost the run a criterion.
const Chapter = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  citations: z.array(z.number().int().nonnegative()).max(40),
}).strict()

const GOOD = { title: 'A Grave at the Northern Ford', text: 'At the fork where the water bends.', citations: [4, 9] }
const asJson = JSON.stringify(GOOD)

describe('repairToSchema: the shape is repaired, the content never is', () => {
  it('reads the JSON out of the prose written before it (Baidu, 12 of 13 dead calls in batch 14)', () => {
    const out = repairToSchema(`Here is the chapter you asked for:\n\n${asJson}`, Chapter)
    expect(out?.value).toEqual(GOOD)
  })

  it('reads it out of a fenced block', () => {
    const out = repairToSchema('```json\n' + asJson + '\n```', Chapter)
    expect(out?.value).toEqual(GOOD)
  })

  it('reads it with prose on both sides, and past a brace in the prose', () => {
    const out = repairToSchema(`I considered {a shorter title} first. Final answer:\n${asJson}\nHope that helps.`, Chapter)
    expect(out?.value).toEqual(GOOD)
  })

  it('unwraps an answer the provider quoted as a whole string', () => {
    expect(repairToSchema(JSON.stringify(asJson), Chapter)?.value).toEqual(GOOD)
  })

  it('drops a trailing comma without touching one inside a sentence', () => {
    const withComma = '{"title":"A Grave","text":"the stores went bad, }","citations":[4,9,],}'
    const out = repairToSchema(withComma, Chapter)
    expect(out?.value.text).toBe('the stores went bad, }')
    expect(out?.value.citations).toEqual([4, 9])
  })

  it('drops a key the strict schema does not model, and changes nothing else', () => {
    const out = repairToSchema(JSON.stringify({ ...GOOD, day: 3, model: 'ernie' }), Chapter)
    expect(out?.value).toEqual(GOOD)
  })

  it('reads a citation the provider quoted as a string, when the string is exactly the number', () => {
    const out = repairToSchema(JSON.stringify({ ...GOOD, citations: ['4', '9'] }), Chapter)
    expect(out?.value.citations).toEqual([4, 9])
  })

  it('names the repair it took, so a repaired call is never a silent one', () => {
    expect(repairToSchema(`prose\n${asJson}`, Chapter)?.how).toMatch(/braced/)
  })

  it('leaves a payload that already fits alone', () => {
    expect(repairToSchema(asJson, Chapter)?.how).toBe('as-written')
  })
})

describe('repairToSchema: it refuses rather than guesses', () => {
  it('will not supply a required field the provider never wrote', () => {
    expect(repairToSchema(JSON.stringify({ title: 'A Grave', text: 'the water bends' }), Chapter)).toBeUndefined()
  })

  it('will not read a number out of a string that is not one', () => {
    expect(repairToSchema(JSON.stringify({ ...GOOD, citations: ['4 events'] }), Chapter)).toBeUndefined()
  })

  it('will not truncate a citation list the schema caps', () => {
    const tooMany = { ...GOOD, citations: Array.from({ length: 41 }, (_, i) => i) }
    expect(repairToSchema(JSON.stringify(tooMany), Chapter)).toBeUndefined()
  })

  it('has nothing to say about a payload with no JSON in it at all', () => {
    expect(repairToSchema('I could not write that chapter.', Chapter)).toBeUndefined()
    expect(repairCandidates('I could not write that chapter.')).toEqual([])
  })

  // The known gap, pinned: a correct turn emitted as YAML is a different serialisation, not a
  // reframing, and reading it needs a parser this pass deliberately does not have.
  it('does not pretend to read YAML', () => {
    const yaml = 'title: A Grave at the Northern Ford\ntext: At the fork where the water bends.\ncitations:\n  - 4\n  - 9\n'
    expect(repairToSchema(yaml, Chapter)).toBeUndefined()
  })
})
