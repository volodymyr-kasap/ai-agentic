import 'dotenv/config';
import Fastify, { LogController } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { answerQuestion } from './query.js';
import { getCollection } from './lib/chroma.js';

const PORT = Number(process.env.PORT || 3000);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const DEBUG = LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace';

const CONFIG = {
  PORT,
  LOG_LEVEL,
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434',
  EMBED_MODEL: process.env.EMBED_MODEL || 'nomic-embed-text',
  CHAT_MODEL: process.env.CHAT_MODEL || 'llama3.1',
  CHROMA_URL: process.env.CHROMA_URL || 'http://localhost:8000',
  COLLECTION_NAME: process.env.COLLECTION_NAME || 'site_rag',
  TOP_K: Number(process.env.TOP_K || 4),
};

let requestCounter = 0;

const app = Fastify({
  logger: {
    level: LOG_LEVEL,
    // Keep timestamps readable in a terminal instead of epoch millis.
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.socket?.remoteAddress,
      }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  },
  genReqId: () => `req-${++requestCounter}`,
  // We log the request lifecycle ourselves (with timings), so silence Fastify's built-in pair.
  logController: new LogController({ disableRequestLogging: true }),
});

/** Shorten long strings so logs stay scannable. */
function preview(text, max = 200) {
  if (typeof text !== 'string') return text;
  return text.length > max ? `${text.slice(0, max)}… (${text.length} chars)` : text;
}

// --- Request lifecycle logging -------------------------------------------

app.addHook('onRequest', async (request) => {
  request.startedAt = process.hrtime.bigint();
  request.log.info({ method: request.method, url: request.url }, 'incoming request');
  if (DEBUG) request.log.debug({ headers: request.headers }, 'request headers');
});

app.addHook('preHandler', async (request) => {
  if (DEBUG && request.body) request.log.debug({ body: request.body }, 'request body');
});

app.addHook('onResponse', async (request, reply) => {
  const ms = Number(process.hrtime.bigint() - request.startedAt) / 1e6;
  request.log.info(
    { method: request.method, url: request.url, statusCode: reply.statusCode, ms: +ms.toFixed(1) },
    'request completed'
  );
});

app.addHook('onError', async (request, reply, err) => {
  request.log.error(
    { err, name: err.name, code: err.code, cause: err.cause, statusCode: reply.statusCode },
    'request errored'
  );
});

app.setErrorHandler((err, request, reply) => {
  request.log.error({ err, stack: err.stack }, 'unhandled route error');
  reply.code(err.statusCode || 500).send({ error: err.message, requestId: request.id });
});

app.setNotFoundHandler((request, reply) => {
  request.log.warn({ method: request.method, url: request.url }, 'route not found');
  reply.code(404).send({ error: `Not found: ${request.method} ${request.url}` });
});

// Serves public/ at the root, so GET / returns public/index.html
await app.register(fastifyStatic, { root: path.resolve('public') });

// --- Routes ---------------------------------------------------------------

app.get('/api/health', async (request) => {
  const health = { ok: true, uptimeSec: +process.uptime().toFixed(1), config: CONFIG, checks: {} };

  // Ollama reachable, and are the configured models actually pulled?
  try {
    const res = await fetch(`${CONFIG.OLLAMA_URL}/api/tags`);
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    health.checks.ollama = {
      ok: res.ok,
      status: res.status,
      models,
      embedModelPulled: models.some((m) => m.startsWith(CONFIG.EMBED_MODEL)),
      chatModelPulled: models.some((m) => m.startsWith(CONFIG.CHAT_MODEL)),
    };
  } catch (err) {
    health.checks.ollama = { ok: false, error: err.message };
  }

  // Chroma reachable, and how many chunks are indexed?
  try {
    const collection = await getCollection();
    health.checks.chroma = { ok: true, collection: CONFIG.COLLECTION_NAME, count: await collection.count() };
  } catch (err) {
    health.checks.chroma = { ok: false, error: err.message };
  }

  health.ok = Object.values(health.checks).every((c) => c.ok);
  request.log.info({ health }, 'health check');
  return health;
});

app.post('/api/ask', async (request, reply) => {
  const { question } = request.body || {};
  if (!question || typeof question !== 'string') {
    request.log.warn({ body: request.body }, 'rejected /api/ask: missing or non-string "question"');
    return reply.code(400).send({ error: 'The request body must contain "question" (a string).' });
  }

  request.log.info({ question: preview(question), length: question.length }, 'answering question');
  const startedAt = process.hrtime.bigint();

  try {
    const result = await answerQuestion(question);
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    request.log.info(
      {
        ms: +ms.toFixed(1),
        sources: result.sources.length,
        answerLength: result.answer.length,
      },
      'answered question'
    );
    if (DEBUG) request.log.debug({ answer: preview(result.answer, 500), sources: result.sources }, 'answer payload');
    return result;
  } catch (err) {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    request.log.error(
      { err, name: err.name, code: err.code, cause: err.cause, ms: +ms.toFixed(1), question: preview(question) },
      'failed to answer question'
    );
    return reply.code(500).send({ error: err.message, requestId: request.id });
  }
});

// --- Process-level diagnostics -------------------------------------------

process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaught exception — exiting');
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

// --- Start ----------------------------------------------------------------

try {
  app.log.info(
    { config: CONFIG, node: process.version, pid: process.pid, cwd: process.cwd() },
    'starting RAG server'
  );
  await app.listen({ port: PORT });
  app.log.info(`RAG server running: http://localhost:${PORT} (health: /api/health)`);
} catch (err) {
  app.log.fatal({ err, port: PORT }, 'failed to start server');
  process.exit(1);
}
