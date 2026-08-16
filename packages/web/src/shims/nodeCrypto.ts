// Browser stand-in for node:crypto pulled in via @sj/shared's stateHash re-export.
// The observatory never hashes state client-side; calling it here is a bug.
export function createHash(): never {
  throw new Error('stateHash is server-side only — the observatory never hashes in the browser')
}
