/**
 * Spritesheet Phase
 *
 * Takes a scene description and generates SpritesheetMetadata by:
 * 1. Using a fixed structural layout (positions, sizes, connectivity)
 * 2. Having the LLM fill in semantic fields (id, description) based on theme
 *
 * Architecture Decision:
 * - Structural layout is deterministic (layout.ts)
 * - LLM cannot break grid positions or connectivity
 * - LLM focuses on creative naming and vivid descriptions
 */

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import type { Sprite, SpritesheetMetadata } from '../../types';
import { GRID_CONFIG, DERIVED_CONFIG } from '../../config';
import { buildLayoutSlots, getSlotCount } from '../layout';

// ─────────────────────────────────────────────────────────────────
// Schema for LLM output - only semantic fields
// ─────────────────────────────────────────────────────────────────

const SpriteSemanticSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .describe('Theme-appropriate identifier in snake_case (e.g., cobblestone_road, torch_post)'),
  description: z
    .string()
    .min(20)
    .describe('Vivid visual description of the sprite for image generation'),
});

const SpriteSemanticsSchema = z.object({
  sprites: z.array(SpriteSemanticSchema),
});

type SpriteSemantic = z.infer<typeof SpriteSemanticSchema>;

// ─────────────────────────────────────────────────────────────────
// Main phase execution
// ─────────────────────────────────────────────────────────────────

/**
 * Execute the spritesheet metadata generation phase.
 * Merges fixed structural layout with LLM-generated semantic content.
 */
export async function executeSpritesheetPhase(
  sceneDescription: string,
  verbose: boolean
): Promise<SpritesheetMetadata> {
  if (verbose) console.log('[Spritesheet Phase] Starting...');

  const slots = buildLayoutSlots();
  const slotCount = slots.length;

  // Prepare slot summary for LLM (only what it needs to know)
  const slotSummary = slots.map((slot, index) => ({
    index,
    position: `(${slot.col}, ${slot.row})`,
    size: `${slot.w}x${slot.h}`,
    category: slot.category,
    hint: slot.hint,
  }));

  const result = await generateObject({
    model: google('gemini-2.5-pro-preview-05-06'),
    schema: SpriteSemanticsSchema,
    system: buildDescriptionPrompt(),
    prompt: `Scene description:
---
${sceneDescription}
---

Spritesheet slots (provide id + description for each):
${JSON.stringify(slotSummary, null, 2)}

For each slot index, provide:
- id: A theme-appropriate name in snake_case (e.g., cobblestone_path, wooden_barrel, neon_sign)
- description: Vivid visual details matching the scene theme

IMPORTANT: Return exactly ${slotCount} sprites in order matching the slot indices.
Every sprite must have a UNIQUE id - no duplicates allowed.`,
  });

  // Validate we got the right number of sprites
  const semantics = result.object.sprites;
  if (semantics.length !== slotCount) {
    console.warn(
      `[Spritesheet Phase] Warning: Expected ${slotCount} sprites, got ${semantics.length}`
    );
  }

  // Merge LLM semantics into structural slots
  const sprites: Sprite[] = slots.map((slot, i) => {
    const semantic: SpriteSemantic | undefined = semantics[i];
    return {
      id: semantic?.id ?? `sprite_${i}`,
      category: slot.category,
      col: slot.col,
      row: slot.row,
      w: slot.w,
      h: slot.h,
      description: semantic?.description ?? slot.hint,
      placement: slot.placement,
      connectivity: slot.connectivity,
    };
  });

  // Extract theme from scene description (first line or first sentence)
  const theme = extractTheme(sceneDescription);

  if (verbose) {
    console.log(`[Spritesheet Phase] Generated ${sprites.length} sprites for theme: "${theme}"`);
    console.log('[Spritesheet Phase] Complete');
  }

  return {
    theme,
    tileSize: GRID_CONFIG.tileSize,
    columns: DERIVED_CONFIG.columns,
    rows: DERIVED_CONFIG.rows,
    sprites,
    sceneDescription,
  };
}

// ─────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────

/**
 * Extract a short theme name from the scene description.
 */
function extractTheme(sceneDescription: string): string {
  // Take first line or first sentence, truncate to reasonable length
  const firstLine = sceneDescription.split('\n')[0] ?? '';
  const firstSentence = firstLine.split(/[.!?]/)[0] ?? '';
  const theme = firstSentence.trim().slice(0, 50);
  return theme || 'unknown theme';
}

/**
 * Build the system prompt for sprite description generation.
 */
function buildDescriptionPrompt(): string {
  return `You are creating sprite descriptions for a 2D top-down JRPG game spritesheet.

YOUR TASK: For each slot, provide:
1. A theme-appropriate ID (snake_case identifier)
2. A vivid visual description for pixel art generation

NAMING RULES:
- Use snake_case (e.g., cobblestone_road, wooden_barrel, neon_lamp)
- Names should match the theme (fantasy: torch_post, cyberpunk: neon_sign)
- Every ID must be UNIQUE - no duplicates

DESCRIPTION RULES:
1. VARIETY IS CRITICAL - Every sprite must be visually distinct
   - Different patterns, colors, wear marks, details
   - No two ground tiles should look the same
   - Each prop needs unique characteristics

2. PERSPECTIVE - All sprites use classic JRPG 3/4 view:
   - Ground tiles: Pure top-down (looking straight down)
   - Buildings/props: Show top surface + south-facing front
   - Shadows cast toward bottom-right

3. BE SPECIFIC AND CONCRETE:
   - BAD: "A road tile with some cracks"
   - GOOD: "Weathered gray cobblestone with three diagonal cracks, moss growing in gaps, a fallen leaf in the NE corner"

4. MATCH THE THEME:
   - Read the scene description carefully
   - Use materials, colors, and atmosphere from the scene
   - Maintain visual consistency across all sprites

5. FILL ENTIRE TILES:
   - Ground tiles must have solid colors filling the entire tile
   - No transparency or gaps on ground - background shows as black

Return a sprite entry for EVERY slot in the list.`;
}
