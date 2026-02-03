/**
 * redeemer.ts - Polymarket Auto-Claim System
 * ============================================================================
 * 
 * Automatic on-chain claiming for resolved Polymarket markets.
 * 
 * For Magic/Email wallets (signature_type=1):
 *   Uses the Polymarket Relayer API for gasless redemptions
 *   Requires Builder API credentials (POLY_BUILDER_*)
 * 
 * For EOA/Browser wallets:
 *   Direct on-chain CTF.redeemPositions() calls
 * 
 * Features:
 * - Periodic detection of resolved markets (configurable interval)
 * - Batching support for gas efficiency  
 * - Database logging of all claim attempts
 * - Safety guardrails (no double claims, min threshold, retry logic)
 * - Event-based confirmation (PayoutRedemption events)
 * 
 * @version 3.0.0 - Added Relayer API support for Magic wallets
 */

import pkg from 'ethers';
const { ethers, Wallet } = pkg;
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import {
  getProvider,
  getProxyOwner,
  CTF_ADDRESS,
  parsePayoutRedemptionEvents,
  waitForTransaction,
  PayoutRedemptionEvent,
} from './chain.js';
import { reconcile, printReconciliationReport } from './reconcile.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DATA_API_URL = 'https://data-api.polymarket.com';

// NOTE: Polymarket Relayer API endpoints are deprecated/non-functional.
// All redemptions now go through direct on-chain transactions.
// Magic/Email wallets use the proxy wallet's execute() method.

const DEFAULT_CLAIM_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_CLAIM_THRESHOLD_USD = 0.10; // Only claim positions worth $0.10+ (gas efficiency)
const MAX_RETRY_COUNT = 3;
const RETRY_BACKOFF_MS = 30000; // 30 seconds between retries
const BATCH_SIZE = 5; // Max positions to claim per batch
const DELAY_BETWEEN_CLAIMS_MS = 3000; // 3 seconds between individual claims

// CTF ABI for direct redeem
const CTF_REDEEM_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets) external',
];

// Polymarket Proxy Wallet ABI (for Magic/Email logins)
// V35.15.0: The correct method is proxy() NOT execute()
const POLYMARKET_PROXY_WALLET_ABI = [
  'function proxy(address dest, bytes calldata data) external returns (bytes memory)',
  'function owner() view returns (address)',
];

const GNOSIS_SAFE_ABI = [
  'function nonce() view returns (uint256)',
  'function getOwners() view returns (address[])',
  'function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)',
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool success)',
];

type ProxyWalletKind = 'POLY_PROXY' | 'GNOSIS_SAFE' | 'EOA';

// ============================================================================
// RELAYER API SUPPORT (for Magic/Email wallets)
// ============================================================================

function hasBuilderCredentials(): boolean {
  return Boolean(
    config.polymarket.builderApiKey &&
    config.polymarket.builderApiSecret &&
    config.polymarket.builderPassphrase
  );
}

function toUrlSafeBase64(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

function sanitizeBase64Secret(secret: string): string {
  let s = secret.trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');

  const pad = s.length % 4;
  if (pad === 2) s += '==';
  if (pad === 3) s += '=';
  return s;
}

function buildRelayerSignature(
  secretBytes: Buffer,
  timestampSeconds: string,
  method: string,
  requestPath: string,
  body: string = ''
): string {
  const message = `${timestampSeconds}${method.toUpperCase()}${requestPath}${body}`;
  const digest = crypto.createHmac('sha256', secretBytes).update(message).digest();
  return toUrlSafeBase64(Buffer.from(digest).toString('base64'));
}

async function detectProxyWalletKind(proxyAddress: string, provider: any): Promise<ProxyWalletKind> {
  // Allow explicit override via env
  // 0 = EOA, 1 = POLY_PROXY (Magic/Email), 2 = GNOSIS_SAFE (Browser wallet)
  if (config.polymarket.signatureType === 0) return 'EOA';
  if (config.polymarket.signatureType === 2) return 'GNOSIS_SAFE';
  if (config.polymarket.signatureType === 1) return 'POLY_PROXY';

  // Auto-detect: if getOwners() works, it's almost certainly a Safe (browser wallet like MetaMask).
  try {
    const safe = new ethers.Contract(proxyAddress, ['function getOwners() view returns (address[])'], provider);
    const owners = await safe.getOwners();
    if (Array.isArray(owners) && owners.length >= 1) return 'GNOSIS_SAFE';
  } catch {
    // fallthrough - not a Safe, so it's a Polymarket Proxy (Magic/Email)
  }

  return 'POLY_PROXY';
}

// ============================================================================
// TYPES
// ============================================================================

interface RedeemablePosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  currentValue: number;
  cashPnl: number;
  redeemable: boolean;
  title: string;
  slug: string;
  outcome: string;
  outcomeIndex: number;
  negRisk?: boolean;
}

interface ClaimResult {
  success: boolean;
  txHash?: string;
  gasUsed?: number;
  gasPriceGwei?: number;
  blockNumber?: number;
  usdcReceived?: number;
  error?: string;
  /** If false, we should NOT schedule retries for this failure */
  retryable?: boolean;
  /** Optional machine-ish error code for easier filtering */
  errorCode?: string;
}

