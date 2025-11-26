import sharp, { type OverlayOptions } from 'sharp';
import { readFile } from 'fs/promises';
import type { GameMap, SpritesheetMetadata, Sprite, MapCell } from '../types';

/**
 * Map Renderer - Composites map.json to PNG using spritesheet
 *
 * Architecture Decision:
 * - Using Sharp over node-canvas because:
 *   1. No external native dependencies (Cairo) - simpler CI/CD
 *   2. Sharp is already used in the project ecosystem
 *   3. Memory-efficient streaming composites via libvips
 * - Pre-extract sprites to cache to avoid repeated spritesheet reads
 * - Single composite call for efficiency (Sharp batches operations)
 *
 * Trade-off: Sharp's composite API is less intuitive than Canvas drawImage
 * but avoids native dependency issues.
 */

export interface RenderOptions {
  /** Scale factor for output (0.125 = 1/8, 0.25 = 1/4, 1.0 = full). Default 0.25 */
  scale?: number;
  /** Output format. Default 'png' */
  format?: 'png' | 'jpeg' | 'webp';
  /** JPEG/WebP quality (1-100). Default 90 */
  quality?: number;
  /** Background color (CSS hex). Default '#000000' */
  backgroundColor?: string;
  /** Which layers to render. Default: both */
  layers?: ('ground' | 'objects')[];
}

export interface RenderResult {
  path: string;
  width: number;
  height: number;
  scale: number;
  stats: {
    groundTilesRendered: number;
    objectTilesRendered: number;
    uniqueSpritesUsed: number;
  };
}

/**
 * Extract a sprite region from the spritesheet, scaled for compositing.
 *
 * Using kernel: 'nearest' for resize because pixel art should not be
 * interpolated (would blur edges). Nearest-neighbor preserves crisp
 * pixel boundaries.
 */
async function extractSprite(
  spritesheetPath: string,
  sprite: Sprite,
  tileSize: number,
  scale: number
): Promise<Buffer> {
  const sourceX = sprite.col * tileSize;
  const sourceY = sprite.row * tileSize;
  const sourceW = sprite.w * tileSize;
  const sourceH = sprite.h * tileSize;

  const scaledW = Math.round(sourceW * scale);
  const scaledH = Math.round(sourceH * scale);

  return sharp(spritesheetPath)
    .extract({ left: sourceX, top: sourceY, width: sourceW, height: sourceH })
    .resize(scaledW, scaledH, { kernel: 'nearest' })
    .toBuffer();
}

/**
 * Build a cache of extracted sprites for all unique assets in the map.
 *
 * Performance: Pre-extracting avoids repeated spritesheet reads.
 * With 16 sprites max, cache is ~4MB at scale 0.25.
 */
async function buildSpriteCache(
  spritesheetPath: string,
  metadata: SpritesheetMetadata,
  map: GameMap,
  scale: number
): Promise<Map<string, Buffer>> {
  const cache = new Map<string, Buffer>();

  // Find all unique asset IDs used in the map
  const usedAssets = new Set<string>();

  for (const row of map.layers.ground) {
    if (!row) continue;
    for (const cell of row) {
      if (cell?.assetId) usedAssets.add(cell.assetId);
    }
  }
  for (const row of map.layers.objects) {
    if (!row) continue;
    for (const cell of row) {
      if (cell?.assetId) usedAssets.add(cell.assetId);
    }
  }

  // Extract each used sprite
  for (const assetId of usedAssets) {
    const sprite = metadata.sprites.find(s => s.id === assetId);
    if (!sprite) {
      console.warn(`   Warning: Unknown asset ID "${assetId}" - skipping`);
      continue;
    }
    const buffer = await extractSprite(spritesheetPath, sprite, metadata.tileSize, scale);
    cache.set(assetId, buffer);
  }

  return cache;
}

/**
 * Process a map layer and build composite operations.
 */
function processLayer(
  layer: (MapCell | null)[][],
  spriteCache: Map<string, Buffer>,
  scaledTileSize: number
): { composites: OverlayOptions[]; tilesRendered: number } {
  const composites: OverlayOptions[] = [];
  let tilesRendered = 0;

  for (let y = 0; y < layer.length; y++) {
    const row = layer[y];
    if (!row) continue;

    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (!cell?.assetId) continue;

      const spriteBuffer = spriteCache.get(cell.assetId);
      if (!spriteBuffer) continue;

      composites.push({
        input: spriteBuffer,
        left: x * scaledTileSize,
        top: y * scaledTileSize,
      });
      tilesRendered++;
    }
  }

  return { composites, tilesRendered };
}

/**
 * Render a map to an image file.
 *
 * @param map - The parsed GameMap object
 * @param metadata - The spritesheet metadata
 * @param spritesheetPath - Path to the spritesheet PNG
 * @param outputPath - Where to save the rendered image
 * @param options - Render options (scale, format, etc.)
 */
export async function renderMap(
  map: GameMap,
  metadata: SpritesheetMetadata,
  spritesheetPath: string,
  outputPath: string,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const {
    scale = 0.25,
    format = 'png',
    quality = 90,
    backgroundColor = '#000000',
    layers = ['ground', 'objects'],
  } = options;

  const tileSize = metadata.tileSize;
  const scaledTileSize = Math.round(tileSize * scale);
  const canvasWidth = map.width * scaledTileSize;
  const canvasHeight = map.height * scaledTileSize;

  console.log(`   Map: ${map.width}x${map.height} tiles`);
  console.log(`   Scale: ${scale} (${scaledTileSize}px per tile)`);
  console.log(`   Output: ${canvasWidth}x${canvasHeight}px`);
  console.log(`   Layers: ${layers.join(', ')}`);

  // Build sprite cache
  const spriteCache = await buildSpriteCache(spritesheetPath, metadata, map, scale);
  console.log(`   Cached ${spriteCache.size} unique sprites`);

  // Process requested layers
  const ground = layers.includes('ground')
    ? processLayer(map.layers.ground, spriteCache, scaledTileSize)
    : { composites: [], tilesRendered: 0 };
  const objects = layers.includes('objects')
    ? processLayer(map.layers.objects, spriteCache, scaledTileSize)
    : { composites: [], tilesRendered: 0 };

  // Combine: ground first (bottom), then objects (top)
  const allComposites = [...ground.composites, ...objects.composites];
  console.log(`   Compositing ${allComposites.length} tiles...`);

  // Create canvas and composite
  let output = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: backgroundColor,
    },
  }).composite(allComposites);

  // Apply format-specific options
  switch (format) {
    case 'jpeg':
      output = output.jpeg({ quality });
      break;
    case 'webp':
      output = output.webp({ quality });
      break;
    default:
      output = output.png();
  }

  // Write to file (streams directly to disk - memory efficient)
  await output.toFile(outputPath);

  return {
    path: outputPath,
    width: canvasWidth,
    height: canvasHeight,
    scale,
    stats: {
      groundTilesRendered: ground.tilesRendered,
      objectTilesRendered: objects.tilesRendered,
      uniqueSpritesUsed: spriteCache.size,
    },
  };
}

/**
 * Convenience function that loads files and renders.
 */
export async function renderMapFromFiles(
  mapPath: string,
  metadataPath: string,
  spritesheetPath: string,
  outputPath: string,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const mapJson = await readFile(mapPath, 'utf-8');
  const map = JSON.parse(mapJson) as GameMap;

  const metaJson = await readFile(metadataPath, 'utf-8');
  const metadata = JSON.parse(metaJson) as SpritesheetMetadata;

  return renderMap(map, metadata, spritesheetPath, outputPath, options);
}
