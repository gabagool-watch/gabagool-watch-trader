/**
 * Test Direct On-Chain Redemption V2
 * 
 * Mirrors the working script logic:
 * 1. Fetches proxy address from Polymarket API
 * 2. If proxy exists and is different from signer, uses proxy.proxy()
 * 3. If no proxy, calls CTF.redeemPositions directly
 *
 * Usage:
 *   npx tsx scripts/test-direct-redeem-v2.ts <conditionId>
 */

import '../src/config.js';
import { config } from '../src/config.js';
import pkg from 'ethers';
const { ethers, Wallet } = pkg as any;
import { getProvider, CTF_ADDRESS, parsePayoutRedemptionEvents } from '../src/chain.js';

const CTF_REDEEM_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external',
];

const PROXY_ABI = [
  'function proxy(address dest, bytes calldata data) external returns (bytes memory)',
];

async function fetchProxyAddress(mainWallet: string): Promise<string | null> {
  try {
    const response = await fetch(`https://data-api.polymarket.com/profile?address=${mainWallet}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.proxyAddress ? ethers.utils.getAddress(data.proxyAddress) : null;
  } catch {
    return null;
  }
}

async function main() {
  const conditionId = process.argv[2];
  if (!conditionId) {
    console.error('Usage: npx tsx scripts/test-direct-redeem-v2.ts <conditionId>');
    process.exit(1);
  }

  const collateralToken = config.polymarket.usdcAddress;
  const configuredProxy = config.polymarket.address;

  console.log('\n🧪 TEST DIRECT ON-CHAIN REDEMPTION V2');
  console.log('='.repeat(60));

  // Initialize wallet
  const provider = getProvider();
  const wallet = new Wallet(config.polymarket.privateKey, provider);
  const signerAddress = wallet.address;

  console.log(`📍 Signer wallet: ${signerAddress}`);
  console.log(`📍 Configured proxy: ${configuredProxy}`);
  console.log(`📍 Condition ID: ${conditionId}`);
  console.log(`📍 CTF Address: ${CTF_ADDRESS}`);

  // Check signer balance
  const signerBalance = await provider.getBalance(signerAddress);
  const signerBalanceMatic = parseFloat(ethers.utils.formatEther(signerBalance));
  console.log(`\n💰 Signer balance: ${signerBalanceMatic.toFixed(4)} MATIC`);

  if (signerBalanceMatic < 0.01) {
    console.error('❌ INSUFFICIENT GAS: Need at least 0.01 MATIC');
    console.error(`   Send MATIC to: ${signerAddress}`);
    process.exit(1);
  }
  console.log('   ✅ Sufficient gas balance');

  // Fetch proxy address from API (like the working script does)
  console.log('\n🔍 Fetching proxy address from Polymarket API...');
  const apiProxyAddress = await fetchProxyAddress(signerAddress);
  console.log(`   API returned proxy: ${apiProxyAddress || 'none'}`);

  // Determine target: use proxy if exists and different from signer
  const useProxy = apiProxyAddress && apiProxyAddress.toLowerCase() !== signerAddress.toLowerCase();
  const targetAddress = useProxy ? apiProxyAddress : signerAddress;

  console.log(`\n📊 Redemption mode: ${useProxy ? 'PROXY' : 'DIRECT'}`);
  console.log(`   Target address: ${targetAddress}`);

  // Fetch redeemable positions
  console.log('\n📋 Checking redeemable positions...');
  try {
    const posResponse = await fetch(`https://data-api.polymarket.com/positions?user=${targetAddress}&redeemable=true`);
    if (posResponse.ok) {
      const positions = await posResponse.json();
      console.log(`   Found ${positions.length} redeemable positions`);
      const matchingPos = positions.filter((p: any) => p.conditionId === conditionId);
      if (matchingPos.length > 0) {
        console.log(`   ✅ Condition ${conditionId.slice(0, 20)}... is redeemable`);
      } else {
        console.log(`   ⚠️ Condition not found in redeemable list (may still work)`);
      }
    }
  } catch {
    console.log('   Could not fetch positions from API');
  }

  // Build redeem calldata
  console.log('\n📦 Building redemption transaction...');
  const indexSets = [1, 2];
  const parentCollectionId = ethers.constants.HashZero;
  const ctfInterface = new ethers.utils.Interface(CTF_REDEEM_ABI);
  const redeemCalldata = ctfInterface.encodeFunctionData('redeemPositions', [
    collateralToken,
    parentCollectionId,
    conditionId,
    indexSets,
  ]);
  console.log(`   ✅ Calldata built`);

  // Gas settings (like the working script)
  const feeData = await provider.getFeeData();
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.mul(130).div(100);
  const maxFeePerGas = feeData.maxFeePerGas.mul(130).div(100);
  console.log(`\n⛽ Gas settings:`);
  console.log(`   Priority: ${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);
  console.log(`   Max fee: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);

  // Execute redemption
  console.log('\n📡 Sending transaction...');
  let tx;

  try {
    if (useProxy) {
      console.log('   Using PROXY mode: proxy.proxy(CTF, data)');
      const proxyContract = new ethers.Contract(apiProxyAddress, PROXY_ABI, wallet);
      tx = await proxyContract.proxy(CTF_ADDRESS, redeemCalldata, {
        maxPriorityFeePerGas,
        maxFeePerGas,
      });
    } else {
      console.log('   Using DIRECT mode: CTF.redeemPositions(...)');
      const ctfContract = new ethers.Contract(CTF_ADDRESS, CTF_REDEEM_ABI, wallet);
      tx = await ctfContract.redeemPositions(
        collateralToken,
        parentCollectionId,
        conditionId,
        indexSets,
        { maxPriorityFeePerGas, maxFeePerGas }
      );
    }

    console.log(`   ✅ Tx sent: ${tx.hash}`);
    console.log(`   🔗 https://polygonscan.com/tx/${tx.hash}`);

    console.log('\n⏳ Waiting for confirmation...');
    const receipt = await Promise.race([
      tx.wait(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 45s')), 45000)),
    ]);

    console.log(`\n📋 RESULT:`);
    console.log(`   Status: ${receipt.status === 1 ? '✅ SUCCESS' : '❌ REVERTED'}`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

    if (receipt.status === 1) {
      const events = parsePayoutRedemptionEvents(receipt);
      if (events.length > 0) {
        let totalPayout = 0;
        for (const event of events) {
          console.log(`   💰 Payout: $${event.payoutUSDC.toFixed(2)} USDC`);
          totalPayout += event.payoutUSDC;
        }
        console.log(`\n🎉 TOTAL REDEEMED: $${totalPayout.toFixed(2)} USDC`);
      }
    }
  } catch (err: any) {
    console.error(`\n❌ Transaction failed: ${err.shortMessage || err.message}`);
    
    if (err.message?.includes('not authorized') || err.code === 'CALL_EXCEPTION') {
      console.error('\n💡 The signer is not authorized for this proxy.');
      console.error('   Your private key may not control the Polymarket proxy wallet.');
    }
  }
}

main().catch((e) => {
  console.error('\n❌ ERROR:', e.message || e);
  process.exit(1);
});
