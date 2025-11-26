import type {
  MapCell,
  GameMap,
  SpritesheetMetadata,
  Sprite,
  SpriteCategory,
  ConnectivityType,
  Direction,
} from '../types';

/**
 * GridState - Mutable map state for the Planner Agent
 *
 * Architecture Decision:
 * - Class-based to encapsulate validation and query logic
 * - Tools receive GridState via closure, allowing shared mutable state
 * - Two layers (ground, objects) support proper sprite stacking
 * - Query helpers use semantic metadata instead of tags
 */
export class GridState {
  private ground: (MapCell | null)[][];
  private objects: (MapCell | null)[][];

  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly metadata: SpritesheetMetadata
  ) {
    // Initialize empty grids
    this.ground = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => null)
    );
    this.objects = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => null)
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Sprite Lookup
  // ─────────────────────────────────────────────────────────────────

  getSprite(id: string): Sprite | undefined {
    return this.metadata.sprites.find(s => s.id === id);
  }

  getSpriteOrThrow(id: string): Sprite {
    const sprite = this.getSprite(id);
    if (!sprite) {
      throw new Error(`Unknown sprite: ${id}`);
    }
    return sprite;
  }

  // ─────────────────────────────────────────────────────────────────
  // Tile Operations
  // ─────────────────────────────────────────────────────────────────

  setTile(
    x: number,
    y: number,
    assetId: string,
    layer: 'ground' | 'object' = 'ground'
  ): void {
    // Validate sprite exists
    this.getSpriteOrThrow(assetId);

    // Validate bounds
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new Error(`Position out of bounds: (${x}, ${y})`);
    }

    const target = layer === 'ground' ? this.ground : this.objects;
    const row = target[y];
    if (row) {
      row[x] = { assetId, layer };
    }

    // Handle multi-tile sprites (w > 1 or h > 1)
    // For now, only the anchor position is set. The renderer handles the full sprite.
    // Future: could mark adjacent cells as "occupied by [assetId]"
  }

  getTile(
    x: number,
    y: number,
    layer: 'ground' | 'object' = 'ground'
  ): MapCell | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    const target = layer === 'ground' ? this.ground : this.objects;
    const row = target[y];
    return row?.[x] ?? null;
  }

  clearTile(x: number, y: number, layer: 'ground' | 'object' = 'ground'): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return;
    }
    const target = layer === 'ground' ? this.ground : this.objects;
    const row = target[y];
    if (row) {
      row[x] = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Sprite Queries - Semantic, not tag-based
  // ─────────────────────────────────────────────────────────────────

  getSpritesByCategory(category: SpriteCategory): Sprite[] {
    return this.metadata.sprites.filter(s => s.category === category);
  }

  getSpritesByConnectivity(type: ConnectivityType): Sprite[] {
    return this.metadata.sprites.filter(
      s => s.connectivity?.type === type
    );
  }

  /**
   * Find sprites matching exact directional connectivity.
   * Used by drawPath to find the right corner/straight/intersection sprite.
   */
  getSpritesWithConnections(directions: Direction[]): Sprite[] {
    return this.metadata.sprites.filter(s => {
      const connects = s.connectivity?.connects || [];
      // Must have exactly these connections (order doesn't matter)
      return (
        connects.length === directions.length &&
        directions.every(d => connects.includes(d))
      );
    });
  }

  /**
   * Filter sprites by description keywords.
   * Case-insensitive partial match.
   */
  filterByDescription(sprites: Sprite[], keywords: string): Sprite[] {
    const terms = keywords.toLowerCase().split(/\s+/);
    return sprites.filter(s =>
      terms.some(term => s.description.toLowerCase().includes(term))
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Road Helpers - For drawRoad tool connectivity detection
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check if a tile at position is a road (has path-like connectivity).
   */
  isRoadAt(x: number, y: number): boolean {
    const tile = this.getTile(x, y, 'ground');
    if (!tile) return false;

    const sprite = this.getSprite(tile.assetId);
    if (!sprite) return false;

    const type = sprite.connectivity?.type;
    return type === 'path' || type === 'corner' || type === 'intersection' || type === 'cap';
  }

  /**
   * Get all road sprites (ground tiles with path-like connectivity).
   */
  getRoadSprites(): Sprite[] {
    return this.metadata.sprites.filter(s => {
      if (s.category !== 'ground') return false;
      const type = s.connectivity?.type;
      return type === 'path' || type === 'corner' || type === 'intersection' || type === 'cap';
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Road Network Validation - For post-generation connectivity checks
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get all road tile positions as a Set of "x,y" keys.
   */
  getRoadNetwork(): Set<string> {
    const roadTiles = new Set<string>();

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.isRoadAt(x, y)) {
          roadTiles.add(`${x},${y}`);
        }
      }
    }

    return roadTiles;
  }

  /**
   * Find all disconnected road "islands" using flood-fill.
   * Returns an array of islands, each containing its tile positions.
   */
  getRoadIslands(): Array<{
    tiles: Array<{ x: number; y: number }>;
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
  }> {
    const roadTiles = this.getRoadNetwork();
    const visited = new Set<string>();
    const islands: Array<{
      tiles: Array<{ x: number; y: number }>;
      bounds: { minX: number; maxX: number; minY: number; maxY: number };
    }> = [];

    // Direction offsets for adjacency
    const offsets = [
      { dx: 0, dy: -1 }, // north
      { dx: 0, dy: 1 },  // south
      { dx: 1, dy: 0 },  // east
      { dx: -1, dy: 0 }, // west
    ];

    // Flood-fill from each unvisited road tile
    for (const key of roadTiles) {
      if (visited.has(key)) continue;

      // Start a new island
      const island: Array<{ x: number; y: number }> = [];
      const queue: string[] = [key];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visited.has(current)) continue;

        visited.add(current);
        const [cx, cy] = current.split(',').map(Number);
        if (cx === undefined || cy === undefined) continue;

        island.push({ x: cx, y: cy });

        // Check all adjacent tiles
        for (const offset of offsets) {
          const nx = cx + offset.dx;
          const ny = cy + offset.dy;
          const neighborKey = `${nx},${ny}`;

          if (roadTiles.has(neighborKey) && !visited.has(neighborKey)) {
            queue.push(neighborKey);
          }
        }
      }

      if (island.length > 0) {
        // Calculate bounds
        const xs = island.map(t => t.x);
        const ys = island.map(t => t.y);

        islands.push({
          tiles: island,
          bounds: {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys),
          },
        });
      }
    }

    return islands;
  }

  /**
   * Validate that all roads form a single connected network.
   * Returns connectivity status and list of islands if disconnected.
   */
  validateRoadConnectivity(): {
    connected: boolean;
    totalRoadTiles: number;
    islandCount: number;
    islands: Array<{
      tiles: Array<{ x: number; y: number }>;
      bounds: { minX: number; maxX: number; minY: number; maxY: number };
    }>;
  } {
    const islands = this.getRoadIslands();
    const totalRoadTiles = islands.reduce((sum, island) => sum + island.tiles.length, 0);

    return {
      connected: islands.length <= 1,
      totalRoadTiles,
      islandCount: islands.length,
      islands,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────

  toJSON(): GameMap {
    return {
      width: this.width,
      height: this.height,
      layers: {
        ground: this.ground,
        objects: this.objects,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // ASCII Representation - For AI visualization
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate ASCII representation of the map for AI visualization.
   * Ground: R=road, G=ground, .=empty
   * Objects: B=building, P=prop, M=marker, .=empty
   */
  toASCII(): { ground: string; objects: string } {
    const groundLines: string[] = [];
    const objectLines: string[] = [];

    // Header row with column numbers
    const header = '  ' + Array.from({ length: this.width }, (_, i) => i % 10).join('');
    groundLines.push(header);
    objectLines.push(header);

    for (let y = 0; y < this.height; y++) {
      let groundRow = `${y % 10} `;
      let objectRow = `${y % 10} `;

      for (let x = 0; x < this.width; x++) {
        // Ground layer
        const groundTile = this.getTile(x, y, 'ground');
        if (groundTile) {
          const sprite = this.getSprite(groundTile.assetId);
          if (sprite && this.isRoadAt(x, y)) {
            groundRow += 'R';
          } else {
            groundRow += 'G';
          }
        } else {
          groundRow += '.';
        }

        // Object layer
        const objectTile = this.getTile(x, y, 'object');
        if (objectTile) {
          const sprite = this.getSprite(objectTile.assetId);
          if (sprite?.category === 'building') {
            objectRow += 'B';
          } else if (sprite?.category === 'prop') {
            objectRow += 'P';
          } else if (sprite?.category === 'marker') {
            objectRow += 'M';
          } else {
            objectRow += '?';
          }
        } else {
          objectRow += '.';
        }
      }

      groundLines.push(groundRow);
      objectLines.push(objectRow);
    }

    // Add legend
    groundLines.push('');
    groundLines.push('Legend: R=road, G=ground, .=empty');

    objectLines.push('');
    objectLines.push('Legend: B=building, P=prop, M=marker, .=empty');

    return {
      ground: groundLines.join('\n'),
      objects: objectLines.join('\n'),
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Debug Helpers
  // ─────────────────────────────────────────────────────────────────

  getStats(): {
    totalTiles: number;
    groundFilled: number;
    objectsFilled: number;
  } {
    let groundFilled = 0;
    let objectsFilled = 0;

    for (let y = 0; y < this.height; y++) {
      const groundRow = this.ground[y];
      const objectsRow = this.objects[y];
      for (let x = 0; x < this.width; x++) {
        if (groundRow?.[x]) groundFilled++;
        if (objectsRow?.[x]) objectsFilled++;
      }
    }

    return {
      totalTiles: this.width * this.height,
      groundFilled,
      objectsFilled,
    };
  }
}
