// ============================================================
// V37.4.0 MERGE MANAGER
// ============================================================
// Handles merging of paired UP+DOWN positions 10-5 seconds before expiry.
// Merge returns $1.00 per pair, locking in profit = 1.00 - CPP
// 
// Uses ethers v5 API (compatible with local-runner package.json)
// ============================================================

import { ethers, BigNumber } from 'ethers';
import type { V35Asset } from './types.js';

// ============================================================
// CTF CONTRACT ABI (merge function only)
// ============================================================

const CTF_ABI = [
  'function mergePositions(address collateral, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount) external',
  'function getPositionId(address collateral, bytes32 collectionId) external view returns (uint256)',
];

// Polymarket CTF contract on Polygon
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// USDC on Polygon (6 decimals)
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

// Parent collection ID (null collection for root)
const PARENT_COLLECTION_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';

// ============================================================
// TYPES
// ============================================================

export interface MergeResult {
  success: boolean;
  txHash?: string;
  mergedShares: number;
  gasUsed?: number;
  error?: string;
}

export interface MergeCandidate {
  conditionId: string;
  marketSlug: string;
  asset: V35Asset;
  pairedShares: number;  // Min of up/down
  upShares: number;
  downShares: number;
  avgUpPrice: number;
  avgDownPrice: number;
  cpp: number;           // Combined price per share
  expectedPnl: number;   // pairedShares × (1.00 - cpp)
}

// ============================================================
// MERGE MANAGER CLASS
// ============================================================

export class MergeManager {
  private provider: ethers.providers.JsonRpcProvider | null = null;
  private wallet: ethers.Wallet | null = null;
  private ctfContract: ethers.Contract | null = null;
  private isInitialized = false;
  
  // Track pending merges to avoid duplicates
  private pendingMerges = new Set<string>();
  
  // ============================================================
  // INITIALIZATION
  // ============================================================
  
