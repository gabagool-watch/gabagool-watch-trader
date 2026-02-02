/**
 * Derive or Create CLOB API Credentials
 * 
 * Usage: npx tsx scripts/derive-api-keys.ts
 * 
 * This script uses the @polymarket/clob-client to derive L2 API credentials
 * from your wallet's private key via L1 authentication.
 * 
 * For Magic/POLY_PROXY wallets, use signatureType=1
 * For EOA wallets, use signatureType=0
 * For Gnosis Safe wallets, use signatureType=2
 */

import { ClobClient } from '@polymarket/clob-client';
import { config } from '../src/config.js';

const CLOB_API_URL = 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon mainnet

async function main() {
  console.log('\n🔑 DERIVE CLOB API CREDENTIALS');
  console.log('='.repeat(60));

  const privateKey = config.polymarket.privateKey;
  const address = config.polymarket.address;
  const signatureType = config.polymarket.signatureType ?? 1; // Default to POLY_PROXY for Magic wallets

  console.log(`\n📋 Configuration:`);
  console.log(`   Wallet address: ${address}`);
  console.log(`   Signature type: ${signatureType} (${signatureType === 0 ? 'EOA' : signatureType === 1 ? 'POLY_PROXY/Magic' : 'GNOSIS_SAFE'})`);
  console.log(`   Private key: ${privateKey ? '✅ set' : '❌ MISSING'}`);

  if (!privateKey || !address) {
    console.error('\n❌ Missing POLYMARKET_PRIVATE_KEY or POLYMARKET_ADDRESS!');
    process.exit(1);
  }

  console.log('\n📡 Initializing CLOB client...');
  
  try {
    // Initialize client without API credentials (we're deriving them)
    const clobClient = new ClobClient(
      CLOB_API_URL,
      CHAIN_ID,
      privateKey as `0x${string}`,
      undefined, // No API creds yet
      signatureType
    );

    console.log('   ✅ Client initialized');

    console.log('\n🔐 Deriving API credentials via L1 authentication...');
    console.log('   (This will sign a message with your private key)');

    // Try to derive existing credentials first
    let apiCreds;
    try {
      console.log('\n   Attempting deriveApiKey() first...');
      apiCreds = await clobClient.deriveApiKey();
      console.log('   ✅ Derived existing credentials!');
    } catch (deriveError: any) {
      console.log(`   ⚠️ deriveApiKey() failed: ${deriveError.message}`);
      console.log('   Attempting createApiKey() to create new credentials...');
      
      try {
        apiCreds = await clobClient.createApiKey();
        console.log('   ✅ Created new credentials!');
      } catch (createError: any) {
        console.error(`   ❌ createApiKey() also failed: ${createError.message}`);
        throw createError;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 SUCCESS! Here are your L2 API credentials:');
    console.log('='.repeat(60));
    console.log('\nAdd these to your .env file:\n');
    console.log(`POLYMARKET_API_KEY=${apiCreds.apiKey}`);
    console.log(`POLYMARKET_API_SECRET=${apiCreds.secret}`);
    console.log(`POLYMARKET_PASSPHRASE=${apiCreds.passphrase}`);
    console.log('\n' + '='.repeat(60));

    // Test the new credentials
    console.log('\n📋 Testing new credentials...');
    
    const testClient = new ClobClient(
      CLOB_API_URL,
      CHAIN_ID,
      privateKey as `0x${string}`,
      {
        key: apiCreds.apiKey,
        secret: apiCreds.secret,
        passphrase: apiCreds.passphrase,
      },
      signatureType
    );

    // Try to get API keys to verify
    const apiKeys = await testClient.getApiKeys();
    console.log(`   ✅ Credentials verified! Found ${apiKeys.length} API key(s) for this wallet.`);

  } catch (error: any) {
    console.error('\n❌ Failed to derive credentials:', error.message);
    
    if (error.message?.includes('signature')) {
      console.error('\n💡 This might be a signature type mismatch.');
      console.error('   If you have a Magic wallet, make sure POLYMARKET_SIGNATURE_TYPE=1');
      console.error('   If you have an EOA wallet, use POLYMARKET_SIGNATURE_TYPE=0');
    }
    
    process.exit(1);
  }

  console.log('\n✅ Done!\n');
}

main().catch(console.error);
