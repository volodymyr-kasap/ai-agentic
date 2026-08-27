import type { FastifyInstance } from 'fastify';

interface HealthResponse {
  status: 'ok';
  uptime: number;
}

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    uptime: process.uptime(),
  }));
}
