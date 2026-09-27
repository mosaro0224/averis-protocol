/**
 * Chain adapter registry.
 * Each adapter implements the IChainAdapter interface:
 *   chainId, chainName, rpc, explorer, erc8004, isTestnet
 *   getAgentIdentity(walletOrId) → IdentityRecord | null
 *   getTransactionHistory(wallet, fromBlock) → TxRecord[]
 *
 * Import adapters lazily so the server starts even if one chain is unreachable.
 */

import { rhTestnetAdapter }  from "./rh-testnet.mjs";
import { arcTestnetAdapter } from "./arc-testnet.mjs";

const ADAPTERS = [rhTestnetAdapter, arcTestnetAdapter];

/** Look up adapter by chainId. Returns null if not found. */
export function getAdapter(chainId) {
  return ADAPTERS.find(a => a.chainId === Number(chainId)) ?? null;
}

/** All registered adapters. */
export function getAllAdapters() {
  return ADAPTERS;
}

/** Canonical ERC-8004 testnet addresses (same across all testnets). */
export const ERC8004_TESTNET = {
  identityRegistry:   "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  validationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
};

/** Canonical ERC-8004 mainnet addresses (same across all mainnets). */
export const ERC8004_MAINNET = {
  identityRegistry:   "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  validationRegistry: null,
};
