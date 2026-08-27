// The live half's one entry. `serve.ts` imports it dynamically behind SJ_LIVE=1, which is what
// keeps the mind stack and the `ai` SDK off the scripted path.
export { createLiveCast } from './liveWorld.js'
