// ============================================================
// V37.7.0 MERGE MANAGER - PROXY WALLET AWARE
// ============================================================
// Handles merging of paired UP+DOWN positions after market expiry.
// Merge returns $1.00 per pair, locking in profit = 1.00 - CPP
// 
// V37.7.0: Fixed wallet context - uses proxy wallet for on-chain tx
// because shares are held by the proxy, not the EOA signer.
//
// Uses ethers v5 API (compatible with local-runner package.json)
// ============================================================

import { ethers, BigNumber } from 'ethers';
import type { V35Asset } from './types.js';
import { config } from '../config.js';
import { processFill as processAccountingFill, getEntry } from '../accounting-ledger.js';

// ============================================================
// CTF CONTRACT ABI (merge function)
// ============================================================

const CTF_ABI = [
  'function mergePositions(address collateral, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount) external',
  'function balanceOf(address owner, uint256 positionId) external view returns (uint256)',
  'function getPositionId(address collateral, bytes32 collectionId) external view returns (uint256)',
];

// Gnosis Safe ABI for proxy execution
const GNOSIS_SAFE_ABI = [
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) external payable returns (bool success)',
  'function nonce() view returns (uint256)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
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
  realizedPnl?: number;
  gasUsed?: number;
  error?: string;
  walletType?: 'eoa' | 'proxy' | 'gnosis';
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
  upTokenId?: string;    // V37.7.0: Token IDs for balance check
  downTokenId?: string;
}

// ============================================================
// MERGE MANAGER CLASS
// ============================================================

export class MergeManager {
  private provider: ethers.providers.JsonRpcProvider | null = null;
  private signer: ethers.Wallet | null = null;
  private proxyAddress: string | null = null;
  private ctfContract: ethers.Contract | null = null;
  private ctfInterface: ethers.utils.Interface | null = null;
  private isInitialized = false;
  private walletType: 'eoa' | 'proxy' | 'gnosis' = 'eoa';
  
  // Track pending merges to avoid duplicates
  private pendingMerges = new Set<string>();
  
  // ============================================================
  // INITIALIZATION
  // ============================================================
  
