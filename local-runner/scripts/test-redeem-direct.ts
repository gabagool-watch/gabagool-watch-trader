/**
 * Test Direct Redemption Script
 *
 * Tests the NEW direct on-chain redemption method for Magic/Email wallets.
 * The old Relayer API is deprecated - this uses proxy.execute() directly.
 *
 * Usage:
 *   cd local-runner
 *   npx tsx scripts/test-redeem-direct.ts <conditionId>
 *
 * Example:
 *   npx tsx scripts/test-redeem-direct.ts 0x7c407e5d812b13c2a84bae93f3dfcf9aad2aae00da1d5f7f512df18556ccc670
 */

import '../src/config.js';
import { config } from '../src/config.js';
import pkg from 'ethers';
const { ethers, Wallet } = pkg as any;

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const POLYGON_RPC = 'https://polygon-rpc.com';

const CTF_REDEEM_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets) external',
];

const POLYMARKET_PROXY_WALLET_ABI = [
  'function execute(address to, bytes data) external returns (bytes)',
  'function owner() view returns (address)',
];

async function main() {
  const conditionId = process.argv[2];
  if (!conditionId) {
    console.error('Usage: npx tsx scripts/test-redeem-direct.ts <conditionId>');
    process.exit(1);
  }

  const collateralToken = config.polymarket.usdcAddress;
  const proxyWallet = config.polymarket.address;
  const privateKey = config.polymarket.privateKey;

  console.log(`\n🧪 TEST DIRECT REDEMPTION (proxy.execute)`);
  console.log('='.repeat(60));
  console.log(`📍 Proxy wallet: ${proxyWallet}`);
  console.log(`📍 Condition ID: ${conditionId}`);
  console.log(`📍 Collateral: ${collateralToken}`);

  if (!privateKey) {
    console.error('\n❌ Missing POLYMARKET_PRIVATE_KEY!');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC);
  const wallet = new Wallet(privateKey, provider);
  
  console.log(`\n📍 Signer: ${wallet.address}`);

  // Check signer balance
  const balance = await provider.getBalance(wallet.address);
  const balanceMatic = parseFloat(ethers.utils.formatEther(balance));
  console.log(`💰 Signer balance: ${balanceMatic.toFixed(4)} MATIC`);

  if (balanceMatic < 0.005) {
    console.error(`\n❌ Insufficient MATIC for gas!`);
    console.error(`   Send at least 0.02 MATIC to: ${wallet.address}`);
    process.exit(1);
  }

  // Connect to proxy wallet
  const proxyContract = new ethers.Contract(proxyWallet, POLYMARKET_PROXY_WALLET_ABI, wallet);

  // Verify ownership
  console.log(`\n🔍 Verifying proxy wallet ownership...`);
  try {
    const owner = await proxyContract.owner();
    console.log(`   Owner: ${owner}`);
    
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      console.error(`\n❌ Signer is NOT the proxy wallet owner!`);
      console.error(`   Signer: ${wallet.address}`);
      console.error(`   Owner:  ${owner}`);
      process.exit(1);
    }
    console.log(`   ✅ Signer is the owner`);
  } catch (e: any) {
    console.log(`   ⚠️ Could not verify ownership: ${e.message}`);
    console.log(`   Proceeding anyway (might fail)...`);
  }

  // Build redemption calldata
  console.log(`\n📦 Building redemption transaction...`);
  const indexSets = [1, 2];
  const parentCollectionId = ethers.utils.hexZeroPad('0x00', 32);
  const ctfInterface = new ethers.utils.Interface(CTF_REDEEM_ABI);
  const redeemCalldata = ctfInterface.encodeFunctionData('redeemPositions', [
    collateralToken,
    parentCollectionId,
    conditionId,
    indexSets,
  ]);

  console.log(`   Target: ${CTF_ADDRESS}`);
  console.log(`   Data: ${redeemCalldata.slice(0, 66)}...`);

  // Get gas settings
  const feeData = await provider.getFeeData();
  const maxPriorityFeePerGas = ethers.utils.parseUnits('30', 'gwei');
  const maxFeePerGas = ethers.utils.parseUnits('100', 'gwei');

  console.log(`\n⛽ Gas settings:`);
  console.log(`   Priority: 30 gwei`);
  console.log(`   Max fee: 100 gwei`);

  // DRY RUN - estimate gas first
  console.log(`\n🔍 Estimating gas (dry run)...`);
  try {
    const gasEstimate = await proxyContract.estimateGas.execute(CTF_ADDRESS, redeemCalldata);
    console.log(`   ✅ Gas estimate: ${gasEstimate.toString()}`);
    
    const gasCostWei = gasEstimate.mul(maxFeePerGas);
    const gasCostMatic = parseFloat(ethers.utils.formatEther(gasCostWei));
    console.log(`   💰 Max gas cost: ~${gasCostMatic.toFixed(4)} MATIC`);
  } catch (e: any) {
    console.error(`   ❌ Gas estimation failed: ${e.message}`);
    console.error(`\n   This usually means:`);
    console.error(`   1. The position is not redeemable yet (market not resolved)`);
    console.error(`   2. The position was already redeemed`);
    console.error(`   3. Wrong conditionId`);
    process.exit(1);
  }

  // Ask for confirmation
  console.log(`\n⚠️  Ready to execute redemption transaction.`);
  console.log(`   This will cost gas (MATIC).`);
  console.log(`   Press Ctrl+C to cancel, or wait 5 seconds to proceed...`);
  
  await new Promise(r => setTimeout(r, 5000));

  // Execute the transaction
  console.log(`\n📡 Sending transaction...`);
  try {
    const tx = await proxyContract.execute(CTF_ADDRESS, redeemCalldata, {
      maxPriorityFeePerGas,
      maxFeePerGas,
      gasLimit: 500000,
    });

    console.log(`   ✅ Tx sent: ${tx.hash}`);
    console.log(`   🔗 View: https://polygonscan.com/tx/${tx.hash}`);

    console.log(`\n⏳ Waiting for confirmation...`);
    const receipt = await tx.wait(1);

    if (receipt.status === 1) {
      console.log(`\n✅ SUCCESS! Transaction confirmed.`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`   🎉 USDC should now be in your proxy wallet!`);
    } else {
      console.log(`\n❌ Transaction reverted on-chain.`);
      console.log(`   This means the redemption failed.`);
    }

  } catch (e: any) {
    console.error(`\n❌ Transaction failed: ${e.message}`);
    
    if (e.message?.includes('insufficient funds')) {
      console.error(`   💡 Send more MATIC to: ${wallet.address}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
