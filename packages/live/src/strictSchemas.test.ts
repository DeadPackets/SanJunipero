import { describe, expect, it } from 'vitest'
import { strictSchemaFaults } from '@sj/shared'
import {
  CloseAnswerSchema,
  DAY_SUMMARY_SCHEMA,
  DREAM_SCHEMA,
  FACTS_SCHEMA,
  LEDGER_SCHEMA,
  PARAGRAPH_SCHEMA,
  ProposeEditSchema,
  SCENES_SCHEMA,
  SceneTurnSchema,
  StrictTurnSchema,
  TIES_SCHEMA,
} from '@sj/agents'
import {
  ClassificationSchema,
  ExpressiveRulingSchema,
  StrictLawCompileSchema,
  StrictVerdictSchema,
} from '@sj/arbiter'
import {
  BiographySchema,
  ChapterSummarySchema,
  EraSummarySchema,
  NewspaperCopySchema,
  SemanticVerdictSchema,
} from '@sj/narrator'

// r21 put the whole town on an OpenAI model: two answers the fleet had used for weeks were refused
// on sight, 12 of 12 personality edits and 3 of 3 semantic passes, 282 alerts. Every shape the
// town asks a model for is checked here against the one decoder that refuses rather than bends.
type Shape = Parameters<typeof strictSchemaFaults>[0]
const SHAPES: [string, Shape][] = [
  ['turn', StrictTurnSchema],
  ['scene', SceneTurnSchema],
  ['scene.close', CloseAnswerSchema],
  ['reflection.facts', FACTS_SCHEMA],
  ['reflection.scenes', SCENES_SCHEMA],
  ['reflection.day', DAY_SUMMARY_SCHEMA],
  ['reflection.ledger', LEDGER_SCHEMA],
  ['reflection.ties', TIES_SCHEMA],
  ['reflection.paragraph', PARAGRAPH_SCHEMA],
  ['reflection.edit', ProposeEditSchema],
  ['dream', DREAM_SCHEMA],
  ['arbiter', StrictVerdictSchema],
  ['law.compile', StrictLawCompileSchema],
  ['expressive', ExpressiveRulingSchema],
  ['constructs', ClassificationSchema],
  ['semantic', SemanticVerdictSchema],
  ['narrator.copy', NewspaperCopySchema],
  ['narrator.biography', BiographySchema],
  ['narrator.chapter', ChapterSummarySchema],
  ['narrator.era', EraSummarySchema],
]

describe('★ every shape the town asks a model for fits a strict decoder', () => {
  it.each(SHAPES)('%s', (_name, schema) => {
    expect(strictSchemaFaults(schema)).toEqual([])
  })
})
