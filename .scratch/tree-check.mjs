// Structural guard for docs/superpowers/content/c8-discovery-tree.md.
// Asserts: field order, era validity, DAG-ness, no forward citations, and — the one that
// actually bites — that the genesis-reachable set is exactly the five the canon landed.
import { readFileSync } from 'node:fs'

const ERAS = ['handwork', 'arrangement', 'works', 'machinery', 'industry']
const ORDER = Object.fromEntries(ERAS.map((e, i) => [e, i + 1]))
const FIELDS = ['id', 'name', 'era', 'prereqs', 'skill', 'conditions', 'unlocks', 'desc']

const LANDED_HANDWORK = ['farming', 'fishing', 'foraging', 'carpentry', 'masonry', 'tailoring', 'cooking', 'machine_repair']
const LANDED_ARRANGEMENT = { work_rota: 'farming', common_store: 'farming', food_preserving: 'cooking', memorial: 'masonry', bridging: 'carpentry' }

const text = readFileSync(process.argv[2], 'utf8')
const blocks = text.split('\n### node').slice(1)
const nodes = []
const fail = []

for (const raw of blocks) {
  const [head, ...rest] = raw.split('\n')
  const social = head.trim() === '[SOCIAL]'
  if (head.trim() !== '' && !social) fail.push(`bad node header: "### node${head}"`)
  const seen = []
  const f = {}
  for (const line of rest) {
    const m = /^- (id|name|era|prereqs|skill|conditions|unlocks|desc): (.*)$/.exec(line)
    if (!m) continue
    seen.push(m[1]); f[m[1]] = m[2].trim()
  }
  if (seen.join(',') !== FIELDS.join(',')) fail.push(`${f.id ?? '?'}: field order is [${seen}]`)
  const prereqs = f.prereqs === '(none)' ? [] : f.prereqs.split(',').map((s) => s.trim())
  nodes.push({ id: f.id, era: f.era, prereqs, social, skill: f.skill })
}

const byId = new Map(nodes.map((n) => [n.id, n]))
if (byId.size !== nodes.length) fail.push('duplicate ids present')

for (const n of nodes) {
  if (!ORDER[n.era]) fail.push(`${n.id}: unknown era "${n.era}"`)
  for (const p of n.prereqs) {
    const parent = byId.get(p)
    if (!parent) { fail.push(`${n.id}: prereq "${p}" is not a node`); continue }
    if (ORDER[parent.era] > ORDER[n.era]) fail.push(`${n.id} (${n.era}) cites later-era ${p} (${parent.era})`)
  }
}

// cycles, by iterative topological peel
const remaining = new Set(nodes.map((n) => n.id))
let peeled = true
while (peeled) {
  peeled = false
  for (const id of [...remaining]) {
    if (byId.get(id).prereqs.every((p) => !remaining.has(p))) { remaining.delete(id); peeled = true }
  }
}
if (remaining.size > 0) fail.push(`cycle among: ${[...remaining].join(', ')}`)

// THE genesis assertion: reachable at genesis == every prereq is a practised craft.
const practised = new Set(LANDED_HANDWORK)
const genesisReachable = nodes
  .filter((n) => n.era !== 'handwork' && n.prereqs.length > 0 && n.prereqs.every((p) => practised.has(p)))
  .map((n) => n.id).sort()
const expected = Object.keys(LANDED_ARRANGEMENT).sort()
if (genesisReachable.join(',') !== expected.join(','))
  fail.push(`genesis frontier is [${genesisReachable}], canon says [${expected}]`)

// the thirteen landed ids, exactly, as the first two rungs
const handwork = nodes.filter((n) => n.era === 'handwork')
if (handwork.map((n) => n.id).join(',') !== LANDED_HANDWORK.join(','))
  fail.push(`handwork rung is [${handwork.map((n) => n.id)}]`)
for (const n of handwork) if (n.prereqs.length > 0) fail.push(`${n.id}: a practised craft must have no prereqs`)
for (const [id, prereq] of Object.entries(LANDED_ARRANGEMENT)) {
  const n = byId.get(id)
  if (!n) { fail.push(`landed id ${id} missing`); continue }
  if (n.era !== 'arrangement') fail.push(`${id}: era is ${n.era}, canon says arrangement`)
  if (n.prereqs.join(',') !== prereq) fail.push(`${id}: prereqs are [${n.prereqs}], canon says ${prereq}`)
}

const counts = Object.fromEntries(ERAS.map((e) => [e, nodes.filter((n) => n.era === e).length]))
const social = nodes.filter((n) => n.social).length
console.log(`nodes: ${nodes.length}   ${ERAS.map((e) => `${e}=${counts[e]}`).join(' ')}`)
console.log(`[SOCIAL]: ${social} of ${nodes.length} (${(100 * social / nodes.length).toFixed(1)}%)`)
console.log(`social by era: ${ERAS.map((e) => `${e}=${nodes.filter((n) => n.era === e && n.social).length}`).join(' ')}`)
console.log(`handwork rung (8 landed): ${handwork.map((n) => n.id).join(', ')}`)
console.log(`genesis frontier (5 landed): ${genesisReachable.join(', ')}`)
// Claims are printed only once they have survived. A summary line above a FAIL block is the
// kind of guard that asserts nothing, which is the failure mode this file exists to avoid.
if (fail.length) { console.log('\nFAIL:'); for (const f of fail) console.log(`  - ${f}`); process.exit(1) }
console.log(`DAG: acyclic, no forward citations, ${nodes.length} nodes topologically ordered`)
console.log('\nPASS: every check above holds.')
