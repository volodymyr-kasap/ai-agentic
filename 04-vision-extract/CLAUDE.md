# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # tsx watch src/index.ts
npm run build        # tsc -p tsconfig.build.json → dist/ (tests excluded)
npm start            # node dist/index.js (build first)
npm run typecheck    # tsc --noEmit over everything, tests included
npm test             # node --import tsx --test "src/**/*.test.ts"

# one file
node --import tsx --test src/tx/schema.test.ts
# one test by name
node --import tsx --test --test-name-pattern "decimal" src/tx/schema.test.ts
```

Node >= 22 required (`.nvmrc` → 22). `sharp` claims >=20.9 but ships import attributes Node 20.9 cannot parse, so the server dies at startup there.

There is no linter or formatter configured — `typecheck` is the only static gate. Test-only config: `tsconfig.build.json` extends `tsconfig.json` and excludes `*.test.ts`.

## Architecture

A Fastify HTTP server that reads a transaction off an uploaded screenshot via a vision model. One request path: `POST /tx/extract` (multipart) → `src/routes/tx.ts` → `extractTransaction()` in `src/tx/client.ts` → OpenRouter → `normalizeTransaction()` in `src/tx/schema.ts` → JSON response.

`src/tx/` is a self-contained module with its public surface in `src/tx/index.ts`; the routes layer is a thin adapter over it and holds only HTTP concerns (multipart parsing, size/length limits, error→status mapping).

Three invariants shape the code:

- **Nothing the model returns is trusted.** `schema.ts` is the only path from model output to caller and it never throws — a bad field becomes `null` rather than failing the extraction, so a partly legible screenshot still returns what was readable. Keep it total: no exceptions, no passthrough of unvalidated strings.
- **`fields.ts` is the single source of truth for closed vocabularies.** `TRANSACTION_KINDS`, `TRANSACTION_STATUSES` and `NETWORKS` are rendered verbatim into the prompt *and* re-checked on the way back. Adding a network is a one-line change there; `client.test.ts` asserts every vocabulary value and every schema key actually reaches the prompt, so a list edited in one place and not the other fails the tests.
- **Money is a string, never a number.** `amount` and `fee` stay decimal strings end to end — a float destroys wei precision and cents. `normalizeAmount` reduces printed forms (`$1,234.50`, `1 234,50 €`) to plain decimals and returns `null` for anything not unambiguously numeric.

Error mapping lives in one place, `routes/tx.ts`: `ImageProcessingError` → 400, `ModelInferenceError` → 502, missing API key → 503 (checked up front, so misconfiguration never masquerades as an upstream failure), oversize file → 413 via the `FST_REQ_FILE_TOO_LARGE` code from `@fastify/multipart`. `errors.ts` holds both error classes.

Provider isolation: OpenRouter is reached with a plain `fetch` in `client.ts` — no vendor SDK. Swapping providers touches that file only; the prompt, schema, route and tests do not know who serves the model. Switching *models* is config (`VLM__MODEL`), but any replacement must accept images and honour `response_format: {"type": "json_object"}` — unparseable output is a 502.

**Logging is deliberately narrow.** The extractor logs `kind`, `asset` and `confidence` only. Amounts, addresses and counterparties must stay out of logs.

## Configuration

Read once at module load in `src/tx/settings.ts`: `OPENROUTER_API_KEY` (required), `VLM__MODEL`, `VLM__IMAGE_SIZE` (1536, longest edge — downscale-only, aspect ratio preserved so small print survives), `VLM__TIMEOUT` (60s). `HOST`/`PORT` are read in `src/index.ts`. Node reads dotenv natively — `dev` and `start` pass `--env-file-if-exists=.env`, so no dotenv package is involved and none should be added. `npm test` intentionally does not load `.env`.

Because settings are module-load-time constants, tests that need a key must set `process.env` *before* importing the app graph — see the dynamic `await import('../app.js')` at the top of `src/routes/tx.test.ts`. Alternatively pass `{ apiKey, settings }` as the third argument to `extractTransaction()`, which is how the client tests avoid the environment entirely.

## Tests

Node's built-in runner, no network and no real key: `fetch` is stubbed globally (and restored in `afterEach`), and image fixtures are generated with `sharp` at run time. `buildApp()` returns an unbound instance so route tests drive it through `app.inject(...)`. The 413 and 503 paths depend on server state rather than request shape and are not covered by `inject`.
