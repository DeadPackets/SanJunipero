// OFFLINE — zero API spend. Contact sheet of the 12 authored emotes: 4×3 grid at 4x
// so a human can eyeball them, written to the durable session scratchpad.
import { mkdirSync, writeFileSync } from 'node:fs'
import { encodePng } from '../src/post/raw.js'
import { EMOTE_KINDS, EMOTE_SIZE, renderEmote } from '../src/emotes.js'
import { assembleGrid, upscaleNearest } from '../src/sheet.js'
import { scratch } from './scratch.js'

const OUT = scratch('c5', 'emotes')
mkdirSync(OUT, { recursive: true })

const COLS = 4,
  ROWS = 3
const grid = Array.from({ length: ROWS }, (_, r) =>
  Array.from({ length: COLS }, (_, c) => renderEmote(EMOTE_KINDS[r * COLS + c]!)),
)
const sheet = assembleGrid(grid, EMOTE_SIZE, EMOTE_SIZE)
writeFileSync(`${OUT}/emotes.png`, await encodePng(sheet))
writeFileSync(`${OUT}/emotes-4x.png`, await encodePng(upscaleNearest(sheet, 4)))
console.log(`wrote ${OUT}/emotes.png (${sheet.width}x${sheet.height}) and emotes-4x.png`)
console.log(`order: ${EMOTE_KINDS.join(', ')}`)
