/**
 * Connect Roads Tool (Auto-Fixup)
 *
 * Automatically connects disconnected road islands to form a unified network.
 * This is a safety net tool that runs after road generation to ensure
 * all roads are connected.
 *
 * Architecture Decision:
 * - Detects islands using flood-fill from GridState
 * - Finds nearest points between islands
 * - Draws connecting roads using Manhattan paths
 * - Preserves existing road sprites and updates intersections
 */

import { z } from 'zod';
import { tool } from 'ai';
import type { GridState } from '../../lib/grid-state';
import type { Direction, Sprite } from '../../types';

// No parameters needed - auto-detects and fixes
const ConnectRoadsParamsSchema = z.object({});

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
 * Find the pair of tiles (one from each island) with minimum Manhattan distance.
 */
function findNearestTilesBetweenIslands(
  island1: Array<{ x: number; y: number }>,
  island2: Array<{ x: number; y: number }>
): { from: { x: number; y: number }; to: { x: number; y: number }; distance: number } {
  let best: { from: { x: number; y: number }; to: { x: number; y: number }; distance: number } | null = null;

  for (const t1 of island1) {
    for (const t2 of island2) {
      const distance = Math.abs(t1.x - t2.x) + Math.abs(t1.y - t2.y);
      if (!best || distance < best.distance) {
        best = { from: t1, to: t2, distance };
      }
    }
  }

  // Safe fallback (should never happen with non-empty islands)
  return best ?? { from: island1[0]!, to: island2[0]!, distance: 0 };
}

/**
 * Generate a Manhattan path from start to end.
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
 * Check if a sprite is a road sprite.
 */
function isRoadSprite(sprite: Sprite | undefined): boolean {
  if (!sprite) return false;
  const type = sprite.connectivity?.type;
  return type === 'path' || type === 'corner' || type === 'intersection' || type === 'cap';
}

/**
 * Get connections from adjacent existing roads.
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

    if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;

    const tile = grid.getTile(nx, ny, 'ground');
    if (!tile) continue;

    const sprite = grid.getSprite(tile.assetId);
    if (!sprite || !isRoadSprite(sprite)) continue;

    const neighborConnects = sprite.connectivity?.connects ?? [];
    const oppositeDir = OPPOSITE_DIRECTION[dir];

    if (neighborConnects.includes(oppositeDir)) {
      connections.push(dir);
    }
  }

  return connections;
}

/**
 * Get connections needed for a path point based on path neighbors.
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

  if (prev) {
    const dir = getDirectionBetween(current.x, current.y, prev.x, prev.y);
    if (dir) connections.push(dir);
  }

  if (next) {
    const dir = getDirectionBetween(current.x, current.y, next.x, next.y);
    if (dir) connections.push(dir);
  }

  return connections;
}

/**
 * Find a road sprite that matches the needed connections.
 */
function findMatchingRoadSprite(
  grid: GridState,
  connections: Direction[]
): Sprite | undefined {
  const matches = grid.getSpritesWithConnections(connections);
  const roadMatches = matches.filter(
    (s) => s.category === 'ground' && isRoadSprite(s)
  );
  return roadMatches[0];
}

/**
 * Update an adjacent road to include a new connection.
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
  if (currentConnections.includes(newConnection)) return false;

  const updatedConnections = [...currentConnections, newConnection];
  const newSprite = findMatchingRoadSprite(grid, updatedConnections);

  if (newSprite && newSprite.id !== tile.assetId) {
    grid.setTile(x, y, newSprite.id, 'ground');
    return true;
  }

  return false;
}

/**
 * Draw a connecting road between two points.
 */
