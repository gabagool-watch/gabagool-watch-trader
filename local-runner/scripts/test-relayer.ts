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
import pkg from 'ethers';
const { Wallet } = pkg as any;

const CLOB_API_URL = 'https://clob.polymarket.com';

function toUrlSafeBase64(b64: string): string {
  // Match the runner's implementation: url-safe base64, KEEP padding
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
  body: string = '',
  signatureVariant: 'base64url' | 'base64' = 'base64url'
): string {
  const message = `${timestampSeconds}${method.toUpperCase()}${requestPath}${body}`;
  const digest = crypto.createHmac('sha256', secretBytes).update(message).digest();
  const b64 = Buffer.from(digest).toString('base64');
  return signatureVariant === 'base64url' ? toUrlSafeBase64(b64) : b64;
}

function decodeSecret(secret: string, variant: 'base64url' | 'base64'): Buffer | null {
  if (!secret) return null;
  try {
    if (variant === 'base64url') {
      const normalized = sanitizeBase64Secret(secret);
      const bytes = Buffer.from(normalized, 'base64');
      return bytes.length > 0 ? bytes : null;
    }

    // base64 (strict-ish)
    const trimmed = secret.trim();
    const bytes = Buffer.from(trimmed, 'base64');
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('\n🧪 CLOB API AUTH TEST');
  console.log('='.repeat(60));

  // Step 1: Check credentials - BOTH sets
  console.log('\n📋 STEP 1: Checking API credentials...');
  
  // Regular CLOB credentials
  const regularApiKey = config.polymarket.apiKey;
  const regularApiSecret = config.polymarket.apiSecret;
  const regularPassphrase = config.polymarket.passphrase;
  const funderAddress = config.polymarket.address;
  const signerAddress = (() => {
    try {
      const w = new Wallet(config.polymarket.privateKey);
      return String(w.address);
    } catch {
      return null;
    }
  })();
  
  // Builder credentials (for comparison)
  const builderApiKey = config.polymarket.builderApiKey;
  const builderApiSecret = config.polymarket.builderApiSecret;
  const builderPassphrase = config.polymarket.builderPassphrase;

  console.log('\n   Regular CLOB credentials:');
  console.log(`   POLYMARKET_API_KEY: ${regularApiKey ? `✅ set (${regularApiKey.length} chars, starts with "${regularApiKey.slice(0, 8)}...")` : '❌ MISSING'}`);
  console.log(`   POLYMARKET_API_SECRET: ${regularApiSecret ? `✅ set (${regularApiSecret.length} chars)` : '❌ MISSING'}`);
  console.log(`   POLYMARKET_PASSPHRASE: ${regularPassphrase ? `✅ set (${regularPassphrase.length} chars)` : '❌ MISSING'}`);
  console.log(`   POLYMARKET_ADDRESS (funder): ${funderAddress ? `✅ set (${funderAddress.slice(0, 10)}...)` : '❌ MISSING'}`);
  console.log(`   Signer (from private key): ${signerAddress ? `✅ ${signerAddress.slice(0, 10)}...` : '⚠️ unavailable'}`);

  console.log('\n   Builder credentials (for reference):');
  console.log(`   POLY_BUILDER_API_KEY: ${builderApiKey ? `✅ set (${builderApiKey.length} chars)` : '⚠️ not set'}`);
  console.log(`   POLY_BUILDER_API_SECRET: ${builderApiSecret ? `✅ set (${builderApiSecret.length} chars)` : '⚠️ not set'}`);
  console.log(`   POLY_BUILDER_PASSPHRASE: ${builderPassphrase ? `✅ set (${builderPassphrase.length} chars)` : '⚠️ not set'}`);

  if (!regularApiKey || !regularApiSecret || !regularPassphrase || !funderAddress) {
    console.error('\n❌ Missing regular CLOB API credentials!');
    process.exit(1);
  }

  console.log('\n   ✅ Regular credentials present!');

  // Step 2: Test signature generation with REGULAR credentials
  console.log('\n📋 STEP 2: Testing HMAC signature generation...');
  
  let secretBytes: Buffer;
  try {
    const sanitizedSecret = sanitizeBase64Secret(regularApiSecret);
    secretBytes = Buffer.from(sanitizedSecret, 'base64');
    console.log(`   Sanitized secret length: ${sanitizedSecret.length} chars`);
    console.log(`   Secret bytes length: ${secretBytes.length} bytes`);

    const testTimestamp = Math.floor(Date.now() / 1000).toString();
    const testSignature = buildRelayerSignature(secretBytes, testTimestamp, 'GET', '/health', '', 'base64url');
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

  // Step 4: Test authenticated endpoint with REGULAR credentials
  console.log('\n📋 STEP 4: Testing authenticated CLOB API call (regular credentials)...');

  const endpointsToTry = ['/auth/api-keys'];
  const secretVariants: Array<{ label: 'base64url' | 'base64'; bytes: Buffer }> = [
    { label: 'base64url', bytes: decodeSecret(regularApiSecret, 'base64url')! },
    { label: 'base64', bytes: decodeSecret(regularApiSecret, 'base64')! },
  ].filter((v) => Boolean(v.bytes)) as Array<{ label: 'base64url' | 'base64'; bytes: Buffer }>;

  const signatureVariants: Array<'base64url' | 'base64'> = ['base64url', 'base64'];

  let authSucceeded = false;
  let lastStatus: number | null = null;

  for (const path of endpointsToTry) {
    for (const secretVariant of secretVariants) {
      for (const signatureVariant of signatureVariants) {
        try {
          // IMPORTANT: Polymarket uses MILLISECONDS, not seconds!
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const method = 'GET';

          const signature = buildRelayerSignature(
            secretVariant.bytes,
            timestamp,
            method,
            path,
            '',
            signatureVariant
          );

          const headers: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            // Match runner behavior: POLY_ADDRESS should be the SIGNER address
            POLY_ADDRESS: signerAddress ?? funderAddress,
            POLY_API_KEY: regularApiKey,
            POLY_PASSPHRASE: regularPassphrase,
            POLY_SIGNATURE: signature,
            POLY_TIMESTAMP: timestamp,
          };

          console.log(
            `\n   Attempt: endpoint=${path} secret=${secretVariant.label} signature=${signatureVariant} timestamp=${timestamp}`
          );

          const response = await fetch(`${CLOB_API_URL}${path}`, { method, headers });
          lastStatus = response.status;
          const text = await response.text();

          console.log(`   Response status: ${response.status} ${response.statusText}`);
          if (text) console.log(`   Response: ${text.slice(0, 200)}`);

          if (response.ok) {
            console.log('   ✅ Authenticated API call successful!');
            authSucceeded = true;
            break;
          }
        } catch (e) {
          console.error(`   ❌ Authenticated API call failed: ${e}`);
        }
      }
      if (authSucceeded) break;
    }
    if (authSucceeded) break;
  }

  if (!authSucceeded) {
    if (lastStatus === 401 || lastStatus === 403) {
      console.log(
        '\n   ⚠️ Still unauthorized after trying multiple encodings. This strongly suggests the API key/secret/passphrase set is invalid or not enabled for this address.'
      );
    }
  }

  // Step 5: Check POLYMARKET_SIGNATURE_TYPE
  console.log('\n📋 STEP 5: Checking signature type configuration...');
  console.log(`   POLYMARKET_SIGNATURE_TYPE: ${config.polymarket.signatureType ?? 'not set'}`);
  
  if (config.polymarket.signatureType === 1) {
    console.log('   ✅ Set to 1 (POLY_PROXY / Magic wallet)');
  } else if (config.polymarket.signatureType === undefined) {
    console.log('   ⚠️ Not set - will auto-detect wallet type');
    console.log('   💡 TIP: Set POLYMARKET_SIGNATURE_TYPE=1 in .env to force POLY_PROXY (Magic) wallet routing');
  } else {
    console.log(`   ℹ️ Set to ${config.polymarket.signatureType} - may use direct on-chain method`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Test complete!\n');
}

main().catch(console.error);
