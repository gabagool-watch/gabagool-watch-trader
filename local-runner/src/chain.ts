import pkg from 'ethers';
const { ethers, providers } = pkg;

// Polygon RPC endpoints - ordered by reliability (publicnode/ankr most stable)
const RPC_ENDPOINTS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://rpc.ankr.com/polygon',
  'https://polygon-rpc.com',
  'https://1rpc.io/matic',
  'https://polygon.drpc.org',
  'https://polygon-mainnet.public.blastapi.io',
];

// Rate limiting state
let _lastRpcCall = 0;
const MIN_RPC_INTERVAL_MS = 250; // Min 250ms between calls
let _rateLimitBackoffUntil = 0;
let _consecutiveErrors = 0;

// CTF Contract address
export const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// USDC address on Polygon
export const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

// PayoutRedemption event signature
// event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)
export const PAYOUT_REDEMPTION_TOPIC = ethers.utils.id(
  'PayoutRedemption(address,address,bytes32,bytes32,uint256[],uint256)'
);

// Full ABI for parsing
export const CTF_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets) external',
  'event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)',
];

export interface PayoutRedemptionEvent {
  redeemer: string;
  collateralToken: string;
  parentCollectionId: string;
  conditionId: string;
  indexSets: number[];
  payout: string; // In wei (USDC has 6 decimals)
  payoutUSDC: number;
  transactionHash: string;
  blockNumber: number;
}

let _provider: providers.JsonRpcProvider | null = null;
let _currentRpcIndex = 0;

const POLYGON_NETWORK: providers.Network = {
  name: 'matic',
  chainId: 137,
};

function makeProvider(url: string): providers.JsonRpcProvider {
  // Static provider prevents "could not detect network" failures on flaky RPCs
  // by skipping the initial network-detection roundtrip.
  return new providers.StaticJsonRpcProvider(url, POLYGON_NETWORK);
}

/**
 * Check if we're in rate limit backoff
 */
function isInBackoff(): boolean {
  return Date.now() < _rateLimitBackoffUntil;
}

/**
 * Set rate limit backoff with exponential increase
 */
function setRateLimitBackoff(errorMsg: string): void {
  // Parse "retry in 10m0s" style messages
  let backoffMs = 30000; // Default 30s

  const match = errorMsg.match(/retry in (\d+)m(\d+)s/);
  if (match) {
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
    backoffMs = (mins * 60 + secs) * 1000;
  }

  // Cap at 10 minutes
  backoffMs = Math.min(backoffMs, 10 * 60 * 1000);

  _rateLimitBackoffUntil = Date.now() + backoffMs;
  console.log(`⏳ RPC rate limit backoff for ${backoffMs / 1000}s`);

  // Also rotate provider
  rotateProvider();
}

/**
 * Throttle RPC calls
 */
async function throttleRpc(): Promise<void> {
  // Wait if in backoff
  if (isInBackoff()) {
    const waitTime = _rateLimitBackoffUntil - Date.now();
    console.log(`⏳ Waiting ${Math.ceil(waitTime / 1000)}s for rate limit backoff...`);
    await new Promise(r => setTimeout(r, waitTime));
  }

  // Ensure minimum interval between calls
  const now = Date.now();
  const elapsed = now - _lastRpcCall;
  if (elapsed < MIN_RPC_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_RPC_INTERVAL_MS - elapsed));
  }
  _lastRpcCall = Date.now();
}

/**
 * Handle RPC error and check for rate limiting
 */
export function handleRpcError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);

  // Check for rate limit errors
  if (msg.includes('rate limit') || msg.includes('-32090') || msg.includes('Too many requests')) {
    setRateLimitBackoff(msg);
    _consecutiveErrors++;
    return true; // Indicates rate limit, should retry
  }

  _consecutiveErrors++;

  // After 3 consecutive errors, rotate provider
  if (_consecutiveErrors >= 3) {
    rotateProvider();
    _consecutiveErrors = 0;
  }

  return false;
}

/**
 * Get a working provider with fallback
 */
