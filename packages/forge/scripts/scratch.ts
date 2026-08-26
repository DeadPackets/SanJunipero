import { join } from 'node:path'

/** Where a forge script parks candidates, sheets and audit dumps. Untracked working ground,
 *  not a build output — point `SJ_SCRATCH` elsewhere to keep a run. */
export const SJ_SCRATCH = process.env.SJ_SCRATCH ?? 'out/scratch'

export const scratch = (...parts: string[]): string => join(SJ_SCRATCH, ...parts)
