/**
 * Spritesheet Phase
 *
 * Takes a scene description and generates structured SpritesheetMetadata.
 * Uses generateObject with Zod schema for type-safe output.
 */

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { SpritesheetMetadataSchema, type SpritesheetMetadata } from '../../types';
import { GRID_CONFIG, DERIVED_CONFIG } from '../../config';

/**
 * Execute the spritesheet metadata generation phase.
 * Transforms scene description into structured sprite definitions.
 */
export async function executeSpritesheetPhase(
  sceneDescription: string,
  verbose: boolean
): Promise<SpritesheetMetadata> {
  if (verbose) console.log('[Spritesheet Phase] Starting...');

  const result = await generateObject({
    model: google('gemini-2.5-pro-preview-05-06'),
    schema: SpritesheetMetadataSchema,
    system: buildSpritesheetPrompt(),
    prompt: `Based on this scene description, generate the sprite metadata:

---
${sceneDescription}
---

Create sprites that bring this world to life in a ${DERIVED_CONFIG.columns}x${DERIVED_CONFIG.rows} spritesheet grid.

Remember:
- tileSize: ${GRID_CONFIG.tileSize}
- columns: ${DERIVED_CONFIG.columns}
- rows: ${DERIVED_CONFIG.rows}
- Total tiles: ${DERIVED_CONFIG.totalTiles}`,
  });

  if (verbose) console.log('[Spritesheet Phase] Complete');

  return result.object;
}

/**
 * Build the system prompt for spritesheet generation.
 * Contains all technical rules for sprite layout and metadata.
 */
function buildSpritesheetPrompt(): string {
  return `You are a sprite sheet planner for 2D top-down JRPG games.

Your job: Read the scene description and output a complete JSON describing all ${DERIVED_CONFIG.totalTiles} sprites needed for a ${DERIVED_CONFIG.columns}x${DERIVED_CONFIG.rows} spritesheet.

GLOBAL VISUAL RULES (VERY IMPORTANT):
- Style: pixel art.
- Lighting: handled at scene level, do NOT mention lighting in individual descriptions.
- Camera: classic top-down JRPG 3/4 view, like Pokemon / Chrono Trigger.
  - Ground tiles are seen straight from above.
  - Buildings and tall props are drawn so you see the top surface AND a bit of the front.
  - Every object must share the SAME camera angle; do NOT change perspective between tiles.
- Forbidden:
  - No pure side-view / platformer-style objects.
  - No straight-on front-facing objects with no visible top.
  - No true isometric / diamond-grid perspective.

RULES:
1. Fill EXACTLY ${DERIVED_CONFIG.totalTiles} tiles (accounting for multi-tile sprites like 2x2 buildings)
2. Assign explicit (col, row) to each sprite - plan the grid layout carefully
3. Each sprite needs: id, category, col, row, description, placement, connectivity
4. Ground tiles MUST fill the ENTIRE tile boundary - no transparent areas allowed
5. The ground layer has no background; empty/transparent pixels render as black

STANDARD LAYOUT (${DERIVED_CONFIG.columns}x${DERIVED_CONFIG.rows} grid = ${DERIVED_CONFIG.totalTiles} tiles):
- Row 0: Road tiles (simplified 8-tile set) - 8 tiles
- Row 1: Ground surfaces (3 categories: walkable, decorative, hazard) - 8 tiles
- Rows 2-3: Buildings as 2x2 sprites (4 buildings x 4 tiles = 16 tiles)
- Rows 4-5: Props (trees, lamps, benches, signs, etc.) - 16 tiles
- Rows 6-7: More props, markers, and decorations - 16 tiles

REQUIRED ROAD SPRITES (Row 0 - exactly 8 tiles, simplified set):
- road_horizontal: connects ['east','west'], type: 'path'
- road_vertical: connects ['north','south'], type: 'path'
- road_corner_ne: connects ['north','east'], type: 'corner'
- road_corner_nw: connects ['north','west'], type: 'corner'
- road_corner_se: connects ['south','east'], type: 'corner'
- road_corner_sw: connects ['south','west'], type: 'corner'
- road_4way: connects ['north','south','east','west'], type: 'intersection'
- road_t_south: connects ['south','east','west'], type: 'intersection'
NOTE: This is a simplified road set. No T-north/east/west variants or dead-end caps.

REQUIRED GROUND SURFACES (Row 1 - exactly 8 tiles, 3 categories):
WALKABLE URBAN (4 tiles):
- ground_sidewalk: paved walkway
- ground_plaza: decorative plaza flooring
- ground_concrete: basic concrete surface
- ground_metal_plate: industrial metal flooring
DECORATIVE TERRAIN (3 tiles) - thematic background filler:
- ground_rubble: broken debris/rubble pile
- ground_debris: scattered industrial waste
- ground_overgrown: nature reclaiming urban space
HAZARD (1 tile):
- ground_water_toxic: toxic/polluted water (walkable=false)

IMPORTANT FOR GROUND TILES: Every ground tile must have solid colors filling
the entire tile. No transparency or gaps - the background will show as black.

PLACEMENT RULES:
- Ground tiles: layer='ground', walkable=true
- Buildings: layer='object', walkable=false
- Props like trees, lamps: layer='object', walkable depends on size
- Roads: layer='ground', walkable=true

CONNECTIVITY:
- type: 'none' for non-connecting tiles
- type: 'path' for straight roads
- type: 'corner' for road corners
- type: 'intersection' for 3-way or 4-way junctions
- connects: array of directions this tile connects to

SPRITE DESCRIPTIONS:
- Reference the scene description's visual details (colors, materials, textures)
- Be specific about what each sprite looks like
- Include relevant colors, materials, and style from the scene
- Descriptions are used for image generation - make them vivid

Output valid JSON matching the SpritesheetMetadata schema exactly.`;
}
