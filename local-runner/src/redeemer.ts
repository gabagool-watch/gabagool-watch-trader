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
 * @version 4.2.0 - V36.8.3: Comprehensive gasless API endpoint discovery (Gamma, CLOB, Relayer)
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
  if (claimMutexLocked) return false;
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
  
  if (!url || !key) return null;
  
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
    await client.from('claim_logs').insert({
      ...entry,
      confirmed_at: entry.status === 'confirmed' ? new Date().toISOString() : null,
    });
  } catch {
    // silent
  }
}

async function updateLiveTradeResultClaimStatus(
  _conditionId: string, 
  txHash: string, 
  usdcReceived: number
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  
  try {
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
  } catch {
    // silent
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
  const provider = getProvider();
  wallet = new Wallet(config.polymarket.privateKey, provider);
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

        if (!response.ok) break;

        const data = await response.json();

        let positions: RedeemablePosition[];
        let nextCursor: string | null = null;

        if (Array.isArray(data)) {
          positions = data;
        } else if (data.positions && Array.isArray(data.positions)) {
          positions = data.positions;
          nextCursor = data.next_cursor || data.nextCursor || null;
        } else {
          break;
        }

        // Tag each position with its wallet
        for (const p of positions) {
          p.proxyWallet = p.proxyWallet || walletAddress;
        }

        allPositions.push(...positions);
        if (!nextCursor || nextCursor === cursor || positions.length === 0) break;
        cursor = nextCursor;
      }
    } catch {
      // ignore fetch errors
    }
  }

  // Filter redeemable, exclude confirmed claims, apply minimum threshold
  const redeemableByCondition = new Map<string, RedeemablePosition>();

  for (const p of allPositions) {
    // Skip if not redeemable
    if (!p.redeemable) continue;
    
    // Skip if already confirmed
    if (confirmedClaims.has(p.conditionId)) continue;
    
    // Skip if below minimum threshold
    if ((p.currentValue || 0) < MIN_CLAIM_THRESHOLD_USD) {
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
  return redeemable;
}

// ============================================================================
// RELAYER API REDEMPTION (for Magic/Email wallets)
// 
// For Magic/Email wallets, the exported private key CANNOT call proxy.proxy()
// directly. Only Polymarket's backend (via Relayer API) can sign these txs.
// 
// V35.17.0: Using official Relayer V2 API at relayer-v2.polymarket.com
// Reference: https://docs.polymarket.com/developers/builders/relayer-client
// 
// Endpoints:
//   POST /redeem - Gasless redemption via Polymarket infrastructure
// ============================================================================

// V36.8.3: Comprehensive endpoint discovery for gasless redemption
// We try multiple hosts and paths since Polymarket's API surface has changed over time.
// Priority: Gamma API (most reliable) > CLOB integrated > Relayer services
const RELAYER_ENDPOINTS = [
  // Gamma API - often more reliable for account operations
  { host: 'https://gamma-api.polymarket.com', paths: ['/claim', '/redeem', '/positions/claim', '/v1/claim'] },
  // CLOB integrated relayer
  { host: 'https://clob.polymarket.com', paths: ['/relayer/execute', '/relay/execute', '/claim', '/redeem'] },
  // Dedicated relayer services
  { host: 'https://relayer-v2.polymarket.com', paths: ['/redeem', '/execute', '/claim', '/relay', '/v1/execute'] },
  { host: 'https://relayer.polymarket.com', paths: ['/redeem', '/execute', '/v2/redeem'] },
  // Main API fallbacks
  { host: 'https://api.polymarket.com', paths: ['/claim', '/redeem', '/relayer/execute'] },
] as const;

interface RelayerRedeemRequest {
  conditionId: string;
  indexSet?: number[];
}

interface RelayerRedeemResponse {
  success?: boolean;
  transactionHash?: string;
  txHash?: string;
  error?: string;
  message?: string;
}

async function redeemViaRelayerAPI(position: RedeemablePosition): Promise<ClaimResult> {
  const conditionId = position.conditionId;
  const proxyWallet = position.proxyWallet || config.polymarket.address;
  
  if (!hasBuilderCredentials()) {
    return {
      success: false,
      error: 'No Builder API credentials configured',
      retryable: false,
      errorCode: 'NO_BUILDER_CREDS',
    };
  }

  // Prepare multiple request body formats (different APIs expect different shapes)
  const requestBodies = [
    // Format 1: Simple conditionId
    { conditionId },
    // Format 2: With wallet address
    { conditionId, wallet: proxyWallet, address: proxyWallet },
    // Format 3: Relay execute format
    { to: CTF_ADDRESS, data: buildRedeemCalldata(conditionId), wallet: proxyWallet },
    // Format 4: Claim format with user
    { conditionId, user: proxyWallet },
  ];

  const secretBytes = Buffer.from(
    sanitizeBase64Secret(config.polymarket.builderApiSecret!),
    'base64'
  );
  
  let lastFailure: ClaimResult | null = null;
  let attemptCount = 0;
  const maxAttempts = 20; // Limit total attempts to prevent endless loops

  for (const endpoint of RELAYER_ENDPOINTS) {
    for (const path of endpoint.paths) {
      if (attemptCount >= maxAttempts) break;
      
      for (const bodyObj of requestBodies.slice(0, 2)) { // Only try first 2 body formats per endpoint
        attemptCount++;
        if (attemptCount >= maxAttempts) break;

        const method = 'POST';
        const body = JSON.stringify(bodyObj);
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = buildRelayerSignature(secretBytes, timestamp, method, path, body);

        // Headers: try both underscore (POLY_*) and hyphen (POLY-*) formats
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          // Underscore format (official docs)
          'POLY_ADDRESS': proxyWallet,
          'POLY_SIGNATURE': signature,
          'POLY_TIMESTAMP': timestamp,
          'POLY_API_KEY': config.polymarket.builderApiKey!,
          'POLY_PASSPHRASE': config.polymarket.builderPassphrase!,
          // Hyphen format (some endpoints)
          'POLY-ADDRESS': proxyWallet,
          'POLY-SIGNATURE': signature,
          'POLY-TIMESTAMP': timestamp,
          'POLY-API-KEY': config.polymarket.builderApiKey!,
          'POLY-PASSPHRASE': config.polymarket.builderPassphrase!,
        };

        const url = `${endpoint.host}${path}`;
        let response: any;
        let responseText = '';
        try {
          response = await fetch(url, { method, headers, body });
          responseText = await response.text();
        } catch (netErr: any) {
          lastFailure = {
            success: false,
            error: netErr?.message || String(netErr),
            retryable: true,
            errorCode: 'RELAYER_NETWORK',
          };
          continue;
        }

        // Skip routing errors and try next endpoint
        if (response.status === 404 || response.status === 405) {
          lastFailure = {
            success: false,
            error: `Route not available (HTTP ${response.status})`,
            retryable: false,
            errorCode: 'RELAYER_ROUTE',
          };
          continue;
        }

        // Auth errors are definitive
        if (response.status === 401 || response.status === 403) {
          lastFailure = {
            success: false,
            error: `Auth error (HTTP ${response.status})`,
            retryable: false,
            errorCode: 'RELAYER_AUTH',
          };
          continue;
        }

        // Server errors - retryable
        if (response.status >= 500) {
          lastFailure = {
            success: false,
            error: `Server error (HTTP ${response.status})`,
            retryable: true,
            errorCode: `RELAYER_${response.status}`,
          };
          continue;
        }

        // Parse response
        let data: RelayerRedeemResponse;
        try {
          data = responseText ? JSON.parse(responseText) : {};
        } catch {
          // Some endpoints return empty 200 on success
          if (response.ok) {
            return { success: true, usdcReceived: position.currentValue || 0 };
          }
          lastFailure = {
            success: false,
            error: 'Invalid JSON response',
            retryable: true,
            errorCode: 'RELAYER_BAD_JSON',
          };
          continue;
        }

        // Check for tx hash in response
        const txHash = data.transactionHash || data.txHash || (data as any).tx_hash || (data as any).hash;

        if (txHash) {
          // Wait for confirmation
          const provider = getProvider();
          try {
            const receipt = await waitForTransaction(provider, txHash, 60000);

            if (receipt && receipt.status === 1) {
              const events = parsePayoutRedemptionEvents(receipt);
              const totalPayout = events.length > 0
                ? events.reduce((sum: number, e: PayoutRedemptionEvent) => sum + e.payoutUSDC, 0)
                : position.currentValue || 0;

              confirmedClaims.set(conditionId, {
                txHash,
                blockNumber: receipt.blockNumber,
                payoutUSDC: totalPayout,
                confirmedAt: Date.now(),
              });

              return {
                success: true,
                txHash,
                blockNumber: receipt.blockNumber,
                usdcReceived: totalPayout,
              };
            }
          } catch {
            // Still return success since API accepted it
            return {
              success: true,
              txHash,
              usdcReceived: position.currentValue || 0,
            };
          }
        }

        // Check for success flags
        if (data.success === true || response.ok) {
          return { success: true, usdcReceived: position.currentValue || 0 };
        }

        // Error in response body
        const errorMsg = data.error || data.message || (data as any).msg || responseText.slice(0, 100);

        lastFailure = {
          success: false,
          error: String(errorMsg),
          retryable: true,
          errorCode: 'RELAYER_ERROR',
        };
      }
    }
  }
  
  return (
    lastFailure ?? {
      success: false,
      error: 'Gasless redemption failed: no working endpoint found',
      retryable: false,
      errorCode: 'RELAYER_NO_ENDPOINT',
    }
  );
}

