import { parseMaterialSetManifest } from '@sj/shared'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { AssetCodex } from '../src/codex.js'
import { openForgeDb } from '../src/db.js'
import { registerMaterialSet } from '../src/materialIngest.js'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    class: { type: 'string', default: 'building' },
    normal: { type: 'string' },
    roughness: { type: 'string' },
    emissive: { type: 'string' },
  },
})
const [database, kind, baseColor] = positionals
if (positionals.length !== 3 || !database || !kind || !baseColor)
  throw new Error(
    'Usage: import-material-set.ts <database> <kind> <baseColor.png> [--class building|terrain] [--normal file.png] [--roughness file.png] [--emissive file.png]',
  )
if (values.class !== 'building' && values.class !== 'terrain')
  throw new Error('--class must be building or terrain')
const maps = {
  baseColor: readFileSync(baseColor),
  ...(values.normal ? { normal: readFileSync(values.normal) } : {}),
  ...(values.roughness ? { roughness: readFileSync(values.roughness) } : {}),
  ...(values.emissive ? { emissive: readFileSync(values.emissive) } : {}),
}
const db = openForgeDb(database)
try {
  const record = await registerMaterialSet(new AssetCodex(db), { class: values.class, kind, maps })
  console.log(
    JSON.stringify(
      { id: record.id, kind: record.kind, material: parseMaterialSetManifest(record.meta) },
      null,
      2,
    ),
  )
} finally {
  db.close()
}
