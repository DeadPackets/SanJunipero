import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// Under `packages/forge/out`, which is gitignored, so a run never lands in `git status`.
const ROOT = process.env.SJ_SCRATCH ?? fileURLToPath(new URL('../out/scratch/', import.meta.url))

/** Where a forge script parks candidates, sheets and audit dumps. Override with `SJ_SCRATCH`. */
export const scratch = (...parts: string[]): string => join(ROOT, ...parts)
