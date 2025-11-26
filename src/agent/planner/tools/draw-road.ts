/**
 * Draw Road Tool
 *
 * Draws connected roads from point A to point B with automatic
 * sprite selection based on connectivity metadata.
 *
 * Architecture Decision:
 * - AI specifies WHERE roads go (creative decision)
 * - Tool determines WHICH sprite (mechanical based on connectivity)
 * - Automatically handles corners, intersections, caps
 * - Updates adjacent roads when new connections are made
 */

import { z } from 'zod';
import { tool } from 'ai';
import type { GridState } from '../../lib/grid-state';
import type { Direction, Sprite } from '../../types';

// Tool parameter schema
const DrawRoadParamsSchema = z.object({
  fromX: z.number().int().describe('Starting X coordinate'),
  fromY: z.number().int().describe('Starting Y coordinate'),
  toX: z.number().int().describe('Ending X coordinate'),
  toY: z.number().int().describe('Ending Y coordinate'),
});

// Direction offset mappings
const DIRECTION_OFFSETS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

// Opposite directions for connectivity checking
const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/**
 * Generate a Manhattan path from start to end.
 * Moves horizontally first, then vertically.
 */
function generateManhattanPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Array<{ x: number; y: number }> {
  const path: Array<{ x: number; y: number }> = [];
  let x = fromX;
  let y = fromY;

  // Move horizontally first
  while (x !== toX) {
    path.push({ x, y });
    x += x < toX ? 1 : -1;
  }

  // Then move vertically
  while (y !== toY) {
    path.push({ x, y });
    y += y < toY ? 1 : -1;
  }

  // Add final point
  path.push({ x: toX, y: toY });

  return path;
}

/**
 * Get the direction from one point to an adjacent point.
 */
