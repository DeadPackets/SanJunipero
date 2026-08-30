// The art of the town, in three parts, and only the first is on a stream's path.
//
// This barrel is the light one: the codex, the committed library, tile and atlas maths, and the
// post-processing a running town needs. `@sj/forge/gen` is a SEPARATE entry point holding 9.7 MB
// of LLM SDK — the live path reaches it, nothing else may. `scripts/` is the offline art
// pipeline, human-run one-shots; the `gen-*` ones spend real money.

// Budget, config, and the offline pipeline's own spend ledger.
export * from './budget.js'
export * from './forgeConfig.js'
export * from './spendLedger.js'

// Drawing surfaces: the committed library, sheets, atlases and tiles.
export * from './library/catalog.js'
export * from './library/register.js'
export * from './roadTiles.js'
export * from './alignment.js'
export * from './palette.js'
export * from './styleBible.js'

// Post-processing every generated image goes through.
export * from './post/raw.js'
export * from './post/chromaKey.js'
export * from './tints.js'
export * from './post/quantize.js'
export * from './post/postProcess.js'

// The gates a generated image must pass, and the reference sheet it is judged against.
export * from './gate.js'
export * from './pixelGates.js'
export * from './referenceSheet.js'

// The asset database, the codex of what the town has art for, and the manifests.
export * from './db.js'
export * from './codex.js'
export * from './placeholder.js'
export type { Forge } from './forge.js'
export * from './terrainManifest.js'
export * from './emotes.js'

// Character sheets, poses and the walk cycle the viewer animates.
export {
  FACINGS,
  POSES_V2,
  WALK_POSES_V2,
  STRIP_POSES_V2,
  CELL_V2,
  FEET_Y_V2,
  SHEET_W_V2,
  SHEET_H_V2,
  type Facing,
  type PoseV2,
} from './sheet.js'
export { packCharacterAtlas } from './atlasV4.js'
export { CELL_NAMES_V4, WALK_CYCLE_V4, WALK_FRAME_MS } from './mirror.js'
export { cellAnchor, processHiResCell } from './hires.js'

// Terrain and building art: generated ground, ramps, ploughed rows, interiors, coverage.
export * from './reCell.js'
export * from './ramps.js'
export * from './plough.js'
export * from './terrainTiles.js'
export * from './terrainGen.js'
export * from './terrainIngest.js'
export * from './buildingArt.js'
export * from './structureArt.js'
export * from './library/committed.js'
export * from './interiorArt.js'
export * from './castArt.js'
export * from './artCoverage.js'
