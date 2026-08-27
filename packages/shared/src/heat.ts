/** One `/api/heat` row: how loud a stretch of ticks was around one person. Declared here because
 *  the gateway scores it and the viewer's director mode cuts on it. */
export type HeatWindow = { fromTick: number; toTick: number; agentId: string; score: number }