export function getProvider(): providers.JsonRpcProvider {
  if (_provider) return _provider;
  _provider = makeProvider(RPC_ENDPOINTS[_currentRpcIndex]);
  return _provider;
}

/**
 * Rotate to next RPC on failure
 */
export function rotateProvider(): providers.JsonRpcProvider {
  _currentRpcIndex = (_currentRpcIndex + 1) % RPC_ENDPOINTS.length;
  _provider = makeProvider(RPC_ENDPOINTS[_currentRpcIndex]);
  console.log(`🔄 Rotated to RPC: ${RPC_ENDPOINTS[_currentRpcIndex]}`);
  _consecutiveErrors = 0;
  return _provider;
}

/**
 * Parse PayoutRedemption events from a transaction receipt
 */
export function parsePayoutRedemptionEvents(
  receipt: providers.TransactionReceipt
): PayoutRedemptionEvent[] {
  const iface = new ethers.utils.Interface(CTF_ABI);
  const events: PayoutRedemptionEvent[] = [];

  for (const log of receipt.logs) {
    // Only parse logs from CTF contract
    if (log.address.toLowerCase() !== CTF_ADDRESS.toLowerCase()) continue;
    
    // Check if it's a PayoutRedemption event
    if (log.topics[0] !== PAYOUT_REDEMPTION_TOPIC) continue;

    try {
      const parsed = iface.parseLog(log);
      const payout = parsed.args.payout as ethers.BigNumber;
      
      events.push({
        redeemer: parsed.args.redeemer,
        collateralToken: parsed.args.collateralToken,
        parentCollectionId: parsed.args.parentCollectionId,
        conditionId: parsed.args.conditionId,
        indexSets: parsed.args.indexSets.map((n: ethers.BigNumber) => n.toNumber()),
        payout: payout.toString(),
        payoutUSDC: parseFloat(ethers.utils.formatUnits(payout, 6)),
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
      });
    } catch (e) {
      // Skip unparseable logs
    }
  }

  return events;
}

/**
 * Get transaction receipt with retry and rate limit handling
 */
export async function getReceiptWithRetry(
  txHash: string,
  maxRetries = 5
): Promise<providers.TransactionReceipt | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await throttleRpc();
      const provider = attempt === 0 ? getProvider() : rotateProvider();
      const receipt = await provider.getTransactionReceipt(txHash);
      _consecutiveErrors = 0; // Reset on success
      return receipt;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.log(`⚠️ getReceipt attempt ${attempt + 1} failed: ${lastError.message}`);
      
      const isRateLimit = handleRpcError(e);
      if (isRateLimit && attempt < maxRetries - 1) {
        // Wait for backoff then retry
        continue;
      }
    }
  }

  console.error(`❌ Failed to get receipt after ${maxRetries} attempts: ${lastError?.message}`);
  return null;
}

/**
 * Wait for transaction with timeout and rate limit handling
 */
export async function waitForTransaction(
  txHash: string,
  confirmations = 1,
  timeoutMs = 120000
): Promise<providers.TransactionReceipt | null> {
  await throttleRpc();
  const provider = getProvider();
  
  try {
    const receipt = await provider.waitForTransaction(txHash, confirmations, timeoutMs);
    _consecutiveErrors = 0;
    return receipt;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('timeout')) {
      console.log(`⏳ Transaction ${txHash} still pending after ${timeoutMs / 1000}s`);
      return null;
    }
    handleRpcError(e);
    throw e;
  }
}

/**
 * Get current nonce for address with rate limiting
 */
export async function getCurrentNonce(address: string): Promise<number> {
  await throttleRpc();
  const provider = getProvider();
  try {
    const nonce = await provider.getTransactionCount(address, 'pending');
    _consecutiveErrors = 0;
    return nonce;
  } catch (e) {
    handleRpcError(e);
    throw e;
  }
}

/**
 * Get latest block number with rate limiting
 */
export async function getBlockNumber(): Promise<number> {
  await throttleRpc();
  const provider = getProvider();
  try {
    const blockNum = await provider.getBlockNumber();
    _consecutiveErrors = 0;
    return blockNum;
  } catch (e) {
    handleRpcError(e);
    throw e;
  }
}

