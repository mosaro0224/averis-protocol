/**
 * Robinhood Chain Testnet adapter.
 * Chain ID: 46630
 * RPC: https://rpc.testnet.chain.robinhood.com
 * Explorer: https://explorer.testnet.chain.robinhood.com
 * ERC-8004: same testnet addresses as Arc Testnet (CREATE2 deterministic)
 */

import { createPublicClient, http, parseAbi } from "viem";

// Defined locally to avoid circular import with index.mjs
// (index.mjs imports this file, so we cannot import from index.mjs here)
const ERC8004_TESTNET = {
  identityRegistry:   "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  validationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
};

const RH_TESTNET_RPC = process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";

const rhChain = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RH_TESTNET_RPC] } },
};

let _client = null;
function getClient() {
  if (!_client) {
    _client = createPublicClient({ chain: rhChain, transport: http(RH_TESTNET_RPC) });
  }
  return _client;
}

const IDENTITY_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function totalSupply() view returns (uint256)",
]);

const REPUTATION_ABI = parseAbi([
  "function getReputation(uint256 agentId) view returns (uint256 score, uint256 totalJobs, uint256 successfulJobs, uint256 failedJobs)",
]);

async function getAgentIdentity(walletOrAgentId) {
  const client = getClient();
  try {
    // If it looks like an agentId (numeric string or number), resolve by tokenId
    if (typeof walletOrAgentId === "number" || /^\d+$/.test(String(walletOrAgentId))) {
      const agentId = BigInt(walletOrAgentId);
      const [owner, uri] = await Promise.all([
        client.readContract({ address: ERC8004_TESTNET.identityRegistry, abi: IDENTITY_ABI, functionName: "ownerOf", args: [agentId] }),
        client.readContract({ address: ERC8004_TESTNET.identityRegistry, abi: IDENTITY_ABI, functionName: "tokenURI", args: [agentId] }),
      ]);
      return {
        chainId: 46630,
        chainName: "Robinhood Chain Testnet",
        caip2: "eip155:46630",
        registryAddress: ERC8004_TESTNET.identityRegistry,
        agentId: Number(agentId),
        wallet: owner,
        metadataURI: uri,
        verified: true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function getTransactionHistory(wallet, fromBlock = 0n) {
  // Returns an empty array — RH Testnet transaction history is not yet indexed
  // Future: use eth_getLogs or Blockscout API
  return [];
}

function categorizeTransaction(tx) {
  // Future: categorize based on contract addresses and function selectors
  return "OTHER";
}

async function isReachable() {
  try {
    await getClient().getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

export const rhTestnetAdapter = {
  chainId: 46630,
  chainName: "Robinhood Chain Testnet",
  rpc: RH_TESTNET_RPC,
  explorer: "https://explorer.testnet.chain.robinhood.com",
  isTestnet: true,
  caip2: "eip155:46630",
  erc8004: ERC8004_TESTNET,
  // Passport contracts (populated from env after deployment)
  passportContracts: {
    policyRegistry:  process.env.PASSPORT_POLICY_REGISTRY  || null,
    receiptRegistry: process.env.PASSPORT_RECEIPT_REGISTRY || null,
  },
  getAgentIdentity,
  getTransactionHistory,
  categorizeTransaction,
  isReachable,
};