interface ClaimLogEntry {
  market_id: string | null;
  condition_id: string;
  market_title: string | null;
  outcome: string | null;
  shares_redeemed: number;
  usdc_received: number;
  tx_hash: string | null;
  gas_used: number | null;
  gas_price_gwei: number | null;
  wallet_address: string;
  wallet_type: 'EOA' | 'PROXY';
  status: 'pending' | 'confirmed' | 'failed';
  error_message: string | null;
  retry_count: number;
  block_number: number | null;
}

// ============================================================================
// MUTEX: Prevent concurrent claim loops
// ============================================================================

let claimMutexLocked = false;

async function acquireClaimMutex(): Promise<boolean> {
  if (claimMutexLocked) {
    console.log('🔒 Claim mutex already held, skipping');
    return false;
  }
  claimMutexLocked = true;
  return true;
}

function releaseClaimMutex(): void {
  claimMutexLocked = false;
}

// ============================================================================
// TRACKING: In-memory state
// ============================================================================

const confirmedClaims = new Map<string, {
  txHash: string;
  blockNumber: number;
  payoutUSDC: number;
  confirmedAt: number;
}>();

const pendingRetries = new Map<string, {
  position: RedeemablePosition;
  retryCount: number;
  nextRetryAt: number;
}>();

const claimTxHistory: Array<{
  txHash: string;
  conditionId: string;
  status: 'pending' | 'confirmed' | 'failed';
  sentAt: number;
  confirmedAt?: number;
  error?: string;
}> = [];

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

let supabase: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
  if (supabase) return supabase;
  
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    console.warn('⚠️ Supabase credentials not found, database logging disabled');
    return null;
  }
  
  supabase = createClient(url, key);
  return supabase;
}

// ============================================================================
// DATABASE LOGGING
// ============================================================================

async function logClaimToDatabase(entry: ClaimLogEntry): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  
  try {
    const { error } = await client.from('claim_logs').insert({
      ...entry,
      confirmed_at: entry.status === 'confirmed' ? new Date().toISOString() : null,
    });
    
    if (error) {
      console.error('❌ Failed to log claim to database:', error.message);
    }
  } catch (e) {
    console.error('❌ Database logging error:', e);
  }
}

