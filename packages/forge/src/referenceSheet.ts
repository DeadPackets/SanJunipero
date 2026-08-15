import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'reference')

export function loadReferenceSheet(dir: string = DEFAULT_DIR): Buffer[] {
  return [1, 2, 3].map(n => {
    try { return readFileSync(join(dir, `ref-${n}.png`)) }
    catch { throw new Error(`missing ${dir}/ref-${n}.png — run scripts/gen-reference-sheet.ts and curate 3 references (C5 Task 6)`) }
  })
}
