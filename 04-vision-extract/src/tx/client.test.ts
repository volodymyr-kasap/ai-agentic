import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPrompt } from './client.js';
import { NETWORKS, TRANSACTION_KINDS, TRANSACTION_STATUSES } from './fields.js';

test('the prompt lists every value of each closed vocabulary', () => {
  const prompt = buildPrompt(null);

  for (const kind of TRANSACTION_KINDS) {
    assert.ok(prompt.includes(kind), `kind ${kind} missing from the prompt`);
  }
  for (const status of TRANSACTION_STATUSES) {
    assert.ok(prompt.includes(status), `status ${status} missing from the prompt`);
  }
  for (const network of NETWORKS) {
    assert.ok(prompt.includes(network), `network ${network} missing from the prompt`);
  }
});

test('the prompt names every field of the response schema', () => {
  const prompt = buildPrompt(null);

  for (const field of [
    'kind',
    'status',
    'amount',
    'asset',
    'network',
    'from',
    'to',
    'txHash',
    'counterparty',
    'fee',
    'feeAsset',
    'timestamp',
    'confidence',
  ]) {
    assert.ok(prompt.includes(`"${field}"`), `field ${field} missing from the JSON template`);
  }
});

test('the prompt forbids guessing', () => {
  const prompt = buildPrompt(null);

  assert.match(prompt, /never guess/i);
  assert.match(prompt, /null/);
});

test('blank context is treated as absent', () => {
  const bare = buildPrompt(null);

  assert.equal(buildPrompt(undefined), bare);
  assert.equal(buildPrompt(''), bare);
  assert.equal(buildPrompt('   '), bare);
});

test('context is inserted before the JSON instruction, not after', () => {
  const prompt = buildPrompt('Screenshot from the Binance mobile app.');

  assert.ok(prompt.includes('Screenshot from the Binance mobile app.'));
  assert.ok(
    prompt.indexOf('Screenshot from the Binance mobile app.') < prompt.indexOf('Return JSON only'),
    'context must not come after the output instruction',
  );
  assert.ok(prompt.trimEnd().endsWith('}'), 'the prompt must end with the JSON template');
});
