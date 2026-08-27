import sharp from 'sharp';

import { ImageProcessingError, ModelInferenceError } from './errors.js';
import { KINDS_BLOCK, NETWORKS_BLOCK, STATUSES_BLOCK } from './fields.js';
import { normalizeTransaction } from './schema.js';
import type { Transaction } from './schema.js';
import { OPENROUTER_URL, openrouterApiKey, vlmSettings } from './settings.js';
import type { VlmSettings } from './settings.js';

const PROMPT_BASE = `You are a financial document analyst.

Extract the transaction shown in this image. It may be a crypto wallet or block explorer screenshot, an exchange trade, a card or bank payment confirmation, or an invoice.

Report only what is legible in the image. Use null for any field that is not clearly visible — never guess a value, never infer one from another field, and never complete a truncated address.

Fields:
- kind: one of ${KINDS_BLOCK}
- status: one of ${STATUSES_BLOCK}, or null if the document does not show one
- amount: the principal amount as a plain decimal string, without separators or currency symbols
- asset: the ticker or currency code as shown, e.g. BTC, ETH, USDT, USD, EUR
- network: one of ${NETWORKS_BLOCK}, or null when the payment is not on-chain
- from: sender address or account, exactly as printed
- to: recipient address or account, exactly as printed
- txHash: transaction hash or reference number
- counterparty: merchant, exchange or contact name
- fee: network or service fee, same format as amount
- feeAsset: currency of the fee
- timestamp: ISO 8601 with a timezone, or null if no date and time are shown
- confidence: your confidence between 0.0 and 1.0 that this extraction is correct`;

const PROMPT_SUFFIX = `
Return JSON only, with exactly these keys: {"kind": ..., "status": ..., "amount": ..., "asset": ..., "network": ..., "from": ..., "to": ..., "txHash": ..., "counterparty": ..., "fee": ..., "feeAsset": ..., "timestamp": ..., "confidence": ...}`;

/** Minimal logger shape — satisfied by both `console` and Fastify's logger. */
export interface VlmLogger {
  info(message: string): void;
}

export interface ExtractOptions {
  settings?: VlmSettings;
  apiKey?: string | null;
  logger?: VlmLogger;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Builds the extraction prompt. `context` is optional free text from the
 * caller — what the screenshot is, which app it came from, anything that
 * narrows the reading.
 */
export function buildPrompt(context: string | null | undefined): string {
  if (context === null || context === undefined || context.trim() === '') {
    return PROMPT_BASE + PROMPT_SUFFIX;
  }
  return `${PROMPT_BASE}

The caller provided this context about the image:
${context.trim()}${PROMPT_SUFFIX}`;
}

/**
 * Reads a transaction off a screenshot via the VLM.
 *
 * Throws ImageProcessingError on an unreadable image and ModelInferenceError
 * when the model call fails or returns something unusable.
 *
 * @param image Encoded image bytes (JPEG/PNG/WebP/...).
 */
export async function extractTransaction(
  image: Buffer | Uint8Array | ArrayBuffer,
  context: string | null = null,
  options: ExtractOptions = {},
): Promise<Transaction> {
  const settings = options.settings ?? vlmSettings;
  const apiKey = options.apiKey !== undefined ? options.apiKey : openrouterApiKey;
  const logger = options.logger ?? console;

  if (!apiKey) {
    throw new ModelInferenceError('OpenRouter API key not configured (OPENROUTER_API_KEY)');
  }

  let b64: string;
  try {
    const jpeg = await sharp(image instanceof ArrayBuffer ? Buffer.from(image) : image)
      .flatten({ background: '#ffffff' })
      .resize(settings.imageSize, settings.imageSize, {
        fit: 'inside',
        withoutEnlargement: true,
        kernel: 'lanczos3',
      })
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
      .toBuffer();
    b64 = jpeg.toString('base64');
  } catch (e) {
    throw new ImageProcessingError(`Invalid image format or corrupted image: ${messageOf(e)}`, {
      cause: e,
    });
  }

  let raw: unknown;
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
              { type: 'text', text: buildPrompt(context) },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(settings.timeout * 1000),
    });

    if (!response.ok) {
      throw new ModelInferenceError(`VLM request failed: ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (content === undefined) {
      throw new ModelInferenceError('VLM returned no message content');
    }
    raw = JSON.parse(content);
  } catch (e) {
    if (e instanceof ModelInferenceError) {
      throw e;
    }
    throw new ModelInferenceError(`VLM inference failed: ${messageOf(e)}`, { cause: e });
  }

  const transaction = normalizeTransaction(raw);
  logger.info(
    `Transaction extracted: kind=${transaction.kind} asset=${transaction.asset ?? '-'} ` +
      `confidence=${transaction.confidence}`,
  );
  return transaction;
}
