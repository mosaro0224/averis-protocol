/* =========================================================
   Averis Protocol — app.js
   Arc Testnet (chain 5042002) · USDC 0x3600...0000
   ========================================================= */

const CHAIN_ID     = 5042002;
const CHAIN_HEX    = '0x' + CHAIN_ID.toString(16);
const RPC          = 'https://rpc.testnet.arc.io';
const USDC_ADDR    = '0x3600000000000000000000000000000000000000';
const VAULT_ADDR   = '0xf7F47493E2f042a428a531724bE62854002979cA';
const API_BASE     = 'https://averis-protocol-production.up.railway.app';

// Minimal ABIs
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
];
const VAULT_ABI = [
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function withdraw(uint256 shares, address receiver, address owner) returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
];

// ── State ────────────────────────────────────────────────
let account = null;
let txPending = false;

// ── Toast (fires once, auto-dismisses after 4s) ──────────
function toast(msg, isError = false) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  container.appendChild(el);
  // Animate in
  requestAnimationFrame(() => { requestAnimationFrame(() => { el.classList.add('show'); }); });
  // Auto-dismiss after 4s
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ── Tab switching ────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ── RPC helper ───────────────────────────────────────────
async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

function encodeCall(sig, ...args) {
  // Very minimal ABI encoder for simple view calls (address, uint256 only)
  const selector = sig.slice(0, 10);
  const encoded = args.map(a => {
    if (typeof a === 'string' && a.startsWith('0x') && a.length === 42)
      return a.slice(2).toLowerCase().padStart(64, '0');
    const n = BigInt(a);
    return n.toString(16).padStart(64, '0');
  }).join('');
  return selector + encoded;
}

async function callView(addr, sig, ...args) {
  const data = encodeCall(sig, ...args);
  const hex = await rpc('eth_call', [{ to: addr, data }, 'latest']);
  return BigInt(hex);
}

function fmt(raw, decimals = 6, dp = 2) {
  const d = Number(raw) / 10 ** decimals;
  return d.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// ── Load metrics from API ────────────────────────────────
async function loadMetrics() {
  try {
    const res = await fetch(`${API_BASE}/v1/discover`);
    const data = await res.json();
    const tvl = data?.vault_status?.total_assets_usdc ?? data?.tvl_usdc ?? null;
    const avail = data?.vault_status?.available_usdc ?? data?.available_usdc ?? null;
    const util = data?.vault_status?.utilization_bps != null
      ? (data.vault_status.utilization_bps / 100).toFixed(1) + '%'
      : null;
    const pos = data?.active_positions ?? null;
    if (tvl !== null) document.querySelector('[data-chain="tvl"]').textContent = '$' + Number(tvl).toLocaleString();
    if (avail !== null) document.querySelector('[data-chain="available"]').textContent = '$' + Number(avail).toLocaleString();
    if (util !== null) document.querySelector('[data-chain="utilization"]').textContent = util;
    if (pos !== null) document.querySelector('[data-chain="positions"]').textContent = pos;
  } catch { /* silently skip if API is unavailable */ }
}

// ── Load user vault data ─────────────────────────────────
async function loadUserVault() {
  if (!account) return;
  try {
    const sharesRaw = await callView(
      VAULT_ADDR,
      '0x70a08231', // balanceOf(address)
      account
    );
    const assetsRaw = sharesRaw > 0n
      ? await callView(VAULT_ADDR, '0x4cdad506', sharesRaw) // previewRedeem
      : 0n;

    document.getElementById('user-supplied').textContent = '$' + fmt(assetsRaw) + ' USDC';
    document.getElementById('user-shares').textContent = fmt(sharesRaw, 6, 4);
    document.getElementById('user-fees').textContent = assetsRaw > 0n ? '~' + fmt(assetsRaw - (sharesRaw * 1n), 6, 4) + ' USDC' : '—';
  } catch {
    document.getElementById('user-supplied').textContent = '—';
    document.getElementById('user-shares').textContent = '—';
  }
}

// ── Switch to Arc Testnet ────────────────────────────────
async function ensureNetwork() {
  const chainHex = await window.ethereum.request({ method: 'eth_chainId' });
  if (chainHex.toLowerCase() === CHAIN_HEX.toLowerCase()) return true;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN_HEX }],
    });
    return true;
  } catch (err) {
    if (err.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN_HEX,
          chainName: 'Arc Testnet',
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: [RPC],
          blockExplorerUrls: ['https://explorer.testnet.arc.io'],
        }],
      });
      return true;
    }
    throw err;
  }
}

// ── Wallet connect ───────────────────────────────────────
const connectBtn = document.getElementById('connect');

async function connectWallet() {
  if (!window.ethereum) {
    toast('Install a wallet (MetaMask, Rabby, etc.) to connect.', true);
    return;
  }
  try {
    const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    account = addr;
    connectBtn.textContent = addr.slice(0, 6) + '…' + addr.slice(-4);
    await ensureNetwork();
    enableVaultButtons();
    await loadUserVault();
  } catch (err) {
    if (err.code !== 4001) toast('Connection error: ' + (err.message || err), true);
  }
}

