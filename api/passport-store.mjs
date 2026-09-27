/**
 * Passport persistent store.
 *
 * Persists to /data/passport-store.json on Railway (persistent volume).
 * Falls back to /tmp/passport-store.json in development.
 *
 * Schema is migration-friendly: each domain is a top-level key.
 * Future Postgres migration: each domain → table, agentWallet → primary key prefix.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

const STORE_PATH = existsSync("/data")
  ? "/data/passport-store.json"
  : "/tmp/passport-store.json";

const SCHEMA_VERSION = 1;

const EMPTY_STORE = {
  version: SCHEMA_VERSION,
  capabilities:   {},   // agentWallet → Capability[]
  transactions:   {},   // agentWallet → Transaction[]
  counterparties: {},   // agentWallet → Counterparty[]
  agreements:     {},   // agentWallet → Agreement[]
  receipts_meta:  {},   // agentWallet → ReceiptMeta[]
  identityLinks:  {},   // agentWallet → IdentityLink[]
};

let _store = null;

function load() {
  if (_store) return _store;
  try {
    if (existsSync(STORE_PATH)) {
      const raw = readFileSync(STORE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      // Migrate: add any missing domains
      _store = { ...EMPTY_STORE, ...parsed };
      return _store;
    }
  } catch (e) {
    console.warn("[passport-store] Failed to load store, using empty:", e.message);
  }
  _store = { ...EMPTY_STORE };
  return _store;
}

function save() {
  try {
    const dir = dirname(STORE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(_store, null, 2), "utf8");
  } catch (e) {
    console.error("[passport-store] Failed to save:", e.message);
  }
}

function getStore() {
  return load();
}

// ── Capabilities ──────────────────────────────────────────────────────────────

export function getCapabilities(wallet) {
  return getStore().capabilities[wallet.toLowerCase()] ?? [];
}

export function setCapabilities(wallet, capabilities) {
  const store = getStore();
  store.capabilities[wallet.toLowerCase()] = capabilities;
  save();
}

export function addCapability(wallet, capability) {
  const store = getStore();
  const key = wallet.toLowerCase();
  const existing = store.capabilities[key] ?? [];
  // Dedup by type
  const filtered = existing.filter(c => c.type !== capability.type);
  store.capabilities[key] = [...filtered, { ...capability, addedAt: Date.now() }];
  save();
}

export function removeCapability(wallet, type) {
  const store = getStore();
  const key = wallet.toLowerCase();
  store.capabilities[key] = (store.capabilities[key] ?? []).filter(c => c.type !== type);
  save();
}

// ── Transactions ──────────────────────────────────────────────────────────────

export function getTransactions(wallet, { type, status, counterparty, limit = 50, offset = 0 } = {}) {
  let txs = getStore().transactions[wallet.toLowerCase()] ?? [];
  if (type)         txs = txs.filter(t => t.type === type);
  if (status)       txs = txs.filter(t => t.status === status);
  if (counterparty) txs = txs.filter(t => t.counterparty?.toLowerCase() === counterparty.toLowerCase());
  // Sort newest first
  txs = [...txs].sort((a, b) => b.timestamp - a.timestamp);
  return { total: txs.length, items: txs.slice(offset, offset + limit) };
}

export function addTransaction(wallet, tx) {
  const store = getStore();
  const key = wallet.toLowerCase();
  store.transactions[key] = [...(store.transactions[key] ?? []), { ...tx, id: `tx_${Date.now()}_${Math.random().toString(36).slice(2)}` }];
  save();
}

// ── Counterparties ─────────────────────────────────────────────────────────────

export function getCounterparties(wallet) {
  return getStore().counterparties[wallet.toLowerCase()] ?? [];
}

export function upsertCounterparty(wallet, counterparty) {
  const store = getStore();
  const key = wallet.toLowerCase();
  const existing = store.counterparties[key] ?? [];
  const idx = existing.findIndex(c => c.address?.toLowerCase() === counterparty.address?.toLowerCase());
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...counterparty, lastInteraction: Date.now() };
  } else {
    existing.push({ ...counterparty, firstInteraction: Date.now(), lastInteraction: Date.now() });
  }
  store.counterparties[key] = existing;
  save();
}

// ── Agreements ─────────────────────────────────────────────────────────────────

export function getAgreements(wallet) {
  return getStore().agreements[wallet.toLowerCase()] ?? [];
}

export function addAgreement(wallet, agreement) {
  const store = getStore();
  const key = wallet.toLowerCase();
  store.agreements[key] = [...(store.agreements[key] ?? []), {
    ...agreement,
    id: `agr_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
  }];
  save();
}

// ── Receipt metadata (offchain portion) ───────────────────────────────────────

export function getReceiptsMeta(wallet) {
  return getStore().receipts_meta[wallet.toLowerCase()] ?? [];
}

export function addReceiptMeta(wallet, meta) {
  const store = getStore();
  const key = wallet.toLowerCase();
  store.receipts_meta[key] = [...(store.receipts_meta[key] ?? []), {
    ...meta,
    recordedAt: Date.now(),
  }];
  save();
}

// ── Identity links ─────────────────────────────────────────────────────────────

export function getIdentityLinks(wallet) {
  return getStore().identityLinks[wallet.toLowerCase()] ?? [];
}

export function addIdentityLink(wallet, link) {
  const store = getStore();
  const key = wallet.toLowerCase();
  const existing = store.identityLinks[key] ?? [];
  // Dedup by caip2+agentId
  const filtered = existing.filter(
    l => !(l.caip2 === link.caip2 && l.agentId === link.agentId)
  );
  store.identityLinks[key] = [...filtered, { ...link, linkedAt: Date.now() }];
  save();
}

// ── Aggregated reputation evidence ────────────────────────────────────────────

export function getReputationEvidence(wallet) {
  const txs   = getStore().transactions[wallet.toLowerCase()] ?? [];
  const receipts = getStore().receipts_meta[wallet.toLowerCase()] ?? [];

  const completed   = txs.filter(t => t.type === "JOB_PAYMENT" && t.status === "completed").length;
  const failed      = txs.filter(t => t.type === "JOB_PAYMENT" && t.status === "failed").length;
  const disputed    = txs.filter(t => t.status === "disputed").length;
  const repaid      = txs.filter(t => t.type === "CREDIT_REPAYMENT" && t.status === "completed").length;
  const outstanding = txs.filter(t => t.type === "FINANCING" && t.status === "active").length;

  return {
    jobsCompleted:      completed,
    jobsFailed:         failed,
    jobsDisputed:       disputed,
    paymentsCompleted:  txs.filter(t => t.type === "PAYMENT" && t.status === "completed").length,
    financingRepaid:    repaid,
    outstandingObligations: outstanding,
    counterpartyCount:  (getStore().counterparties[wallet.toLowerCase()] ?? []).length,
    receiptCount:       receipts.length,
    verifiedReceipts:   receipts.filter(r => r.verificationState === "AVERIS_VERIFIED").length,
    attestations:       receipts.filter(r => r.verificationState === "EXTERNAL_ATTESTER").length,
  };
}
