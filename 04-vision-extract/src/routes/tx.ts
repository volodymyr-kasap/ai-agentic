import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { extractTransaction } from '../tx/client.js';
import { ImageProcessingError, ModelInferenceError } from '../tx/errors.js';
import type { Transaction } from '../tx/schema.js';
import { openrouterApiKey } from '../tx/settings.js';

/** Rejected uploads larger than this never reach sharp. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Free-text hint from the caller; long enough to describe an image, no more. */
const MAX_CONTEXT_LENGTH = 1000;

export default async function txRoutes(app: FastifyInstance): Promise<void> {
  if (!openrouterApiKey) {
    app.log.warn('OPENROUTER_API_KEY is not set — POST /tx/extract will answer 503');
  }

  app.post(
    '/tx/extract',
    async (request: FastifyRequest, reply: FastifyReply): Promise<Transaction | undefined> => {
      // A missing key is a server misconfiguration, not an upstream failure, so
      // it is answered before any work is done rather than surfacing as a 502.
      if (!openrouterApiKey) {
        return reply.code(503).send({ error: 'VLM is not configured' });
      }

      if (!request.isMultipart()) {
        return reply
          .code(415)
          .send({ error: 'expected multipart/form-data with an "image" file part' });
      }

      let image: Buffer | undefined;
      let context: string | null = null;

      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'image') {
              // Drain unexpected files so the request stream can finish.
              await part.toBuffer();
              continue;
            }
            image = await part.toBuffer();
          } else if (part.fieldname === 'context') {
            context = String(part.value);
          }
        }
      } catch (e) {
        if (e instanceof Error && 'code' in e && e.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({ error: 'image exceeds the 10 MB limit' });
        }
        throw e;
      }

      if (!image || image.length === 0) {
        return reply.code(400).send({ error: 'missing "image" file part' });
      }

      if (context !== null && context.length > MAX_CONTEXT_LENGTH) {
        return reply
          .code(400)
          .send({ error: `context exceeds ${MAX_CONTEXT_LENGTH} characters` });
      }

      try {
        return await extractTransaction(image, context, { logger: request.log });
      } catch (e) {
        if (e instanceof ImageProcessingError) {
          return reply.code(400).send({ error: e.message });
        }
        if (e instanceof ModelInferenceError) {
          request.log.error({ err: e }, 'VLM extraction failed');
          return reply.code(502).send({ error: e.message });
        }
        throw e;
      }
    },
  );
}

export { MAX_CONTEXT_LENGTH, MAX_IMAGE_BYTES };
