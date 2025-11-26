import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import type { ImageGenerationConfig } from '../config';
import { defaultImageConfig } from '../config';

/**
 * Replace white (#FFFFFF) pixels with transparency.
 * Uses a tight tolerance to avoid making white parts of sprites transparent.
 * Relies on black outlines to separate sprites from background.
 */
async function chromaKeyWhite(imageBuffer: Buffer, tolerance = 15): Promise<Buffer> {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Process pixels: RGBA format (4 bytes per pixel)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;

    // Check if pixel is near white (#FFFFFF)
    const isNearWhite =
      r >= 255 - tolerance &&
      g >= 255 - tolerance &&
      b >= 255 - tolerance;

    if (isNearWhite) {
      // Set alpha to 0 (transparent)
      data[i + 3] = 0;
    }
  }

  // Reconstruct the image with transparency
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

/**
 * Generate a cache key from prompt + config.
 * Uses SHA256 hash (first 16 chars) to create filesystem-safe filename.
 */
function getCacheKey(prompt: string, config: ImageGenerationConfig): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({ prompt, config }))
    .digest('hex')
    .slice(0, 16);
  return `spritesheet-${hash}`;
}

export interface GenerateImageResult {
  path: string;
  cached: boolean;
}

export interface GenerateImageOptions {
  force?: boolean;
}

/**
 * Generate a spritesheet image using Google's Gemini model.
 *
 * Caching strategy:
 * - Cache key is SHA256(prompt + config)
 * - If cached image exists, returns cached path (unless force=true)
 * - Saves both image and metadata JSON for debugging
 *
 * @param prompt - The image generation prompt
 * @param outputDir - Directory to save the image
 * @param config - Image generation settings
 * @param options - Additional options (force regeneration)
 */
export async function generateSpritesheetImage(
  prompt: string,
  outputDir: string,
  config: ImageGenerationConfig = defaultImageConfig,
  options: GenerateImageOptions = {}
): Promise<GenerateImageResult> {
  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const cacheKey = getCacheKey(prompt, config);
  const imagePath = join(outputDir, `${cacheKey}.png`);
  const metaPath = join(outputDir, `${cacheKey}.meta.json`);

  // Check cache (unless --force)
  if (!options.force && existsSync(imagePath) && existsSync(metaPath)) {
    console.log(`📦 Using cached image: ${imagePath}`);
    return {
      path: imagePath,
      cached: true,
    };
  }

  console.log('🎨 Generating spritesheet image...');

  // Gemini image generation uses generateText with responseModalities: ['IMAGE']
  const result = await generateText({
    model: google(config.model),
    prompt,
    providerOptions: {
      google: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: config.aspectRatio,
          ...(config.imageSize && { imageSize: config.imageSize }),
        },
      },
    },
  });

  // Extract image from response files
  const imageFile = result.files?.find(f => f.mediaType.startsWith('image/'));
  if (!imageFile) {
    throw new Error('No image returned from Gemini');
  }

  // Apply chroma key to replace white background with transparency
  console.log('🔑 Applying chroma key (replacing white with transparency)...');
  const rawBuffer = Buffer.from(imageFile.uint8Array);
  const processedBuffer = await chromaKeyWhite(rawBuffer);

  // Save image as PNG with transparency
  writeFileSync(imagePath, processedBuffer);

  // Save metadata for cache validation and debugging
  const metadata = {
    prompt,
    model: config.model,
    aspectRatio: config.aspectRatio,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  console.log(`✅ Image saved: ${imagePath}`);

  return {
    path: imagePath,
    cached: false,
  };
}