async function updateLiveTradeResultClaimStatus(
  conditionId: string, 
  txHash: string, 
  usdcReceived: number
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  
  try {
    // Find the live_trade_results entry by condition_id pattern in market_slug
    // Note: This is a best-effort update since we don't store condition_id directly
    await client
      .from('live_trade_results')
      .update({
        claim_status: 'claimed',
        claim_tx_hash: txHash,
        claimed_at: new Date().toISOString(),
        claim_usdc: usdcReceived,
      })
      .is('claim_status', null)
      .or('claim_status.eq.pending');
      
  } catch (e) {
    console.error('❌ Failed to update live_trade_results:', e);
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

let wallet: Wallet | null = null;
let autoClaimInterval: NodeJS.Timeout | null = null;
let isAutoClaimRunning = false;

function initializeRedeemer(): void {
  if (wallet) return;

  console.log('🔧 Initializing redeemer...');

  const provider = getProvider();
  wallet = new Wallet(config.polymarket.privateKey, provider);

  const signerAddress = wallet.address.toLowerCase();
  const proxyAddress = (config.polymarket.address || '').toLowerCase();

  console.log(`✅ Redeemer initialized`);
  console.log(`   📍 Signer (EOA): ${wallet.address}`);
  console.log(`   📍 Proxy wallet (config): ${config.polymarket.address || 'not set'}`);

  // === DEBUG: Builder API credentials check ===
  console.log(`\n🔍 DEBUG: Builder API credentials check:`);
  console.log(`   POLY_BUILDER_API_KEY: ${config.polymarket.builderApiKey ? `✅ set (${config.polymarket.builderApiKey.length} chars)` : '❌ MISSING'}`);
  console.log(`   POLY_BUILDER_API_SECRET: ${config.polymarket.builderApiSecret ? `✅ set (${config.polymarket.builderApiSecret.length} chars)` : '❌ MISSING'}`);
  console.log(`   POLY_BUILDER_PASSPHRASE: ${config.polymarket.builderPassphrase ? `✅ set (${config.polymarket.builderPassphrase.length} chars)` : '❌ MISSING'}`);
  console.log(`   hasBuilderCredentials(): ${hasBuilderCredentials() ? '✅ TRUE - Relayer API enabled' : '❌ FALSE - Direct on-chain mode'}`);
  console.log(`   POLYMARKET_SIGNATURE_TYPE: ${config.polymarket.signatureType ?? 'not set (auto-detect)'}`);

  // Detect wallet type
  if (!proxyAddress) {
    console.log(`\n⚠️ No POLYMARKET_ADDRESS set - will try direct EOA claiming`);
  } else if (signerAddress === proxyAddress) {
    console.log(`\n✅ Signer = Proxy (EOA mode) - direct claiming supported`);
  } else {
    console.log(`\n🔐 Signer ≠ Proxy (Proxy wallet mode)`);
    if (hasBuilderCredentials()) {
      console.log(`   ✅ Builder credentials found - will use Relayer API (gasless)`);
    } else {
      console.log(`   ⚠️ No Builder credentials - will attempt direct on-chain claiming`);
      console.log(`   ⚠️ Ensure SIGNER has enough MATIC for gas (not the proxy)`);
    }
  }
}

function isProxyWalletMode(): boolean {
  const signerAddress = wallet?.address.toLowerCase() || '';
  const proxyAddress = (config.polymarket.address || '').toLowerCase();
  // V35.10.2: Proxy wallet mode is disabled - we now claim directly from the proxy wallet
  // The signer can call redeemPositions on behalf of the proxy wallet because
  // Polymarket proxy wallets authorize the signer to execute transactions.
  // For Magic/Email accounts, the exported private key IS the proxy controller.
  return false; // Disabled: allow claiming in all cases
}

// ============================================================================
// ERROR CLASSIFICATION / GAS PRECHECK
// ============================================================================

function isInsufficientFundsError(err: any): boolean {
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || err || '').toLowerCase();
  return code === 'INSUFFICIENT_FUNDS' || msg.includes('insufficient funds');
}

function buildInsufficientFundsMessage(address: string): string {
  // Keep it short, but actionable; the logs already show the address.
  return `insufficient_funds_gas: fund signer wallet with MATIC for gas (send ~0.02 MATIC to ${address})`;
}

function classifyClaimError(err: any): { message: string; retryable: boolean; code?: string } {
  if (isInsufficientFundsError(err)) {
    return {
      message: buildInsufficientFundsMessage(wallet?.address || 'SIGNER'),
      retryable: false,
      code: 'INSUFFICIENT_FUNDS',
    };
  }

  const msg = String(err?.message || err || 'unknown_error');

  // Nonce / temporary RPC issues -> retryable
  const lower = msg.toLowerCase();
  if (lower.includes('nonce') || lower.includes('replacement fee too low') || lower.includes('already known')) {
    return { message: msg, retryable: true, code: String(err?.code || 'NONCE') };
  }

  if (lower.includes('timeout') || lower.includes('rate') || lower.includes('429') || lower.includes('gateway') || lower.includes('temporarily')) {
    return { message: msg, retryable: true, code: String(err?.code || 'TRANSIENT') };
  }

  // Default: retryable (keeps existing behaviour)
  return { message: msg, retryable: true, code: String(err?.code || 'UNKNOWN') };
}

// ============================================================================
// FETCH POSITIONS
// ============================================================================

async function fetchRedeemablePositions(): Promise<RedeemablePosition[]> {
  const proxyWallet = config.polymarket.address;
  const signingWallet = wallet?.address;

  const walletsToCheck = new Set<string>();
  if (proxyWallet) walletsToCheck.add(proxyWallet.toLowerCase());
  if (signingWallet) walletsToCheck.add(signingWallet.toLowerCase());

  console.log(`\n🔍 Fetching positions for ${walletsToCheck.size} wallet(s):`);
  for (const w of walletsToCheck) {
    console.log(`   📍 ${w}`);
  }

  const allPositions: RedeemablePosition[] = [];

  for (const walletAddress of walletsToCheck) {
    let cursor: string | null = null;
    let pageCount = 0;
    const maxPages = 10;

    try {
      while (pageCount < maxPages) {
        pageCount++;
        let url = `${DATA_API_URL}/positions?user=${walletAddress}&sizeThreshold=0&limit=500`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });

        if (!response.ok) {
          console.error(`❌ API error for ${walletAddress}: HTTP ${response.status}`);
          break;
        }

        const data = await response.json();

        let positions: RedeemablePosition[];
        let nextCursor: string | null = null;

        if (Array.isArray(data)) {
          positions = data;
        } else if (data.positions && Array.isArray(data.positions)) {
          positions = data.positions;
          nextCursor = data.next_cursor || data.nextCursor || null;
        } else {
          console.log(`⚠️ Unexpected API response for ${walletAddress}`);
          break;
        }

        // Tag each position with its wallet
        for (const p of positions) {
          p.proxyWallet = p.proxyWallet || walletAddress;
        }

        allPositions.push(...positions);
        console.log(`   📄 Page ${pageCount}: ${positions.length} positions for ${walletAddress.slice(0, 10)}...`);

        if (!nextCursor || nextCursor === cursor || positions.length === 0) break;
        cursor = nextCursor;
      }
    } catch (error) {
      console.error(`❌ Error fetching positions for ${walletAddress}:`, error);
    }
  }

  console.log(`📊 Total positions fetched: ${allPositions.length}`);

  // Filter redeemable, exclude confirmed claims, apply minimum threshold
  const redeemableByCondition = new Map<string, RedeemablePosition>();

  for (const p of allPositions) {
    // Skip if not redeemable
    if (!p.redeemable) continue;
    
    // Skip if already confirmed
    if (confirmedClaims.has(p.conditionId)) continue;
    
    // Skip if below minimum threshold
    if ((p.currentValue || 0) < MIN_CLAIM_THRESHOLD_USD) {
      console.log(`   ⏭️ Skipping ${p.conditionId.slice(0, 10)}... (value $${p.currentValue?.toFixed(2)} < min $${MIN_CLAIM_THRESHOLD_USD})`);
      continue;
    }

    const existing = redeemableByCondition.get(p.conditionId);
    if (!existing || (p.currentValue || 0) > (existing.currentValue || 0)) {
      redeemableByCondition.set(p.conditionId, p);
    }
  }

  const redeemable = [...redeemableByCondition.values()];

  // Sort by value descending (claim highest value first)
  redeemable.sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0));

  if (redeemable.length > 0) {
    const totalValue = redeemable.reduce((sum, p) => sum + (p.currentValue || 0), 0);
    console.log(`\n💰 ${redeemable.length} redeemable positions ($${totalValue.toFixed(2)} total):`);
    for (const p of redeemable.slice(0, 10)) { // Show max 10
      console.log(`   💰 ${p.outcome} ${p.size.toFixed(0)} shares @ ${p.title?.slice(0, 45)}`);
      console.log(`      Value: $${p.currentValue?.toFixed(2)} | Wallet: ${p.proxyWallet?.slice(0, 10)}...`);
    }
    if (redeemable.length > 10) {
      console.log(`   ... and ${redeemable.length - 10} more`);
    }
  } else if (confirmedClaims.size > 0) {
    console.log(`   ✅ All positions confirmed claimed (${confirmedClaims.size} total)`);
  } else {
    console.log(`   No redeemable positions above $${MIN_CLAIM_THRESHOLD_USD} threshold`);
  }

  return redeemable;
}