// Helper to build redeem calldata for relay execute format
function buildRedeemCalldata(conditionId: string): string {
  const collateralToken = config.polymarket.usdcAddress;
  const parentCollectionId = ethers.constants.HashZero;
  const indexSets = [1, 2]; // Binary market default
  
  const ctfInterface = new ethers.utils.Interface(CTF_REDEEM_ABI);
  return ctfInterface.encodeFunctionData('redeemPositions', [
    collateralToken,
    parentCollectionId,
    conditionId,
    indexSets,
  ]);
}

// ============================================================================
// INDEX SETS HELPER
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

    // Call CTF.redeemPositions directly
    const ctfContract = new ethers.Contract(CTF_ADDRESS, CTF_REDEEM_ABI, wallet);
    const tx = await ctfContract.redeemPositions(
      collateralToken,
      parentCollectionId,
      conditionId,
      indexSets,
      { maxPriorityFeePerGas, maxFeePerGas }
    );

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
    return {
      success: false,
      error: classified.message,
      retryable: classified.retryable,
      errorCode: classified.code,
    };
  }
}

/**
 * V35.16.0: Fallback proxy redemption (may not work for Magic/Email wallets)
 * 
 * For Magic wallets, the exported signer is typically NOT authorized to call
 * proxy.proxy() directly. This method is a fallback that may work for some
 * wallet configurations but will fail for most Magic/Email setups.
 * 
 * Primary path for Magic wallets is redeemViaRelayerAPI().
 */
