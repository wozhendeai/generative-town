/**
 * Primitive type schemas shared across type definitions.
 *
 * Architecture Decision:
 * - Extracted to separate file to avoid circular dependencies
 * - types.ts and design-plan.ts both import from here
 * - This file should NOT import from ../types or sibling files
 */

import { z } from 'zod';

// Direction enum for connectivity
export const DirectionSchema = z.enum(['north', 'south', 'east', 'west']);
export type Direction = z.infer<typeof DirectionSchema>;

// Sprite categories
export const SpriteCategorySchema = z.enum([
  'ground',   // Floor tiles (roads, grass, water, etc.)
  'building', // Structures (houses, shops, etc.)
  'prop',     // Objects (trees, benches, vending machines)
  'wall',     // Blocking elements (fences, railings)
  'marker',   // Game logic markers (spawn points, teleports)
]);
export type SpriteCategory = z.infer<typeof SpriteCategorySchema>;

// Connectivity types for path-building logic
export const ConnectivityTypeSchema = z.enum([
  'none',         // Solid tile, no connections
  'path',         // Connects two opposite directions (straight road)
  'edge',         // Border tile (water edge, wall segment)
  'corner',       // Connects two perpendicular directions
  'intersection', // Connects 3+ directions
  'cap',          // Connects only one direction (dead end)
]);
export type ConnectivityType = z.infer<typeof ConnectivityTypeSchema>;
