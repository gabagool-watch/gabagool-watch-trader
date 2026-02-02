/**
 * Test Relayer v3 - Using Official Builder Relayer Client endpoints
 *
 * Based on Polymarket's official SDK:
 * - https://github.com/Polymarket/builder-relayer-client
 * - https://github.com/Polymarket/py-builder-relayer-client
 *
 * Key findings from docs:
 * - Endpoints: /submit, /nonce, /relay-payload, /deployed, /transaction
 * - Staging URL: https://relayer-v2-staging.polymarket.dev/
 * - Prod URL: https://relayer-v2.polymarket.dev/ (assumed)
 *
 * Usage:
 *   cd local-runner
 *   npx tsx scripts/test-relayer-v3.ts <conditionId>
 */

import '../src/config.js';
import { config } from '../src/config.js';
import pkg from 'ethers';
const { ethers } = pkg as any;
import crypto from 'node:crypto';

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// RELAYER URLs to try (from official SDK documentation)
const RELAYER_URLS = [
  'https://relayer-v2.polymarket.dev',        // Production (assumed)
  'https://relayer.polymarket.dev',            // Alt production
  'https://relayer-v2-staging.polymarket.dev', // Staging (from py-builder README)
  'https://relayer.polymarket.com',            // Legacy?
];

const CTF_REDEEM_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets) external',
];

function toUrlSafeBase64(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sanitizeBase64Secret(secret: string): string {
  let s = secret
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');

  const pad = s.length % 4;
  if (pad === 2) s += '==';
  if (pad === 3) s += '=';
  return s;
}

function buildHmacSignature(
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

function requireBuilderCreds(): void {
  if (!config.polymarket.builderApiKey || !config.polymarket.builderApiSecret || !config.polymarket.builderPassphrase) {
    console.error('\n❌ Missing Builder credentials!');
    console.error(`   POLY_BUILDER_API_KEY: ${config.polymarket.builderApiKey ? '✅' : '❌'}`);
    console.error(`   POLY_BUILDER_API_SECRET: ${config.polymarket.builderApiSecret ? '✅' : '❌'}`);
    console.error(`   POLY_BUILDER_PASSPHRASE: ${config.polymarket.builderPassphrase ? '✅' : '❌'}`);
    process.exit(1);
  }
}

async function testEndpoint(baseUrl: string, path: string, method: string, body?: string): Promise<{status: number; text: string}> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return { status: res.status, text: await res.text() };
  } catch (e: any) {
    return { status: 0, text: e.message };
  }
}

