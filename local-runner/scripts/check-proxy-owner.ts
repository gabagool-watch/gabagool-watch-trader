/**
 * Check Proxy Owner Script
 * 
 * Usage: npx tsx scripts/check-proxy-owner.ts [proxy_address]
 * 
 * This script checks who owns a Polymarket proxy wallet and whether
 * your configured signer can execute transactions on it.
 */

import { config } from '../src/config.js';
import pkg from 'ethers';
const { ethers, Wallet } = pkg;
import { getProvider, getProxyOwner } from '../src/chain.js';

async function main() {
  console.log('\n🔍 POLYMARKET PROXY OWNER CHECK');
  console.log('='.repeat(60));

  const provider = getProvider();
  
  // Get addresses from config or command line
  const proxyAddress = process.argv[2] || config.polymarket.address;
  const signerAddress = config.polymarket.privateKey 
    ? new Wallet(config.polymarket.privateKey).address 
    : null;

  if (!proxyAddress) {
    console.error('❌ No proxy address provided. Set POLYMARKET_ADDRESS or pass as argument.');
    process.exit(1);
  }

  console.log(`\n📍 ADDRESSES:`);
  console.log(`   Proxy wallet: ${proxyAddress}`);
  console.log(`   Signer (EOA): ${signerAddress || 'not configured'}`);
  
  // Check proxy balance
  console.log(`\n💰 BALANCES:`);
  const proxyBalance = await provider.getBalance(proxyAddress);
  console.log(`   Proxy POL: ${ethers.utils.formatEther(proxyBalance)} POL`);
  
  if (signerAddress) {
    const signerBalance = await provider.getBalance(signerAddress);
    console.log(`   Signer POL: ${ethers.utils.formatEther(signerBalance)} POL`);
  }

  // Check proxy owner
  console.log(`\n🔐 OWNERSHIP CHECK:`);
  const ownerInfo = await getProxyOwner(proxyAddress);
  
  console.log(`   Proxy type: ${ownerInfo.proxyType}`);
  console.log(`   Owner address: ${ownerInfo.ownerAddress || 'UNKNOWN'}`);
  
  if (ownerInfo.gnosisOwners) {
    console.log(`   Gnosis owners: ${ownerInfo.gnosisOwners.join(', ')}`);
  }
  
  if (ownerInfo.error) {
    console.log(`   Error: ${ownerInfo.error}`);
  }

  // Check if signer can execute
  console.log(`\n✅ AUTHORIZATION CHECK:`);
  if (!signerAddress) {
    console.log(`   ⚠️ No signer configured - cannot check authorization`);
  } else if (!ownerInfo.ownerAddress) {
    console.log(`   ⚠️ Could not determine proxy owner - authorization unclear`);
    console.log(`\n💡 POSSIBLE REASONS:`);
    console.log(`   1. This is a Polymarket Magic wallet with custom architecture`);
    console.log(`   2. Only Polymarket's backend can claim for this wallet`);
    console.log(`   3. The proxy uses a non-standard ownership pattern`);
  } else {
    const isOwner = ownerInfo.isOwnedBy(signerAddress);
    if (isOwner) {
      console.log(`   ✅ Signer IS authorized to execute on this proxy`);
    } else {
      console.log(`   ❌ Signer is NOT the owner of this proxy!`);
      console.log(`\n💡 THE PROBLEM:`);
      console.log(`   Your signer: ${signerAddress}`);
      console.log(`   Proxy owner: ${ownerInfo.ownerAddress}`);
      console.log(`\n   These don't match! The proxy will reject execute() calls.`);
      
      console.log(`\n🔧 SOLUTIONS:`);
      console.log(`   1. Use the correct private key that owns this proxy`);
      console.log(`   2. Or, claim manually via Polymarket UI`);
      console.log(`   3. Or, export the correct private key from Polymarket`);
    }
  }

  // Additional diagnostics: check if proxy has code
  console.log(`\n📋 CONTRACT INFO:`);
  const code = await provider.getCode(proxyAddress);
  console.log(`   Has code: ${code !== '0x' ? 'Yes (' + code.length + ' bytes)' : 'No (EOA)'}`);
  
  // Read first 5 storage slots for debugging
  console.log(`\n📦 STORAGE SLOTS (debugging):`);
  for (let slot = 0; slot < 5; slot++) {
    try {
      const value = await provider.getStorageAt(proxyAddress, slot);
      if (value !== ethers.constants.HashZero) {
        console.log(`   Slot ${slot}: ${value}`);
        // Try to interpret as address
        const potentialAddr = '0x' + value.slice(26);
        if (potentialAddr !== '0x0000000000000000000000000000000000000000') {
          try {
            const checksumAddr = ethers.utils.getAddress(potentialAddr);
            console.log(`          → Could be address: ${checksumAddr}`);
          } catch {}
        }
      }
    } catch (e) {
      console.log(`   Slot ${slot}: (error reading)`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Done\n');
}

main().catch(console.error);
