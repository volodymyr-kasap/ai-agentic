import { KIND_SET, NETWORK_SET, STATUS_SET } from './fields.js';
import type { Network, TransactionKind, TransactionStatus } from './fields.js';

/**
 * A transaction as read off a screenshot. Every field except `kind` and
 * `confidence` is nullable: the model is told to report null rather than guess,
 * and anything it returns that fails validation here becomes null too.
 */
export interface Transaction {
  kind: TransactionKind;
  status: TransactionStatus | null;
  /** Plain decimal string — never a float, to keep cent/wei precision intact. */
  amount: string | null;
  asset: string | null;
  network: Network | null;
  from: string | null;
  to: string | null;
  txHash: string | null;
  counterparty: string | null;
  fee: string | null;
  feeAsset: string | null;
  /** ISO 8601 UTC, e.g. `2026-08-15T10:22:00.000Z`. */
  timestamp: string | null;
  /** Model-reported confidence, 0–1. Zero when the model omitted it. */
  confidence: number;
}

/** Longest string accepted for a free-form field; longer values are junk. */
const MAX_FIELD_LENGTH = 256;

const DECIMAL = /^-?\d+(\.\d+)?$/;
const TICKER = /^[A-Za-z0-9._-]{1,16}$/;

function str(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_FIELD_LENGTH) {
    return null;
  }
  // Models spell an absent value a dozen ways; treat the common ones as null.
  if (/^(null|none|n\/a|na|unknown|-|—)$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<string>): T | null {
  const raw = str(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  return raw !== undefined && raw !== null && allowed.has(raw) ? (raw as T) : null;
}

/**
 * Accepts what a screenshot realistically shows — `1,234.50`, `$1234.50`,
 * `1 234,50 €` — and reduces it to a plain decimal string. Returns null when
 * the result is not unambiguously numeric.
 */
export function normalizeAmount(value: unknown): string | null {
  const raw = str(value);
  if (raw === null) {
    return null;
  }

  let cleaned = raw.replace(/[^\d.,-]/g, '');

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever separator comes last is the decimal point.
    cleaned =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // A lone comma is a decimal point only when it is not grouping digits.
    cleaned = /,\d{3}(\D|$)/.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  }

  return DECIMAL.test(cleaned) ? cleaned : null;
}

/** Uppercases a ticker or currency code, rejecting anything sentence-shaped. */
export function normalizeAsset(value: unknown): string | null {
  const raw = str(value);
  return raw !== null && TICKER.test(raw) ? raw.toUpperCase() : null;
}

/** Normalizes any parseable date to ISO 8601 UTC. */
export function normalizeTimestamp(value: unknown): string | null {
  const raw = str(value);
  if (raw === null) {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function confidenceOf(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}

/**
 * Turns the model's raw JSON object into a `Transaction`. Never throws: an
 * unusable field is dropped to null rather than failing the whole extraction,
 * so a partially legible screenshot still returns what was readable.
 */
export function normalizeTransaction(raw: unknown): Transaction {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  return {
    kind: enumValue<TransactionKind>(o['kind'], KIND_SET) ?? 'unknown',
    status: enumValue<TransactionStatus>(o['status'], STATUS_SET),
    amount: normalizeAmount(o['amount']),
    asset: normalizeAsset(o['asset']),
    network: enumValue<Network>(o['network'], NETWORK_SET),
    from: str(o['from']),
    to: str(o['to']),
    txHash: str(o['txHash'] ?? o['tx_hash']),
    counterparty: str(o['counterparty']),
    fee: normalizeAmount(o['fee']),
    feeAsset: normalizeAsset(o['feeAsset'] ?? o['fee_asset']),
    timestamp: normalizeTimestamp(o['timestamp']),
    confidence: confidenceOf(o['confidence']),
  };
}
