/**
 * Scene Phase
 *
 * Takes a theme and generates a rich, detailed scene description.
 * Output is free-form text for creative flexibility.
 */

import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

/**
 * Execute the scene description phase.
 * Transforms a theme into a detailed creative description.
 */
export async function executeScenePhase(
  theme: string,
  verbose: boolean
): Promise<string> {
  if (verbose) console.log('[Scene Phase] Starting...');

  const result = await generateText({
    model: google('gemini-2.5-pro-preview-05-06'),
    system: buildScenePrompt(),
    prompt: `Create a detailed scene description for a top-down JRPG game world with this theme: "${theme}"`,
  });

  if (verbose) console.log('[Scene Phase] Complete');

  return result.text;
}

/**
 * Build the system prompt for scene generation.
 * Focuses on creative world-building with visual specificity.
 */
function buildScenePrompt(): string {
  return `You are a game world designer creating detailed scene descriptions for 2D top-down JRPG games.

Your task is to take a theme and create a rich, detailed description of a game world scene that will be used to generate pixel art sprites.

OUTPUT FORMAT:
Write a detailed creative description covering:

1. VISUAL IDENTITY
   - Primary color palette (3-4 dominant colors with hex codes)
   - Secondary/accent colors
   - Overall mood and atmosphere (dark, vibrant, muted, etc.)
   - Lighting conditions (time of day, weather, light sources)

2. ARCHITECTURE
   - Building styles and materials (brick, metal, wood, glass, etc.)
   - Structural characteristics (angular, rounded, industrial, organic)
   - Scale and proportions relative to characters
   - Distinctive architectural features

3. GROUND SURFACES
   - Road/path materials and appearance
   - Walkable urban surfaces (sidewalks, plazas, floors)
   - Decorative terrain (rubble, debris, vegetation)
   - Hazardous areas (water, toxic zones, etc.)

4. PROPS & OBJECTS
   - Street furniture (lamps, benches, signs, kiosks)
   - Infrastructure (power lines, vents, pipes, barriers)
   - Vegetation and natural elements
   - Interactive/atmospheric objects
   - Debris and environmental details

5. WORLD FLAVOR
   - Cultural or era influences
   - Technology level and aesthetic
   - Environmental storytelling elements
   - Unique distinguishing features that make this world memorable

Write in vivid, descriptive prose. Be VERY specific about visual details - colors, textures, shapes, materials.
This description will be used to generate game sprites, so focus on concrete visual elements that can be drawn.
Aim for 400-600 words of rich description.`;
}
