/**
 * The closed vocabularies the model must choose from. Each list is rendered
 * into the prompt verbatim and re-checked when the response comes back, so a
 * value outside the list can never reach a caller.
 */

/** What kind of document the screenshot is. */
export const TRANSACTION_KINDS = [
  'crypto_transfer',
  'exchange_trade',
  'card_payment',
  'bank_transfer',
  'invoice',
  'unknown',
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** Settlement state as shown in the document. */
export const TRANSACTION_STATUSES = ['pending', 'confirmed', 'failed', 'unknown'] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/** Chains we accept; anything else (including fiat rails) resolves to null. */
export const NETWORKS = [
  'bitcoin',
  'ethereum',
  'solana',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'bnb_chain',
  'avalanche',
  'tron',
  'litecoin',
  'ripple',
] as const;

export type Network = (typeof NETWORKS)[number];

export const KIND_SET: ReadonlySet<string> = new Set(TRANSACTION_KINDS);
export const STATUS_SET: ReadonlySet<string> = new Set(TRANSACTION_STATUSES);
export const NETWORK_SET: ReadonlySet<string> = new Set(NETWORKS);

/** Comma-joined lists as they appear in the prompt. */
export const KINDS_BLOCK = TRANSACTION_KINDS.join(', ');
export const STATUSES_BLOCK = TRANSACTION_STATUSES.join(', ');
export const NETWORKS_BLOCK = NETWORKS.join(', ');
