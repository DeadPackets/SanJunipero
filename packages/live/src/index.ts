// The live half's one entry. `serve.ts` imports it dynamically behind SJ_LIVE=1, which is what
// keeps `@sj/agents` and its 128 MB sentence-transformer off the scripted path.
export { createLiveCast } from './liveWorld.js'
