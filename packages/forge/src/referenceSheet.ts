import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'reference')

// style-anchor.png (the human-designated canonical style reference) is ALWAYS refs[0]:
// first input_reference on every generation and first judge refSheet.
export function loadReferenceSheet(dir: string = DEFAULT_DIR): Buffer[] {
  let anchor: Buffer
  try { anchor = readFileSync(join(dir, 'style-anchor.png')) }
  catch { throw new Error(`missing ${dir}/style-anchor.png — the canonical style anchor (see style-bible.md 'Canonical style anchor')`) }
  return [anchor, ...[1, 2, 3].map(n => {
    try { return readFileSync(join(dir, `ref-${n}.png`)) }
    catch { throw new Error(`missing ${dir}/ref-${n}.png — run scripts/gen-reference-sheet.ts and curate 3 references (C5 Task 6)`) }
  })]
}