  async initialize(): Promise<boolean> {
    // Get private key from environment (same as polymarket.ts uses)
    const privateKey = process.env.POLYMARKET_PRIVATE_KEY || process.env.PRIVATE_KEY;
    
    if (!privateKey) {
      console.log('[MergeManager] No private key configured (POLYMARKET_PRIVATE_KEY or PRIVATE_KEY), merge disabled');
      return false;
    }
    
    try {
      // Use Polygon RPC - prefer Alchemy if configured
      const alchemyKey = process.env.ALCHEMY_POLYGON_API_KEY;
      const rpcUrl = alchemyKey 
        ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`
        : (process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com');
      
      this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      
      // Create wallet from private key
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      
      // Create CTF contract instance
      this.ctfContract = new ethers.Contract(CTF_ADDRESS, CTF_ABI, this.wallet);
      
      this.isInitialized = true;
      console.log(`[MergeManager] ✅ Initialized with wallet ${this.wallet.address.slice(0, 10)}...`);
      
      return true;
    } catch (err) {
      console.error('[MergeManager] Failed to initialize:', err);
      return false;
    }
  }
  
  // ============================================================
  // MERGE EXECUTION
  // ============================================================
  
  /**
   * Merge paired positions for a market
   * This calls CTF.mergePositions() to convert UP+DOWN back to USDC
   */
  async merge(candidate: MergeCandidate): Promise<MergeResult> {
    if (!this.isInitialized || !this.ctfContract || !this.wallet || !this.provider) {
      return { success: false, mergedShares: 0, error: 'not_initialized' };
    }
    
    // Prevent duplicate merges
    if (this.pendingMerges.has(candidate.conditionId)) {
      console.log(`[MergeManager] ⏳ Merge already pending for ${candidate.marketSlug}`);
      return { success: false, mergedShares: 0, error: 'already_pending' };
    }
    
    // Validate we have paired shares
    if (candidate.pairedShares < 1) {
      return { success: false, mergedShares: 0, error: 'no_paired_shares' };
    }
    
    this.pendingMerges.add(candidate.conditionId);
    
    try {
      console.log(`\n[MergeManager] ════════════════════════════════════════════════════`);
      console.log(`[MergeManager] 🔄 MERGING ${candidate.marketSlug}`);
      console.log(`[MergeManager]    Shares: ${candidate.pairedShares} pairs`);
      console.log(`[MergeManager]    CPP: $${candidate.cpp.toFixed(3)}`);
      console.log(`[MergeManager]    Expected PnL: $${candidate.expectedPnl >= 0 ? '+' : ''}${candidate.expectedPnl.toFixed(2)}`);
      console.log(`[MergeManager] ════════════════════════════════════════════════════\n`);
      
      // Convert shares to contract units (6 decimals for USDC-backed shares)
      const shareAmount = ethers.utils.parseUnits(candidate.pairedShares.toFixed(6), 6);
      
      // Partition for binary market: [1, 2] = both outcomes
      const partition = [1, 2];
      
      // Convert conditionId to bytes32
      const conditionIdBytes = candidate.conditionId.startsWith('0x') 
        ? candidate.conditionId 
        : `0x${candidate.conditionId}`;
      
      // Estimate gas
      const gasEstimate = await this.ctfContract.estimateGas.mergePositions(
        USDC_ADDRESS,
        PARENT_COLLECTION_ID,
        conditionIdBytes,
        partition,
        shareAmount
      );
      
      // Add 30% buffer
      const gasLimit = gasEstimate.mul(130).div(100);
      
      // Get current gas price with 30% premium for faster execution
      const gasPrice = (await this.provider.getGasPrice()).mul(130).div(100);
      
      console.log(`[MergeManager] 📤 Sending merge tx (gas: ${gasLimit.toString()}, price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei)...`);
      
      // Execute merge
      const tx = await this.ctfContract.mergePositions(
        USDC_ADDRESS,
        PARENT_COLLECTION_ID,
        conditionIdBytes,
        partition,
        shareAmount,
        { gasLimit, gasPrice }
      );
      
      console.log(`[MergeManager] ⏳ Tx submitted: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait(1);
      
      const gasUsed = receipt ? receipt.gasUsed.toNumber() : undefined;
      
      console.log(`[MergeManager] ✅ MERGE CONFIRMED: ${tx.hash}`);
      console.log(`[MergeManager]    Gas used: ${gasUsed}`);
      console.log(`[MergeManager]    USDC received: $${candidate.pairedShares.toFixed(2)}`);
      console.log(`[MergeManager]    PnL locked: $${candidate.expectedPnl >= 0 ? '+' : ''}${candidate.expectedPnl.toFixed(2)}`);
      
      return {
        success: true,
        txHash: tx.hash,
        mergedShares: candidate.pairedShares,
        gasUsed,
      };
      
    } catch (err: any) {
      console.error(`[MergeManager] ❌ Merge failed:`, err?.message);
      return {
        success: false,
        mergedShares: 0,
        error: err?.message || 'unknown_error',
      };
    } finally {
      this.pendingMerges.delete(candidate.conditionId);
    }
  }
  
  // ============================================================
  // HELPERS
  // ============================================================
  
  /**
   * Calculate merge candidate from position data
   */
  static createCandidate(
    conditionId: string,
    marketSlug: string,
    asset: V35Asset,
    upShares: number,
    downShares: number,
    upCost: number,
    downCost: number
  ): MergeCandidate | null {
    const pairedShares = Math.min(upShares, downShares);
    
    if (pairedShares < 1) {
      return null;
    }
    
    const avgUpPrice = upShares > 0 ? upCost / upShares : 0;
    const avgDownPrice = downShares > 0 ? downCost / downShares : 0;
    const cpp = avgUpPrice + avgDownPrice;
    const expectedPnl = pairedShares * (1.00 - cpp);
    
    return {
      conditionId,
      marketSlug,
      asset,
      pairedShares,
      upShares,
      downShares,
      avgUpPrice,
      avgDownPrice,
      cpp,
      expectedPnl,
    };
  }
  
  /**
   * Check if position is worth merging
   * Only merge if CPP < 1.00 (profitable) or if forced
   */
  static shouldMerge(candidate: MergeCandidate, forceUnprofitable = false): boolean {
    // Minimum shares threshold
    if (candidate.pairedShares < 1) {
      return false;
    }
    
    // Only merge if profitable (CPP < $1.00)
    if (candidate.cpp >= 1.00 && !forceUnprofitable) {
      console.log(`[MergeManager] Skip merge: CPP $${candidate.cpp.toFixed(3)} >= $1.00`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Is manager ready to merge?
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

let mergeManagerInstance: MergeManager | null = null;

export function getMergeManager(): MergeManager {
  if (!mergeManagerInstance) {
    mergeManagerInstance = new MergeManager();
  }
  return mergeManagerInstance;
}
