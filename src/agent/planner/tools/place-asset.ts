/**
 * Place Asset Tool
 *
 * Places buildings, props, and other objects on the map.
 * Supports both single placement and batch placement.
 */

import { z } from 'zod';
import { tool } from 'ai';
import type { GridState } from '../../lib/grid-state';

// Single placement schema
const PlaceAssetParamsSchema = z.object({
  x: z.number().int().describe('X coordinate for asset placement'),
  y: z.number().int().describe('Y coordinate for asset placement'),
  assetId: z.string().describe('ID of the asset to place (building, prop, marker, etc.)'),
  layer: z.enum(['ground', 'object']).optional().describe('Layer to place on. Default: auto-detect from sprite metadata'),
});

// Batch placement schema
const PlaceAssetsParamsSchema = z.object({
  placements: z.array(
    z.object({
      x: z.number().int(),
      y: z.number().int(),
      assetId: z.string(),
      layer: z.enum(['ground', 'object']).optional(),
    })
  ).min(1).describe('Array of assets to place'),
});

/**
 * Create the placeAsset tool bound to a GridState instance.
 */
export function createPlaceAssetTool(grid: GridState, verbose = false) {
  return tool({
    description: 'Place a single asset (building, prop, marker) at a specific location. The layer is auto-detected from sprite metadata. Use for trees, benches, buildings, etc.',
    inputSchema: PlaceAssetParamsSchema,
    execute: async ({ x, y, assetId, layer }: { x: number; y: number; assetId: string; layer?: 'ground' | 'object' }) => {
      // Validate bounds
      if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) {
        return {
          success: false,
          error: `Position (${x}, ${y}) is out of bounds. Map is ${grid.width}x${grid.height}.`,
        };
      }

      // Validate sprite exists
      const sprite = grid.getSprite(assetId);
      if (!sprite) {
        // Find similar sprites for suggestion
        const allSprites = [
          ...grid.getSpritesByCategory('building'),
          ...grid.getSpritesByCategory('prop'),
          ...grid.getSpritesByCategory('marker'),
        ];
        const suggestions = allSprites
          .slice(0, 5)
          .map((s) => `${s.id} (${s.category})`)
          .join(', ');

        return {
          success: false,
          error: `Unknown asset: "${assetId}". Available: ${suggestions}`,
        };
      }

      // Determine layer from sprite metadata if not specified
      const targetLayer = layer ?? sprite.placement.layer;

      // For object layer, check that ground exists
      if (targetLayer === 'object') {
        const groundTile = grid.getTile(x, y, 'ground');
        if (!groundTile) {
          return {
            success: false,
            error: `Cannot place object at (${x}, ${y}): no ground tile exists. Use fillGround first.`,
          };
        }
      }

      // Check for existing object at location (prevent overlap)
      if (targetLayer === 'object') {
        const existing = grid.getTile(x, y, 'object');
        if (existing) {
          return {
            success: false,
            error: `Position (${x}, ${y}) already has an object: ${existing.assetId}`,
          };
        }
      }

      try {
        grid.setTile(x, y, assetId, targetLayer);

        if (verbose) {
          console.log(`[placeAsset] Placed ${assetId} at (${x}, ${y}) on ${targetLayer} layer`);
        }

        return {
          success: true,
          placed: {
            x,
            y,
            assetId,
            layer: targetLayer,
            sprite: {
              category: sprite.category,
              width: sprite.w,
              height: sprite.h,
              walkable: sprite.placement.walkable,
            },
          },
          groundLayer: grid.toASCII().ground,
          objectsLayer: grid.toASCII().objects,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to place ${assetId} at (${x}, ${y}): ${error}`,
        };
      }
    },
  });
}

/**
 * Create a batch version of the placeAsset tool for efficiency.
 */
export function createPlaceAssetsTool(grid: GridState, verbose = false) {
  return tool({
    description: 'Place multiple assets in a single call. More efficient than multiple placeAsset calls. Each placement specifies position and asset ID.',
    inputSchema: PlaceAssetsParamsSchema,
    execute: async ({ placements }: { placements: Array<{ x: number; y: number; assetId: string; layer?: 'ground' | 'object' }> }) => {
      const results: Array<{
        x: number;
        y: number;
        assetId: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const p of placements) {
        // Validate bounds
        if (p.x < 0 || p.x >= grid.width || p.y < 0 || p.y >= grid.height) {
          results.push({
            ...p,
            success: false,
            error: `Out of bounds`,
          });
          continue;
        }

        // Validate sprite
        const sprite = grid.getSprite(p.assetId);
        if (!sprite) {
          results.push({
            ...p,
            success: false,
            error: `Unknown asset`,
          });
          continue;
        }

        const targetLayer = p.layer ?? sprite.placement.layer;

        // Check ground exists for objects
        if (targetLayer === 'object' && !grid.getTile(p.x, p.y, 'ground')) {
          results.push({
            ...p,
            success: false,
            error: `No ground at location`,
          });
          continue;
        }

        // Check for existing object
        if (targetLayer === 'object' && grid.getTile(p.x, p.y, 'object')) {
          results.push({
            ...p,
            success: false,
            error: `Position occupied`,
          });
          continue;
        }

        try {
          grid.setTile(p.x, p.y, p.assetId, targetLayer);
          results.push({ ...p, success: true });

          if (verbose) {
            console.log(`[placeAssets] Placed ${p.assetId} at (${p.x}, ${p.y})`);
          }
        } catch (error) {
          results.push({
            ...p,
            success: false,
            error: String(error),
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      return {
        success: failCount === 0,
        placed: successCount,
        failed: failCount,
        results,
      };
    },
  });
}
