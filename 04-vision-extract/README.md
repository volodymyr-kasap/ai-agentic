# Vision Extract — structured data out of a screenshot

Learning project: a vision model as a **parser**, not a chatbot. Upload a crypto
wallet or block-explorer screenshot, an exchange trade, a card or bank payment
confirmation, or an invoice, and get back validated structured fields.

The whole project is one lesson: **a model's output is untrusted input.** A VLM
reading a screenshot will occasionally invent a plausible-looking value, so nothing
it returns reaches the caller unchecked — a bad field becomes `null` instead of
failing the extraction, and money never becomes a JS number.

A Fastify HTTP server in TypeScript (ESM), 29 tests, no vendor SDK.

Requires **Node >= 22** — the repo has an `.nvmrc`, so `nvm use` picks the right version.

> `sharp` declares `>=20.9.0`, but ships `import … with { type: "json" }`, which Node 20.9 cannot parse — the server fails at startup there. Verified working on 22, 24 and 26.

```bash
npm install
cp .env.example .env   # then put your OpenRouter key in it
```

## Running

| Command | What it does |
|---|---|
| `npm run dev` | Runs `src/index.ts` through `tsx`, restarting on save |
| `npm run build` | Compiles `src/` to `dist/` (tests excluded) |
| `npm start` | Runs the compiled `dist/index.js` — build first |
| `npm run typecheck` | `tsc --noEmit` over everything, tests included |
| `npm test` | Node's test runner over `src/**/*.test.ts` via `tsx` |

The server listens on `HOST`/`PORT` (default `127.0.0.1:3000`) and shuts down cleanly on `SIGINT`/`SIGTERM`.

## Endpoints

### `GET /health`

```json
{ "status": "ok", "uptime": 12.34 }
```

### `POST /tx/extract`

`multipart/form-data`.

| Part | Required | Description |
|---|---|---|
| `image` | yes | Screenshot or photo (JPEG/PNG/WebP/…), max 10 MB |
| `context` | no | Free text about the image, max 1000 chars — e.g. which app it came from |

```bash
curl -F "image=@tx.png" \
     -F "context=Screenshot from the Binance mobile app" \
     localhost:3000/tx/extract
```

```json
{
  "kind": "crypto_transfer",
  "status": "confirmed",
  "amount": "0.5",
  "asset": "ETH",
  "network": "ethereum",
  "from": "0xAAA",
  "to": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  "txHash": "0xdeadbeef",
  "counterparty": null,
  "fee": "0.0012",
  "feeAsset": "ETH",
  "timestamp": "2026-08-15T10:22:00.000Z",
  "confidence": 0.9
}
```

**Response fields.** Every field except `kind` and `confidence` is nullable — the model is told to report `null` rather than guess, and any value failing validation is nulled out on the way back.

| Field | Notes |
|---|---|
| `kind` | `crypto_transfer`, `exchange_trade`, `card_payment`, `bank_transfer`, `invoice`, `unknown` |
| `status` | `pending`, `confirmed`, `failed`, `unknown`, or `null` |
| `amount`, `fee` | **Decimal strings, never numbers** — see below |
| `asset`, `feeAsset` | Uppercased ticker or currency code |
| `network` | One of the chains below, or `null` for anything off-chain |
| `timestamp` | ISO 8601 UTC |
| `confidence` | Model's own 0–1 confidence; `0` when it reported none |

Supported networks: `bitcoin`, `ethereum`, `solana`, `polygon`, `arbitrum`, `optimism`, `base`, `bnb_chain`, `avalanche`, `tron`, `litecoin`, `ripple`. The list lives in `src/tx/fields.ts` and feeds both the prompt and the validation on the way back, so adding a chain is a one-line change in one place.

**Failure responses** — all shaped `{ "error": string }`:

| Code | Cause |
|---|---|
| `400` | Missing `image` part, undecodable image, or `context` over 1000 chars |
| `413` | Image over the 10 MB limit |
| `415` | Request was not `multipart/form-data` |
| `502` | OpenRouter rejected the request, timed out, or returned unparseable output |
| `503` | `OPENROUTER_API_KEY` is not set |

## Handling model output

A VLM reading a screenshot will occasionally invent a plausible-looking value, so nothing it returns is trusted directly. `src/tx/schema.ts` is the only path from model output to caller, and it never throws — a bad field becomes `null` instead of failing the whole extraction, so a partly legible screenshot still returns what was readable.

- **Closed vocabularies.** `kind`, `status` and `network` are checked against the same lists rendered into the prompt. A hallucinated `"dogecoin"` becomes `null`, never a passthrough string. Matching is case- and separator-insensitive, so `"BNB-Chain"` resolves to `bnb_chain`.
- **Money stays a string.** `amount` and `fee` are never parsed into a JS number — `0.1 + 0.2` has no place near a ledger, and a wei-precision integer does not survive a float. Printed forms are reduced to a plain decimal (`$1,234.50` → `1234.50`, `1 234,50 €` → `1234.50`), including the ambiguous-separator cases; anything not unambiguously numeric becomes `null`.
- **Placeholders are absences.** `"N/A"`, `"none"`, `"unknown"`, `"—"` and friends normalize to `null` rather than reaching a caller as text.
- **Bounds.** Free-form fields over 256 characters are dropped, and `confidence` is clamped to 0–1.

