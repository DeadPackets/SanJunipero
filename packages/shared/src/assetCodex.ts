import { z } from 'zod'

export const AssetClassSchema = z.enum(['building', 'item', 'crop', 'terrain', 'rig-part', 'portrait'])
export type AssetClass = z.infer<typeof AssetClassSchema>

export const FootprintSchema = z.object({
  w: z.number().int().min(1).max(4), h: z.number().int().min(1).max(4),
}).strict()
export type Footprint = z.infer<typeof FootprintSchema>

export const AssetRecordSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().positive(),
  class: AssetClassSchema,
  desc: z.string().min(1),
  footprint: FootprintSchema,
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  status: z.enum(['ready', 'placeholder']),
  score: z.number().min(1).max(10).nullable(),
  attempts: z.number().int().min(1).max(3),
  costUsd: z.number().min(0),
  createdAt: z.string(),
}).strict()
export type AssetRecord = z.infer<typeof AssetRecordSchema>