async function main() {
  const conditionId = process.argv[2];
  if (!conditionId) {
    console.error('Usage: npx tsx scripts/test-relayer-v3.ts <conditionId>');
    process.exit(1);
  }

  const collateralToken = config.polymarket.usdcAddress;
  const proxyWallet = config.polymarket.address;

  console.log(`\n🧪 TEST RELAYER V3 (Official SDK Endpoints)`);
  console.log('='.repeat(60));
  console.log(`📍 Proxy wallet: ${proxyWallet}`);
  console.log(`📍 Condition ID: ${conditionId}`);
  console.log(`📍 Collateral: ${collateralToken}`);

  requireBuilderCreds();
  console.log(`\n✅ Builder credentials configured`);
  console.log(`   API Key: ${config.polymarket.builderApiKey.slice(0, 15)}...`);

  const secretBytes = Buffer.from(sanitizeBase64Secret(config.polymarket.builderApiSecret), 'base64');

  // Step 1: Find working relayer URL
  console.log(`\n📡 Step 1: Testing Relayer URLs for connectivity...\n`);
  
  let workingUrl: string | null = null;
  
  for (const baseUrl of RELAYER_URLS) {
    console.log(`🔗 Testing: ${baseUrl}`);
    
    // Health check
    const health = await testEndpoint(baseUrl, '/', 'GET');
    console.log(`   GET /: ${health.status || 'FAILED'} ${health.text.slice(0, 100)}`);
    
    // Test /nonce endpoint (from SDK)
    const nonce = await testEndpoint(baseUrl, `/nonce?address=${proxyWallet}&type=PROXY`, 'GET');
    console.log(`   GET /nonce: ${nonce.status || 'FAILED'} ${nonce.text.slice(0, 100)}`);
    
    // Test /relay-payload endpoint
    const relayPayload = await testEndpoint(baseUrl, `/relay-payload?address=${proxyWallet}&type=PROXY`, 'GET');
    console.log(`   GET /relay-payload: ${relayPayload.status || 'FAILED'} ${relayPayload.text.slice(0, 100)}`);
    
    // Test /deployed endpoint
    const deployed = await testEndpoint(baseUrl, `/deployed?address=${proxyWallet}`, 'GET');
    console.log(`   GET /deployed: ${deployed.status || 'FAILED'} ${deployed.text.slice(0, 100)}`);
    
    if (nonce.status === 200 || relayPayload.status === 200) {
      workingUrl = baseUrl;
      console.log(`   ✅ WORKING URL FOUND!`);
    }
    console.log('');
  }

  if (!workingUrl) {
    console.log(`❌ No working relayer URL found.`);
    console.log(`\n💡 The Relayer API may require builder program access.`);
    console.log(`   Contact Polymarket support: https://polymarket.com/support`);
    process.exit(2);
  }

  // Step 2: Try to submit a transaction
  console.log(`\n📡 Step 2: Attempting redemption via ${workingUrl}/submit ...\n`);

  // Build redeemPositions calldata
  const indexSets = [1, 2];
  const parentCollectionId = ethers.utils.hexZeroPad('0x00', 32);
  const ctfInterface = new ethers.utils.Interface(CTF_REDEEM_ABI);
  const redeemCalldata = ctfInterface.encodeFunctionData('redeemPositions', [
    collateralToken,
    parentCollectionId,
    conditionId,
    indexSets,
  ]);

  // Get relay payload first
  const relayPayloadRes = await testEndpoint(workingUrl, `/relay-payload?address=${proxyWallet}&type=PROXY`, 'GET');
  console.log(`📥 Relay payload: ${relayPayloadRes.text.slice(0, 200)}`);
  
  let relayPayload: any;
  try {
    relayPayload = JSON.parse(relayPayloadRes.text);
  } catch {
    console.log(`❌ Could not parse relay payload`);
    process.exit(2);
  }

  // Build the transaction request according to SDK format
  const timestampSeconds = String(Math.floor(Date.now() / 1000));
  const submitPath = '/submit';
  
  // ProxyTransaction format from SDK
  const proxyTx = {
    to: CTF_ADDRESS,
    typeCode: 0, // CallType.Call
    data: redeemCalldata,
    value: '0',
  };

  // ProxyTransactionRequest format
  const request = {
    type: 'PROXY',
    from: proxyWallet,
    transactions: [proxyTx],
    nonce: relayPayload.nonce,
    description: `Auto-redeem ${conditionId.slice(0, 20)}...`,
  };

  const bodyStr = JSON.stringify(request);
  const signature = buildHmacSignature(secretBytes, timestampSeconds, 'POST', submitPath, bodyStr);

  // Builder headers according to SDK
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'POLY_BUILDER_API_KEY': config.polymarket.builderApiKey,
    'POLY_BUILDER_PASSPHRASE': config.polymarket.builderPassphrase,
    'POLY_BUILDER_SIGNATURE': signature,
    'POLY_BUILDER_TIMESTAMP': timestampSeconds,
  };

  console.log(`📤 Submitting transaction...`);
  console.log(`   Request: ${bodyStr.slice(0, 200)}...`);

  try {
    const res = await fetch(`${workingUrl}${submitPath}`, {
      method: 'POST',
      headers,
      body: bodyStr,
    });

    const text = await res.text();
    console.log(`\n📬 Response: ${res.status} ${res.statusText}`);
    console.log(`   Body: ${text.slice(0, 500)}`);

    if (res.ok) {
      console.log(`\n🎉 SUCCESS! Transaction submitted.`);
      try {
        const result = JSON.parse(text);
        if (result.transactionID) {
          console.log(`   Transaction ID: ${result.transactionID}`);
          console.log(`   Check status: ${workingUrl}/transaction?id=${result.transactionID}`);
        }
      } catch {}
    } else {
      console.log(`\n❌ Submission failed.`);
    }
  } catch (e: any) {
    console.log(`\n❌ Request failed: ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