function drawConnectingRoad(
  grid: GridState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  verbose: boolean
): { tilesPlaced: number; tilesUpdated: number; errors: string[] } {
  const path = generateManhattanPath(fromX, fromY, toX, toY);

  let tilesPlaced = 0;
  let tilesUpdated = 0;
  const errors: string[] = [];

  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    if (!point) continue;

    // Skip if already a road (we're connecting to existing roads)
    if (grid.isRoadAt(point.x, point.y)) {
      // But update connections if needed
      const pathConnections = getPathConnections(path, i);
      for (const dir of pathConnections) {
        const offset = DIRECTION_OFFSETS[dir];
        const nx = point.x + offset.dx;
        const ny = point.y + offset.dy;
        if (updateAdjacentRoad(grid, nx, ny, OPPOSITE_DIRECTION[dir])) {
          tilesUpdated++;
        }
      }
      continue;
    }

    const pathConnections = getPathConnections(path, i);
    const adjacentConnections = getAdjacentRoadConnections(grid, point.x, point.y);
    const allConnections = [...new Set([...pathConnections, ...adjacentConnections])];

    if (allConnections.length === 0) {
      allConnections.push('east', 'west');
    }

    const sprite = findMatchingRoadSprite(grid, allConnections);

    if (!sprite) {
      errors.push(`No sprite for connections [${allConnections.join(', ')}] at (${point.x}, ${point.y})`);
      continue;
    }

    try {
      grid.setTile(point.x, point.y, sprite.id, 'ground');
      tilesPlaced++;

      // Update adjacent roads
      for (const dir of allConnections) {
        const offset = DIRECTION_OFFSETS[dir];
        const nx = point.x + offset.dx;
        const ny = point.y + offset.dy;
        if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
          if (updateAdjacentRoad(grid, nx, ny, OPPOSITE_DIRECTION[dir])) {
            tilesUpdated++;
          }
        }
      }

      if (verbose) {
        console.log(`[connectRoads] Placed ${sprite.id} at (${point.x}, ${point.y})`);
      }
    } catch (error) {
      errors.push(`Failed at (${point.x}, ${point.y}): ${error}`);
    }
  }

  return { tilesPlaced, tilesUpdated, errors };
}

/**
 * Create the connectRoads auto-fixup tool.
 */
export function createConnectRoadsTool(grid: GridState, verbose = false) {
  return tool({
    description:
      'Automatically connect disconnected road islands. Use this after drawing roads to ensure all roads form a single connected network. Takes no parameters - auto-detects and fixes.',
    inputSchema: ConnectRoadsParamsSchema,
    execute: async () => {
      const connectivity = grid.validateRoadConnectivity();

      // Already connected or no roads
      if (connectivity.connected) {
        return {
          success: true,
          alreadyConnected: true,
          totalRoadTiles: connectivity.totalRoadTiles,
          islandCount: connectivity.islandCount,
        };
      }

      if (verbose) {
        console.log(`[connectRoads] Found ${connectivity.islandCount} disconnected road islands, connecting...`);
      }

      let totalTilesPlaced = 0;
      let totalTilesUpdated = 0;
      const allErrors: string[] = [];
      const connections: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = [];

      // Connect islands sequentially (connect island 1 to 0, island 2 to 1, etc.)
      const islands = connectivity.islands;
      for (let i = 1; i < islands.length; i++) {
        const prevIsland = islands[i - 1];
        const currentIsland = islands[i];

        if (!prevIsland || !currentIsland) continue;

        // Find nearest tiles between these two islands
        const nearest = findNearestTilesBetweenIslands(prevIsland.tiles, currentIsland.tiles);

        if (verbose) {
          console.log(
            `[connectRoads] Connecting island ${i - 1} to island ${i}: (${nearest.from.x},${nearest.from.y}) -> (${nearest.to.x},${nearest.to.y})`
          );
        }

        // Draw connecting road
        const result = drawConnectingRoad(
          grid,
          nearest.from.x,
          nearest.from.y,
          nearest.to.x,
          nearest.to.y,
          verbose
        );

        totalTilesPlaced += result.tilesPlaced;
        totalTilesUpdated += result.tilesUpdated;
        allErrors.push(...result.errors);
        connections.push({ from: nearest.from, to: nearest.to });
      }

      // Verify connectivity after fixes
      const finalConnectivity = grid.validateRoadConnectivity();

      return {
        success: finalConnectivity.connected,
        previousIslandCount: connectivity.islandCount,
        finalIslandCount: finalConnectivity.islandCount,
        tilesPlaced: totalTilesPlaced,
        tilesUpdated: totalTilesUpdated,
        connections,
        errors: allErrors.length > 0 ? allErrors : undefined,
        groundLayer: grid.toASCII().ground,
        objectsLayer: grid.toASCII().objects,
      };
    },
  });
}