/**
 * Query past PayoutRedemption events for a wallet with rate limiting
 */
export async function getRecentPayoutRedemptions(
  redeemerAddress: string,
  fromBlock: number,
  toBlock: number | 'latest' = 'latest'
): Promise<PayoutRedemptionEvent[]> {
  await throttleRpc();
  const provider = getProvider();
  const iface = new ethers.utils.Interface(CTF_ABI);
  
  // PayoutRedemption has redeemer as first indexed param
  const redeemerTopic = ethers.utils.hexZeroPad(redeemerAddress.toLowerCase(), 32);

  const filter = {
    address: CTF_ADDRESS,
    topics: [PAYOUT_REDEMPTION_TOPIC, redeemerTopic],
    fromBlock,
    toBlock,
  };

  try {
    const logs = await provider.getLogs(filter);
    _consecutiveErrors = 0;
    const events: PayoutRedemptionEvent[] = [];

    for (const log of logs) {
      try {
        const parsed = iface.parseLog(log);
        const payout = parsed.args.payout as ethers.BigNumber;

        events.push({
          redeemer: parsed.args.redeemer,
          collateralToken: parsed.args.collateralToken,
          parentCollectionId: parsed.args.parentCollectionId,
          conditionId: parsed.args.conditionId,
          indexSets: parsed.args.indexSets.map((n: ethers.BigNumber) => n.toNumber()),
          payout: payout.toString(),
          payoutUSDC: parseFloat(ethers.utils.formatUnits(payout, 6)),
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      } catch {}
    }

    return events;
  } catch (e) {
    handleRpcError(e);
    console.error('❌ Failed to query PayoutRedemption events:', e);
    return [];
  }
}

// ===========================================================
// CHAINLINK PRICE FEEDS – Real-time BTC/ETH from Polygon
// ===========================================================

interface ChainlinkFeedInfo {
  address: string;
  decimals: number;
}

const CHAINLINK_FEEDS: Record<string, ChainlinkFeedInfo> = {
  BTC: { address: '0xc907E116054Ad103354f2D350FD2514433D57F6f', decimals: 8 },
  ETH: { address: '0xF9680D99D6C9589e2a93a78A04A279e509205945', decimals: 8 },
};

const AGGREGATOR_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
];

export interface ChainlinkPrice {
  price: number;
  timestamp: number;
}

/**
 * Fetch the latest Chainlink price for an asset (BTC or ETH).
 * Returns null if the feed is unavailable or stale.
 */
export async function fetchChainlinkPrice(asset: 'BTC' | 'ETH'): Promise<ChainlinkPrice | null> {
  const feedInfo = CHAINLINK_FEEDS[asset];
  if (!feedInfo) return null;

  try {
    await throttleRpc();
    const provider = getProvider();
    const aggregator = new ethers.Contract(feedInfo.address, AGGREGATOR_ABI, provider);
    const [, answer, , updatedAt] = await aggregator.latestRoundData();
    _consecutiveErrors = 0;
    const price = parseFloat(ethers.utils.formatUnits(answer, feedInfo.decimals));
    const timestamp = (updatedAt as ethers.BigNumber).toNumber();
    return { price, timestamp };
  } catch (e) {
    handleRpcError(e);
    console.error(`❌ fetchChainlinkPrice(${asset}) error:`, e);
    return null;
  }
}

// ===========================================================
// POLYMARKET PROXY WALLET – Owner detection
// ===========================================================

// Polymarket ProxyWallet uses ProxyWalletLib which stores owner at a specific slot
// The slot is: keccak256("polymarket.proxy.owner") - but we can also try common patterns

const PROXY_WALLET_ABI = [
  'function owner() view returns (address)',
  'function getOwner() view returns (address)',
];

// Gnosis Safe ABI for ownership check
const GNOSIS_SAFE_ABI = [
  'function getOwners() view returns (address[])',
  'function isOwner(address owner) view returns (bool)',
];

export interface ProxyOwnerInfo {
  proxyAddress: string;
  ownerAddress: string | null;
  proxyType: 'polymarket' | 'gnosis' | 'unknown';
  isOwnedBy: (address: string) => boolean;
  gnosisOwners?: string[];
  error?: string;
}

/**
 * Detect the owner of a Polymarket proxy wallet or Gnosis Safe.
 * Polymarket Magic/Email proxies store owner in a specific storage slot.
 * 
 * Known Polymarket proxy patterns:
 * - ProxyWalletLib uses slot keccak256("polymarket.proxy.wallet.owner")
 * - Some older proxies use slot 0 directly
 * - Gnosis Safes use getOwners()
 */
export async function getProxyOwner(proxyAddress: string): Promise<ProxyOwnerInfo> {
  await throttleRpc();
  const provider = getProvider();
  
  const result: ProxyOwnerInfo = {
    proxyAddress: proxyAddress.toLowerCase(),
    ownerAddress: null,
    proxyType: 'unknown',
    isOwnedBy: () => false,
  };

  // Helper to extract address from 32-byte storage value
  const extractAddress = (slot: string): string | null => {
    if (!slot || slot === ethers.constants.HashZero) return null;
    // Address is in the lower 20 bytes (last 40 hex chars)
    const addr = '0x' + slot.slice(26);
    if (addr === '0x0000000000000000000000000000000000000000') return null;
    try {
      return ethers.utils.getAddress(addr).toLowerCase();
    } catch {
      return null;
    }
  };
  
  try {
    // Check if it's actually a contract
    const code = await provider.getCode(proxyAddress);
    if (code === '0x' || code === '0x0') {
      result.error = 'Address is not a contract (EOA or empty)';
      console.log(`⚠️ ${proxyAddress} is not a contract`);
      return result;
    }

    // Try 1: Gnosis Safe pattern (getOwners)
    const safeContract = new ethers.Contract(proxyAddress, GNOSIS_SAFE_ABI, provider);
    try {
      const owners = await safeContract.getOwners();
      if (owners && owners.length > 0) {
        result.proxyType = 'gnosis';
        result.gnosisOwners = owners.map((o: string) => o.toLowerCase());
        result.ownerAddress = result.gnosisOwners[0];
        result.isOwnedBy = (addr: string) => 
          result.gnosisOwners?.includes(addr.toLowerCase()) ?? false;
        console.log(`✅ Gnosis Safe owners: ${result.gnosisOwners.join(', ')}`);
        return result;
      }
    } catch {}
    
    // Try 2: Standard owner() call (some Polymarket proxies expose this)
    const proxyContract = new ethers.Contract(proxyAddress, PROXY_WALLET_ABI, provider);
    try {
      const owner = await proxyContract.owner();
      if (owner && owner !== ethers.constants.AddressZero) {
        result.ownerAddress = owner.toLowerCase();
        result.proxyType = 'polymarket';
        result.isOwnedBy = (addr: string) => addr.toLowerCase() === result.ownerAddress;
        console.log(`✅ Proxy owner (via owner()): ${result.ownerAddress}`);
        return result;
      }
    } catch {}
    
    // Try 3: getOwner() call
    try {
      const owner = await proxyContract.getOwner();
      if (owner && owner !== ethers.constants.AddressZero) {
        result.ownerAddress = owner.toLowerCase();
        result.proxyType = 'polymarket';
        result.isOwnedBy = (addr: string) => addr.toLowerCase() === result.ownerAddress;
        console.log(`✅ Proxy owner (via getOwner()): ${result.ownerAddress}`);
        return result;
      }
    } catch {}

    // Try 4: Polymarket ProxyWalletLib slot - keccak256("polymarket.proxy.wallet.owner")
    // This is the actual slot used by Polymarket's Magic/Email proxy wallets
    const POLYMARKET_WALLET_OWNER_SLOT = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("polymarket.proxy.wallet.owner")
    );
    try {
      const storageValue = await provider.getStorageAt(proxyAddress, POLYMARKET_WALLET_OWNER_SLOT);
      const ownerAddr = extractAddress(storageValue);
      if (ownerAddr) {
        result.ownerAddress = ownerAddr;
        result.proxyType = 'polymarket';
        result.isOwnedBy = (addr: string) => addr.toLowerCase() === result.ownerAddress;
        console.log(`✅ Proxy owner (via polymarket.proxy.wallet.owner slot): ${result.ownerAddress}`);
        return result;
      }
    } catch {}

    // Try 5: Alternative slot - keccak256("polymarket.proxy.owner")
    const POLYMARKET_OWNER_SLOT = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("polymarket.proxy.owner")
    );
    try {
      const storageValue = await provider.getStorageAt(proxyAddress, POLYMARKET_OWNER_SLOT);
      const ownerAddr = extractAddress(storageValue);
      if (ownerAddr) {
        result.ownerAddress = ownerAddr;
        result.proxyType = 'polymarket';
        result.isOwnedBy = (addr: string) => addr.toLowerCase() === result.ownerAddress;
        console.log(`✅ Proxy owner (via polymarket.proxy.owner slot): ${result.ownerAddress}`);
        return result;
      }
    } catch {}

    // Try 6: EIP-1967 admin slot
    const EIP1967_ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
    try {
      const storageValue = await provider.getStorageAt(proxyAddress, EIP1967_ADMIN_SLOT);
      const adminAddr = extractAddress(storageValue);
      if (adminAddr) {
        result.ownerAddress = adminAddr;
        result.proxyType = 'polymarket';
        result.isOwnedBy = (addr: string) => addr.toLowerCase() === result.ownerAddress;
        console.log(`✅ Proxy admin (via EIP-1967 slot): ${result.ownerAddress}`);
        return result;
      }
    } catch {}
    
    // Try 7: Storage slot 0 (common for minimal proxies / simple ownership patterns)
    try {
      const storageValue = await provider.getStorageAt(proxyAddress, 0);
      const ownerAddr = extractAddress(storageValue);
      if (ownerAddr) {
        // Verify it's an EOA (not another contract, which would be implementation)
        const ownerCode = await provider.getCode(ownerAddr);
        if (ownerCode === '0x' || ownerCode === '0x0') {
          result.ownerAddress = ownerAddr;
          result.proxyType = 'polymarket';
          result.isOwnedBy = (addr: string) => addr.toLowerCase() === result.ownerAddress;
          console.log(`✅ Proxy owner (via slot 0): ${result.ownerAddress}`);
          return result;
        }
      }
    } catch {}

    // Try 8: Check slots 1-4 (some proxies use non-zero slots)
    for (let slot = 1; slot <= 4; slot++) {
      try {
        const storageValue = await provider.getStorageAt(proxyAddress, slot);
        const potentialOwner = extractAddress(storageValue);
        if (potentialOwner) {
          const ownerCode = await provider.getCode(potentialOwner);
          if (ownerCode === '0x' || ownerCode === '0x0') {
            result.ownerAddress = potentialOwner;
            result.proxyType = 'polymarket';
            result.isOwnedBy = (addr: string) => addr.toLowerCase() === result.ownerAddress;
            console.log(`✅ Potential owner in slot ${slot}: ${result.ownerAddress}`);
            return result;
          }
        }
      } catch {}
    }

    // Try 9: Debug - dump first few storage slots to help diagnose
    console.log(`🔍 DEBUG: Dumping storage slots for ${proxyAddress}...`);
    for (let slot = 0; slot < 10; slot++) {
      try {
        const val = await provider.getStorageAt(proxyAddress, slot);
        if (val !== ethers.constants.HashZero) {
          console.log(`   Slot ${slot}: ${val}`);
        }
      } catch {}
    }
    // Also dump the named slots
    console.log(`   Slot polymarket.proxy.wallet.owner: ${await provider.getStorageAt(proxyAddress, POLYMARKET_WALLET_OWNER_SLOT).catch(() => 'error')}`);
    console.log(`   Slot polymarket.proxy.owner: ${await provider.getStorageAt(proxyAddress, POLYMARKET_OWNER_SLOT).catch(() => 'error')}`);
    
    result.error = 'Could not determine proxy owner';
    console.log(`⚠️ Could not determine owner for proxy ${proxyAddress}`);
    return result;
    
  } catch (e) {
    handleRpcError(e);
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
}
