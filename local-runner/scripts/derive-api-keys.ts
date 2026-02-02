/**
 * Derive or Create CLOB API Credentials
 * 
 * Usage: 
 *   npx tsx scripts/derive-api-keys.ts          # Safe: only derives existing
 *   npx tsx scripts/derive-api-keys.ts --create # Creates NEW credentials (may invalidate old!)
 * 
 * This script uses the @polymarket/clob-client to derive L2 API credentials
 * from your wallet's private key via L1 authentication.
 * 
 * For Magic/POLY_PROXY wallets, use signatureType=1
 * For EOA wallets, use signatureType=0
 * For Gnosis Safe wallets, use signatureType=2
 * 
 * ⚠️ WARNING: Using --create may invalidate existing credentials!
 *    Stop the bot first if you use --create.
 */

import { ClobClient } from '@polymarket/clob-client';
import { config } from '../src/config.js';

const CLOB_API_URL = 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon mainnet

const FORCE_CREATE = process.argv.includes('--create');

async function main() {
  console.log('\n🔑 DERIVE CLOB API CREDENTIALS');
  console.log('='.repeat(60));

  if (FORCE_CREATE) {
    console.log('\n⚠️  WARNING: --create flag detected!');
    console.log('   This will create NEW credentials and may INVALIDATE existing ones.');
    console.log('   Make sure the bot is STOPPED before continuing!');
    console.log('\n   Press Ctrl+C within 5 seconds to abort...');
    await new Promise(r => setTimeout(r, 5000));
    console.log('   Continuing...\n');
  }

  const privateKey = config.polymarket.privateKey;
  const address = config.polymarket.address;
  const signatureType = config.polymarket.signatureType ?? 1; // Default to POLY_PROXY for Magic wallets

  console.log(`\n📋 Configuration:`);
  console.log(`   Wallet address: ${address}`);
  console.log(`   Signature type: ${signatureType} (${signatureType === 0 ? 'EOA' : signatureType === 1 ? 'POLY_PROXY/Magic' : 'GNOSIS_SAFE'})`);
  console.log(`   Private key: ${privateKey ? '✅ set' : '❌ MISSING'}`);
  console.log(`   Mode: ${FORCE_CREATE ? '🆕 CREATE (may invalidate old creds!)' : '🔍 DERIVE ONLY (safe)'}`);

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

    console.log('\n🔐 Attempting to derive existing API credentials...');
    console.log('   (This will sign a message with your private key)');

    let apiCreds;
    try {
      apiCreds = await clobClient.deriveApiKey();
      console.log('   ✅ Successfully derived existing credentials!');
    } catch (deriveError: any) {
      console.log(`\n   ⚠️ deriveApiKey() failed: ${deriveError.message}`);
      
      if (!FORCE_CREATE) {
        console.log('\n   No existing credentials found for this wallet.');
        console.log('   To create NEW credentials, run:');
        console.log('   npx tsx scripts/derive-api-keys.ts --create');
        console.log('\n   ⚠️ IMPORTANT: Stop the bot first before using --create!');
        process.exit(1);
      }

      console.log('\n   Creating NEW credentials (--create flag was set)...');
      
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
    console.log('\n📋 Testing credentials...');
    
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

main().catch(console.error);
