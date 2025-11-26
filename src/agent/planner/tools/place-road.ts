/**
 * Place Road Tool
 *
 * Places a road sprite at a specific location with connectivity validation.
 * Unlike drawRoad, this requires the AI to specify the exact sprite ID.
 * The tool validates that connectivity matches neighbors and throws errors
 * if the placement would break connectivity rules.
 *
 * Architecture Decision:
 * - AI must know road sprites and their connections
 * - Tool validates connectivity, doesn't auto-select
 * - Provides helpful error messages with suggestions
 */

import { z } from 'zod';
import { tool } from 'ai';
import type { GridState } from '../../lib/grid-state';
import type { Direction, Sprite } from '../../types';

// Tool parameter schema
const PlaceRoadParamsSchema = z.object({
  x: z.number().int().describe('X coordinate for road placement'),
  y: z.number().int().describe('Y coordinate for road placement'),
  spriteId: z.string().describe('Exact road sprite ID (e.g., road_horizontal, road_corner_ne, road_t_north)'),
});

// Direction offset mappings
const DIRECTION_OFFSETS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

// Opposite directions
const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/**
 * Check if a sprite is a road sprite.
 */
function isRoadSprite(sprite: Sprite | undefined): boolean {
  if (!sprite) return false;
  const type = sprite.connectivity?.type;
  return type === 'path' || type === 'corner' || type === 'intersection' || type === 'cap';
}

/**
 * Get what connections a neighbor road expects from this cell.
 */
function getNeighborExpectations(
  grid: GridState,
  x: number,
  y: number
): { direction: Direction; neighborSprite: string }[] {
  const expectations: { direction: Direction; neighborSprite: string }[] = [];

  for (const [dir, offset] of Object.entries(DIRECTION_OFFSETS) as [Direction, { dx: number; dy: number }][]) {
    const nx = x + offset.dx;
    const ny = y + offset.dy;

    if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;

    const tile = grid.getTile(nx, ny, 'ground');
    if (!tile) continue;

    const sprite = grid.getSprite(tile.assetId);
    if (!sprite || !isRoadSprite(sprite)) continue;

    // Check if neighbor connects toward us
    const neighborConnects = sprite.connectivity?.connects ?? [];
    const oppositeDir = OPPOSITE_DIRECTION[dir];

    if (neighborConnects.includes(oppositeDir)) {
      expectations.push({ direction: dir, neighborSprite: tile.assetId });
    }
  }

  return expectations;
}

/**
 * Find a road sprite that would satisfy the given connectivity requirements.
 */
function suggestCorrectSprite(grid: GridState, neededConnections: Direction[]): string | null {
  const matches = grid.getSpritesWithConnections(neededConnections);
  const roadMatches = matches.filter((s) => s.category === 'ground' && isRoadSprite(s));

  if (roadMatches.length > 0) {
    return roadMatches[0]?.id ?? null;
  }

  return null;
}

/**
 * State tracker for road budget across multiple calls.
 */
interface RoadBudgetTracker {
  tilesPlaced: number;
  maxTiles: number;
}

/**
 * Create the placeRoad tool bound to a GridState instance.
 */
export function createPlaceRoadTool(
  grid: GridState,
  maxRoadTiles: number,
  verbose = false
) {
  const tracker: RoadBudgetTracker = {
    tilesPlaced: 0,
    maxTiles: maxRoadTiles,
  };

  return tool({
    description: `Place a road sprite at a specific location. You must specify the exact sprite ID. The tool validates connectivity - the sprite's connections must match adjacent roads. Road budget: ${maxRoadTiles} tiles max.`,
    inputSchema: PlaceRoadParamsSchema,
    execute: async ({ x, y, spriteId }: { x: number; y: number; spriteId: string }) => {
      // Validate bounds
      if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) {
        return {
          success: false,
          error: `Position (${x}, ${y}) is out of bounds. Map is ${grid.width}x${grid.height}.`,
        };
      }

      // Check budget
      if (tracker.tilesPlaced >= tracker.maxTiles) {
        return {
          success: false,
          error: `Road budget exhausted. Max ${tracker.maxTiles} tiles.`,
          budgetRemaining: 0,
        };
      }

      // Validate sprite exists
      const sprite = grid.getSprite(spriteId);
      if (!sprite) {
        const roadSprites = grid.getRoadSprites();
        const suggestions = roadSprites.slice(0, 8).map((s) => s.id).join(', ');

        return {
          success: false,
          error: `Unknown sprite: "${spriteId}".`,
          availableRoadSprites: suggestions,
        };
      }

      // Validate it's a road sprite
      if (!isRoadSprite(sprite)) {
        return {
          success: false,
          error: `"${spriteId}" is not a road sprite. Use placeAsset for other tiles.`,
        };
      }

      // Get what this sprite connects to
      const spriteConnects = sprite.connectivity?.connects ?? [];

      // Get what adjacent roads expect from this cell
      const neighborExpectations = getNeighborExpectations(grid, x, y);

      // Check if sprite satisfies all neighbor expectations
      const missingConnections: Direction[] = [];
      for (const expectation of neighborExpectations) {
        if (!spriteConnects.includes(expectation.direction)) {
          missingConnections.push(expectation.direction);
        }
      }

      if (missingConnections.length > 0) {
        // Find what sprite would work
        const neededConnections = neighborExpectations.map((e) => e.direction);
        const suggestedSprite = suggestCorrectSprite(grid, neededConnections);

        return {
          success: false,
          error: `Connectivity mismatch. "${spriteId}" connects [${spriteConnects.join(', ')}] but needs to connect [${neededConnections.join(', ')}] to match adjacent roads.`,
          missingConnections,
          neighborExpectations: neighborExpectations.map((e) => `${e.direction}: ${e.neighborSprite}`),
          suggestion: suggestedSprite ? `Try "${suggestedSprite}" instead.` : undefined,
        };
      }

      // Check for extra connections that point to non-roads (warning, not error)
      const warnings: string[] = [];
      for (const dir of spriteConnects) {
        const offset = DIRECTION_OFFSETS[dir];
        const nx = x + offset.dx;
        const ny = y + offset.dy;

        // Skip out of bounds (edge of map is OK)
        if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;

        const neighborTile = grid.getTile(nx, ny, 'ground');
        if (neighborTile) {
          const neighborSprite = grid.getSprite(neighborTile.assetId);
          if (neighborSprite && !isRoadSprite(neighborSprite)) {
            warnings.push(`Connection ${dir} points to non-road tile "${neighborTile.assetId}"`);
          }
        }
      }

      // Place the road
      try {
        grid.setTile(x, y, spriteId, 'ground');
        tracker.tilesPlaced++;

        if (verbose) {
          console.log(`[placeRoad] Placed ${spriteId} at (${x}, ${y}) with connections [${spriteConnects.join(', ')}]`);
        }

        return {
          success: true,
          placed: {
            x,
            y,
            spriteId,
            connections: spriteConnects,
          },
          budgetRemaining: tracker.maxTiles - tracker.tilesPlaced,
          warnings: warnings.length > 0 ? warnings : undefined,
          groundLayer: grid.toASCII().ground,
          objectsLayer: grid.toASCII().objects,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to place ${spriteId} at (${x}, ${y}): ${error}`,
        };
      }
    },
  });
}