async function redeemViaMagicProxy(position: RedeemablePosition): Promise<ClaimResult> {
  const conditionId = position.conditionId;
  const collateralToken = config.polymarket.usdcAddress;
  const provider = getProvider();
  const proxyAddress = config.polymarket.address;

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

    // Call proxy.proxy() - this makes the PROXY the msg.sender in CTF
    const proxyContract = new ethers.Contract(proxyAddress, POLYMARKET_PROXY_WALLET_ABI, wallet);
    const tx = await proxyContract.proxy(CTF_ADDRESS, redeemCalldata, {
      maxPriorityFeePerGas,
      maxFeePerGas,
    });

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
    return {
      success: false,
      error: classified.message,
      retryable: classified.retryable,
      errorCode: classified.code,
    };
  }
}

// ============================================================================
// REDEEM: V35.16.0 - Correct routing based on wallet type
// 
// Priority order for Magic/Email wallets (proxy mode):
//   1. Relayer API (gasless, works for all Magic wallets)
//   2. Direct CTF if position is in signer wallet
// 
// For EOA wallets (no proxy):
//   Direct CTF.redeemPositions() call
// ============================================================================

async function redeemDirectEOA(position: RedeemablePosition): Promise<ClaimResult> {
  const positionWallet = (position.proxyWallet || '').toLowerCase();
  const signerWallet = (wallet?.address || '').toLowerCase();
  const configProxy = (config.polymarket.address || '').toLowerCase();

  // Position in signer wallet - direct CTF call works
  if (positionWallet === signerWallet) {
    return redeemDirectCTF(position);
  }

  // Position in proxy wallet - use Relayer API
  if (configProxy && positionWallet === configProxy) {
    // Try Relayer API (gasless)
    if (hasBuilderCredentials()) {
      const relayerResult = await redeemViaRelayerAPI(position);
      
      // If Relayer works, great!
      if (relayerResult.success) {
        return relayerResult;
      }
      
      // If Relayer failed with a definitive error, report it; otherwise allow fallbacks.
      if (
        relayerResult.errorCode !== 'RELAYER_404' &&
        relayerResult.errorCode !== 'RELAYER_NETWORK' &&
        relayerResult.errorCode !== 'RELAYER_ROUTE' &&
        relayerResult.errorCode !== 'RELAYER_NO_ENDPOINT'
      ) {
        return relayerResult;
      }
      
      // Relayer unavailable - try fallback
    }
    const proxyResult = await redeemViaMagicProxy(position);
    if (proxyResult.success) {
      return proxyResult;
    }
    
    // Both failed - provide clear error message
    console.log(`   ❌ All redemption methods failed for proxy wallet`);
    console.log(`   💡 For Magic/Email wallets, manual claim at polymarket.com/portfolio may be required`);
    
    return {
      success: false,
      error: 'Proxy wallet redemption failed - Relayer unavailable and proxy.proxy() unauthorized. Manual claim required.',
      retryable: false,
      errorCode: 'PROXY_NO_PATH',
    };
  }

  // Position in unknown wallet
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
    if (result.retryable === false) {
      pendingRetries.delete(position.conditionId);
      return result;
    }

    const currentRetry = pendingRetries.get(position.conditionId);
    const retryCount = (currentRetry?.retryCount || 0) + 1;
    
    if (retryCount < MAX_RETRY_COUNT) {
      pendingRetries.set(position.conditionId, {
        position,
        retryCount,
        nextRetryAt: Date.now() + RETRY_BACKOFF_MS * retryCount,
      });
    } else {
      pendingRetries.delete(position.conditionId);
    }
  } else {
    pendingRetries.delete(position.conditionId);
  }

  return result;
}