// ============================================================================
// REDEEM: Magic/Email Proxy Wallet (via execute() method)
// The signer can call the proxy wallet's execute() to redeem positions on-chain.
// This replaces the deprecated Relayer API.
// ============================================================================

async function buildIndexSetsForCondition(conditionId: string, provider: any): Promise<number[]> {
  // Default for binary markets
  const fallback = [1, 2];

  try {
    const ctfRead = new ethers.Contract(
      CTF_ADDRESS,
      ['function getOutcomeSlotCount(bytes32 conditionId) view returns (uint256)'],
      provider
    );
    const n = await ctfRead.getOutcomeSlotCount(conditionId);
    const count = Number(n?.toString?.() ?? n);
    if (!Number.isFinite(count) || count <= 0 || count > 16) return fallback;

    const indexSets: number[] = [];
    for (let i = 0; i < count; i++) indexSets.push(1 << i);
    return indexSets.length ? indexSets : fallback;
  } catch {
    return fallback;
  }
}

// ============================================================================
// FETCH PROXY ADDRESS FROM POLYMARKET API
// Same approach as working test-direct-redeem-v2.ts script
// ============================================================================

async function fetchProxyAddressFromAPI(walletAddress: string): Promise<string | null> {
  try {
    const response = await fetch(`${DATA_API_URL}/profile?address=${walletAddress}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.proxyAddress ? ethers.utils.getAddress(data.proxyAddress) : null;
  } catch {
    return null;
  }
}

// ============================================================================
// REDEEM: Direct CTF redemption (works when signer has no proxy or is the proxy)
// This mirrors the successful test-direct-redeem-v2.ts approach
// ============================================================================

async function redeemDirectCTF(position: RedeemablePosition): Promise<ClaimResult> {
  const conditionId = position.conditionId;
  const collateralToken = config.polymarket.usdcAddress;
  const provider = getProvider();
  const signerAddress = wallet?.address || '';

  console.log(`   🎯 Redeeming via DIRECT CTF.redeemPositions()`);
  console.log(`   📍 Signer: ${signerAddress}`);
  console.log(`   📍 Condition ID: ${conditionId}`);

  if (!wallet) {
    return {
      success: false,
      error: 'Wallet not initialized',
      retryable: false,
      errorCode: 'NO_WALLET',
    };
  }

  try {
    // Build the CTF redeemPositions calldata
    const indexSets = await buildIndexSetsForCondition(conditionId, provider);
    const parentCollectionId = ethers.utils.hexZeroPad('0x00', 32);

    // Check signer balance for gas
    const signerBalance = await provider.getBalance(wallet.address);
    const minGasBalance = ethers.utils.parseEther('0.01'); // ~0.01 MATIC minimum
    
    if (signerBalance.lt(minGasBalance)) {
      return {
        success: false,
        error: buildInsufficientFundsMessage(wallet.address),
        retryable: false,
        errorCode: 'INSUFFICIENT_FUNDS',
      };
    }

    // Gas settings - use high minimums for Polygon (same as test script)
    const feeData = await provider.getFeeData();
    const minPriority = ethers.utils.parseUnits('30', 'gwei');
    const minMaxFee = ethers.utils.parseUnits('100', 'gwei');
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas?.gt(minPriority) 
      ? feeData.maxPriorityFeePerGas.mul(130).div(100) 
      : minPriority;
    const maxFeePerGas = feeData.maxFeePerGas?.gt(minMaxFee)
      ? feeData.maxFeePerGas.mul(130).div(100)
      : minMaxFee;

    console.log(`   ⛽ Gas: priority=${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei, max=${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);

    // Call CTF.redeemPositions directly
    const ctfContract = new ethers.Contract(CTF_ADDRESS, CTF_REDEEM_ABI, wallet);
    
    console.log(`   📡 Sending CTF.redeemPositions() transaction...`);
    const tx = await ctfContract.redeemPositions(
      collateralToken,
      parentCollectionId,
      conditionId,
      indexSets,
      { maxPriorityFeePerGas, maxFeePerGas }
    );

    console.log(`   ⏳ Tx sent: ${tx.hash}`);
    console.log(`   🔗 View: https://polygonscan.com/tx/${tx.hash}`);

    // Wait for confirmation with timeout
    const receipt = await Promise.race([
      tx.wait(1),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Timeout after 60s')), 60000)),
    ]);

    if (!receipt || receipt.status !== 1) {
      return {
        success: false,
        txHash: tx.hash,
        error: receipt ? 'Transaction reverted on-chain' : 'Transaction timeout',
        retryable: !receipt, // Timeout is retryable
        errorCode: receipt ? 'TX_REVERTED' : 'TIMEOUT',
      };
    }

    const events = parsePayoutRedemptionEvents(receipt);
    let totalPayout = position.currentValue || 0;

    if (events.length > 0) {
      totalPayout = events.reduce((sum: number, e: PayoutRedemptionEvent) => sum + e.payoutUSDC, 0);
    }

    console.log(`   ✅ CONFIRMED: claimed $${totalPayout.toFixed(2)}`);

    confirmedClaims.set(conditionId, {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      payoutUSDC: totalPayout,
      confirmedAt: Date.now(),
    });

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed?.toNumber(),
      gasPriceGwei: parseFloat(ethers.utils.formatUnits(receipt.effectiveGasPrice || 0, 'gwei')),
      usdcReceived: totalPayout,
    };

  } catch (error: any) {
    const classified = classifyClaimError(error);
    console.error(`   ❌ Direct CTF redeem failed: ${classified.message}`);
    return {
      success: false,
      error: classified.message,
      retryable: classified.retryable,
      errorCode: classified.code,
    };
  }
}

/**
 * V35.15.0: Fixed redemption for Magic/Email wallets
 * 
 * Uses proxy.proxy(CTF_ADDRESS, redeemCalldata) to make the PROXY the msg.sender
 * This way the CTF contract sees the proxy as the caller, burns its tokens,
 * and sends USDC to the proxy wallet.
 * 
 * The key insight: we call proxy.proxy() NOT proxy.execute()
 */
async function redeemViaMagicProxy(position: RedeemablePosition): Promise<ClaimResult> {
  const conditionId = position.conditionId;
  const collateralToken = config.polymarket.usdcAddress;
  const provider = getProvider();
  const proxyAddress = config.polymarket.address;

  console.log(`   🔧 V35.15.0: Proxy redemption via proxy.proxy()`);
  console.log(`   📍 Proxy wallet: ${proxyAddress}`);
  console.log(`   📍 Signer: ${wallet?.address}`);

  if (!wallet || !proxyAddress) {
    return {
      success: false,
      error: 'Wallet or proxy not configured',
      retryable: false,
      errorCode: 'NO_WALLET',
    };
  }

  try {
    // Check signer balance for gas
    const signerBalance = await provider.getBalance(wallet.address);
    const minGasBalance = ethers.utils.parseEther('0.01');
    
    if (signerBalance.lt(minGasBalance)) {
      return {
        success: false,
        error: buildInsufficientFundsMessage(wallet.address),
        retryable: false,
        errorCode: 'INSUFFICIENT_FUNDS',
      };
    }

    // Build CTF.redeemPositions calldata
    const indexSets = await buildIndexSetsForCondition(conditionId, provider);
    const parentCollectionId = ethers.constants.HashZero;
    const ctfInterface = new ethers.utils.Interface(CTF_REDEEM_ABI);
    const redeemCalldata = ctfInterface.encodeFunctionData('redeemPositions', [
      collateralToken,
      parentCollectionId,
      conditionId,
      indexSets,
    ]);

    // Gas settings - high minimums for Polygon
    const feeData = await provider.getFeeData();
    const minPriority = ethers.utils.parseUnits('30', 'gwei');
    const minMaxFee = ethers.utils.parseUnits('100', 'gwei');
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas?.gt(minPriority) 
      ? feeData.maxPriorityFeePerGas.mul(130).div(100) 
      : minPriority;
    const maxFeePerGas = feeData.maxFeePerGas?.gt(minMaxFee)
      ? feeData.maxFeePerGas.mul(130).div(100)
      : minMaxFee;

    console.log(`   ⛽ Gas: priority=${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);
    console.log(`   📡 Calling proxy.proxy(CTF, redeemCalldata)...`);

    // Call proxy.proxy() - this makes the PROXY the msg.sender in CTF
    const proxyContract = new ethers.Contract(proxyAddress, POLYMARKET_PROXY_WALLET_ABI, wallet);
    const tx = await proxyContract.proxy(CTF_ADDRESS, redeemCalldata, {
      maxPriorityFeePerGas,
      maxFeePerGas,
    });

    console.log(`   ⏳ Tx sent: ${tx.hash}`);
    console.log(`   🔗 View: https://polygonscan.com/tx/${tx.hash}`);

    // Wait for confirmation
    const receipt = await Promise.race([
      tx.wait(1),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Timeout after 60s')), 60000)),
    ]);

    if (!receipt || receipt.status !== 1) {
      return {
        success: false,
        txHash: tx.hash,
        error: receipt ? 'Transaction reverted on-chain' : 'Transaction timeout',
        retryable: !receipt,
        errorCode: receipt ? 'TX_REVERTED' : 'TIMEOUT',
      };
    }

    // Parse payout events
    const events = parsePayoutRedemptionEvents(receipt);
    let totalPayout = position.currentValue || 0;

    if (events.length > 0) {
      totalPayout = events.reduce((sum: number, e: PayoutRedemptionEvent) => sum + e.payoutUSDC, 0);
    }

    console.log(`   ✅ CONFIRMED: claimed $${totalPayout.toFixed(2)}`);

    confirmedClaims.set(conditionId, {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      payoutUSDC: totalPayout,
      confirmedAt: Date.now(),
    });

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed?.toNumber(),
      gasPriceGwei: parseFloat(ethers.utils.formatUnits(receipt.effectiveGasPrice || 0, 'gwei')),
      usdcReceived: totalPayout,
    };

  } catch (error: any) {
    const classified = classifyClaimError(error);
    console.error(`   ❌ Proxy redemption failed: ${classified.message}`);
    return {
      success: false,
      error: classified.message,
      retryable: classified.retryable,
      errorCode: classified.code,
    };
  }
}

// ============================================================================
// REDEEM: V35.15.0 - Correct routing based on wallet type
// 
// For Magic/Email wallets (proxy mode):
//   Use proxy.proxy(CTF, calldata) to make the proxy the msg.sender
// 
// For EOA wallets (no proxy):
//   Call CTF.redeemPositions() directly (tokens must be in signer wallet)
// ============================================================================

async function redeemDirectEOA(position: RedeemablePosition): Promise<ClaimResult> {
  const positionWallet = (position.proxyWallet || '').toLowerCase();
  const signerWallet = (wallet?.address || '').toLowerCase();
  const configProxy = (config.polymarket.address || '').toLowerCase();
  
  console.log(`   🔧 V35.15.0: Determining redemption path`);
  console.log(`   📍 Position held by: ${positionWallet.slice(0, 10)}...`);
  console.log(`   📍 Signer wallet: ${signerWallet.slice(0, 10)}...`);
  console.log(`   📍 Config proxy: ${configProxy.slice(0, 10) || 'not set'}...`);

  // V35.15.0: Route based on whether we have a proxy configured
  // If position is held by proxy, we MUST use proxy.proxy() method
  if (configProxy && positionWallet === configProxy) {
    console.log(`   🎯 Position in PROXY wallet → using proxy.proxy() method`);
    return redeemViaMagicProxy(position);
  }
  
  // Position is in signer wallet - direct CTF call works
  if (positionWallet === signerWallet) {
    console.log(`   🎯 Position in SIGNER wallet → using direct CTF call`);
    return redeemDirectCTF(position);
  }

  // Position in unknown wallet - try proxy if configured
  if (configProxy) {
    console.log(`   ⚠️ Position wallet unknown, trying proxy method`);
    return redeemViaMagicProxy(position);
  }

  console.log(`   ❌ No redemption path available`);
  return {
    success: false,
    error: `Position wallet ${positionWallet} not controlled by signer`,
    retryable: false,
    errorCode: 'WRONG_WALLET',
  };
}

// ============================================================================
// CLAIM WITH DATABASE LOGGING
// ============================================================================

async function claimPositionWithLogging(position: RedeemablePosition): Promise<ClaimResult> {
  const walletAddress = wallet?.address || '';
  const walletType = isProxyWalletMode() ? 'PROXY' : 'EOA';

  // Log pending claim
  const pendingLog: ClaimLogEntry = {
    market_id: position.slug,
    condition_id: position.conditionId,
    market_title: position.title,
    outcome: position.outcome,
    shares_redeemed: position.size,
    usdc_received: 0,
    tx_hash: null,
    gas_used: null,
    gas_price_gwei: null,
    wallet_address: walletAddress,
    wallet_type: walletType,
    status: 'pending',
    error_message: null,
    retry_count: pendingRetries.get(position.conditionId)?.retryCount || 0,
    block_number: null,
  };

  console.log(`\n💎 CLAIMING: ${position.title?.slice(0, 50)}`);
  console.log(`   Outcome: ${position.outcome} | Value: $${position.currentValue?.toFixed(2)}`);
  console.log(`   ConditionId: ${position.conditionId}`);
  console.log(`   Position wallet: ${position.proxyWallet}`);
  console.log(`   Signer wallet: ${walletAddress}`);

  // V35.15.0: Both EOA and Proxy modes are now supported
  // Proxy mode uses proxy.proxy() method which works for Magic/Email wallets
  const result = await redeemDirectEOA(position);

  // Update log with result
  pendingLog.tx_hash = result.txHash || null;
  pendingLog.gas_used = result.gasUsed || null;
  pendingLog.gas_price_gwei = result.gasPriceGwei || null;
  pendingLog.block_number = result.blockNumber || null;
  pendingLog.usdc_received = result.usdcReceived || 0;
  pendingLog.status = result.success ? 'confirmed' : 'failed';
  pendingLog.error_message = result.error || null;

  await logClaimToDatabase(pendingLog);

  // Update live_trade_results if successful
  if (result.success && result.txHash) {
    await updateLiveTradeResultClaimStatus(
      position.conditionId,
      result.txHash,
      result.usdcReceived || 0
    );
  }

  // Handle retry logic
  if (!result.success) {
    // If explicitly non-retryable (e.g., insufficient MATIC for gas), do not spam retries.
    if (result.retryable === false) {
      pendingRetries.delete(position.conditionId);
      console.log(`   ⛔ Not retrying (non-retryable): ${result.errorCode || 'error'}`);
      return result;
    }

    const currentRetry = pendingRetries.get(position.conditionId);
    const retryCount = (currentRetry?.retryCount || 0) + 1;
    
    if (retryCount < MAX_RETRY_COUNT) {
      pendingRetries.set(position.conditionId, {
        position,
        retryCount,
        nextRetryAt: Date.now() + RETRY_BACKOFF_MS * retryCount, // Exponential backoff
      });
      console.log(`   🔄 Scheduled retry ${retryCount}/${MAX_RETRY_COUNT} in ${RETRY_BACKOFF_MS * retryCount / 1000}s`);
    } else {
      pendingRetries.delete(position.conditionId);
      console.log(`   ❌ Max retries (${MAX_RETRY_COUNT}) exceeded for ${position.conditionId.slice(0, 20)}...`);
    }
  } else {
    pendingRetries.delete(position.conditionId);
  }

  return result;
}

// ============================================================================
// PROXY WALLET INSTRUCTIONS
// ============================================================================

function printProxyWalletClaimInstructions(positions: RedeemablePosition[]): void {
  const totalValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`⚠️  PROXY WALLET DETECTED - MANUAL CLAIM REQUIRED`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\nYour positions are held by a proxy wallet (Safe/Magic).`);
  console.log(`Polymarket does NOT yet support automated claiming via API for proxy wallets.`);
  console.log(`\n📋 CLAIMABLE POSITIONS (${positions.length} total, $${totalValue.toFixed(2)} value):`);
  
  for (const p of positions) {
    console.log(`   💰 ${p.outcome} ${p.size.toFixed(0)} shares @ ${p.title?.slice(0, 45)}`);
    console.log(`      Value: $${p.currentValue?.toFixed(2)}`);
  }
  
  console.log(`\n🔗 TO CLAIM YOUR WINNINGS:`);
  console.log(`   1. Go to: https://polymarket.com/portfolio`);
  console.log(`   2. Connect your MetaMask wallet`);
  console.log(`   3. Click the "Claim" button on each resolved market`);
  console.log(`\n💡 TIP: Bookmark this page for easy access to claims!`);
  console.log(`${'='.repeat(70)}\n`);
}

// ============================================================================
// MAIN CLAIM FUNCTION
// ============================================================================

export async function checkAndClaimWinnings(): Promise<{ claimed: number; total: number; totalUSDC: number }> {
  if (!await acquireClaimMutex()) {
    return { claimed: 0, total: 0, totalUSDC: 0 };
  }

  try {
    initializeRedeemer();

    // First, process any pending retries
    const now = Date.now();
    for (const [conditionId, retry] of pendingRetries) {
      if (retry.nextRetryAt <= now) {
        console.log(`\n🔄 Processing retry for ${conditionId.slice(0, 20)}...`);
        await claimPositionWithLogging(retry.position);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CLAIMS_MS));
      }
    }

    const positions = await fetchRedeemablePositions();

    if (positions.length === 0) {
      return { claimed: 0, total: 0, totalUSDC: 0 };
    }

    // If proxy wallet mode, show instructions and exit
    if (isProxyWalletMode()) {
      printProxyWalletClaimInstructions(positions);
      console.log(`\n📊 RESULT: ${positions.length} positions need manual claiming`);
      return { claimed: 0, total: positions.length, totalUSDC: 0 };
    }

    // EOA mode - attempt automated claiming in batches
    let claimedCount = 0;
    let totalUSDC = 0;
    const batch = positions.slice(0, BATCH_SIZE); // Take first batch

    console.log(`\n🚀 Processing batch of ${batch.length} claims...`);

    for (const position of batch) {
      if (confirmedClaims.has(position.conditionId)) continue;

      // Delay between claims
      if (claimedCount > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CLAIMS_MS));
      }

      const result = await claimPositionWithLogging(position);
      if (result.success) {
        claimedCount++;
        totalUSDC += result.usdcReceived || 0;
      }
    }

    if (claimedCount > 0) {
      console.log(`\n🎉 Claimed ${claimedCount} of ${batch.length} positions ($${totalUSDC.toFixed(2)} USDC)`);

      // POST-CLAIM VERIFICATION
      console.log(`\n🔄 Verifying claims...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const remainingPositions = await fetchRedeemablePositions();
      if (remainingPositions.length > 0) {
        console.log(`⚠️ ${remainingPositions.length} positions still showing as claimable`);
        console.log(`   This may be due to indexer delay (will retry next cycle)`);
      } else {
        console.log(`✅ Verified: all positions claimed`);
      }
    }

    return { 
      claimed: claimedCount, 
      total: positions.length,
      totalUSDC,
    };

  } finally {
    releaseClaimMutex();
  }
}

// ============================================================================
// AUTO-CLAIM LOOP
// ============================================================================

export function startAutoClaimLoop(intervalMs: number = DEFAULT_CLAIM_INTERVAL_MS): void {
  if (isAutoClaimRunning) {
    console.log('⚠️ Auto-claim loop already running');
    return;
  }

  console.log(`\n🔄 Starting auto-claim loop (interval: ${intervalMs / 1000}s)`);
  isAutoClaimRunning = true;

  // Run immediately on start
  checkAndClaimWinnings().catch(console.error);

  // Then run periodically
  autoClaimInterval = setInterval(async () => {
    console.log(`\n⏰ Auto-claim check triggered at ${new Date().toISOString()}`);
    try {
      await checkAndClaimWinnings();
    } catch (error) {
      console.error('❌ Auto-claim error:', error);
    }
  }, intervalMs);
}

export function stopAutoClaimLoop(): void {
  if (autoClaimInterval) {
    clearInterval(autoClaimInterval);
    autoClaimInterval = null;
  }
  isAutoClaimRunning = false;
  console.log('⏹️ Auto-claim loop stopped');
}

export function isAutoClaimActive(): boolean {
  return isAutoClaimRunning;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get current claimable value from API
 */
export async function getClaimableValue(): Promise<number> {
  initializeRedeemer();
  const positions = await fetchRedeemablePositions();
  return positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);
}

/**
 * Run reconciliation and print report
 */
export async function runReconciliation(): Promise<void> {
  initializeRedeemer();
  const result = await reconcile(wallet!.address);
  printReconciliationReport(result);
}

/**
 * Get claim history for debugging
 */
export function getClaimHistory(): typeof claimTxHistory {
  return [...claimTxHistory];
}

/**
 * Get confirmed claims
 */
export function getConfirmedClaims(): Map<string, any> {
  return new Map(confirmedClaims);
}

/**
 * Get pending retries
 */
export function getPendingRetries(): Map<string, any> {
  return new Map(pendingRetries);
}

/**
 * Get claim statistics
 */
export function getClaimStats(): {
  confirmed: number;
  pending: number;
  totalClaimedUSDC: number;
} {
  let totalClaimedUSDC = 0;
  for (const claim of confirmedClaims.values()) {
    totalClaimedUSDC += claim.payoutUSDC;
  }
  
  return {
    confirmed: confirmedClaims.size,
    pending: pendingRetries.size,
    totalClaimedUSDC,
  };
}

/**
 * Print debug state
 */
export function printDebugState(): void {
  const stats = getClaimStats();
  
  console.log('\n📊 REDEEMER DEBUG STATE:');
  console.log(`   Confirmed claims: ${stats.confirmed}`);
  console.log(`   Pending retries: ${stats.pending}`);
  console.log(`   Total claimed USDC: $${stats.totalClaimedUSDC.toFixed(2)}`);
  console.log(`   Tx history entries: ${claimTxHistory.length}`);
  console.log(`   Proxy wallet mode: ${isProxyWalletMode()}`);
  console.log(`   Auto-claim active: ${isAutoClaimRunning}`);
  
  if (confirmedClaims.size > 0) {
    console.log('\n   Recent confirmed claims:');
    const recent = [...confirmedClaims.entries()].slice(-5);
    for (const [conditionId, claim] of recent) {
      console.log(`   - ${conditionId.slice(0, 20)}...: $${claim.payoutUSDC.toFixed(2)} (block ${claim.blockNumber})`);
    }
  }
  
  if (pendingRetries.size > 0) {
    console.log('\n   Pending retries:');
    for (const [conditionId, retry] of pendingRetries) {
      const waitTime = Math.max(0, (retry.nextRetryAt - Date.now()) / 1000);
      console.log(`   - ${conditionId.slice(0, 20)}...: retry ${retry.retryCount}/${MAX_RETRY_COUNT} in ${waitTime.toFixed(0)}s`);
    }
  }
}

/**
 * Force clear all state (for testing)
 */
export function clearState(): void {
  confirmedClaims.clear();
  pendingRetries.clear();
  claimTxHistory.length = 0;
  console.log('🧹 Redeemer state cleared');
}