function getDirectionBetween(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Direction | null {
  const dx = toX - fromX;
  const dy = toY - fromY;

  if (dx === 1 && dy === 0) return 'east';
  if (dx === -1 && dy === 0) return 'west';
  if (dx === 0 && dy === 1) return 'south';
  if (dx === 0 && dy === -1) return 'north';

  return null;
}

/**
 * Check if a sprite is a road sprite (has path-like connectivity).
 */
function isRoadSprite(sprite: Sprite | undefined): boolean {
  if (!sprite) return false;
  const type = sprite.connectivity?.type;
  return type === 'path' || type === 'corner' || type === 'intersection' || type === 'cap';
}

/**
 * Get connections needed from adjacent existing roads.
 * Checks each direction for roads that would connect to this cell.
 */
function getAdjacentRoadConnections(
  grid: GridState,
  x: number,
  y: number
): Direction[] {
  const connections: Direction[] = [];

  for (const [dir, offset] of Object.entries(DIRECTION_OFFSETS) as [Direction, { dx: number; dy: number }][]) {
    const nx = x + offset.dx;
    const ny = y + offset.dy;

    // Skip out of bounds
    if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;

    const tile = grid.getTile(nx, ny, 'ground');
    if (!tile) continue;

    const sprite = grid.getSprite(tile.assetId);
    if (!sprite || !isRoadSprite(sprite)) continue;

    // Check if the neighbor connects in our direction
    const neighborConnects = sprite.connectivity?.connects ?? [];
    const oppositeDir = OPPOSITE_DIRECTION[dir];

    if (neighborConnects.includes(oppositeDir)) {
      connections.push(dir);
    }
  }

  return connections;
}

/**
 * Determine needed connections for a path point based on path neighbors.
 */
function getPathConnections(
  path: Array<{ x: number; y: number }>,
  index: number
): Direction[] {
  const connections: Direction[] = [];
  const current = path[index];
  if (!current) return connections;

  const prev = path[index - 1];
  const next = path[index + 1];

  // Connection to previous point in path
  if (prev) {
    const dir = getDirectionBetween(current.x, current.y, prev.x, prev.y);
    if (dir) connections.push(dir);
  }

  // Connection to next point in path
  if (next) {
    const dir = getDirectionBetween(current.x, current.y, next.x, next.y);
    if (dir) connections.push(dir);
  }

  return connections;
}

/**
 * Find a road sprite that matches the needed connections exactly.
 */
function findMatchingRoadSprite(
  grid: GridState,
  connections: Direction[]
): Sprite | undefined {
  // Get sprites with exact matching connections
  const matches = grid.getSpritesWithConnections(connections);

  // Filter to ground category (roads)
  const roadMatches = matches.filter(
    (s) => s.category === 'ground' && isRoadSprite(s)
  );

  if (roadMatches.length > 0) {
    return roadMatches[0];
  }

  return undefined;
}

/**
 * Update an adjacent road tile to include a new connection.
 * Called when a new road creates a T-junction or intersection.
 */
function updateAdjacentRoad(
  grid: GridState,
  x: number,
  y: number,
  newConnection: Direction
): boolean {
  const tile = grid.getTile(x, y, 'ground');
  if (!tile) return false;

  const sprite = grid.getSprite(tile.assetId);
  if (!sprite || !isRoadSprite(sprite)) return false;

  const currentConnections = sprite.connectivity?.connects ?? [];

  // Already has this connection
  if (currentConnections.includes(newConnection)) return false;

  // Add the new connection
  const updatedConnections = [...currentConnections, newConnection];

  // Find sprite with updated connections
  const newSprite = findMatchingRoadSprite(grid, updatedConnections);
  if (newSprite && newSprite.id !== tile.assetId) {
    grid.setTile(x, y, newSprite.id, 'ground');
    return true;
  }

  return false;
}

/**
 * Update all adjacent roads when a new road tile is placed.
 */
function updateAdjacentRoads(
  grid: GridState,
  x: number,
  y: number,
  placedConnections: Direction[]
): number {
  let updated = 0;

  for (const dir of placedConnections) {
    const offset = DIRECTION_OFFSETS[dir];
    const nx = x + offset.dx;
    const ny = y + offset.dy;

    // Skip out of bounds
    if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;

    const oppositeDir = OPPOSITE_DIRECTION[dir];
    if (updateAdjacentRoad(grid, nx, ny, oppositeDir)) {
      updated++;
    }
  }

  return updated;
}

/**
 * State tracker for road network across multiple tool calls.
 * Tracks both budget and connectivity enforcement.
 */
interface RoadNetworkTracker {
  tilesPlaced: number;
  maxTiles: number;
  roadTiles: Set<string>; // "x,y" keys for all road positions
}

/**
 * Check if a point is on or adjacent to an existing road tile.
 * Used to enforce road connectivity after the first road.
 */
function isPointOnOrAdjacentToRoad(
  grid: GridState,
  x: number,
  y: number,
  roadTiles: Set<string>
): boolean {
  // Check if point itself is a road
  if (roadTiles.has(`${x},${y}`)) return true;

  // Check all adjacent cells
  for (const offset of Object.values(DIRECTION_OFFSETS)) {
    const nx = x + offset.dx;
    const ny = y + offset.dy;
    if (roadTiles.has(`${nx},${ny}`)) return true;
  }

  return false;
}

/**
 * Find the nearest road tile to a given point.
 * Used to provide helpful suggestions when connectivity fails.
 */
function findNearestRoadTile(
  roadTiles: Set<string>,
  x: number,
  y: number
): { x: number; y: number; distance: number } | null {
  let nearest: { x: number; y: number; distance: number } | null = null;

  for (const key of roadTiles) {
    const [rx, ry] = key.split(',').map(Number);
    if (rx === undefined || ry === undefined) continue;

    const distance = Math.abs(rx - x) + Math.abs(ry - y);
    if (!nearest || distance < nearest.distance) {
      nearest = { x: rx, y: ry, distance };
    }
  }

  return nearest;
}

/**
 * Create the drawRoad tool bound to a GridState instance.
 * Enforces road connectivity: after the first road, new roads must connect.
 */
export function createDrawRoadTool(
  grid: GridState,
  maxRoadTiles: number,
  verbose = false
) {
  // Track road network across multiple calls
  const tracker: RoadNetworkTracker = {
    tilesPlaced: 0,
    maxTiles: maxRoadTiles,
    roadTiles: new Set<string>(),
  };

  return tool({
    description: `Draw a connected road from one point to another. IMPORTANT: After the first road, new roads MUST start or end on/adjacent to an existing road (to create intersections). The system auto-selects correct sprites (straight, corners, intersections). Creates a Manhattan path. Road budget: ${maxRoadTiles} tiles max.`,
    inputSchema: DrawRoadParamsSchema,
    execute: async ({ fromX, fromY, toX, toY }: { fromX: number; fromY: number; toX: number; toY: number }) => {
      // Validate bounds
      if (
        fromX < 0 || fromX >= grid.width ||
        fromY < 0 || fromY >= grid.height ||
        toX < 0 || toX >= grid.width ||
        toY < 0 || toY >= grid.height
      ) {
        return {
          success: false,
          error: `Coordinates out of bounds. Map is ${grid.width}x${grid.height}.`,
        };
      }

      // CONNECTION ENFORCEMENT: After first road, require connection to existing network
      if (tracker.tilesPlaced > 0) {
        const startConnected = isPointOnOrAdjacentToRoad(grid, fromX, fromY, tracker.roadTiles);
        const endConnected = isPointOnOrAdjacentToRoad(grid, toX, toY, tracker.roadTiles);

        if (!startConnected && !endConnected) {
          const nearestToStart = findNearestRoadTile(tracker.roadTiles, fromX, fromY);
          const nearestToEnd = findNearestRoadTile(tracker.roadTiles, toX, toY);

          // Pick the nearest overall for suggestion
          const nearest = nearestToStart && nearestToEnd
            ? (nearestToStart.distance <= nearestToEnd.distance ? nearestToStart : nearestToEnd)
            : nearestToStart ?? nearestToEnd;

          return {
            success: false,
            error: `Road must connect to existing network. Start (${fromX},${fromY}) and end (${toX},${toY}) are both disconnected.`,
            suggestion: nearest
              ? `Try starting from or ending at (${nearest.x}, ${nearest.y}) which is on an existing road.`
              : 'Draw a road that connects to your existing road network.',
            existingRoadCount: tracker.roadTiles.size,
          };
        }
      }

      // Generate path
      const path = generateManhattanPath(fromX, fromY, toX, toY);

      // Check budget
      const remaining = tracker.maxTiles - tracker.tilesPlaced;
      if (path.length > remaining) {
        return {
          success: false,
          error: `Road would exceed budget. Need ${path.length} tiles but only ${remaining} remaining.`,
          suggestion: 'Focus on defineZone and placeAsset instead.',
        };
      }

      let tilesPlaced = 0;
      let tilesUpdated = 0;
      const errors: string[] = [];

      // Place each tile in the path
      for (let i = 0; i < path.length; i++) {
        const point = path[i];
        if (!point) continue;

        // Get connections needed from path neighbors
        const pathConnections = getPathConnections(path, i);

        // Get connections from existing adjacent roads
        const adjacentConnections = getAdjacentRoadConnections(grid, point.x, point.y);

        // Combine connections (unique)
        const allConnections = [...new Set([...pathConnections, ...adjacentConnections])];

        // Handle isolated tile (no connections) - default to horizontal
        if (allConnections.length === 0) {
          allConnections.push('east', 'west');
        }

        // Find matching sprite
        const sprite = findMatchingRoadSprite(grid, allConnections);

        if (!sprite) {
          errors.push(
            `No road sprite for connections [${allConnections.join(', ')}] at (${point.x}, ${point.y})`
          );
          continue;
        }

        // Place the tile
        try {
          grid.setTile(point.x, point.y, sprite.id, 'ground');
          tilesPlaced++;

          // Track this road tile for connectivity enforcement
          tracker.roadTiles.add(`${point.x},${point.y}`);

          // Update adjacent roads that might need to become intersections
          tilesUpdated += updateAdjacentRoads(grid, point.x, point.y, allConnections);

          if (verbose) {
            console.log(
              `[drawRoad] Placed ${sprite.id} at (${point.x}, ${point.y}) with connections [${allConnections.join(', ')}]`
            );
          }
        } catch (error) {
          errors.push(`Failed to place at (${point.x}, ${point.y}): ${error}`);
        }
      }

      // Update budget
      tracker.tilesPlaced += tilesPlaced;

      return {
        success: errors.length === 0,
        tilesPlaced,
        tilesUpdated,
        budgetRemaining: tracker.maxTiles - tracker.tilesPlaced,
        totalRoadTiles: tracker.roadTiles.size,
        errors: errors.length > 0 ? errors : undefined,
        groundLayer: grid.toASCII().ground,
        objectsLayer: grid.toASCII().objects,
      };
    },
  });
}
