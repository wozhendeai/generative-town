/**
 * Fill Ground Tool
 *
 * Fills a rectangular region with a specific ground tile.
 * Preserves existing ground tiles (like roads) unless forced.
 */

import { z } from 'zod';
import { tool } from 'ai';
import type { GridState } from '../../lib/grid-state';

// Tool parameter schema - uses x1,y1 to x2,y2 coordinate format
const FillGroundParamsSchema = z.object({
  x1: z.number().int().describe('Start X coordinate'),
  y1: z.number().int().describe('Start Y coordinate'),
  x2: z.number().int().describe('End X coordinate (inclusive)'),
  y2: z.number().int().describe('End Y coordinate (inclusive)'),
  groundTileId: z.string().describe('Ground tile ID to fill with'),
  overwrite: z.boolean().optional().describe('Overwrite existing tiles (default: false, preserves roads)'),
});

/**
 * Create the fillGround tool bound to a GridState instance.
 */
export function createFillGroundTool(grid: GridState, verbose = false) {
  return tool({
    description: 'Fill a rectangular region from (x1,y1) to (x2,y2) with a ground tile. By default, preserves existing ground (like roads). Example: fillGround(0,0,4,4,"ground_sidewalk") fills a 5x5 area.',
    inputSchema: FillGroundParamsSchema,
    execute: async ({ x1, y1, x2, y2, groundTileId, overwrite = false }: { x1: number; y1: number; x2: number; y2: number; groundTileId: string; overwrite?: boolean }) => {
      // Validate sprite exists
      const sprite = grid.getSprite(groundTileId);
      if (!sprite) {
        // Try to find similar sprites for suggestion
        const groundSprites = grid.getSpritesByCategory('ground');
        const suggestions = groundSprites
          .slice(0, 5)
          .map((s) => s.id)
          .join(', ');

        return {
          success: false,
          error: `Unknown sprite: "${groundTileId}". Available ground tiles: ${suggestions}`,
        };
      }

      // Validate it's a ground tile
      if (sprite.category !== 'ground') {
        return {
          success: false,
          error: `"${groundTileId}" is not a ground tile (category: ${sprite.category}). Use placeAsset for objects.`,
        };
      }

      // Normalize coordinates (handle x1 > x2 or y1 > y2)
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);

      // Clamp region to grid bounds
      const clampedStartX = Math.max(0, minX);
      const clampedStartY = Math.max(0, minY);
      const clampedEndX = Math.min(grid.width - 1, maxX);
      const clampedEndY = Math.min(grid.height - 1, maxY);

      let tilesFilled = 0;
      let tilesSkipped = 0;

      // Inclusive loop (x2, y2 are included)
      for (let y = clampedStartY; y <= clampedEndY; y++) {
        for (let x = clampedStartX; x <= clampedEndX; x++) {
          // Check if tile already has ground
          const existing = grid.getTile(x, y, 'ground');

          if (existing && !overwrite) {
            tilesSkipped++;
            continue;
          }

          try {
            grid.setTile(x, y, groundTileId, 'ground');
            tilesFilled++;

            if (verbose) {
              console.log(`[fillGround] Placed ${groundTileId} at (${x}, ${y})`);
            }
          } catch (error) {
            // Shouldn't happen since we validated sprite exists
            if (verbose) {
              console.warn(`[fillGround] Failed at (${x}, ${y}): ${error}`);
            }
          }
        }
      }

      return {
        success: true,
        tilesFilled,
        tilesSkipped,
        region: {
          x1: clampedStartX,
          y1: clampedStartY,
          x2: clampedEndX,
          y2: clampedEndY,
        },
        groundLayer: grid.toASCII().ground,
        objectsLayer: grid.toASCII().objects,
      };
    },
  });
}
