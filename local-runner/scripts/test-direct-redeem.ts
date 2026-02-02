/**
 * Test Direct On-Chain Redemption
 * 
 * Tests the direct proxy.execute() path for Magic/Email wallets.
 * This skips the Relayer API entirely and pays gas directly.
 *
 * Usage:
 *   cd local-runner
 *   npx tsx scripts/test-direct-redeem.ts <conditionId>
 */

import '../src/config.js';
import { config } from '../src/config.js';
import pkg from 'ethers';
const { ethers, Wallet } = pkg as any;
import {
  getProvider,
  getProxyOwner,
  CTF_ADDRESS,
  parsePayoutRedemptionEvents,
} from '../src/chain.js';

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
    console.error('Usage: npx tsx scripts/test-direct-redeem.ts <conditionId>');
    process.exit(1);
  }

  const proxyWallet = config.polymarket.address;
  const collateralToken = config.polymarket.usdcAddress;

  console.log('\n🧪 TEST DIRECT ON-CHAIN REDEMPTION');
  console.log('='.repeat(60));

  // Initialize wallet
  const provider = getProvider();
  const wallet = new Wallet(config.polymarket.privateKey, provider);

  console.log(`📍 Signer wallet: ${wallet.address}`);
  console.log(`📍 Proxy wallet: ${proxyWallet}`);
  console.log(`📍 Condition ID: ${conditionId}`);
  console.log(`📍 Collateral: ${collateralToken}`);
  console.log(`📍 CTF Address: ${CTF_ADDRESS}`);

  // Check signer balance
  const signerBalance = await provider.getBalance(wallet.address);
  const signerBalanceMatic = parseFloat(ethers.utils.formatEther(signerBalance));
  console.log(`\n💰 Signer balance: ${signerBalanceMatic.toFixed(4)} MATIC`);

  if (signerBalanceMatic < 0.005) {
    console.error('❌ INSUFFICIENT GAS: Need at least 0.005 MATIC for gas');
    console.error(`   Send MATIC to: ${wallet.address}`);
    process.exit(1);
  }
  console.log('   ✅ Sufficient gas balance');

  // Check proxy ownership
  console.log('\n🔐 Checking proxy wallet ownership...');
  const ownerInfo = await getProxyOwner(proxyWallet);
  console.log(`   Proxy type: ${ownerInfo.proxyType}`);
  console.log(`   Owner: ${ownerInfo.ownerAddress || 'unknown'}`);

  if (ownerInfo.proxyType === 'gnosis') {
    console.error('❌ This is a Gnosis Safe wallet - needs execTransaction(), not execute()');
    console.error('   Set POLYMARKET_SIGNATURE_TYPE=2 for Safe wallets');
    process.exit(1);
  }

  if (ownerInfo.ownerAddress && !ownerInfo.isOwnedBy(wallet.address)) {
    console.error(`❌ OWNERSHIP MISMATCH:`);
    console.error(`   Signer: ${wallet.address}`);
    console.error(`   Owner:  ${ownerInfo.ownerAddress}`);
    console.error('   The signer is not the owner of this proxy wallet!');
    process.exit(1);
  }
  console.log('   ✅ Signer is authorized');

  // Build redeem calldata
  console.log('\n📦 Building redemption transaction...');
  const indexSets = [1, 2]; // Both YES and NO outcomes
  const parentCollectionId = ethers.utils.hexZeroPad('0x00', 32);
  const ctfInterface = new ethers.utils.Interface(CTF_REDEEM_ABI);
  const redeemCalldata = ctfInterface.encodeFunctionData('redeemPositions', [
    collateralToken,
    parentCollectionId,
    conditionId,
    indexSets,
  ]);
  console.log(`   ✅ Calldata built (${redeemCalldata.length} bytes)`);

  // Preflight: simulate CTF call from proxy
  console.log('\n🧪 Preflight 1: Simulating CTF.redeemPositions from proxy...');
  try {
    await provider.call({
      to: CTF_ADDRESS,
      from: proxyWallet,
      data: redeemCalldata,
    });
    console.log('   ✅ CTF call would succeed (position is redeemable)');
  } catch (err: any) {
    console.error('   ❌ CTF call would REVERT:');
    console.error(`      ${err.reason || err.message || err}`);
    console.error('   This means: position not resolved, already redeemed, or wrong conditionId');
    process.exit(1);
  }

  // Preflight: simulate proxy.execute()
  console.log('\n🧪 Preflight 2: Simulating proxy.execute()...');
  const proxyContract = new ethers.Contract(proxyWallet, POLYMARKET_PROXY_WALLET_ABI, wallet);
  try {
    await proxyContract.callStatic.execute(CTF_ADDRESS, redeemCalldata);
    console.log('   ✅ proxy.execute() would succeed (authorization OK)');
  } catch (err: any) {
    console.error('   ❌ proxy.execute() would REVERT:');
    console.error(`      ${err.reason || err.message || err}`);
    console.error('   This means: signer is not authorized on this proxy wallet');
    process.exit(1);
  }

  // Estimate gas
  console.log('\n⛽ Estimating gas...');
  const gasEstimate = await proxyContract.estimateGas.execute(CTF_ADDRESS, redeemCalldata);
  console.log(`   Estimated gas: ${gasEstimate.toString()}`);

  const feeData = await provider.getFeeData();
  const maxPriorityFeePerGas = ethers.utils.parseUnits('35', 'gwei');
  const maxFeePerGas = ethers.utils.parseUnits('150', 'gwei');
  console.log(`   Max priority fee: ${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);
  console.log(`   Max fee: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);

  // Confirmation prompt
  console.log('\n' + '='.repeat(60));
  console.log('🚀 ALL PREFLIGHTS PASSED - READY TO SEND TRANSACTION');
  console.log('='.repeat(60));
  console.log('\nThis will:');
  console.log(`   1. Call proxy.execute(CTF, redeemPositions) from ${wallet.address.slice(0, 10)}...`);
  console.log(`   2. Pay ~${(gasEstimate.toNumber() * 100 / 1e9).toFixed(4)} MATIC in gas`);
  console.log(`   3. Redeem winning shares for condition ${conditionId.slice(0, 20)}...`);

  // Actually send the transaction
  console.log('\n📡 Sending transaction...');
  const tx = await proxyContract.execute(CTF_ADDRESS, redeemCalldata, {
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit: gasEstimate.mul(130).div(100), // 30% buffer
  });

  console.log(`   ⏳ Tx hash: ${tx.hash}`);
  console.log(`   🔗 View: https://polygonscan.com/tx/${tx.hash}`);

  // Wait for confirmation
  console.log('\n⏳ Waiting for confirmation...');
  const receipt = await tx.wait(1);

  console.log(`\n📋 TRANSACTION RESULT:`);
  console.log(`   Status: ${receipt.status === 1 ? '✅ SUCCESS' : '❌ REVERTED'}`);
  console.log(`   Block: ${receipt.blockNumber}`);
  console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
  console.log(`   Effective gas price: ${ethers.utils.formatUnits(receipt.effectiveGasPrice, 'gwei')} gwei`);

  if (receipt.status === 1) {
    const events = parsePayoutRedemptionEvents(receipt);
    if (events.length > 0) {
      let totalPayout = 0;
      for (const event of events) {
        console.log(`   💰 Payout: $${event.payoutUSDC.toFixed(2)} USDC`);
        totalPayout += event.payoutUSDC;
      }
      console.log(`\n🎉 TOTAL REDEEMED: $${totalPayout.toFixed(2)} USDC`);
    } else {
      console.log('   ⚠️ No PayoutRedemption events found (may have been 0 payout)');
    }
  } else {
    console.error('\n❌ Transaction reverted. Check on Polygonscan for details.');
  }
}

main().catch((e) => {
  console.error('\n❌ ERROR:', e.message || e);
  process.exit(1);
});
