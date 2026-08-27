/**
 * VLM configuration, read from the environment once at module load.
 *
 *   OPENROUTER_API_KEY
 *   VLM__MODEL       (default: google/gemini-3-flash-preview)
 *   VLM__IMAGE_SIZE  (default: 1536)
 *   VLM__TIMEOUT     (default: 60 seconds)
 */

export interface VlmSettings {
  model: string;
  /**
   * Longest edge, in pixels. Documents are downscaled to fit inside a square of
   * this size with their aspect ratio intact — small print has to stay legible.
   */
  imageSize: number;
  /** Request timeout in seconds. */
  timeout: number;
}

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value === undefined || value === '' || Number.isNaN(parsed) ? fallback : parsed;
};

export const vlmSettings: VlmSettings = {
  model: process.env['VLM__MODEL'] || 'google/gemini-3-flash-preview',
  imageSize: num(process.env['VLM__IMAGE_SIZE'], 1536),
  timeout: num(process.env['VLM__TIMEOUT'], 60.0),
};

export const openrouterApiKey: string | null = process.env['OPENROUTER_API_KEY'] || null;

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