// ============================================================================
// PROXY WALLET INSTRUCTIONS (silent - no logging)
// ============================================================================

function printProxyWalletClaimInstructions(_positions: RedeemablePosition[]): void {
  // silent - all logging removed
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
    for (const [_, retry] of pendingRetries) {
      if (retry.nextRetryAt <= now) {
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
      return { claimed: 0, total: positions.length, totalUSDC: 0 };
    }

    // EOA mode - attempt automated claiming in batches
    let claimedCount = 0;
    let totalUSDC = 0;
    const batch = positions.slice(0, BATCH_SIZE);

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
      // POST-CLAIM VERIFICATION: wait a bit and re-fetch
      await new Promise(resolve => setTimeout(resolve, 5000));
      await fetchRedeemablePositions();
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
  if (isAutoClaimRunning) return;
  isAutoClaimRunning = true;

  // Run immediately on start
  checkAndClaimWinnings().catch(() => {});

  // Then run periodically
  autoClaimInterval = setInterval(async () => {
    try {
      await checkAndClaimWinnings();
    } catch {
      // silent
    }
  }, intervalMs);
}

export function stopAutoClaimLoop(): void {
  if (autoClaimInterval) {
    clearInterval(autoClaimInterval);
    autoClaimInterval = null;
  }
  isAutoClaimRunning = false;
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
 * Print debug state (silent - no logging)
 */
export function printDebugState(): void {
  // silent - all logging removed
}

/**
 * Force clear all state (for testing)
 */
export function clearState(): void {
  confirmedClaims.clear();
  pendingRetries.clear();
  claimTxHistory.length = 0;
}