connectBtn.addEventListener('click', connectWallet);

if (window.ethereum) {
  window.ethereum.on('accountsChanged', accs => {
    account = accs[0] || null;
    if (account) {
      connectBtn.textContent = account.slice(0, 6) + '…' + account.slice(-4);
      enableVaultButtons();
      loadUserVault();
    } else {
      connectBtn.textContent = 'CONNECT WALLET';
      disableVaultButtons();
    }
  });
  window.ethereum.on('chainChanged', () => window.location.reload());

  // Auto-reconnect if already approved
  window.ethereum.request({ method: 'eth_accounts' }).then(accs => {
    if (accs[0]) {
      account = accs[0];
      connectBtn.textContent = account.slice(0, 6) + '…' + account.slice(-4);
      enableVaultButtons();
      loadUserVault();
    }
  });
}

// ── Vault button state ───────────────────────────────────
function enableVaultButtons() {
  document.getElementById('btn-deposit').disabled = false;
  document.getElementById('btn-withdraw').disabled = false;
}
function disableVaultButtons() {
  document.getElementById('btn-deposit').disabled = true;
  document.getElementById('btn-withdraw').disabled = true;
}

// ── DEPOSIT ──────────────────────────────────────────────
document.getElementById('btn-deposit').addEventListener('click', async () => {
  if (txPending) return;
  const raw = document.getElementById('deposit-amount').value.trim();
  if (!raw || isNaN(raw) || Number(raw) <= 0) {
    toast('Enter a valid USDC amount.', true);
    return;
  }
  const amount = BigInt(Math.round(Number(raw) * 1e6)); // 6 decimals

  try {
    txPending = true;
    document.getElementById('btn-deposit').disabled = true;

    await ensureNetwork();

    // 1. Check allowance
    const allowanceHex = await rpc('eth_call', [{
      to: USDC_ADDR,
      data: encodeCall('0xdd62ed3e', account, VAULT_ADDR),
    }, 'latest']);
    const allowance = BigInt(allowanceHex);

    if (allowance < amount) {
      // Approve first
      const approveTx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: account,
          to: USDC_ADDR,
          data: '0x095ea7b3' +
            VAULT_ADDR.slice(2).toLowerCase().padStart(64, '0') +
            amount.toString(16).padStart(64, '0'),
        }],
      });
      await waitForTx(approveTx);
    }

    // 2. Deposit
    const depositTx = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: account,
        to: VAULT_ADDR,
        data: '0x6e553f65' +
          amount.toString(16).padStart(64, '0') +
          account.slice(2).toLowerCase().padStart(64, '0'),
      }],
    });
    await waitForTx(depositTx);

    toast('Deposit confirmed. Vault shares minted.');
    document.getElementById('deposit-amount').value = '';
    await loadUserVault();
    await loadMetrics();

  } catch (err) {
    if (err.code !== 4001) toast('Deposit failed: ' + (err.message || err), true);
  } finally {
    txPending = false;
    if (account) document.getElementById('btn-deposit').disabled = false;
  }
});

// ── WITHDRAW ─────────────────────────────────────────────
document.getElementById('btn-withdraw').addEventListener('click', async () => {
  if (txPending) return;
  const raw = document.getElementById('withdraw-amount').value.trim();
  if (!raw || isNaN(raw) || Number(raw) <= 0) {
    toast('Enter a valid shares amount.', true);
    return;
  }
  const shares = BigInt(Math.round(Number(raw) * 1e6));

  try {
    txPending = true;
    document.getElementById('btn-withdraw').disabled = true;

    await ensureNetwork();

    const withdrawTx = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: account,
        to: VAULT_ADDR,
        data: '0xb460af94' +
          shares.toString(16).padStart(64, '0') +
          account.slice(2).toLowerCase().padStart(64, '0') +
          account.slice(2).toLowerCase().padStart(64, '0'),
      }],
    });
    await waitForTx(withdrawTx);

    toast('Withdrawal confirmed. USDC returned to your wallet.');
    document.getElementById('withdraw-amount').value = '';
    await loadUserVault();
    await loadMetrics();

  } catch (err) {
    if (err.code !== 4001) toast('Withdrawal failed: ' + (err.message || err), true);
  } finally {
    txPending = false;
    if (account) document.getElementById('btn-withdraw').disabled = false;
  }
});

// ── Wait for tx receipt ───────────────────────────────────
async function waitForTx(hash) {
  for (let i = 0; i < 60; i++) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      if (receipt.status === '0x0') throw new Error('Transaction reverted.');
      return receipt;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Transaction timed out.');
}

// ── Init ─────────────────────────────────────────────────
loadMetrics();
