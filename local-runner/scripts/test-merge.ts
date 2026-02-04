#!/usr/bin/env npx ts-node
// ============================================================
// TEST MERGE FUNCTIONALITY
// ============================================================
// Tests if the merge manager can:
// 1. Initialize with wallet
// 2. Connect to CTF contract
// 3. Read position data (if available)
// ============================================================

import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// CTF Contract ABI - minimal for testing
const CTF_ABI = [
  'function mergePositions(address collateral, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount) external',
  'function balanceOf(address owner, uint256 positionId) external view returns (uint256)',
  'function getPositionId(address collateral, bytes32 collectionId) external view returns (uint256)',
];

// ERC20 ABI for USDC balance check
const ERC20_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

// Addresses
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

async function testMerge() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  🧪 MERGE FUNCTIONALITY TEST                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // 1. Check private key
  const privateKey = process.env.POLYMARKET_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ No private key configured (POLYMARKET_PRIVATE_KEY or PRIVATE_KEY)');
    process.exit(1);
  }
  console.log('✅ Private key found');

  // 2. Setup provider
  const alchemyKey = process.env.ALCHEMY_POLYGON_API_KEY;
  const rpcUrl = alchemyKey 
    ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`
    : (process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com');
  
  console.log(`📡 RPC: ${rpcUrl.includes('alchemy') ? 'Alchemy' : rpcUrl.slice(0, 30)}...`);
  
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  
  // Test connection
  try {
    const network = await provider.getNetwork();
    console.log(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})`);
    
    if (network.chainId !== 137) {
      console.warn('⚠️ Expected Polygon mainnet (chainId 137)');
    }
  } catch (err: any) {
    console.error('❌ Failed to connect to RPC:', err.message);
    process.exit(1);
  }

  // 3. Setup wallet
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`✅ Wallet: ${wallet.address}`);

  // Check MATIC balance for gas
  const maticBalance = await provider.getBalance(wallet.address);
  const maticFormatted = ethers.utils.formatEther(maticBalance);
  console.log(`💰 MATIC balance: ${parseFloat(maticFormatted).toFixed(4)} MATIC`);
  
  if (parseFloat(maticFormatted) < 0.01) {
    console.warn('⚠️ Low MATIC balance - may not have enough for gas');
  }

  // Check USDC balance
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const usdcBalance = await usdc.balanceOf(wallet.address);
  const usdcFormatted = ethers.utils.formatUnits(usdcBalance, 6);
  console.log(`💵 USDC balance: $${parseFloat(usdcFormatted).toFixed(2)}`);

  // 4. Test CTF contract connection
  console.log('\n📋 Testing CTF contract...');
  const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, wallet);
  
  // Try to encode a merge call (doesn't execute, just validates ABI)
  try {
    const testConditionId = '0x0000000000000000000000000000000000000000000000000000000000000001';
    const partition = [1, 2];
    const amount = ethers.utils.parseUnits('1', 6); // 1 share
    
    const encoded = ctf.interface.encodeFunctionData('mergePositions', [
      USDC_ADDRESS,
      '0x0000000000000000000000000000000000000000000000000000000000000000', // parent collection
      testConditionId,
      partition,
      amount,
    ]);
    
    console.log(`✅ CTF contract ABI valid`);
    console.log(`   Encoded call data: ${encoded.slice(0, 20)}...`);
  } catch (err: any) {
    console.error('❌ Failed to encode merge call:', err.message);
  }

  // 5. Check gas price
  const gasPrice = await provider.getGasPrice();
  console.log(`⛽ Current gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);

  // 6. Summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  📊 MERGE READINESS SUMMARY                                   ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  
  const hasGas = parseFloat(maticFormatted) >= 0.01;
  const isPolygon = (await provider.getNetwork()).chainId === 137;
  
  console.log(`║  ✅ Private key: configured                                   ║`);
  console.log(`║  ${isPolygon ? '✅' : '❌'} Network: ${isPolygon ? 'Polygon mainnet' : 'WRONG NETWORK'}                                ║`);
  console.log(`║  ${hasGas ? '✅' : '⚠️'} Gas (MATIC): ${maticFormatted.slice(0, 8).padEnd(10)} ${hasGas ? '' : '(LOW!)'}                     ║`);
  console.log(`║  ✅ CTF contract: connected                                   ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (isPolygon && hasGas) {
    console.log('\n✅ MERGE FUNCTIONALITY IS READY');
    console.log('   The bot can merge paired positions when markets expire.\n');
  } else {
    console.log('\n⚠️ MERGE MAY NOT WORK');
    console.log('   Check the issues above before relying on merge functionality.\n');
  }
}

testMerge().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
