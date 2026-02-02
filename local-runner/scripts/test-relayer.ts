/**
 * Test Relayer API Script
 * 
 * Usage: npx tsx scripts/test-relayer.ts
 * 
 * This script tests:
 * 1. Builder API credentials loading
 * 2. Relayer API connectivity
 * 3. HMAC signature generation
 */

import { config } from '../src/config.js';
import crypto from 'node:crypto';

const CLOB_API_URL = 'https://clob.polymarket.com';

function toUrlSafeBase64(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

function sanitizeBase64Secret(secret: string): string {
  let s = secret.trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');

  const pad = s.length % 4;
  if (pad === 2) s += '==';
  if (pad === 3) s += '=';
  return s;
}

function buildRelayerSignature(
  secretBytes: Buffer,
  timestampSeconds: string,
  method: string,
  requestPath: string,
  body: string = ''
): string {
  const message = `${timestampSeconds}${method.toUpperCase()}${requestPath}${body}`;
  const digest = crypto.createHmac('sha256', secretBytes).update(message).digest();
  return toUrlSafeBase64(Buffer.from(digest).toString('base64'));
}

async function main() {
  console.log('\n🧪 RELAYER API TEST');
  console.log('='.repeat(60));

  // Step 1: Check credentials
  console.log('\n📋 STEP 1: Checking Builder API credentials...');
  
  const apiKey = config.polymarket.builderApiKey;
  const apiSecret = config.polymarket.builderApiSecret;
  const passphrase = config.polymarket.builderPassphrase;

  console.log(`   POLY_BUILDER_API_KEY: ${apiKey ? `✅ set (${apiKey.length} chars, starts with "${apiKey.slice(0, 8)}...")` : '❌ MISSING'}`);
  console.log(`   POLY_BUILDER_API_SECRET: ${apiSecret ? `✅ set (${apiSecret.length} chars)` : '❌ MISSING'}`);
  console.log(`   POLY_BUILDER_PASSPHRASE: ${passphrase ? `✅ set (${passphrase.length} chars)` : '❌ MISSING'}`);

  if (!apiKey || !apiSecret || !passphrase) {
    console.error('\n❌ Missing Builder API credentials!');
    console.error('   Make sure these are in your .env file:');
    console.error('   - POLY_BUILDER_API_KEY');
    console.error('   - POLY_BUILDER_API_SECRET');
    console.error('   - POLY_BUILDER_PASSPHRASE');
    process.exit(1);
  }

  console.log('\n   ✅ All credentials present!');

  // Step 2: Test signature generation
  console.log('\n📋 STEP 2: Testing HMAC signature generation...');
  
  try {
    const sanitizedSecret = sanitizeBase64Secret(apiSecret);
    const secretBytes = Buffer.from(sanitizedSecret, 'base64');
    console.log(`   Sanitized secret length: ${sanitizedSecret.length} chars`);
    console.log(`   Secret bytes length: ${secretBytes.length} bytes`);

    const testTimestamp = Math.floor(Date.now() / 1000).toString();
    const testSignature = buildRelayerSignature(secretBytes, testTimestamp, 'GET', '/health');
    console.log(`   Test signature: ${testSignature.slice(0, 20)}...`);
    console.log('   ✅ Signature generation works!');
  } catch (e) {
    console.error(`   ❌ Signature generation failed: ${e}`);
    process.exit(1);
  }

  // Step 3: Test CLOB API connectivity (simple health check)
  console.log('\n📋 STEP 3: Testing CLOB API connectivity...');
  
  try {
    // First, test basic connectivity to the CLOB API
    const response = await fetch(`${CLOB_API_URL}/`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    
    console.log(`   Response status: ${response.status} ${response.statusText}`);
    
    if (response.ok || response.status === 404 || response.status === 405) {
      // 404/405 is fine - means we reached the server but endpoint doesn't exist
      console.log('   ✅ CLOB API is reachable!');
    } else {
      const text = await response.text();
      console.log(`   Response body: ${text.slice(0, 200)}`);
    }
  } catch (e) {
    console.error(`   ❌ Cannot reach CLOB API: ${e}`);
    console.error('   This might be a network/DNS issue on the VPS.');
  }

  // Step 4: Test authenticated endpoint
  console.log('\n📋 STEP 4: Testing authenticated CLOB API call...');
  
  try {
    const sanitizedSecret = sanitizeBase64Secret(apiSecret);
    const secretBytes = Buffer.from(sanitizedSecret, 'base64');
    // IMPORTANT: Polymarket uses MILLISECONDS, not seconds!
    const timestamp = Date.now().toString();
    const method = 'GET';
    const path = '/auth/api-keys'; // Standard auth check endpoint
    
    const signature = buildRelayerSignature(secretBytes, timestamp, method, path);
    
    // Get wallet address from config
    const address = config.polymarket.address;
    
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'POLY_ADDRESS': address,
      'POLY_API_KEY': apiKey,
      'POLY_PASSPHRASE': passphrase,
      'POLY_SIGNATURE': signature,
      'POLY_TIMESTAMP': timestamp,
    };

    console.log(`   Making authenticated request to ${CLOB_API_URL}${path}`);
    console.log(`   Headers: POLY_API_KEY=${apiKey.slice(0, 8)}..., POLY_ADDRESS=${address.slice(0, 10)}..., POLY_TIMESTAMP=${timestamp}`);
    
    const response = await fetch(`${CLOB_API_URL}${path}`, {
      method,
      headers,
    });
    
    console.log(`   Response status: ${response.status} ${response.statusText}`);
    
    const text = await response.text();
    if (text) {
      try {
        const json = JSON.parse(text);
        console.log(`   Response: ${JSON.stringify(json).slice(0, 200)}`);
      } catch {
        console.log(`   Response: ${text.slice(0, 200)}`);
      }
    }

    if (response.ok) {
      console.log('   ✅ Authenticated API call successful!');
    } else if (response.status === 401 || response.status === 403) {
      console.log('   ⚠️ Authentication failed - check credentials');
    } else if (response.status === 404) {
      console.log('   ⚠️ Endpoint not found - but server is reachable');
    }
  } catch (e) {
    console.error(`   ❌ Authenticated API call failed: ${e}`);
  }

  // Step 5: Check POLYMARKET_SIGNATURE_TYPE
  console.log('\n📋 STEP 5: Checking signature type configuration...');
  console.log(`   POLYMARKET_SIGNATURE_TYPE: ${config.polymarket.signatureType ?? 'not set'}`);
  
  if (config.polymarket.signatureType === 1) {
    console.log('   ✅ Set to 1 (POLY_PROXY / Magic wallet) - CLOB API with Builder creds will be used');
  } else if (config.polymarket.signatureType === undefined) {
    console.log('   ⚠️ Not set - will auto-detect wallet type');
    console.log('   💡 TIP: Set POLYMARKET_SIGNATURE_TYPE=1 in .env to force CLOB API with Builder creds');
  } else {
    console.log(`   ℹ️ Set to ${config.polymarket.signatureType} - may use direct on-chain method`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Test complete!\n');
}

main().catch(console.error);
