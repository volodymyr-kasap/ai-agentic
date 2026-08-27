import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeAmount,
  normalizeAsset,
  normalizeTimestamp,
  normalizeTransaction,
} from './schema.js';

test('normalizeAmount reduces printed amounts to a plain decimal', () => {
  assert.equal(normalizeAmount('0.5'), '0.5');
  assert.equal(normalizeAmount('$1,234.50'), '1234.50');
  assert.equal(normalizeAmount('1 234,50 €'), '1234.50');
  assert.equal(normalizeAmount('1.234,56'), '1234.56');
  assert.equal(normalizeAmount('-0.00042 '), '-0.00042');
});

test('normalizeAmount keeps a lone comma as a decimal point', () => {
  assert.equal(normalizeAmount('12,5'), '12.5');
  assert.equal(normalizeAmount('12,500'), '12500');
});

test('normalizeAmount preserves precision instead of going through a float', () => {
  // 0.1 + 0.2 territory: the string must survive byte for byte.
  assert.equal(normalizeAmount('0.30000000000000004'), '0.30000000000000004');
  assert.equal(normalizeAmount('123456789012345678901234567890'), '123456789012345678901234567890');
});

test('normalizeAmount rejects anything not unambiguously numeric', () => {
  assert.equal(normalizeAmount('about ten'), null);
  assert.equal(normalizeAmount(''), null);
  assert.equal(normalizeAmount(null), null);
  assert.equal(normalizeAmount('1.2.3'), null);
});

test('normalizeAsset uppercases tickers and rejects prose', () => {
  assert.equal(normalizeAsset('eth'), 'ETH');
  assert.equal(normalizeAsset(' usdt '), 'USDT');
  assert.equal(normalizeAsset('US Dollars'), null);
  assert.equal(normalizeAsset('n/a'), null);
});

test('normalizeTimestamp converts to ISO 8601 UTC', () => {
  assert.equal(normalizeTimestamp('2026-08-15T10:22:00Z'), '2026-08-15T10:22:00.000Z');
  assert.equal(normalizeTimestamp('2026-08-15T12:22:00+02:00'), '2026-08-15T10:22:00.000Z');
  assert.equal(normalizeTimestamp('not a date'), null);
  assert.equal(normalizeTimestamp(null), null);
});

test('normalizeTransaction maps a well-formed model response', () => {
  const tx = normalizeTransaction({
    kind: 'crypto_transfer',
    status: 'confirmed',
    amount: '0.5',
    asset: 'eth',
    network: 'ethereum',
    from: '0xAAA',
    to: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    txHash: '0xdeadbeef',
    counterparty: 'Binance',
    fee: '0.0012',
    feeAsset: 'eth',
    timestamp: '2026-08-15T10:22:00Z',
    confidence: 0.9,
  });

  assert.deepEqual(tx, {
    kind: 'crypto_transfer',
    status: 'confirmed',
    amount: '0.5',
    asset: 'ETH',
    network: 'ethereum',
    from: '0xAAA',
    to: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    txHash: '0xdeadbeef',
    counterparty: 'Binance',
    fee: '0.0012',
    feeAsset: 'ETH',
    timestamp: '2026-08-15T10:22:00.000Z',
    confidence: 0.9,
  });
});

test('values outside the closed vocabularies become null, not passthrough', () => {
  const tx = normalizeTransaction({
    kind: 'wire_fraud',
    status: 'reversed',
    network: 'dogecoin',
  });

  assert.equal(tx.kind, 'unknown');
  assert.equal(tx.status, null);
  assert.equal(tx.network, null);
});

test('enum values are matched case- and separator-insensitively', () => {
  const tx = normalizeTransaction({ kind: 'Crypto Transfer', network: 'BNB-Chain' });

  assert.equal(tx.kind, 'crypto_transfer');
  assert.equal(tx.network, 'bnb_chain');
});

test('snake_case aliases from the model are accepted', () => {
  const tx = normalizeTransaction({ tx_hash: '0xabc', fee_asset: 'btc' });

  assert.equal(tx.txHash, '0xabc');
  assert.equal(tx.feeAsset, 'BTC');
});

test('placeholder strings are treated as absent', () => {
  const tx = normalizeTransaction({ from: 'N/A', to: 'unknown', counterparty: '  ' });

  assert.equal(tx.from, null);
  assert.equal(tx.to, null);
  assert.equal(tx.counterparty, null);
});

test('confidence is clamped and defaults to zero', () => {
  assert.equal(normalizeTransaction({ confidence: 1.7 }).confidence, 1);
  assert.equal(normalizeTransaction({ confidence: -2 }).confidence, 0);
  assert.equal(normalizeTransaction({ confidence: 'high' }).confidence, 0);
  assert.equal(normalizeTransaction({}).confidence, 0);
});

test('an over-long field is dropped rather than passed through', () => {
  const tx = normalizeTransaction({ to: 'x'.repeat(300) });

  assert.equal(tx.to, null);
});

test('a junk response still yields a complete, all-null transaction', () => {
  const tx = normalizeTransaction('not an object');

  assert.equal(tx.kind, 'unknown');
  assert.equal(tx.amount, null);
  assert.equal(tx.confidence, 0);
  assert.equal(Object.keys(tx).length, 13);
});
