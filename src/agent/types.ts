import { z } from 'zod';
import { GRID_CONFIG, DERIVED_CONFIG } from './config';
import {
  DirectionSchema,
  SpriteCategorySchema,
  ConnectivityTypeSchema,
} from './types/primitives';

// Re-export primitives from shared module (avoids circular dependencies)
export {
  DirectionSchema,
  SpriteCategorySchema,
  ConnectivityTypeSchema,
  type Direction,
  type SpriteCategory,
  type ConnectivityType,
} from './types/primitives';

// Placement configuration
export const PlacementSchema = z.object({
  layer: z.enum(['ground', 'object']).default('ground'),
  walkable: z.boolean().default(true),
  anchor: z.enum(['top_left', 'bottom_center', 'center']).default('top_left'),
});

// Connectivity configuration - critical for path-building tools
export const ConnectivitySchema = z.object({
  type: ConnectivityTypeSchema,
  connects: z.array(DirectionSchema).default([]),
  // For edges: which side has the "content" (water, wall interior)
  contentSide: DirectionSchema.optional(),
});

// Enhanced sprite metadata - semantic, not tag-based
export const SpriteSchema = z.object({
  id: z.string(),
  category: SpriteCategorySchema,

  // Grid position on spritesheet (uses DERIVED_CONFIG for bounds)
  col: z.number().int().min(0).max(DERIVED_CONFIG.columns - 1),
  row: z.number().int().min(0).max(DERIVED_CONFIG.rows - 1),
  w: z.number().int().min(1).max(4).default(1),  // width in tiles
  h: z.number().int().min(1).max(4).default(1),  // height in tiles

  // Semantic description for LLM understanding
  description: z.string().describe('What this sprite depicts'),

  // Placement logic
  placement: PlacementSchema,

  // Connectivity - critical for roads, walls, water edges
  connectivity: ConnectivitySchema.default({ type: 'none', connects: [] }),

  // Variants - what other sprites can substitute
  variants: z.array(z.string()).optional(),
});

export const SpritesheetMetadataSchema = z.object({
  theme: z.string().describe('Visual theme of this spritesheet'),
  tileSize: z.number(),
  columns: z.number(),
  rows: z.number(),
  sprites: z.array(SpriteSchema),
  // Scene description for visual consistency across Designer → Planner pipeline
  sceneDescription: z
    .string()
    .optional()
    .describe('Full creative scene description from Designer for Planner context'),
});

// Map cell - reference to a sprite on the map
export const MapCellSchema = z.object({
  assetId: z.string(),
  rotation: z.number().optional(), // 0, 90, 180, 270
  layer: z.enum(['ground', 'object']).default('ground'),
});

// Full map output
export const MapSchema = z.object({
  width: z.number(),
  height: z.number(),
  layers: z.object({
    ground: z.array(z.array(MapCellSchema.nullable())),
    objects: z.array(z.array(MapCellSchema.nullable())),
  }),
});

// TypeScript types inferred from Zod schemas
export type Sprite = z.infer<typeof SpriteSchema>;
export type SpritesheetMetadata = z.infer<typeof SpritesheetMetadataSchema>;
export type MapCell = z.infer<typeof MapCellSchema>;
export type GameMap = z.infer<typeof MapSchema>;
export type Placement = z.infer<typeof PlacementSchema>;
export type Connectivity = z.infer<typeof ConnectivitySchema>;

// Note: design-plan, sprite-requirement, and ground-plan types are
// no longer used after the Designer simplification.