  async initialize(): Promise<boolean> {
    // Get private key from environment
    const privateKey = process.env.POLYMARKET_PRIVATE_KEY || process.env.PRIVATE_KEY;
    
    if (!privateKey) {
      console.log('[MergeManager] No private key configured, merge disabled');
      return false;
    }
    
    try {
      // Use Polygon RPC - prefer Alchemy if configured
      const alchemyKey = process.env.ALCHEMY_POLYGON_API_KEY;
      const rpcUrl = alchemyKey 
        ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`
        : (process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com');
      
      this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      
      // Create signer from private key
      this.signer = new ethers.Wallet(privateKey, this.provider);
      const eoaAddress = this.signer.address.toLowerCase();
      
      // Determine wallet type: EOA or Proxy
      // config.polymarket.address is the address where shares are held (may be proxy)
      const configAddress = config.polymarket.address.toLowerCase();
      
      if (eoaAddress === configAddress) {
        // Direct EOA trading - signer owns the shares
        this.walletType = 'eoa';
        this.proxyAddress = null;
        console.log(`[MergeManager] ✅ Initialized as EOA: ${eoaAddress.slice(0, 10)}...`);
      } else {
        // Proxy wallet trading - shares are in the proxy
        this.walletType = 'proxy';
        this.proxyAddress = configAddress;
        
        // Check if it's a Gnosis Safe
        try {
          const safeContract = new ethers.Contract(this.proxyAddress, GNOSIS_SAFE_ABI, this.provider);
          const owners = await safeContract.getOwners();
          if (owners && owners.length > 0) {
            this.walletType = 'gnosis';
            const isOwner = owners.map((o: string) => o.toLowerCase()).includes(eoaAddress);
            if (!isOwner) {
              console.log(`[MergeManager] ⚠️ EOA ${eoaAddress.slice(0, 10)}... is not a Safe owner`);
              console.log(`[MergeManager] Safe owners: ${owners.map((o: string) => o.slice(0, 10)).join(', ')}`);
            }
          }
        } catch {
          // Not a Gnosis Safe, might be Polymarket proxy
        }
        
        console.log(`[MergeManager] ✅ Initialized as ${this.walletType.toUpperCase()}: proxy=${this.proxyAddress.slice(0, 10)}... signer=${eoaAddress.slice(0, 10)}...`);
      }
      
      // Create CTF contract and interface
      this.ctfContract = new ethers.Contract(CTF_ADDRESS, CTF_ABI, this.signer);
      this.ctfInterface = new ethers.utils.Interface(CTF_ABI);
      
      this.isInitialized = true;
      return true;
    } catch (err: any) {
      console.error('[MergeManager] Failed to initialize:', err?.message || err);
      return false;
    }
  }
  
  // ============================================================
  // BALANCE CHECK - Verify shares exist before merging
  // ============================================================
  
  async checkBalances(
    conditionId: string, 
    upTokenId?: string, 
    downTokenId?: string
  ): Promise<{ upBalance: number; downBalance: number; pairable: number }> {
    if (!this.provider || !this.ctfContract) {
      return { upBalance: 0, downBalance: 0, pairable: 0 };
    }
    
    const holderAddress = this.proxyAddress || this.signer?.address;
    if (!holderAddress) {
      return { upBalance: 0, downBalance: 0, pairable: 0 };
    }
    
    try {
      // Position IDs are keccak256(collateral, collectionId, outcomeIndex)
      // For binary markets: outcomeIndex 0 = UP, outcomeIndex 1 = DOWN
      const upPositionId = upTokenId 
        ? BigNumber.from(upTokenId) 
        : this.computePositionId(conditionId, 0);
      const downPositionId = downTokenId 
        ? BigNumber.from(downTokenId) 
        : this.computePositionId(conditionId, 1);
      
      const [upBalanceBN, downBalanceBN] = await Promise.all([
        this.ctfContract.balanceOf(holderAddress, upPositionId),
        this.ctfContract.balanceOf(holderAddress, downPositionId),
      ]);
      
      const upBalance = parseFloat(ethers.utils.formatUnits(upBalanceBN, 6));
      const downBalance = parseFloat(ethers.utils.formatUnits(downBalanceBN, 6));
      const pairable = Math.min(upBalance, downBalance);
      
      return { upBalance, downBalance, pairable };
    } catch (err: any) {
      console.warn(`[MergeManager] Balance check failed: ${err?.message}`);
      return { upBalance: 0, downBalance: 0, pairable: 0 };
    }
  }
  
  private computePositionId(conditionId: string, outcomeIndex: number): BigNumber {
    // CTF position ID = hash(collateral, collectionId(conditionId, indexSet))
    // For simplicity, we use the tokenId format from market discovery
    // This is a placeholder - actual implementation depends on market data
    const indexSet = 1 << outcomeIndex; // 1 for UP, 2 for DOWN
    const collectionId = ethers.utils.solidityKeccak256(
      ['bytes32', 'uint256'],
      [conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`, indexSet]
    );
    return BigNumber.from(ethers.utils.solidityKeccak256(
      ['address', 'bytes32'],
      [USDC_ADDRESS, collectionId]
    ));
  }
  
  // ============================================================
  // MERGE EXECUTION
  // ============================================================
  
  /**
   * Merge paired positions for a market
   * V37.7.0: Uses proxy wallet if shares are held there
   */
  async merge(candidate: MergeCandidate): Promise<MergeResult> {
    if (!this.isInitialized || !this.ctfContract || !this.signer || !this.provider || !this.ctfInterface) {
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
      console.log(`[MergeManager]    Wallet Type: ${this.walletType.toUpperCase()}`);
      console.log(`[MergeManager]    Shares: ${candidate.pairedShares.toFixed(2)} pairs`);
      console.log(`[MergeManager]    CPP: $${candidate.cpp.toFixed(3)}`);
      console.log(`[MergeManager]    Expected PnL: $${candidate.expectedPnl >= 0 ? '+' : ''}${candidate.expectedPnl.toFixed(2)}`);
      console.log(`[MergeManager] ════════════════════════════════════════════════════\n`);
      
      // Verify on-chain balances before merge
      const balances = await this.checkBalances(
        candidate.conditionId, 
        candidate.upTokenId, 
        candidate.downTokenId
      );
      
      if (balances.pairable < 1) {
        console.log(`[MergeManager] ⚠️ On-chain balance too low: UP=${balances.upBalance.toFixed(2)} DOWN=${balances.downBalance.toFixed(2)}`);
        return { success: false, mergedShares: 0, error: 'insufficient_on_chain_balance' };
      }
      
      // Use the smaller of expected vs on-chain pairable
      const actualMergeShares = Math.min(candidate.pairedShares, balances.pairable);
      
      // Convert shares to contract units (6 decimals for USDC-backed shares)
      const shareAmount = ethers.utils.parseUnits(actualMergeShares.toFixed(6), 6);
      
      // Partition for binary market: [1, 2] = both outcomes
      const partition = [1, 2];
      
      // Convert conditionId to bytes32
      const conditionIdBytes = candidate.conditionId.startsWith('0x') 
        ? candidate.conditionId 
        : `0x${candidate.conditionId}`;
      
      let txHash: string;
      let gasUsed: number | undefined;
      
      if (this.walletType === 'eoa') {
        // Direct EOA execution
        const result = await this.executeMergeDirect(conditionIdBytes, partition, shareAmount);
        if (!result.success) {
          return { success: false, mergedShares: 0, error: result.error, walletType: this.walletType };
        }
        txHash = result.txHash!;
        gasUsed = result.gasUsed;
      } else if (this.walletType === 'gnosis') {
        // Gnosis Safe execution
        const result = await this.executeMergeViaGnosis(conditionIdBytes, partition, shareAmount);
        if (!result.success) {
          return { success: false, mergedShares: 0, error: result.error, walletType: this.walletType };
        }
        txHash = result.txHash!;
        gasUsed = result.gasUsed;
      } else {
        // For other proxy types, try direct execution from EOA
        // This may fail if the proxy doesn't allow it
        console.log(`[MergeManager] ⚠️ Proxy wallet detected but not Gnosis Safe - attempting direct merge`);
        const result = await this.executeMergeDirect(conditionIdBytes, partition, shareAmount);
        if (!result.success) {
          return { success: false, mergedShares: 0, error: `proxy_not_supported: ${result.error}`, walletType: this.walletType };
        }
        txHash = result.txHash!;
        gasUsed = result.gasUsed;
      }
      
      // Calculate realized PnL
      const realizedPnl = actualMergeShares * (1.0 - candidate.cpp);
      
      // Update accounting ledger with realized PnL
      this.updateAccountingLedger(candidate, actualMergeShares, realizedPnl);
      
      console.log(`[MergeManager] ✅ MERGE CONFIRMED: ${txHash}`);
      console.log(`[MergeManager]    Gas used: ${gasUsed ?? 'unknown'}`);
      console.log(`[MergeManager]    USDC received: $${actualMergeShares.toFixed(2)}`);
      console.log(`[MergeManager]    Realized PnL: $${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)}`);
      
      return {
        success: true,
        txHash,
        mergedShares: actualMergeShares,
        realizedPnl,
        gasUsed,
        walletType: this.walletType,
      };
      
    } catch (err: any) {
      console.error(`[MergeManager] ❌ Merge failed:`, err?.message || err);
      return {
        success: false,
        mergedShares: 0,
        error: err?.message || 'unknown_error',
        walletType: this.walletType,
      };
    } finally {
      this.pendingMerges.delete(candidate.conditionId);
    }
  }
  
  // ============================================================
  // DIRECT EOA MERGE
  // ============================================================
  
  private async executeMergeDirect(
    conditionId: string,
    partition: number[],
    amount: BigNumber
  ): Promise<{ success: boolean; txHash?: string; gasUsed?: number; error?: string }> {
    try {
      // Estimate gas
      const gasEstimate = await this.ctfContract!.estimateGas.mergePositions(
        USDC_ADDRESS,
        PARENT_COLLECTION_ID,
        conditionId,
        partition,
        amount
      );
      
      // Add 30% buffer
      const gasLimit = gasEstimate.mul(130).div(100);
      
      // Get current gas price with 30% premium for faster execution
      const gasPrice = (await this.provider!.getGasPrice()).mul(130).div(100);
      
      console.log(`[MergeManager] 📤 Sending merge tx (gas: ${gasLimit.toString()}, price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei)...`);
      
      // Execute merge
      const tx = await this.ctfContract!.mergePositions(
        USDC_ADDRESS,
        PARENT_COLLECTION_ID,
        conditionId,
        partition,
        amount,
        { gasLimit, gasPrice }
      );
      
      console.log(`[MergeManager] ⏳ Tx submitted: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait(1);
      
      return {
        success: true,
        txHash: tx.hash,
        gasUsed: receipt?.gasUsed?.toNumber(),
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'direct_merge_failed' };
    }
  }
  
  // ============================================================
  // GNOSIS SAFE MERGE
  // ============================================================
  
  private async executeMergeViaGnosis(
    conditionId: string,
    partition: number[],
    amount: BigNumber
  ): Promise<{ success: boolean; txHash?: string; gasUsed?: number; error?: string }> {
    if (!this.proxyAddress || !this.signer || !this.provider || !this.ctfInterface) {
      return { success: false, error: 'gnosis_not_configured' };
    }
    
    try {
      // Encode the mergePositions call
      const mergeData = this.ctfInterface.encodeFunctionData('mergePositions', [
        USDC_ADDRESS,
        PARENT_COLLECTION_ID,
        conditionId,
        partition,
        amount,
      ]);
      
      const safeContract = new ethers.Contract(this.proxyAddress, GNOSIS_SAFE_ABI, this.signer);
      
      // Get Safe threshold and nonce
      const [threshold, nonce] = await Promise.all([
        safeContract.getThreshold(),
        safeContract.nonce(),
      ]);
      
      if (threshold.toNumber() > 1) {
        return { success: false, error: 'gnosis_multisig_not_supported' };
      }
      
      // Build Safe transaction
      // For single-owner Safe, we can sign and execute in one tx
      const safeTxGas = 0; // Let Safe estimate
      const baseGas = 0;
      const gasPriceForSafe = 0; // Not using gas token
      const gasToken = ethers.constants.AddressZero;
      const refundReceiver = ethers.constants.AddressZero;
      const operation = 0; // CALL
      
      // Create transaction hash for signing
      const safeTxHash = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ['bytes1', 'bytes1', 'address', 'address', 'uint256', 'bytes32', 'uint8', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256'],
          [
            '0x19', '0x01',
            this.proxyAddress,
            CTF_ADDRESS,
            0, // value
            ethers.utils.keccak256(mergeData),
            operation,
            safeTxGas,
            baseGas,
            gasPriceForSafe,
            gasToken,
            refundReceiver,
            nonce,
          ]
        )
      );
      
      // Sign the transaction
      const signature = await this.signer.signMessage(ethers.utils.arrayify(safeTxHash));
      
      // Estimate gas for the Safe execution
      const gasEstimate = await safeContract.estimateGas.execTransaction(
        CTF_ADDRESS,
        0, // value
        mergeData,
        operation,
        safeTxGas,
        baseGas,
        gasPriceForSafe,
        gasToken,
        refundReceiver,
        signature
      );
      
      const gasLimit = gasEstimate.mul(150).div(100); // 50% buffer for Safe
      const gasPrice = (await this.provider.getGasPrice()).mul(130).div(100);
      
      console.log(`[MergeManager] 📤 Executing via Gnosis Safe (gas: ${gasLimit.toString()})...`);
      
      // Execute the transaction
      const tx = await safeContract.execTransaction(
        CTF_ADDRESS,
        0,
        mergeData,
        operation,
        safeTxGas,
        baseGas,
        gasPriceForSafe,
        gasToken,
        refundReceiver,
        signature,
        { gasLimit, gasPrice }
      );
      
      console.log(`[MergeManager] ⏳ Safe tx submitted: ${tx.hash}`);
      
      const receipt = await tx.wait(1);
      
      return {
        success: true,
        txHash: tx.hash,
        gasUsed: receipt?.gasUsed?.toNumber(),
      };
    } catch (err: any) {
      return { success: false, error: `gnosis_exec_failed: ${err?.message}` };
    }
  }
  
  // ============================================================
  // ACCOUNTING LEDGER INTEGRATION
  // ============================================================
  
  private updateAccountingLedger(candidate: MergeCandidate, mergedShares: number, realizedPnl: number): void {
    try {
      // Process as "SELL" for both sides at $0.50 each (merge returns $1.00 per pair)
      // The accounting ledger will calculate the actual realized PnL based on cost basis
      
      // UP side: sell at (1.0 - avgDownPrice) to represent fair value on merge
      processAccountingFill({
        marketId: candidate.conditionId,
        asset: candidate.asset,
        side: 'UP',
        action: 'SELL',
        qty: mergedShares,
        price: 0.50, // Each side is worth $0.50 after merge
        orderId: 'merge',
      });
      
      // DOWN side: sell at (1.0 - avgUpPrice)
      processAccountingFill({
        marketId: candidate.conditionId,
        asset: candidate.asset,
        side: 'DOWN',
        action: 'SELL',
        qty: mergedShares,
        price: 0.50,
        orderId: 'merge',
      });
      
      console.log(`[MergeManager] 📊 Accounting updated: realized PnL = $${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)}`);
    } catch (err: any) {
      console.warn(`[MergeManager] Accounting update failed: ${err?.message}`);
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
    downCost: number,
    upTokenId?: string,
    downTokenId?: string
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
      upTokenId,
      downTokenId,
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
  
  /**
   * Get wallet type being used
   */
  getWalletType(): 'eoa' | 'proxy' | 'gnosis' {
    return this.walletType;
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
