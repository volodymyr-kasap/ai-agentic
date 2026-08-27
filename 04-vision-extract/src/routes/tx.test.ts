import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import sharp from 'sharp';

// `settings.ts` reads the environment at module-evaluation time, so the key has
// to be in place before the app graph is imported — hence the dynamic import.
process.env['OPENROUTER_API_KEY'] = 'test-key';
const { buildApp } = await import('../app.js');

const BOUNDARY = '----unknowingtestboundary';

/** Builds a multipart/form-data body with one file part plus optional fields. */
function multipartBody(
  file: { field: string; filename: string; content: Buffer } | null,
  fields: Record<string, string> = {},
): Buffer {
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  if (file) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${file.field}"; ` +
          `filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      file.content,
      Buffer.from('\r\n'),
    );
  }

  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

const MULTIPART_HEADERS = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };

const screenshotFixture = (): Promise<Buffer> =>
  sharp({
    create: { width: 400, height: 900, channels: 3, background: { r: 250, g: 250, b: 250 } },
  })
    .png()
    .toBuffer();

/** Captures the outgoing request so tests can assert on what the VLM was sent. */
let lastRequestBody: Record<string, unknown> | null = null;

/** Stubs the OpenRouter call with a canned chat-completion body. */
function stubFetch(modelJson: unknown): void {
  globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
    lastRequestBody = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelJson) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  lastRequestBody = null;
});

test('rejects a non-multipart request with 415', async () => {
  const app = buildApp({ logger: false });
  const res = await app.inject({ method: 'POST', url: '/tx/extract', payload: { a: 1 } });

  assert.equal(res.statusCode, 415);
  await app.close();
});

test('rejects a multipart request without an image part with 400', async () => {
  const app = buildApp({ logger: false });
  const res = await app.inject({
    method: 'POST',
    url: '/tx/extract',
    headers: MULTIPART_HEADERS,
    payload: multipartBody(null, { context: 'a receipt' }),
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /missing "image"/);
  await app.close();
});

test('rejects an over-long context with 400', async () => {
  const app = buildApp({ logger: false });
  const res = await app.inject({
    method: 'POST',
    url: '/tx/extract',
    headers: MULTIPART_HEADERS,
    payload: multipartBody(
      { field: 'image', filename: 'tx.png', content: await screenshotFixture() },
      { context: 'x'.repeat(1001) },
    ),
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /context exceeds/);
  await app.close();
});

test('rejects an undecodable image with 400', async () => {
  stubFetch({});
  const app = buildApp({ logger: false });
  const res = await app.inject({
    method: 'POST',
    url: '/tx/extract',
    headers: MULTIPART_HEADERS,
    payload: multipartBody({
      field: 'image',
      filename: 'tx.png',
      content: Buffer.from('not an image'),
    }),
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Invalid image format/);
  await app.close();
});

test('extracts a crypto transfer from a valid upload', async () => {
  stubFetch({
    kind: 'crypto_transfer',
    status: 'confirmed',
    amount: '0.5',
    asset: 'eth',
    network: 'ethereum',
    from: '0xAAA',
    to: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    txHash: '0xdeadbeef',
    counterparty: null,
    fee: '0.0012',
    feeAsset: 'eth',
    timestamp: '2026-08-15T10:22:00Z',
    confidence: 0.9,
  });

  const app = buildApp({ logger: false });
  const res = await app.inject({
    method: 'POST',
    url: '/tx/extract',
    headers: MULTIPART_HEADERS,
    payload: multipartBody({
      field: 'image',
      filename: 'tx.png',
      content: await screenshotFixture(),
    }),
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    kind: 'crypto_transfer',
    status: 'confirmed',
    amount: '0.5',
    asset: 'ETH',
    network: 'ethereum',
    from: '0xAAA',
    to: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    txHash: '0xdeadbeef',
    counterparty: null,
    fee: '0.0012',
    feeAsset: 'ETH',
    timestamp: '2026-08-15T10:22:00.000Z',
    confidence: 0.9,
  });
  await app.close();
});

test('a hallucinated network is scrubbed before it reaches the caller', async () => {
  stubFetch({ kind: 'crypto_transfer', network: 'definitely_not_a_chain', amount: 'about ten' });

  const app = buildApp({ logger: false });
  const res = await app.inject({
    method: 'POST',
    url: '/tx/extract',
    headers: MULTIPART_HEADERS,
    payload: multipartBody({
      field: 'image',
      filename: 'tx.png',
      content: await screenshotFixture(),
    }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().network, null);
  assert.equal(res.json().amount, null);
  await app.close();
});

test('the caller context reaches the prompt', async () => {
  stubFetch({ kind: 'invoice' });

  const app = buildApp({ logger: false });
  await app.inject({
    method: 'POST',
    url: '/tx/extract',
    headers: MULTIPART_HEADERS,
    payload: multipartBody(
      { field: 'image', filename: 'tx.png', content: await screenshotFixture() },
      { context: 'Invoice from a German supplier, amounts in EUR.' },
    ),
  });

  const messages = lastRequestBody?.['messages'] as {
    content: { type: string; text?: string }[];
  }[];
  const text = messages[0]?.content.find((part) => part.type === 'text')?.text ?? '';
  assert.match(text, /Invoice from a German supplier/);
  await app.close();
});

test('the image is sent downscaled with its aspect ratio intact', async () => {
  stubFetch({ kind: 'invoice' });

  const app = buildApp({ logger: false });
  await app.inject({
    method: 'POST',
    url: '/tx/extract',
    headers: MULTIPART_HEADERS,
    payload: multipartBody({
      field: 'image',
      filename: 'tx.png',
      content: await screenshotFixture(),
    }),
  });

  const messages = lastRequestBody?.['messages'] as {
    content: { type: string; image_url?: { url: string } }[];
  }[];
  const url = messages[0]?.content.find((part) => part.type === 'image_url')?.image_url?.url ?? '';
  assert.match(url, /^data:image\/jpeg;base64,/);

  const sent = Buffer.from(url.slice('data:image/jpeg;base64,'.length), 'base64');
  const meta = await sharp(sent).metadata();
  // The 400×900 fixture is under the 1536 cap, so it must arrive untouched.
  assert.equal(meta.width, 400);
  assert.equal(meta.height, 900);
  await app.close();
});

test('maps an upstream VLM failure to 502', async () => {
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;

  const app = buildApp({ logger: false });
  const res = await app.inject({
    method: 'POST',
    url: '/tx/extract',
    headers: MULTIPART_HEADERS,
    payload: multipartBody({
      field: 'image',
      filename: 'tx.png',
      content: await screenshotFixture(),
    }),
  });

  assert.equal(res.statusCode, 502);
  assert.match(res.json().error, /VLM request failed: 500/);
  await app.close();
});

test('maps unparseable model output to 502', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), {
      status: 200,
    })) as typeof fetch;

  const app = buildApp({ logger: false });
  const res = await app.inject({
    method: 'POST',
    url: '/tx/extract',
    headers: MULTIPART_HEADERS,
    payload: multipartBody({
      field: 'image',
      filename: 'tx.png',
      content: await screenshotFixture(),
    }),
  });

  assert.equal(res.statusCode, 502);
  assert.match(res.json().error, /VLM inference failed/);
  await app.close();
});
