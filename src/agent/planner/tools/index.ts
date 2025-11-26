/**
 * Tool Factory for Planner Agent
 *
 * Creates all tools bound to a shared GridState instance.
 *
 * Tools:
 * - placeRoad: Place road tiles with exact sprite ID (validates connectivity)
 * - fillGround: Fill rectangular regions with ground tiles (x1,y1 to x2,y2)
 * - placeAsset: Place buildings, props, markers
 * - connectRoads: Auto-fix disconnected road islands (safety net)
 * - viewMap: View current map state as ASCII
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { GridState } from '../../lib/grid-state';
import { createPlaceRoadTool } from './place-road';
import { createFillGroundTool } from './fill-ground';
import { createPlaceAssetTool } from './place-asset';
import { createConnectRoadsTool } from './connect-roads';

export interface ToolOptions {
  /** Maximum road tiles allowed (budget enforcement). Default: 20% of map */
  maxRoadTiles?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Create all planner tools bound to a GridState instance.
 *
 * @param grid - Mutable grid state shared across all tools
 * @param options - Configuration options
 * @returns Record of tool definitions for use with streamText
 */
export function createPlannerTools(grid: GridState, options: ToolOptions = {}) {
  const maxRoadTiles = options.maxRoadTiles ?? Math.floor(grid.width * grid.height * 0.2);

  return {
    placeRoad: createPlaceRoadTool(grid, maxRoadTiles, options.verbose),
    fillGround: createFillGroundTool(grid, options.verbose),
    placeAsset: createPlaceAssetTool(grid, options.verbose),
    connectRoads: createConnectRoadsTool(grid, options.verbose),
    viewMap: createViewMapTool(grid),
  };
}

// Schema for viewMap tool
const ViewMapParamsSchema = z.object({
  layer: z
    .enum(['ground', 'objects', 'both'])
    .describe('Which layer to view: ground, objects, or both'),
});

/**
 * Create viewMap tool for on-demand ASCII map visualization.
 */
export function createViewMapTool(grid: GridState) {
  return tool({
    description: 'View the current map state as ASCII grid. Use to see what has been placed.',
    inputSchema: ViewMapParamsSchema,
    execute: async ({ layer }: { layer: 'ground' | 'objects' | 'both' }) => {
      const ascii = grid.toASCII();

      if (layer === 'ground') {
        return { ground: ascii.ground };
      } else if (layer === 'objects') {
        return { objects: ascii.objects };
      } else {
        return ascii;
      }
    },
  });
}

// Re-export tool creators for individual use
export { createPlaceRoadTool } from './place-road';
export { createFillGroundTool } from './fill-ground';
export { createPlaceAssetTool } from './place-asset';
export { createConnectRoadsTool } from './connect-roads';
