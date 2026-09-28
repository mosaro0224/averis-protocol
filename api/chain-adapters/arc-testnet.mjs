/**
 * Arc Testnet adapter.
 * Chain ID: 5042002
 * RPC: https://rpc.testnet.arc.io
 * Explorer: https://explorer.testnet.arc.io
 * ERC-8004: same testnet addresses (CREATE2 deterministic)
 *
 * Arc is where Averis Bank contracts live. This adapter also provides
 * identity resolution for agents registered on Arc.
 */

import { createPublicClient, http, parseAbi } from "viem";

// Defined locally to avoid circular import with index.mjs
// (index.mjs imports this file, so we cannot import from index.mjs here)
const ERC8004_TESTNET = {
  identityRegistry:   "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  validationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
};

const ARC_RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io";

const arcChain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
};

let _client = null;
function getClient() {
  if (!_client) {
    _client = createPublicClient({ chain: arcChain, transport: http(ARC_RPC) });
  }
  return _client;
}

const IDENTITY_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

const FINANCING_ABI = parseAbi([
  "function positions(uint256 jobId) view returns (address agent, uint96 principal, uint96 fee, uint96 principalRepaid, uint96 feeRepaid, uint8 status, uint256 expiry, address poolAddress, uint8 mode)",
  "function creditLimits(address agent) view returns (uint128)",
  "function advanceRateBps() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function protocolMaximum() view returns (uint256)",
]);

const HOOD_ABI = parseAbi([
  "function agentExposure(address agent) view returns (uint128)",
  "function maxExposurePerAgent() view returns (uint128)",
  "function paused() view returns (bool)",
]);

const VAULT_ABI = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
]);

async function getAgentIdentity(walletOrAgentId) {
  const client = getClient();
  try {
    if (typeof walletOrAgentId === "number" || /^\d+$/.test(String(walletOrAgentId))) {
      const agentId = BigInt(walletOrAgentId);
      const [owner, uri] = await Promise.all([
        client.readContract({ address: ERC8004_TESTNET.identityRegistry, abi: IDENTITY_ABI, functionName: "ownerOf", args: [agentId] }),
        client.readContract({ address: ERC8004_TESTNET.identityRegistry, abi: IDENTITY_ABI, functionName: "tokenURI", args: [agentId] }),
      ]);
      return {
        chainId: 5042002,
        chainName: "Arc Testnet",
        caip2: "eip155:5042002",
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
  // Future: scan Drawn/Repaid/Defaulted events from AverisFinancingV2
  return [];
}

function categorizeTransaction(tx) {
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

export const arcTestnetAdapter = {
  chainId: 5042002,
  chainName: "Arc Testnet",
  rpc: ARC_RPC,
  explorer: "https://explorer.testnet.arc.io",
  isTestnet: true,
  caip2: "eip155:5042002",
  erc8004: ERC8004_TESTNET,
  passportContracts: {
    policyRegistry:  process.env.PASSPORT_POLICY_REGISTRY_ARC  || null,
    receiptRegistry: process.env.PASSPORT_RECEIPT_REGISTRY_ARC || null,
  },
  getAgentIdentity,
  getTransactionHistory,
  categorizeTransaction,
  isReachable,
  // Arc-specific Averis Bank contract reads
  averisContracts: {
    financing: process.env.AVERIS_FINANCING || null,
    hood:      process.env.AVERIS_HOOD      || null,
    vault:     process.env.AVERIS_VAULT     || null,
  },
  abis: { FINANCING_ABI, HOOD_ABI, VAULT_ABI },
};