## The model provider

Requests go to [OpenRouter](https://openrouter.ai), a gateway that fronts many model vendors behind one OpenAI-shaped `chat/completions` endpoint — one API key, one bill, no vendor SDK. That is why `src/tx/client.ts` is a plain `fetch` against `https://openrouter.ai/api/v1/chat/completions` and carries no dependency beyond `sharp`.

The vendor is chosen by the model string, so switching is a config change rather than a code change:

```bash
VLM__MODEL=anthropic/claude-sonnet-5 npm start
```

Anything vision-capable in OpenRouter's catalogue works. Two things to check when swapping: the model must accept images, and it must honour `response_format: {"type": "json_object"}` — the client asks for JSON and treats unparseable output as a `502`. Cost and latency vary by an order of magnitude across the catalogue, and OpenRouter adds its margin on top of the vendor's price.

**Worth knowing before production.** Every screenshot passes through a third party on its way to the model vendor — for transaction images that is a real data-handling decision, not a formality. Check OpenRouter's retention and training policy for the route you pick, and if it does not fit, go direct to the vendor or self-host. Either way the blast radius is `src/tx/client.ts`: the prompt, the schema, the route and the tests do not know who serves the model.

## Configuration

| Variable | Default |
|---|---|
| `OPENROUTER_API_KEY` | — (required; without it `/tx/extract` answers 503) |
| `VLM__MODEL` | `google/gemini-3-flash-preview` |
| `VLM__IMAGE_SIZE` | `1536` (longest edge, in pixels) |
| `VLM__TIMEOUT` | `60` (seconds) |
| `HOST` | `127.0.0.1` |
| `PORT` | `3000` |

Node reads a dotenv file natively, so no dependency is involved: `npm run dev` and `npm start` both pass `--env-file-if-exists=.env`, and a `.env` in the repo root is picked up automatically. Values are read once at module load. Real environment variables win over the file, so `VLM__MODEL=… npm start` still overrides.

`npm test` deliberately does *not* load `.env` — the tests stub `fetch` and use a dummy key.

**On `VLM__IMAGE_SIZE`.** Documents are downscaled to fit *inside* a square of this size with their aspect ratio intact, and never upscaled. Small print has to survive the round trip: a forced square resize would squash a tall receipt into unreadable mush. JPEG is encoded at quality 90 without chroma subsampling, which keeps thin text edges crisp at a modest size cost.

## Layout

```
src/
  index.ts          entrypoint: listen, graceful shutdown
  app.ts            buildApp() — Fastify instance, plugins, routes
  routes/
    health.ts       GET /health
    tx.ts           POST /tx/extract — multipart parsing, error mapping
  tx/
    client.ts       extractTransaction(), buildPrompt()
    schema.ts       Transaction type + normalization of model output
    fields.ts       closed vocabularies (kinds, statuses, networks)
    settings.ts     environment-backed config
    errors.ts       ModelInferenceError, ImageProcessingError
    index.ts        public surface of the module
```

`buildApp()` returns the instance without binding a port, so tests drive it through `app.inject(...)`.

## Using the extractor directly

```ts
import { readFile } from 'node:fs/promises';
import { extractTransaction } from './tx/index.js';

const tx = await extractTransaction(
  await readFile('tx.png'),
  'Screenshot from the Binance mobile app',
);
```

`context` is optional — pass `null` for the bare prompt. A third argument overrides the module defaults, which is how tests avoid touching the environment:

```ts
await extractTransaction(image, null, {
  apiKey: 'sk-or-...',
  settings: { model: 'google/gemini-3-flash-preview', imageSize: 1536, timeout: 60 },
  logger: request.log,
});
```

## Logging

The extractor logs `kind`, `asset` and `confidence` only. Amounts, wallet addresses and counterparties stay out of the logs — they are exactly the fields you do not want landing in a log aggregator.

## Tests

```bash
npm test
```

29 tests, no network access and no real API key needed — `fetch` is stubbed, the key is a dummy, and image fixtures are generated with `sharp` at run time.

- `src/tx/schema.test.ts` — normalization: printed amounts, decimal-separator ambiguity, precision that a float would destroy, closed-vocabulary enforcement, placeholder strings, bounds.
- `src/tx/client.test.ts` — the prompt carries every vocabulary value and every schema key, and caller context lands before the output instruction rather than after it.
- `src/routes/tx.test.ts` — the route end to end: multipart parsing, the `400`/`415`/`502` paths, and assertions on the request that actually left for the model, including that the image arrives with its aspect ratio intact. The `413` and `503` paths depend on server state rather than request shape and are exercised against a running server instead.
