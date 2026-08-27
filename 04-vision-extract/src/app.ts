import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';

import healthRoutes from './routes/health.js';
import txRoutes, { MAX_IMAGE_BYTES } from './routes/tx.js';

export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: true,
    ...opts,
  });

  app.register(multipart, {
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  });

  app.register(healthRoutes);
  app.register(txRoutes);

  return app;
}
